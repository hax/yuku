const std = @import("std");
const parser = @import("parser");

const helpers = @import("../helpers.zig");

const ast = parser.ast;
const testing = std.testing;

/// Parses TS source and returns the tree even when recovery diagnostics fire, so a
/// test can assert on the nodes the parser kept.
fn parseRecovering(source: []const u8) !ast.Tree {
    return parser.parse(testing.allocator, source, .{ .lang = .ts });
}

fn countTag(tree: *const ast.Tree, comptime tag: ast.NodeTag) usize {
    var count: usize = 0;
    var i: u32 = 0;
    while (i < tree.nodes.len) : (i += 1) {
        if (std.meta.activeTag(tree.data(@fromBackingInt(i))) == tag) count += 1;
    }
    return count;
}

fn expectDiagnosticLooksLike(tree: *const ast.Tree, needle: []const u8) !void {
    for (tree.diagnostics.items) |diagnostic| {
        if (std.mem.indexOf(u8, diagnostic.message, needle) != null) return;
    }
    std.debug.print("diagnostics:\n", .{});
    for (tree.diagnostics.items) |diagnostic| std.debug.print("  {s}\n", .{diagnostic.message});
    return error.DiagnosticNotFound;
}

// #9: a private name used as a type member / object literal key / enum member /
// declared name / parameter name is kept in the AST instead of failing the whole
// construct, and the placement is reported.
test "a private type member name is kept" {
    var tree = try parseRecovering("type A = { #foo: string; bar: number };\nconst after = 1;\n");
    defer tree.deinit();
    try testing.expectEqual(@as(usize, 1), countTag(&tree, .private_identifier));
    try expectDiagnosticLooksLike(&tree, "Private identifiers are not allowed outside class bodies");
    // the member after the private one, and the statement after the type alias, still parse
    try testing.expect(countTag(&tree, .binding_identifier) >= 1);
}

test "a private object literal key is kept" {
    var tree = try parseRecovering("const o = { #foo: 1, bar: 2 };\nconst after = 1;\n");
    defer tree.deinit();
    try testing.expectEqual(@as(usize, 1), countTag(&tree, .private_identifier));
    try expectDiagnosticLooksLike(&tree, "Private identifiers are not allowed outside class bodies");
}

test "a private enum member name is kept" {
    var tree = try parseRecovering("enum E { #x, y }\nconst after = 1;\n");
    defer tree.deinit();
    try testing.expectEqual(@as(usize, 1), countTag(&tree, .private_identifier));
    try expectDiagnosticLooksLike(&tree, "An enum member cannot be named with a private identifier");
}

test "a private declared name is kept" {
    var tree = try parseRecovering("const #foo = 3;\nconst after = 1;\n");
    defer tree.deinit();
    // the recovered private binding plus the `after` binding
    try testing.expectEqual(@as(usize, 2), countTag(&tree, .binding_identifier));
    try expectDiagnosticLooksLike(&tree, "Private identifiers are not allowed in variable declarations");
}

test "a private parameter name is kept" {
    var tree = try parseRecovering("class A { setFoo(#foo: string) {} }\nconst after = 1;\n");
    defer tree.deinit();
    try expectDiagnosticLooksLike(&tree, "Private identifiers cannot be used as parameters");
    try testing.expectEqual(@as(usize, 1), countTag(&tree, .function));
}

test "legal private names stay silent" {
    var tree = try parseRecovering(
        \\class C {
        \\    #x = 1;
        \\    #m() { return this.#x; }
        \\    static #s = 2;
        \\    has(o: object) { return #x in o; }
        \\}
        \\enum E { A, B = 2 }
        \\type T = { foo: string; bar(): number };
        \\
    );
    defer tree.deinit();
    if (tree.hasErrors()) {
        for (tree.diagnostics.items) |diagnostic| std.debug.print("  {s}\n", .{diagnostic.message});
        return error.UnexpectedParseErrors;
    }
}
