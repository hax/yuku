// #215 逐项验证基准：parse / print / minify 三种模式
// 用法: bench215 <mode> <file> <iters>
// 输出: 一行 JSON {"ns_per_iter": ..., "check": "..."}，check 用于跨二进制一致性门
const std = @import("std");
const parser = @import("parser");

fn fnv1a(bytes: []const u8) u64 {
    var h: u64 = 0xcbf29ce484222325;
    for (bytes) |b| {
        h ^= b;
        h *%= 0x100000001b3;
    }
    return h;
}

pub fn main(init: std.process.Init) !void {
    const io = init.io;
    const gpa = init.gpa;

    var arg_it = std.process.Args.Iterator.init(init.minimal.args);
    _ = arg_it.next(); // argv[0]
    const mode = arg_it.next() orelse return error.MissingMode;
    const path = arg_it.next() orelse return error.MissingPath;
    const iters_str = arg_it.next() orelse return error.MissingIters;
    const iters = try std.fmt.parseInt(usize, iters_str, 10);

    const src = try std.Io.Dir.cwd().readFileAlloc(io, path, gpa, .limited(1 << 31));
    defer gpa.free(src);

    const lang: parser.ast.Lang = if (std.mem.endsWith(u8, path, ".d.ts"))
        .dts
    else if (std.mem.endsWith(u8, path, ".ts"))
        .ts
    else
        .js;

    const stdout = std.Io.File.stdout();
    var buf: [64 * 1024]u8 = undefined;
    var fw = stdout.writer(io, &buf);
    const out = &fw.interface;

    if (std.mem.eql(u8, mode, "parse")) {
        var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer arena.deinit();

        var check: u64 = 0;
        // 预热 3 轮
        for (0..3) |_| {
            _ = arena.reset(.retain_capacity);
            var tree = try parser.parse(arena.allocator(), src, .{ .lang = lang });
            check = tree.nodes.len;
            tree.deinit();
        }
        const t0 = std.Io.Timestamp.now(io, .awake);
        for (0..iters) |_| {
            _ = arena.reset(.retain_capacity);
            var tree = try parser.parse(arena.allocator(), src, .{ .lang = lang });
            check ^= tree.nodes.len;
            tree.deinit();
        }
        const t1 = std.Io.Timestamp.now(io, .awake);
        const ns: i64 = @intCast(t0.durationTo(t1).nanoseconds);
        // 单独再 parse 一次拿干净的节点数做一致性检查
        _ = arena.reset(.retain_capacity);
        var tree = try parser.parse(arena.allocator(), src, .{ .lang = lang });
        defer tree.deinit();
        try out.print("{{\"ns_per_iter\": {d}, \"check\": \"nodes={d}\"}}\n", .{ @divTrunc(ns, @as(i64, @intCast(iters))), tree.nodes.len });
        std.mem.doNotOptimizeAway(check);
    } else {
        const codegen = parser.codegen;
        const print_opts: codegen.Options = if (std.mem.eql(u8, mode, "minify"))
            .{ .minify = true, .format = .compact }
        else
            .{};

        var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer arena.deinit();
        var tree = try parser.parse(arena.allocator(), src, .{ .lang = lang });

        var gen_arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer gen_arena.deinit();

        var check: u64 = 0;
        for (0..3) |_| {
            _ = gen_arena.reset(.retain_capacity);
            const result = try codegen.generate(gen_arena.allocator(), &tree, print_opts);
            check = result.code.len;
        }
        const t0 = std.Io.Timestamp.now(io, .awake);
        for (0..iters) |_| {
            _ = gen_arena.reset(.retain_capacity);
            const result = try codegen.generate(gen_arena.allocator(), &tree, print_opts);
            check ^= result.code.len;
        }
        const t1 = std.Io.Timestamp.now(io, .awake);
        const ns: i64 = @intCast(t0.durationTo(t1).nanoseconds);
        _ = gen_arena.reset(.retain_capacity);
        const result = try codegen.generate(gen_arena.allocator(), &tree, print_opts);
        try out.print("{{\"ns_per_iter\": {d}, \"check\": \"len={d} fnv={x}\"}}\n", .{ @divTrunc(ns, @as(i64, @intCast(iters))), result.code.len, fnv1a(result.code) });
        std.mem.doNotOptimizeAway(check);
    }
    try fw.flush();
}
