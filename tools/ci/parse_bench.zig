//! Local dev harness (not part of the library): full-parse benchmark and
//! identity digests for A/B-ing two parser builds.
//!   parse_bench bench <file>...  best-of-N full parse, prints ms + MB/s
//!   parse_bench dump <file>...   prints "path tokens=<n> <tok_digest> nodes=<n> <tree_digest>"

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

const Digest = struct {
    token_count: usize,
    token_digest: u64,
    node_count: usize,
    tree_digest: u64,
};

fn digest(gpa: std.mem.Allocator, source: []const u8, basename: []const u8) !Digest {
    @setEvalBranchQuota(50_000);
    var arena_state = std.heap.ArenaAllocator.init(gpa);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    // token stream: tag + span + flags of every token, lexical errors
    // recorded as pseudo-entries
    var lx = try parser.lexer.Lexer.init(source, arena, ast.SourceType.fromPath(basename), false);
    var th = std.hash.Wyhash.init(0);
    var token_count: usize = 0;
    while (true) {
        const tok = lx.nextToken() catch |e| {
            // a bare drain cannot tell regex from division, so regex bodies
            // can mis-lex and error; record the error and skip a byte, the
            // parser would rescue these via re-scan
            std.hash.autoHash(&th, @intFromError(e));
            std.hash.autoHash(&th, lx.cursor);
            token_count += 1;
            if (lx.cursor >= source.len) break;
            lx.cursor += 1;
            continue;
        };
        std.hash.autoHash(&th, @intFromEnum(tok.tag));
        std.hash.autoHash(&th, tok.span.start);
        std.hash.autoHash(&th, tok.span.end);
        std.hash.autoHash(&th, tok.flags);
        token_count += 1;
        if (tok.tag == .eof) break;
    }

    // tree: tag + data + span of every node, extras, diagnostics
    var tree = try parser.parse(gpa, source, optionsFor(basename));
    defer tree.deinit();

    var h = std.hash.Wyhash.init(0);
    std.hash.autoHash(&h, @intFromEnum(tree.root));
    var i: usize = 0;
    while (i < tree.nodes.len) : (i += 1) {
        const node = tree.nodes.get(i);
        std.hash.autoHash(&h, @intFromEnum(std.meta.activeTag(node.data)));
        std.hash.autoHash(&h, node.data);
        std.hash.autoHash(&h, node.span.start);
        std.hash.autoHash(&h, node.span.end);
    }
    for (tree.extras.items) |extra| {
        std.hash.autoHash(&h, @intFromEnum(extra));
    }
    for (tree.diagnostics.items) |diag| {
        std.hash.autoHash(&h, @intFromEnum(diag.severity));
        h.update(diag.message);
        std.hash.autoHash(&h, diag.span.start);
        std.hash.autoHash(&h, diag.span.end);
        if (diag.help) |help| h.update(help);
    }

    return .{
        .token_count = token_count,
        .token_digest = th.final(),
        .node_count = tree.nodes.len,
        .tree_digest = h.final(),
    };
}

pub fn main(init: std.process.Init) !void {
    const io = init.io;
    var debug_alloc = std.heap.DebugAllocator(.{}){};
    defer _ = debug_alloc.deinit();
    const gpa = debug_alloc.allocator();

    var args = init.minimal.args.iterate();
    _ = args.skip();
    const mode = args.next() orelse return error.MissingMode;

    var sink: usize = 0;
    while (args.next()) |path| {
        const source = try std.Io.Dir.cwd().readFileAlloc(io, path, gpa, .limited(64 * 1024 * 1024));
        defer gpa.free(source);
        const basename = std.fs.path.basename(path);

        if (std.mem.eql(u8, mode, "tokdump")) {
            var arena_state = std.heap.ArenaAllocator.init(gpa);
            defer arena_state.deinit();
            var lx = try parser.lexer.Lexer.init(source, arena_state.allocator(), ast.SourceType.fromPath(basename), false);
            while (true) {
                const tok = lx.nextToken() catch |e| {
                    std.debug.print("  ERR {s} @ {d}\n", .{ @errorName(e), lx.cursor });
                    if (lx.cursor >= source.len) break;
                    lx.cursor += 1;
                    continue;
                };
                std.debug.print("  {s} [{d},{d}) flags={x}\n", .{ @tagName(tok.tag), tok.span.start, tok.span.end, tok.flags });
                if (tok.tag == .eof) break;
            }
            continue;
        }

        if (std.mem.eql(u8, mode, "strlen")) {
            // histogram string-ish token lengths via the real lexer
            var arena_state = std.heap.ArenaAllocator.init(gpa);
            defer arena_state.deinit();
            var lx = try parser.lexer.Lexer.init(source, arena_state.allocator(), ast.SourceType.fromPath(basename), false);
            var lens: [100_000]u32 = undefined;
            var n: usize = 0;
            var body_bytes: u64 = 0;
            var count: usize = 0;
            while (true) {
                const tok = lx.nextToken() catch {
                    if (lx.cursor >= source.len) break;
                    lx.cursor += 1;
                    continue;
                };
                if (tok.tag == .eof) break;
                switch (tok.tag) {
                    .string_literal,
                    .template_head,
                    .template_middle,
                    .template_tail,
                    .no_substitution_template,
                    => {
                        const len = tok.span.end - tok.span.start;
                        if (n < lens.len) {
                            lens[n] = len;
                            n += 1;
                        }
                        body_bytes += len;
                        count += 1;
                    },
                    else => {},
                }
            }
            std.mem.sort(u32, lens[0..n], {}, std.sort.asc(u32));
            var long_tokens: usize = 0;
            var long_bytes: u64 = 0;
            for (lens[0..n]) |l| {
                if (l >= 64) {
                    long_tokens += 1;
                    long_bytes += l;
                }
            }
            const pct = struct {
                fn at(arr: []const u32, p: usize) u32 {
                    if (arr.len == 0) return 0;
                    return arr[@min(arr.len - 1, arr.len * p / 100)];
                }
            }.at;
            std.debug.print("{s}: count={d} byte-share={d:.1}% median={d}B p75={d}B p90={d}B p99={d}B max={d}B | >=64B: {d:.1}% of tokens, {d:.0}% of bytes\n", .{
                basename,
                count,
                100.0 * @as(f64, @floatFromInt(body_bytes)) / @as(f64, @floatFromInt(source.len)),
                pct(lens[0..n], 50),
                pct(lens[0..n], 75),
                pct(lens[0..n], 90),
                pct(lens[0..n], 99),
                if (n > 0) lens[n - 1] else 0,
                if (n > 0) 100.0 * @as(f64, @floatFromInt(long_tokens)) / @as(f64, @floatFromInt(n)) else 0.0,
                100.0 * @as(f64, @floatFromInt(long_bytes)) / @as(f64, @floatFromInt(@max(1, body_bytes))),
            });
            continue;
        }

        if (std.mem.eql(u8, mode, "lex")) {
            // lexer-only drain: no parser, no tree, error-skip like dump
            var arena_state = std.heap.ArenaAllocator.init(gpa);
            defer arena_state.deinit();
            var best: u64 = std.math.maxInt(u64);
            var iters: usize = 0;
            var count: usize = 0;
            const t0 = nowNs(io);
            while (true) {
                const s = nowNs(io);
                var drain_arena = std.heap.ArenaAllocator.init(gpa);
                var lx = try parser.lexer.Lexer.init(source, drain_arena.allocator(), ast.SourceType.fromPath(basename), false);
                var n: usize = 0;
                while (true) {
                    const tok = lx.nextToken() catch {
                        if (lx.cursor >= source.len) break;
                        lx.cursor += 1;
                        n += 1;
                        continue;
                    };
                    n += 1;
                    if (tok.tag == .eof) break;
                }
                count = n;
                drain_arena.deinit();
                const dt = nowNs(io) - s;
                if (dt < best) best = dt;
                iters += 1;
                if (nowNs(io) - t0 >= 300_000_000 or iters >= 200) break;
            }
            const mb = @as(f64, @floatFromInt(source.len)) / 1e6;
            const secs = @as(f64, @floatFromInt(best)) / 1e9;
            std.debug.print("{s}\tlex\t{d:.3}ms\t{d:.0}MB/s\t{d} tokens\t({d} iters)\n", .{
                basename, secs * 1000, mb / secs, count, iters,
            });
            continue;
        }

        if (std.mem.eql(u8, mode, "dump")) {
            const d = try digest(gpa, source, basename);
            std.debug.print("{s}\ttokens={d}\t{d:0>16}\tnodes={d}\t{d:0>16}\n", .{
                basename, d.token_count, d.token_digest, d.node_count, d.tree_digest,
            });
            continue;
        }

        // warmup + node-count sanity
        const n = try parseOnce(gpa, source, basename);
        sink +%= n;

        var best: u64 = std.math.maxInt(u64);
        var iters: usize = 0;
        const t0 = nowNs(io);
        while (true) {
            const s = nowNs(io);
            sink +%= try parseOnce(gpa, source, basename);
            const dt = nowNs(io) - s;
            if (dt < best) best = dt;
            iters += 1;
            if (nowNs(io) - t0 >= 300_000_000 or iters >= 200) break;
        }
        const mb = @as(f64, @floatFromInt(source.len)) / 1e6;
        const secs = @as(f64, @floatFromInt(best)) / 1e9;
        std.debug.print("{s}\tparse\t{d:.3}ms\t{d:.0}MB/s\t({d} iters)\n", .{
            basename, secs * 1000, mb / secs, iters,
        });
    }
    std.mem.doNotOptimizeAway(&sink);
}
