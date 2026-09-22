// Goal: readField decodes every field kind from the wire buffer exactly
// as the object decoder does. Method: assert field values against the
// materialized objects over sources exercising each spec kind (nodes,
// arrays, holes, rest, strings, flags, enums, params, literals).
import { describe, expect, test } from "bun:test";
import {
    analyze as analyzeFile,
    childIndexes,
    readField,
    type Module,
    type WireView,
} from "yuku-analyzer";

function analyze(source: string, path = "input.js"): Module {
    return analyzeFile(source, { path });
}

type Node = ReturnType<WireView["nodeOf"]>;

function everyIndex(view: WireView): number[] {
    return Array.from({ length: view.nodeCount }, (_, i) => i);
}

// 按类型找第一个节点（测试只选语形唯一的构造）
function firstOfType(view: WireView, type: string): number {
    const found = everyIndex(view).find((i) => view.nodeOf(i).type === type);
    if (found === undefined) throw new Error(`no node of type ${type}`);
    return found;
}

describe("readField", () => {
    test("child and array fields match the decoded objects, including holes and rest", () => {
        const module = analyze(
            `f(a, ...b); const [x, , y = 1, ...z] = q;`,
            "input.js",
        );
        const view = module._wire();
        const callIndex = firstOfType(view, "CallExpression");
        const decoded = view.nodeOf(callIndex) as Node & {
            callee: Node;
            arguments: Node[];
            optional: boolean;
        };
        expect(readField(view, callIndex, "callee")).toBe(view.indexOf(decoded.callee));
        const args = readField(view, callIndex, "arguments") as number[];
        expect(args).toEqual(decoded.arguments.map((a: Node) => view.indexOf(a)!));
        expect(readField(view, callIndex, "optional")).toBe(false);

        // ArrayPattern 的洞与 rest
        const patternIndex = firstOfType(view, "ArrayPattern");
        const elements = readField(view, patternIndex, "elements") as (number | null)[];
        const decodedPattern = view.nodeOf(patternIndex) as Node & { elements: (Node | null)[] };
        expect(elements).toEqual(
            decodedPattern.elements.map((el: Node | null) => (el === null ? null : view.indexOf(el)!)),
        );
        expect(elements[1]).toBeNull();
    });

    test("string, flags, and enum fields read scalars", () => {
        const module = analyze(`let a = 1 === 2; obj.x;`, "input.js");
        const view = module._wire();
        expect(readField(view, firstOfType(view, "VariableDeclaration"), "kind")).toBe("let");
        expect(readField(view, firstOfType(view, "BinaryExpression"), "operator")).toBe("===");
        expect(readField(view, firstOfType(view, "MemberExpression"), "computed")).toBe(false);
        const identIndex = everyIndex(view).find(
            (i) => view.nodeOf(i).type === "Identifier" && (view.nodeOf(i) as Node & { name: string }).name === "obj",
        )!;
        expect(readField(view, identIndex, "name")).toBe("obj");
    });

    test("function params splice the pseudo nodes", () => {
        const module = analyze(`function f(this: number, a, { b } = {}, ...rest: any[]) {}`, "input.ts");
        const view = module._wire();
        const fnIndex = firstOfType(view, "FunctionDeclaration");
        const params = readField(view, fnIndex, "params") as number[];
        const decoded = view.nodeOf(fnIndex) as Node & { params: Node[] };
        expect(params).toEqual(decoded.params.map((p: Node) => view.indexOf(p)!));
        expect(params.length).toBe(4);
    });

    test("literal values mirror the decoder's value math", () => {
        const module = analyze(
            `"s"; 0o17; 1_000; 0xFn; 12n; true; null; /ab+/gi; \`a\`;`,
            "input.js",
        );
        const view = module._wire();
        const values = everyIndex(view)
            .filter((i) => view.nodeOf(i).type === "Literal")
            .map((i) => readField(view, i, "value"));
        expect(values[0]).toBe("s");
        expect(values[1]).toBe(15); // 0o17 legacy octal
        expect(values[2]).toBe(1000);
        expect(values[3]).toBe(15n);
        expect(values[4]).toBe(12n);
        expect(values[5]).toBe(true);
        expect(values[6]).toBe(null);
        expect(values[7]).toBeInstanceOf(RegExp);
    });

    test("TypeScript-only fields read as undefined in JavaScript mode", () => {
        const module = analyze(`function f() {}`, "input.js");
        const view = module._wire();
        const fnIndex = firstOfType(view, "FunctionDeclaration");
        expect(readField(view, fnIndex, "returnType")).toBeUndefined();
        expect(readField(view, fnIndex, "declare")).toBeUndefined();
        expect(readField(view, fnIndex, "body")).not.toBeNull();
    });

    test("childIndexes walks the same children in the decoder's field order", () => {
        const module = analyze(`if (a) { b(); }`, "input.js");
        const view = module._wire();
        const children = childIndexes(view, firstOfType(view, "IfStatement"));
        expect(children.map((c) => view.nodeOf(c).type)).toEqual([
            "Identifier",
            "BlockStatement",
        ]);
    });
});
