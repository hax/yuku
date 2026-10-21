//! The batch lexing strategy must reproduce the on-demand parse exactly: same
//! nodes, extras, diagnostics, comments, and token stream. Differential tests
//! parse every input with both strategies and compare the trees field by field.

const std = @import("std");
const parser = @import("parser");
const helpers = @import("../helpers.zig");

const ast = parser.ast;
const testing = std.testing;

fn checkBatch(path: []const u8, tree: *const ast.Tree) !void {
    if (!parser.batch_lexing) return;
    var batch = try parser.parse(testing.allocator, tree.source, .{
        .lang = tree.lang,
        .source_type = tree.source_type,
        .lex_strategy = .batch,
    });
    defer batch.deinit();
    expectSameTree(path, tree, &batch) catch |err| {
        std.debug.print("{s}: batch parse diverged: {t}\n", .{ path, err });
        return err;
    };
}

fn expectSameTree(path: []const u8, expected: *const ast.Tree, actual: *const ast.Tree) !void {
    errdefer std.debug.print("{s}: batch parse diverged\n", .{path});

    try testing.expectEqual(expected.nodes.len, actual.nodes.len);
    var i: u32 = 0;
    while (i < expected.nodes.len) : (i += 1) {
        const index: ast.NodeIndex = @fromBackingInt(i);
        if (!std.meta.eql(expected.data(index), actual.data(index))) {
            std.debug.print("node {d} data: {t} vs {t}\n", .{
                i, expected.data(index), actual.data(index),
            });
            return error.BatchMismatch;
        }
        try testing.expectEqual(expected.span(index), actual.span(index));
    }

    try testing.expectEqual(expected.extras.items.len, actual.extras.items.len);
    for (expected.extras.items, actual.extras.items) |a, b| {
        try testing.expectEqual(a, b);
    }

    try testing.expectEqual(expected.diagnostics.items.len, actual.diagnostics.items.len);
    for (expected.diagnostics.items, actual.diagnostics.items) |a, b| {
        try testing.expectEqual(a.severity, b.severity);
        try testing.expectEqualStrings(a.message, b.message);
        try testing.expectEqual(a.span, b.span);
        if (a.help == null or b.help == null) {
            try testing.expectEqual(a.help == null, b.help == null);
        } else {
            try testing.expectEqualStrings(a.help.?, b.help.?);
        }
        try testing.expectEqual(a.labels.len, b.labels.len);
        for (a.labels, b.labels) |la, lb| {
            try testing.expectEqual(la.span, lb.span);
            try testing.expectEqualStrings(la.message, lb.message);
        }
    }

    try testing.expectEqual(expected.comments.len, actual.comments.len);
    for (expected.comments, actual.comments) |a, b| {
        try testing.expectEqual(a, b);
    }
}

test "batch parsing matches on-demand across the parser corpus" {
    if (!parser.batch_lexing) return error.SkipZigTest;
    try helpers.forEachCorpusTree(checkBatch);
}

fn expectSameTokens(source: []const u8, options: parser.Options) !void {
    if (!parser.batch_lexing) return error.SkipZigTest;
    var expected = try parser.parse(testing.allocator, source, options);
    defer expected.deinit();

    var batch_options = options;
    batch_options.lex_strategy = .batch;
    var actual = try parser.parse(testing.allocator, source, batch_options);
    defer actual.deinit();

    try expectSameTree(source, &expected, &actual);

    try testing.expectEqual(expected.tokens.len, actual.tokens.len);
    for (expected.tokens, actual.tokens) |a, b| {
        try testing.expectEqual(a, b);
    }
}

test "batch parsing reproduces regex and template tokens" {
    const options: parser.Options = .{ .tokens = true, .source_type = .script };
    try expectSameTokens("let re = /a[b\\/]+c/gi; let x = 1 / 2 / 3; let y = x /= 2;", options);
    try expectSameTokens("`a${`b${c}d`}e${f}g`;", options);
    try expectSameTokens("tag`/* not a comment */${x}// nor this\n`;", options);
    try expectSameTokens("let s = 'a\\'b'; let t = \"c\\\"d\";", options);
    try expectSameTokens("x++\ny--;\n", options);
    try expectSameTokens("let o = { l\\u{65}t: 1 }; o.l\\u{65}t;", options);
    try expectSameTokens("function* g() { return `1${yield}3${yield* x}`; }", options);
    try expectSameTokens("<!-- html\nlet x = 1;\n--> close\nx /= 2;", options);
}

test "batch parsing reproduces TypeScript angle rescans" {
    const options: parser.Options = .{ .tokens = true, .lang = .ts };
    try expectSameTokens("let x: Map<string, Set<number>> = f();", options);
    try expectSameTokens("let f: <<T>(x: T) => R> = g;", options);
    try expectSameTokens("a<b>(c); a < b > (c);", options);
    try expectSameTokens("let x = a<b, c<d>>(e);", options);
    try expectSameTokens("type T = `a${U}b${V}`;", options);
    try expectSameTokens("x >>>= 2; y >>= 1; z >>> 2; w = a >> 2;", options);
}

test "batch parsing reproduces JSX tokens" {
    const options: parser.Options = .{ .tokens = true, .lang = .tsx };
    try expectSameTokens("let e = <div a-b=\"x\" /* c */>text // not a comment</div>;", options);
    try expectSameTokens("let e = <><a/>{\"}\"}{x}</>;", options);
    try expectSameTokens("let e = <A<T> b={1} {...c} />;", options);
    try expectSameTokens("let e = <div>don't \"q\" `tick` {x}</div>;", options);
}

test "batch parsing falls back when the collecting pass reports diagnostics" {
    if (!parser.batch_lexing) return error.SkipZigTest;
    var tree = try parser.parse(testing.allocator, "let x = 'unterminated", .{
        .lex_strategy = .batch,
    });
    defer tree.deinit();
    try testing.expect(tree.hasErrors());

    var expected = try parser.parse(testing.allocator, "let x = 'unterminated", .{});
    defer expected.deinit();
    try expectSameTree("unterminated", &expected, &tree);
}

test "batch parsing carries comments through attach mode" {
    if (!parser.batch_lexing) return error.SkipZigTest;
    const source = "// lead\nlet /* mid */ x = 1; /* trail */";
    var expected = try parser.parse(testing.allocator, source, .{ .comments = .attach });
    defer expected.deinit();

    var actual = try parser.parse(testing.allocator, source, .{
        .comments = .attach,
        .lex_strategy = .batch,
    });
    defer actual.deinit();

    try expectSameTree(source, &expected, &actual);
    var i: u32 = 0;
    while (i < expected.nodes.len) : (i += 1) {
        const index: ast.NodeIndex = @fromBackingInt(i);
        try testing.expectEqual(expected.hasComments(index), actual.hasComments(index));
        var expected_it = expected.commentsOf(index);
        var actual_it = actual.commentsOf(index);
        while (expected_it.next()) |comment| {
            try testing.expectEqual(comment, actual_it.next() orelse return error.BatchMismatch);
        }
        try testing.expectEqual(@as(?ast.Comment, null), actual_it.next());
    }
}
