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

// #10: a misplaced `...` or `?` in a labeled tuple element keeps the tuple, its
// element names and the following type aliases instead of failing the file.
test "a misplaced tuple rest marker keeps the tuple" {
    var tree = try parseRecovering("type T = [first: string, rest: ...string[]];\ntype After = number;\n");
    defer tree.deinit();
    try testing.expectEqual(@as(usize, 1), countTag(&tree, .ts_tuple_type));
    try testing.expectEqual(@as(usize, 2), countTag(&tree, .ts_named_tuple_member));
    try testing.expectEqual(@as(usize, 1), countTag(&tree, .ts_rest_type));
    try expectDiagnosticLooksLike(&tree, "declared as rest with a '...' before the name");
    try testing.expectEqual(@as(usize, 2), countTag(&tree, .ts_type_alias_declaration));
}

test "a misplaced tuple optional marker keeps the tuple" {
    var tree = try parseRecovering("type T = [element: string?];\ntype After = number;\n");
    defer tree.deinit();
    try testing.expectEqual(@as(usize, 1), countTag(&tree, .ts_tuple_type));
    try testing.expectEqual(@as(usize, 1), countTag(&tree, .ts_named_tuple_member));
    try expectDiagnosticLooksLike(&tree, "declared as optional with a question mark after the name");
    try testing.expectEqual(@as(usize, 2), countTag(&tree, .ts_type_alias_declaration));
}

test "legal named tuples stay silent" {
    var tree = try parseRecovering(
        \\type A = [length: number, size: number];
        \\type B = [number, string];
        \\type C = [...rest: string[]];
        \\type D = [first: string, second?: number];
        \\
    );
    defer tree.deinit();
    if (tree.hasErrors()) {
        for (tree.diagnostics.items) |diagnostic| std.debug.print("  {s}\n", .{diagnostic.message});
        return error.UnexpectedParseErrors;
    }
}

// #11: a reserved word as an interface name, and named imports after `defer`,
// keep their declarations in the tree so the file stays parseable.
test "a reserved interface name keeps the interface" {
    var tree = try parseRecovering("interface void {}\ninterface After {}\n");
    defer tree.deinit();
    try testing.expectEqual(@as(usize, 2), countTag(&tree, .ts_interface_declaration));
}

test "named imports after defer keep the import" {
    var tree = try parseRecovering("import defer { foo } from \"./a\";\nconst after = 1;\n");
    defer tree.deinit();
    try testing.expectEqual(@as(usize, 1), countTag(&tree, .import_declaration));
    try expectDiagnosticLooksLike(&tree, "Named imports are not allowed in a deferred import");
    try testing.expect(countTag(&tree, .binding_identifier) >= 1);
}

test "legal heritage and imports stay silent" {
    var tree = try parseRecovering(
        \\interface Foo {}
        \\class C extends Object {}
        \\import defer * as ns from "./a";
        \\import { named } from "./b";
        \\
    );
    defer tree.deinit();
    if (tree.hasErrors()) {
        for (tree.diagnostics.items) |diagnostic| std.debug.print("  {s}\n", .{diagnostic.message});
        return error.UnexpectedParseErrors;
    }
}
