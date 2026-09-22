// Goal: walkWire, the wire-driven walk, is behaviorally identical to
// module.walk. Method: compare enter/leave event streams (phase and
// object identity) over sources exercising the awkward corners, then
// pin down the wire-walk-specific surface (skip, stop, read-only,
// subtree roots).
import { describe, expect, test } from "bun:test";
import {
    analyze as analyzeFile,
    childIndexes,
    walkWire,
    walkWireIndexes,
    type Module,
} from "yuku-analyzer";

function analyze(source: string, path = "input.js"): Module {
  return analyzeFile(source, { path });
}

type Event = { phase: "enter" | "leave"; node: { type: string; start: number; end: number } };

function walkedEvents(module: Module): Event[] {
  const events: Event[] = [];
  module.walk({
    enter: (node) => events.push({ phase: "enter", node }),
    leave: (node) => events.push({ phase: "leave", node }),
  });
  return events;
}

function wireEvents(module: Module): Event[] {
  const events: Event[] = [];
  walkWire(module, {
    enter: (node) => events.push({ phase: "enter", node }),
    leave: (node) => events.push({ phase: "leave", node }),
  });
  return events;
}

function expectSameEvents(source: string, path?: string): void {
  const module = analyze(source, path);
  // the Hashbang is synthesized at decode time and is not a wire node,
  // so only the object-graph walk visits it
  const expected = walkedEvents(module).filter((event) => event.node.type !== "Hashbang");
  const actual = wireEvents(module);
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i]!.phase).toBe(expected[i]!.phase);
    // identical objects, not just equal shapes
    expect(actual[i]!.node).toBe(expected[i]!.node);
  }
}

describe("walkWire", () => {
  test("matches module.walk event for event, with the same node objects", () => {
    // function and class names depend on node flags, template children
    // interleave in the wire, and a shorthand export specifier mounts
    // the same identifier at two slots
    expectSameEvents(
      `
declare function declared(x: number): void;
function over(x: number): void;
function over(x: string): void;
function over(x: any) { return x; }
abstract class Abs {
  abstract am(): void;
  abstract ap: number;
  abstract accessor aa: string;
}
class C extends Abs {
  accessor acc = 0;
  get g() { return 1; }
  static { C; }
}
const arrow = async <T,>(a: T, { b = 1 } = {}, ...rest: T[]) => a ?? b;
const tpl = tag\`a\${1}b\${2}c\`;
function tag(parts: TemplateStringsArray, ...values: number[]) {}
export { C };
export { Abs } from "./elsewhere";
import { readFile as rf } from "node:fs";
`,
      "input.ts",
    );
    expectSameEvents(`const el = <div a="1" {...rest}>text{expr}{...kids}</div>;`, "input.tsx");
    expectSameEvents(`#!/usr/bin/env node\nconsole.log("hi");`, "input.js");
  });

  test("typed visitors fire exactly the events module.walk would dispatch", () => {
    const module = analyze(`f(1); class C { m() { g(); } } const h = () => k();`, "input.ts");
    const viaWalk: string[] = [];
    module.walk({
      CallExpression: (node) => {
        viaWalk.push(node.callee.type);
      },
    });
    const viaWire: string[] = [];
    walkWire(module, {
      CallExpression: (node) => {
        viaWire.push(node.callee.type);
      },
    });
    expect(viaWire).toEqual(["Identifier", "Identifier", "Identifier"]);
    expect(viaWire).toEqual(viaWalk);
  });

  test("alias keys dispatch like module.walk", () => {
    const module = analyze(`function f() {} const g = () => {}; class C {}`, "input.ts");
    const seen: string[] = [];
    walkWire(module, {
      Function: (node) => {
        seen.push(node.type);
      },
    });
    expect(seen).toEqual(["FunctionDeclaration", "ArrowFunctionExpression"]);
  });

  test("ctx.parent is the walked parent and null at the walk root", () => {
    const module = analyze(`f(g(x));`);
    const parents: (string | null)[] = [];
    walkWire(
      module,
      {
        ExpressionStatement: (node, ctx) => {
          parents.push(ctx.parent === null ? null : ctx.parent.type);
        },
        CallExpression: (node, ctx) => {
          parents.push(ctx.parent === null ? null : ctx.parent.type);
        },
      },
      module.ast.body[0]!,
    );
    // the root's parent is null, then each call's parent is its container
    expect(parents).toEqual([null, "ExpressionStatement", "CallExpression"]);
  });

  test("ctx.skip() skips children but still fires leave", () => {
    const module = analyze(`f(g(x));`);
    const seen: string[] = [];
    walkWire(module, {
      enter: (node, ctx) => {
        seen.push(`enter ${node.type}`);
        if (node.type === "CallExpression") ctx.skip();
      },
      leave: (node) => {
        seen.push(`leave ${node.type}`);
      },
    });
    expect(seen).toEqual([
      "enter Program",
      "enter ExpressionStatement",
      "enter CallExpression",
      "leave CallExpression",
      "leave ExpressionStatement",
      "leave Program",
    ]);
  });

  test("ctx.stop() halts the walk without firing leaves", () => {
    const module = analyze(`f(); g();`);
    const seen: string[] = [];
    walkWire(module, {
      enter: (node, ctx) => {
        seen.push(node.type);
        if (node.type === "CallExpression") ctx.stop();
      },
      leave: (node) => {
        seen.push(`leave ${node.type}`);
      },
    });
    expect(seen).toEqual(["Program", "ExpressionStatement", "CallExpression"]);
  });

  test("the walk is read-only", () => {
    const module = analyze(`f();`);
    expect(() =>
      walkWire(module, {
        CallExpression: (_node, ctx) => {
          // not in the type surface on purpose, the trap is for JS callers
          (ctx as unknown as { remove(): void }).remove();
        },
      }),
    ).toThrow(TypeError);
  });

  test("a root from another module throws", () => {
    const a = analyze(`f();`);
    const b = analyze(`g();`);
    expect(() => walkWire(a, {}, b.ast.body[0]!)).toThrow(TypeError);
  });

  test("walkWireIndexes delivers indexes and walks from a wire-index root", () => {
    const module = analyze(`f(g(x)); class C { m() { h(); } }`, "input.ts");
    const view = module._wire();
    // 从语句索引开走：只访问该语句的子树
    const seen: string[] = [];
    walkWireIndexes(
        module,
        {
            CallExpression: (index, ctx) => {
                seen.push(`${index === ctx.node}`);
                expect(ctx.parent).toBe(view.parentIndex(index));
            },
        },
        childIndexes(view, view.programIndex)[0],
    );
    expect(seen).toEqual(["true", "true"]);
    // 默认 root 是 Program
    let calls = 0;
    walkWireIndexes(module, { CallExpression: () => calls++ });
    expect(calls).toBe(3);
  });
});
