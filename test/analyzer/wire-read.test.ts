// Goal: readField decodes every field kind from the wire buffer exactly
// as the object decoder does. Method: assert field values against the
// materialized objects over sources exercising each spec kind (nodes,
// arrays, holes, rest, strings, flags, enums, params, literals), then
// compare every field of every node over sources covering all 172
// non-dialect wire tags.
import { describe, expect, test } from "bun:test";
import {
  analyze as analyzeFile,
  childIndexes,
  flagsOf,
  readField,
  tagOf,
  type Module,
  type WireView,
} from "yuku/analyzer";

function analyze(source: string, path = "input.js"): Module {
  return analyzeFile(source, { path });
}

type Node = ReturnType<WireView["nodeOf"]>;

function everyIndex(view: WireView): number[] {
  return Array.from({ length: view.nodeCount }, (_, i) => i);
}

// finds the first node of a type; the tests pick constructs of one shape
function firstOfType(view: WireView, type: string): number {
  const found = everyIndex(view).find((i) => view.nodeOf(i).type === type);
  if (found === undefined) throw new Error(`no node of type ${type}`);
  return found;
}

describe("the v12 wire layout", () => {
  test("header words and node records line up", () => {
    const view = analyze(`let x = 1;`, "input.js")._wire();
    // a 40-byte header: node count, then the Program index at word 7,
    // the mode flags at word 8 (bit 0 is TypeScript)
    expect(view.words[0]).toBe(view.nodeCount);
    expect(view.words[7]).toBe(view.programIndex);
    expect(view.words[8]! & 1).toBe(0);
    // 48-byte node records: tag | flags << 16, nine slots, span start, span end
    expect(tagOf(view, view.programIndex)).toBe(74);
    expect(view.nodeOf(view.programIndex).type).toBe("Program");
    const tsView = analyze(`let x: int = 1;`, "input.ts")._wire();
    expect(tsView.isTs).toBe(true);
    expect(tsView.words[8]! & 1).toBe(1);
    // the fork's int keyword sits between ts_number_keyword and ts_bigint_keyword
    const intIndex = everyIndex(tsView).find((i) => tsView.nodeOf(i).type === "TSIntKeyword")!;
    expect(tagOf(tsView, intIndex)).toBe(94);
    expect(flagsOf(tsView, intIndex)).toBe(0);
  });
});

describe("readField", () => {
  test("child and array fields match the decoded objects, including holes and rest", () => {
    const module = analyze(`f(a, ...b); const [x, , y = 1, ...z] = q;`, "input.js");
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

    // the holes and the rest element of an array pattern
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
      (i) =>
        view.nodeOf(i).type === "Identifier" &&
        (view.nodeOf(i) as Node & { name: string }).name === "obj",
    )!;
    expect(readField(view, identIndex, "name")).toBe("obj");
  });

  test("function params splice the pseudo nodes", () => {
    const module = analyze(
      `function f(this: number, a, { b } = {}, ...rest: any[]) {}`,
      "input.ts",
    );
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
    expect(values[1]).toBe(15); // 0o17
    expect(values[2]).toBe(1000);
    expect(values[3]).toBe(15n);
    expect(values[4]).toBe(12n);
    expect(values[5]).toBe(true);
    expect(values[6]).toBe(null);
    expect(values[7]).toBeInstanceOf(RegExp);
  });

  test("legacy octal reads through the flags", () => {
    const module = analyze(`var x = 010;`, "input.cjs");
    const view = module._wire();
    expect(readField(view, firstOfType(view, "Literal"), "value")).toBe(8);
  });

  test("JSX text decodes entities in value but not raw", () => {
    const module = analyze(`const el = <p>a &amp; b</p>;`, "input.tsx");
    const view = module._wire();
    const textIndex = firstOfType(view, "JSXText");
    expect(readField(view, textIndex, "value")).toBe("a & b");
    expect(readField(view, textIndex, "raw")).toBe("a &amp; b");
  });

  test("TypeScript-only fields read as undefined in JavaScript mode", () => {
    const module = analyze(`function f() {}`, "input.js");
    const view = module._wire();
    const fnIndex = firstOfType(view, "FunctionDeclaration");
    expect(readField(view, fnIndex, "returnType")).toBeUndefined();
    expect(readField(view, fnIndex, "declare")).toBeUndefined();
    expect(readField(view, fnIndex, "body")).not.toBeNull();
  });

  test("an unknown field or spec kind throws", () => {
    const view = analyze(`f();`)._wire();
    const callIndex = firstOfType(view, "CallExpression");
    expect(() => readField(view, callIndex, "nope")).toThrow(TypeError);
  });

  test("childIndexes walks the same children in the walk's field order", () => {
    const module = analyze(`if (a) { b(); }`, "input.js");
    const view = module._wire();
    const children = childIndexes(view, firstOfType(view, "IfStatement"));
    expect(children.map((c) => view.nodeOf(c).type)).toEqual(["Identifier", "BlockStatement"]);
  });
});

// every field of every node, read through the wire, against the
// materialized object. Pseudo nodes (6 formal_parameters, 7
// formal_parameter) decode transparently and sit out the field check.
const SKIP_FIELDS = new Set(["type", "start", "end", "comments", "hashbang"]);

function expectFieldEqual(view: WireView, actual: unknown, expected: unknown): void {
  if (expected === null || typeof expected !== "object") {
    expect(actual).toBe(expected);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    const actualItems = actual as (number | null)[];
    expect(actualItems.length).toBe(expected.length);
    for (let j = 0; j < expected.length; j++) {
      const item = expected[j] as Node | null;
      expect(actualItems[j]).toBe(item === null ? null : view.indexOf(item));
    }
    return;
  }
  if (expected instanceof RegExp) {
    expect(actual).toBeInstanceOf(RegExp);
    const re = actual as RegExp;
    expect(re.source).toBe(expected.source);
    expect(re.flags).toBe(expected.flags);
    return;
  }
  if ("type" in expected) {
    expect(actual).toBe(view.indexOf(expected as Node));
    return;
  }
  // TemplateElement's value and a regex literal's regex are plain records
  expect(actual).toEqual(expected);
}

function checkFields(source: string, path: string, seen: Set<number>): void {
  const module = analyze(source, path);
  const view = module._wire();
  for (let i = 0; i < view.nodeCount; i++) {
    const tag = tagOf(view, i);
    seen.add(tag);
    if (tag === 6 || tag === 7) continue;
    const decoded = view.nodeOf(i) as Node & Record<string, unknown>;
    for (const field of Object.keys(decoded)) {
      if (SKIP_FIELDS.has(field)) continue;
      expectFieldEqual(view, readField(view, i, field), decoded[field]);
    }
  }
}

const COVERAGE_SOURCES: [string, string][] = [
  [
    "input.js",
    `#!/usr/bin/env node
"use strict";
label: for (let i = 0, j = 0;; i++, j--) { if (i > 1) break label; else continue label; }
const seq = (a, b), paren = (a), chain = a?.b?.["c"]?.();
const tern = cond ? x : y;
const un = -a + !b + ~c + typeof d + void e + delete o.p;
const arr = [1, , 2];
const nil = null;
const made = new C(1, ...args);
let [x, , y = 1, ...z] = q;
let { p, q: r = 2, ...rest } = s;
const obj = { a: 1, get g() { return 2; }, set g(v) {}, ["c"]: 3, ...spread, m() {}, shorthand };
const tpl = tag\`a\${1}b\${2}c\`;
const re = /ab+/gi;
const big = 12n;
const meta = new.target;
class C extends B {
  #priv = 1;
  static { C; }
  constructor() { super(); this.x = super.x; }
  static get sg() { return 1; }
}
function* gen() { yield* it; yield 1; }
async function af() { await p; for await (const c of cs) {} }
switch (k) { case 1: f(); break; default: g(); }
try { throw e; } catch ({ message }) { debugger; } finally { h(); }
do { w(); } while (cond);
while (cond2) {}
for (const k in obj) {}
for (const v of arr) {}
import("mod", { with: { type: "json" } });
export default function () {};
`,
  ],
  ["with.cjs", `with (scope) { name; } var oct = 010; var empty; ;`],
  [
    "mod.js",
    `import def, { a as b } from "mod" with { attr: "1" };
import * as ns from "mod2";
import "side";
import source w from "./x.wasm";
import defer * as d from "./y";
export { b, ns as renamed };
export const e = 1;
export * from "mod3";
export * as nns from "mod4";
export { z } from "mod5";
`,
  ],
  [
    "types.ts",
    `import type { T1 } from "mod";
import { type X, y } from "mod2";
using res = getRes();
function f(this: number, @dec p: string, q?: number): asserts p is string {}
const arrow = async <T,>(a: T, { b = 1 } = {}, ...rest: T[]) => a ?? b;
declare function declared(x: number): void;
function over(x: number): void;
function over(x: string): void;
function over(x: any) { return x; }
abstract class Abs<U> extends Base<U> implements Iface<U> {
  abstract am(): void;
  abstract ap: number;
  abstract accessor aa: string;
  constructor(private readonly x: number, public y?: string) { super(); }
  @dec method() {}
}
type Alias<T extends object = {}> = keyof T | unique symbol | readonly string[];
type Fn = (a: number) => void;
type Ctor = abstract new (a: string) => object;
type Cond<T> = T extends infer U ? U[] : never;
type Mapped = { -readonly [K in keyof Alias]+?: Alias[K] };
type Lit = "s" | 1 | true;
type Tpl = \`a\${string}b\`;
type Tuple = [name: string, age?: number, ...rest: string[]];
type Opt = [string?];
type Int = string & number;
type Par = (number);
type Imp = import("mod").X<string>;
type Pred = typeof arrow;
type JsN = ?string;
type JsNN = string!;
type JsU = ?;
type Idx = Alias["a"];
type Ops = { [k: string]: number };
type Intrinsic = intrinsic;
let kw: unknown, kn: null, ku: undefined, ki: int, kb: bigint, kbo: boolean;
namespace Ns { export const q = 1; }
declare module "mod" { export const r: number; }
declare global { interface Window {} }
enum En { A = 1, B = "x" }
const enum Ce { X }
interface Iface<T> {
  new (): Iface<T>;
  (): void;
  readonly [k: string]: number;
  get g(): number;
  set g(v: number);
  m(): this;
}
interface Sub extends Iface<string> { prop: number; }
let as = 1 as any;
let sat = {} satisfies object;
let asrt = <string>x;
let nn = x!;
let inst = arrow<string>;
export = Abs;
`,
  ],
  [
    "decl.d.ts",
    `export as namespace Lib;
import x = require("mod");
export import y = Ns.q;
`,
  ],
  [
    "jsx.tsx",
    `const el = <x:y attr="1">text &amp; </x:y>;
const el2 = <x.y.z {...rest}>{expr}{...kids}{/* note */}</x.y.z>;
const fr = <></>;
`,
  ],
];

describe("readField against the decoded objects", () => {
  test("every field of every node matches, over all 172 non-dialect tags", () => {
    const seen = new Set<number>();
    for (const [path, source] of COVERAGE_SOURCES) checkFields(source, path, seen);
    const missing: number[] = [];
    for (let tag = 0; tag <= 171; tag++) if (!seen.has(tag)) missing.push(tag);
    expect(missing).toEqual([]);
  });
});
