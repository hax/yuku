//! Local dev harness (not part of the library): benchmarks the on-demand lexer
//! strategy against the batch strategy, where tokens are scanned up front into
//! an array and the parser reads from it.
//!   parse_bench bench <file>...   per phase best-of-N: parse, collect, array, lex
//!   parse_bench verify <file>...  checks the batch parse reproduces the on-demand tree
//!
//! Phases: `parse` is a full parse driving the lexer, `collect` adds token
//! collection (the batch strategy's first pass), `array` is the second pass
//! alone (parsing from the pre-scanned tokens), `lex` is a lexer-only drain
//! (the floor a real batch lexer could approach).

const std = @import("std");
const parser = @import("parser");
const ast = parser.ast;

fn nowNs(io: std.Io) u64 {
    const t = std.Io.Timestamp.now(io, .awake);
    return @intCast(t.nanoseconds);
}

fn optionsFor(basename: []const u8) parser.Options {
    return .{
        .lang = ast.Lang.fromPath(basename),
        .source_type = ast.SourceType.fromPath(basename),
    };
}

fn parseOnce(gpa: std.mem.Allocator, source: []const u8, basename: []const u8) !usize {
    var tree = try parser.parse(gpa, source, optionsFor(basename));
    defer tree.deinit();
    return tree.nodes.len;
}

fn collectOnce(gpa: std.mem.Allocator, source: []const u8, basename: []const u8) !usize {
    var options = optionsFor(basename);
    options.tokens = true;
    var tree = try parser.parse(gpa, source, options);
    defer tree.deinit();
    return tree.nodes.len + tree.tokens.len;
}

fn bench(
    io: std.Io,
    gpa: std.mem.Allocator,
    comptime label: []const u8,
    source: []const u8,
    basename: []const u8,
    run: fn (gpa: std.mem.Allocator, source: []const u8, basename: []const u8) anyerror!usize,
) !void {
    var sink: usize = 0;
    sink +%= try run(gpa, source, basename);

    var best: u64 = std.math.maxInt(u64);
    var iters: usize = 0;
    const t0 = nowNs(io);
    while (true) {
        const s = nowNs(io);
        sink +%= try run(gpa, source, basename);
        const dt = nowNs(io) - s;
        if (dt < best) best = dt;
        iters += 1;
        if (nowNs(io) - t0 >= 300_000_000 or iters >= 200) break;
    }
    std.mem.doNotOptimizeAway(&sink);
    const mb = @as(f64, @floatFromInt(source.len)) / 1e6;
    const secs = @as(f64, @floatFromInt(best)) / 1e9;
    std.debug.print("{s}\t{s}\t{d:.2}ms\t{d:.0}MB/s\t({d} iters)\n", .{
        basename, label, secs * 1000, mb / secs, iters,
    });
}

fn lexDrain(gpa: std.mem.Allocator, source: []const u8, basename: []const u8) !usize {
    _ = basename;
    var arena_state = std.heap.ArenaAllocator.init(gpa);
    defer arena_state.deinit();
    var lx = parser.lexer.Lexer.init(source, arena_state.allocator(), .module, false);
    var n: usize = 0;
    while (true) {
        // a bare drain cannot tell regex from division, so regex bodies can
        // mis-lex and error; skip a byte, the parser would rescue via re-scan
        const tok = lx.nextToken() catch {
            if (lx.cursor >= source.len) break;
            lx.cursor += 1;
            n += 1;
            continue;
        };
        n += 1;
        if (tok.tag == .eof) break;
    }
    return n;
}

fn benchArray(
    io: std.Io,
    gpa: std.mem.Allocator,
    source: []const u8,
    basename: []const u8,
) !void {
    var options = optionsFor(basename);
    options.tokens = true;
    var first = try parser.parse(gpa, source, options);
    defer first.deinit();
    if (first.diagnostics.items.len > 0) return error.CannotBenchmarkBatchOnErrorFiles;

    var sink: usize = 0;
    var best: u64 = std.math.maxInt(u64);
    var iters: usize = 0;
    const t0 = nowNs(io);
    while (true) {
        const s = nowNs(io);
        var tree = try parser.parseFromTokens(gpa, source, first.tokens, first.comments, optionsFor(basename));
        sink +%= tree.nodes.len;
        tree.deinit();
        const dt = nowNs(io) - s;
        if (dt < best) best = dt;
        iters += 1;
        if (nowNs(io) - t0 >= 300_000_000 or iters >= 200) break;
    }
    std.mem.doNotOptimizeAway(&sink);
    const mb = @as(f64, @floatFromInt(source.len)) / 1e6;
    const secs = @as(f64, @floatFromInt(best)) / 1e9;
    std.debug.print("{s}\tarray\t{d:.2}ms\t{d:.0}MB/s\t{d} tokens\t({d} iters)\n", .{
        basename, secs * 1000, mb / secs, first.tokens.len, iters,
    });
}

/// Simulated end-to-end batch parse: a busy wait stands in for the batch lexer
/// producing the array in `lex_ms` milliseconds, then the array parse runs.
fn simBatch(
    io: std.Io,
    gpa: std.mem.Allocator,
    source: []const u8,
    basename: []const u8,
    lex_ms: u64,
) !void {
    var options = optionsFor(basename);
    options.tokens = true;
    var first = try parser.parse(gpa, source, options);
    defer first.deinit();
    if (first.diagnostics.items.len > 0) return error.CannotBenchmarkBatchOnErrorFiles;

    var sink: usize = 0;
    var best: u64 = std.math.maxInt(u64);
    var iters: usize = 0;
    const t0 = nowNs(io);
    while (true) {
        const s = nowNs(io);
        while (nowNs(io) - s < lex_ns(lex_ms)) {
            std.mem.doNotOptimizeAway(&sink);
        }
        var tree = try parser.parseFromTokens(gpa, source, first.tokens, first.comments, optionsFor(basename));
        sink +%= tree.nodes.len;
        tree.deinit();
        const dt = nowNs(io) - s;
        if (dt < best) best = dt;
        iters += 1;
        if (nowNs(io) - t0 >= 300_000_000 or iters >= 100) break;
    }
    std.mem.doNotOptimizeAway(&sink);
    const mb = @as(f64, @floatFromInt(source.len)) / 1e6;
    const secs = @as(f64, @floatFromInt(best)) / 1e9;
    std.debug.print("{s}\tsim\t{d:.2}ms\t{d:.0}MB/s\t(lex={d}ms, {d} iters)\n", .{
        basename, secs * 1000, mb / secs, lex_ms, iters,
    });
}

fn lex_ns(lex_ms: u64) u64 {
    return lex_ms * 1_000_000;
}

fn verify(gpa: std.mem.Allocator, source: []const u8, basename: []const u8) !void {
    var expected = try parser.parse(gpa, source, optionsFor(basename));
    defer expected.deinit();

    var options = optionsFor(basename);
    options.lex_strategy = .batch;
    var actual = try parser.parse(gpa, source, options);
    defer actual.deinit();

    if (expected.diagnostics.items.len > 0) {
        std.debug.print("{s}\tverify\tskipped (diagnostics)\n", .{basename});
        for (expected.diagnostics.items) |d| {
            std.debug.print("\t{d}..{d}\t{s}\n", .{ d.span.start, d.span.end, d.message });
        }
        return;
    }
    if (!std.meta.eql(expected.diagnostics.items.len, actual.diagnostics.items.len)) {
        for (actual.diagnostics.items) |d| {
            std.debug.print("\tbatch diag {d}..{d}\t{s}\n", .{ d.span.start, d.span.end, d.message });
        }
        return reportMismatch(basename, "diagnostics.len");
    }

    var mismatch: ?[]const u8 = null;
    if (expected.nodes.len != actual.nodes.len) {
        std.debug.print("{s}\tverify\tnodes.len {d} vs {d}\n", .{
            basename, expected.nodes.len, actual.nodes.len,
        });
        mismatch = "nodes.len";
    } else {
        var i: u32 = 0;
        while (i < expected.nodes.len) : (i += 1) {
            const index: ast.NodeIndex = @fromBackingInt(i);
            if (!std.meta.eql(expected.data(index), actual.data(index)) or
                !std.meta.eql(expected.span(index), actual.span(index)))
            {
                std.debug.print("{s}\tverify\tnode {d}: {t} {any} vs {t} {any}\n", .{
                    basename,           i,                  expected.data(index), expected.span(index),
                    actual.data(index), actual.span(index),
                });
                mismatch = "node";
                break;
            }
        }
    }
    if (mismatch == null) {
        if (expected.extras.items.len != actual.extras.items.len) {
            mismatch = "extras.len";
        } else {
            for (expected.extras.items, actual.extras.items, 0..) |a, b, i| {
                if (a != b) {
                    std.debug.print("{s}\tverify\textra {d}: {any} vs {any}\n", .{
                        basename, i, a, b,
                    });
                    mismatch = "extras";
                    break;
                }
            }
        }
    }
    if (mismatch == null and expected.comments.len != actual.comments.len) {
        mismatch = "comments.len";
    }
    if (mismatch == null) {
        for (expected.comments, actual.comments) |a, b| {
            if (!std.meta.eql(a, b)) {
                mismatch = "comments";
                break;
            }
        }
    }
    if (mismatch) |what| return reportMismatch(basename, what);

    var tokenized = optionsFor(basename);
    tokenized.tokens = true;
    var with_tokens = try parser.parse(gpa, source, tokenized);
    defer with_tokens.deinit();
    if (with_tokens.tokens.len != actual.tokens.len) return reportMismatch(basename, "tokens.len");
    for (with_tokens.tokens, actual.tokens) |a, b| {
        if (!std.meta.eql(a, b)) return reportMismatch(basename, "tokens");
    }

    std.debug.print("{s}\tverify\tok\t{d} nodes\t{d} tokens\t{d} comments\t{d} extras\n", .{
        basename,                  expected.nodes.len, actual.tokens.len, actual.comments.len,
        expected.extras.items.len,
    });
}

fn reportMismatch(basename: []const u8, what: []const u8) error{BatchMismatch} {
    std.debug.print("{s}\tverify\tMISMATCH\t{s}\n", .{ basename, what });
    return error.BatchMismatch;
}

pub fn main(init: std.process.Init) !void {
    const io = init.io;
    var debug_alloc = std.heap.DebugAllocator(.{}){};
    defer _ = debug_alloc.deinit();
    const gpa = debug_alloc.allocator();

    var args = init.minimal.args.iterate();
    _ = args.skip();
    const mode = args.next() orelse return error.MissingMode;
    const sim_ms: ?u64 = if (std.mem.eql(u8, mode, "sim"))
        try std.fmt.parseUnsigned(u64, args.next() orelse return error.MissingLexMs, 10)
    else
        null;

    while (args.next()) |path| {
        const source = try std.Io.Dir.cwd().readFileAlloc(io, path, gpa, .limited(64 * 1024 * 1024));
        defer gpa.free(source);
        const basename = std.fs.path.basename(path);

        if (std.mem.eql(u8, mode, "verify")) {
            verify(gpa, source, basename) catch |err| {
                if (err != error.BatchMismatch) return err;
            };
            continue;
        }

        if (sim_ms) |ms| {
            try bench(io, gpa, "parse", source, basename, parseOnce);
            try simBatch(io, gpa, source, basename, ms);
            continue;
        }

        try bench(io, gpa, "parse", source, basename, parseOnce);
        try bench(io, gpa, "collect", source, basename, collectOnce);
        try benchArray(io, gpa, source, basename);
        try bench(io, gpa, "lex", source, basename, lexDrain);
    }
}
