const std = @import("std");
const parser = @import("parser");

const ast = parser.ast;
const testing = std.testing;

/// `await` in a non-async position is an ordinary identifier reference. The parser
/// keeps it in the tree so name resolution (tsc: TS2304 in a script, TS1262 at the
/// top level of a module) can report it, instead of failing the enclosing construct.
/// See hax/yuku#11 §3.1: `var v = { [await]: foo }` must keep the object literal and
/// the statements after it.
fn parseWith(source: []const u8, source_type: ast.SourceType) !ast.Tree {
    return parser.parse(testing.allocator, source, .{ .lang = .ts, .source_type = source_type });
}

fn countTag(tree: *const ast.Tree, comptime tag: ast.NodeTag) usize {
    var count: usize = 0;
    var i: u32 = 0;
    while (i < tree.nodes.len) : (i += 1) {
        if (std.meta.activeTag(tree.data(@fromBackingInt(i))) == tag) count += 1;
    }
    return count;
}

/// Counts `identifier_reference` nodes whose name is `name`.
fn countNamedReference(tree: *const ast.Tree, name: []const u8) usize {
    var count: usize = 0;
    var i: u32 = 0;
    while (i < tree.nodes.len) : (i += 1) {
        const data = tree.data(@fromBackingInt(i));
        if (data != .identifier_reference) continue;
        if (std.mem.eql(u8, tree.string(data.identifier_reference.name), name)) count += 1;
    }
    return count;
}

fn expectNoDiagnostics(tree: *const ast.Tree) !void {
    if (tree.diagnostics.items.len == 0) return;
    std.debug.print("unexpected diagnostics:\n", .{});
    for (tree.diagnostics.items) |d| std.debug.print("  {d}..{d} {s}\n", .{
        d.span.start,
        d.span.end,
        d.message,
    });
    return error.UnexpectedDiagnostic;
}

fn expectDiagnosticLooksLike(tree: *const ast.Tree, needle: []const u8) !void {
    for (tree.diagnostics.items) |d| {
        if (std.mem.indexOf(u8, d.message, needle) != null) return;
    }
    std.debug.print("diagnostics:\n", .{});
    for (tree.diagnostics.items) |d| std.debug.print("  {s}\n", .{d.message});
    return error.DiagnosticNotFound;
}

test "await in a computed name keeps the object literal in a script" {
    var tree = try parseWith("var v = { [await]: foo }\nvar after = 1;\n", .script);
    defer tree.deinit();
    try expectNoDiagnostics(&tree);
    try testing.expectEqual(@as(usize, 1), countNamedReference(&tree, "await"));
    try testing.expectEqual(@as(usize, 1), countNamedReference(&tree, "foo"));
    // the statement after the object literal is not lost
    try testing.expectEqual(@as(usize, 2), countTag(&tree, .variable_declaration));
}

test "await in a computed name keeps the object literal in a module" {
    // tsc 7.1.0-beta parses this file (module top level) without a syntax error and
    // leaves the reserved-word complaint to the binder (TS1262) plus name resolution
    // (TS2304). Keeping the identifier is what lets the caller report those codes.
    var tree = try parseWith("export {};\nvar v = { [await]: foo };\nvar after = 1;\n", .module);
    defer tree.deinit();
    try expectNoDiagnostics(&tree);
    try testing.expectEqual(@as(usize, 1), countNamedReference(&tree, "await"));
    try testing.expectEqual(@as(usize, 1), countNamedReference(&tree, "foo"));
    try testing.expectEqual(@as(usize, 2), countTag(&tree, .variable_declaration));
}

test "await in a computed class member name keeps the member" {
    var tree = try parseWith("export {};\nclass C { [await] = 1; static [await]() {} }\n", .module);
    defer tree.deinit();
    try expectNoDiagnostics(&tree);
    try testing.expectEqual(@as(usize, 2), countNamedReference(&tree, "await"));
}

test "a legal await expression in a computed name is unchanged" {
    // `[await x]` is an await expression, not an identifier key.
    var tree = try parseWith("async function f() { var v = { [await x]: 1 }; }\n", .module);
    defer tree.deinit();
    try expectNoDiagnostics(&tree);
    try testing.expectEqual(@as(usize, 1), countTag(&tree, .await_expression));
    try testing.expectEqual(@as(usize, 0), countNamedReference(&tree, "await"));
}

test "an await expression whose operand is present is still an operator" {
    var tree = try parseWith("export {};\nvar x = await load();\n", .module);
    defer tree.deinit();
    try expectNoDiagnostics(&tree);
    try testing.expectEqual(@as(usize, 1), countTag(&tree, .await_expression));
}

test "await stays a diagnostic in an async body" {
    var tree = try parseWith("async function f() { var a = await; }\n", .script);
    defer tree.deinit();
    try expectDiagnosticLooksLike(&tree, "Expected an expression");
}

test "await stays a diagnostic as a module top level binding name" {
    var tree = try parseWith("export {};\nvar await = 1;\n", .module);
    defer tree.deinit();
    try expectDiagnosticLooksLike(&tree, "is a reserved word");
}

test "await stays a diagnostic as a module top level array element" {
    var tree = try parseWith("export {};\nvar a = [await];\n", .module);
    defer tree.deinit();
    try expectDiagnosticLooksLike(&tree, "Expected an expression");
}
