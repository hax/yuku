// Field reads on the wire buffer by field name, transfer format v12
// (src/parser/ffi/transfer/root.zig): a 40-byte header, then 48-byte node
// records (tag | flags << 16, nine u32 slots, span start and end), then the
// extras array backing IndexRange fields. FIELD_SPECS is a hand-maintained
// map from wire tag to field layout, mirroring the decoder's emission order
// (validated field by field against decode's output in
// test/analyzer/wire-read.test.ts).
//
// Spec tuple forms, with a trailing true marking TypeScript-only fields
// (absent properties in JavaScript mode):
//   ["n", slot]              child node index, -1 reads as null
//   ["n?", slot]             conditionally assigned child, absent reads
//                            as undefined (TSModuleDeclaration.body)
//   ["ns", slot]             extras array, start in slot and count in
//                            slot + 1
//   ["nsH", slot]            the holey form, holes read as null
//   ["nsR", slot, restSlot]  pattern array with the rest element
//   ["nsHR", slot, restSlot] holey pattern array with rest
//   ["s", slot]              string read over slot and slot + 1
//   ["b", mask]              flags bit
//   ["e", mask, shift, table]  flags bit field through a value table
//   ["c", value]             a constant the decoder writes literally
//   ["params", slot]         formal parameter list (pseudo node splice)
//   ["raw"]                  the source slice over the node's span
//   ["litNum"] | ["litBig"] | ["litBigStr"] | ["litRegex"] |
//   ["regexRaw"] | ["regexPair"] | ["quasi"] | ["phase"] |
//   ["jsxValue", slot]       literal, template, import-phase, and JSX text
//                            specials, mirroring the decoder's value math
//                            exactly

import type { Decoded } from "../core/decode";
import type { Node } from "../types";

/**
 * The module's wire-format internals behind {@link walkWire}: the raw
 * analysis buffer plus the decode layer's index-based accessors. Indexes
 * are wire node indexes, stable per parse. Semi-internal, the shape
 * evolves with the wire format.
 */
export interface WireView {
  /** The raw transfer buffer. A 40-byte header, then 48-byte node records. */
  readonly buffer: ArrayBuffer;
  /** The buffer as 32-bit words, the layout the readers index into. */
  readonly words: Int32Array;
  /** The module's source text. */
  readonly source: string;
  /** The number of node records in the buffer. */
  readonly nodeCount: number;
  /** The wire index of the Program node. */
  readonly programIndex: number;
  /** Whether the module was parsed as TypeScript. */
  readonly isTs: boolean;
  /** Decodes the node at a wire index into its ESTree object, cached. */
  nodeOf(index: number): Node;
  /** The wire index of a decoded node object. */
  indexOf(node: Node): number | undefined;
  /** The wire index of a node's structural parent, or -1 at the root. */
  parentIndex(index: number): number;
  /** The node's start offset in UTF-16 code units. */
  startOf(index: number): number;
  /** The node's end offset in UTF-16 code units. */
  endOf(index: number): number;
  /** Decodes the string between two wire string coordinates. */
  str(start: number, end: number): string;
}

type FieldSpec =
  | readonly ["n" | "n?" | "s" | "b" | "params" | "ns" | "nsH" | "jsxValue", number]
  | readonly ["n" | "n?" | "s" | "b" | "params" | "ns" | "nsH" | "jsxValue", number, true]
  | readonly ["nsR" | "nsHR", number, number]
  | readonly ["nsR" | "nsHR", number, number, true]
  | readonly ["e", number, number, readonly unknown[]]
  | readonly ["e", number, number, readonly unknown[], true]
  | readonly ["c", unknown]
  | readonly ["c", unknown, true]
  | readonly [
      "raw" | "litNum" | "litBig" | "litBigStr" | "litRegex" | "regexRaw" | "regexPair" | "quasi" | "phase",
    ];

const FIELD_SPECS: readonly Readonly<Record<string, FieldSpec>>[] = [
  { expressions: ["ns", 1] }, // 0
  { expression: ["n", 1] }, // 1
  { id: ["c", null], generator: ["c", false], async: ["b", 2], body: ["n", 4], expression: ["b", 1], typeParameters: ["n", 1, true], returnType: ["n", 3, true], params: ["params", 2] }, // 2
  { id: ["n", 1], generator: ["b", 4], async: ["b", 8], body: ["n", 5], expression: ["c", false], typeParameters: ["n", 2, true], returnType: ["n", 4, true], declare: ["b", 16, true], params: ["params", 3] }, // 3
  { body: ["ns", 1] }, // 4
  { body: ["ns", 1] }, // 5
  {}, // 6
  {}, // 7
  { left: ["n", 1], right: ["n", 2], operator: ["e", 31, 0, ["==", "!=", "===", "!==", "<", "<=", ">", ">=", "+", "-", "*", "/", "%", "**", "|", "^", "&", "<<", ">>", ">>>", "in", "instanceof"]] }, // 8
  { left: ["n", 1], right: ["n", 2], operator: ["e", 3, 0, ["&&", "||", "??"]] }, // 9
  { test: ["n", 1], consequent: ["n", 2], alternate: ["n", 3] }, // 10
  { operator: ["e", 7, 0, ["-", "+", "!", "~", "typeof", "void", "delete"]], prefix: ["c", true], argument: ["n", 1] }, // 11
  { argument: ["n", 1], operator: ["e", 1, 0, ["++", "--"]], prefix: ["b", 2] }, // 12
  { left: ["n", 1], right: ["n", 2], operator: ["e", 15, 0, ["=", "+=", "-=", "*=", "/=", "%=", "**=", "<<=", ">>=", ">>>=", "|=", "^=", "&=", "||=", "&&=", "??="]] }, // 13
  { elements: ["nsH", 1] }, // 14
  { properties: ["ns", 1] }, // 15
  { argument: ["n", 1] }, // 16
  { key: ["n", 1], value: ["n", 2], kind: ["e", 3, 0, ["init", "get", "set"]], method: ["b", 4], shorthand: ["b", 8], computed: ["b", 16], optional: ["c", false, true] }, // 17
  { object: ["n", 1], property: ["n", 2], computed: ["b", 1], optional: ["b", 2] }, // 18
  { callee: ["n", 1], arguments: ["ns", 3], optional: ["b", 1], typeArguments: ["n", 2, true] }, // 19
  { expression: ["n", 1] }, // 20
  { tag: ["n", 1], quasi: ["n", 3], typeArguments: ["n", 2, true] }, // 21
  { callee: ["n", 1], arguments: ["ns", 3], typeArguments: ["n", 2, true] }, // 22
  { argument: ["n", 1] }, // 23
  { argument: ["n", 1], delegate: ["b", 1] }, // 24
  { meta: ["n", 1], property: ["n", 2] }, // 25
  { expression: ["n", 1] }, // 26
  { decorators: ["ns", 1], id: ["n", 3], superClass: ["n", 5], body: ["n", 9], typeParameters: ["n", 4, true], superTypeArguments: ["n", 6, true], implements: ["ns", 7, true], abstract: ["b", 2, true], declare: ["b", 4, true] }, // 27
  { body: ["ns", 1] }, // 28
  { decorators: ["ns", 1], key: ["n", 3], value: ["n", 4], kind: ["e", 3, 0, ["constructor", "method", "get", "set"]], computed: ["b", 4], static: ["b", 8], override: ["b", 16, true], optional: ["b", 32, true], accessibility: ["e", 3, 7, [null, "public", "private", "protected"], true] }, // 29
  { decorators: ["ns", 1], key: ["n", 3], value: ["n", 5], computed: ["b", 1], static: ["b", 2], typeAnnotation: ["n", 4, true], declare: ["b", 8, true], override: ["b", 16, true], optional: ["b", 32, true], definite: ["b", 64, true], readonly: ["b", 128, true], accessibility: ["e", 3, 9, [null, "public", "private", "protected"], true] }, // 30
  { body: ["ns", 1] }, // 31
  {}, // 32
  { value: ["s", 1], raw: ["raw"] }, // 33
  { value: ["litNum"], raw: ["raw"] }, // 34
  { value: ["litBig"], raw: ["raw"], bigint: ["litBigStr"] }, // 35
  { value: ["b", 1], raw: ["e", 1, 0, ["false", "true"]] }, // 36
  { value: ["c", null], raw: ["c", "null"] }, // 37
  {}, // 38
  { value: ["litRegex"], raw: ["regexRaw"], regex: ["regexPair"] }, // 39
  { quasis: ["ns", 1], expressions: ["ns", 3] }, // 40
  { value: ["quasi"], tail: ["b", 1] }, // 41
  { name: ["s", 1], decorators: ["c", [], true], optional: ["c", false, true], typeAnnotation: ["c", null, true] }, // 42
  { name: ["s", 1] }, // 43
  { name: ["s", 1], decorators: ["ns", 3, true], typeAnnotation: ["n", 5, true], optional: ["b", 1, true] }, // 44
  { name: ["s", 1], decorators: ["c", [], true], optional: ["c", false, true], typeAnnotation: ["c", null, true] }, // 45
  { name: ["s", 1], decorators: ["c", [], true], optional: ["c", false, true], typeAnnotation: ["c", null, true] }, // 46
  { expression: ["n", 1], directive: ["c", null, true] }, // 47
  { test: ["n", 1], consequent: ["n", 2], alternate: ["n", 3] }, // 48
  { discriminant: ["n", 1], cases: ["ns", 2] }, // 49
  { test: ["n", 1], consequent: ["ns", 2] }, // 50
  { init: ["n", 1], test: ["n", 2], update: ["n", 3], body: ["n", 4] }, // 51
  { left: ["n", 1], right: ["n", 2], body: ["n", 3] }, // 52
  { left: ["n", 1], right: ["n", 2], body: ["n", 3], await: ["b", 1] }, // 53
  { test: ["n", 1], body: ["n", 2] }, // 54
  { body: ["n", 1], test: ["n", 2] }, // 55
  { label: ["n", 1] }, // 56
  { label: ["n", 1] }, // 57
  { label: ["n", 1], body: ["n", 2] }, // 58
  { object: ["n", 1], body: ["n", 2] }, // 59
  { argument: ["n", 1] }, // 60
  { argument: ["n", 1] }, // 61
  { block: ["n", 1], handler: ["n", 2], finalizer: ["n", 3] }, // 62
  { param: ["n", 1], body: ["n", 2] }, // 63
  {}, // 64
  {}, // 65
  { kind: ["e", 7, 0, ["var", "let", "const", "using", "await using"]], declarations: ["ns", 1], declare: ["b", 8, true] }, // 66
  { id: ["n", 1], init: ["n", 2], definite: ["b", 1, true] }, // 67
  { expression: ["n", 1], directive: ["s", 2] }, // 68
  { left: ["n", 3], right: ["n", 5], decorators: ["ns", 1, true], typeAnnotation: ["n", 4, true], optional: ["b", 1, true] }, // 69
  { argument: ["n", 3], decorators: ["ns", 1, true], typeAnnotation: ["n", 4, true], optional: ["b", 1, true], value: ["c", null, true] }, // 70
  { decorators: ["ns", 1, true], optional: ["b", 1, true], typeAnnotation: ["n", 6, true], elements: ["nsHR", 3, 5] }, // 71
  { decorators: ["ns", 1, true], optional: ["b", 1, true], typeAnnotation: ["n", 6, true], properties: ["nsR", 3, 5] }, // 72
  { kind: ["c", "init"], key: ["n", 1], value: ["n", 2], method: ["c", false], shorthand: ["b", 1], computed: ["b", 2], optional: ["c", false, true] }, // 73
  { body: ["ns", 1], sourceType: ["e", 1, 0, ["script", "module"]] }, // 74
  { source: ["n", 1], options: ["n", 2], phase: ["phase"] }, // 75
  { specifiers: ["ns", 1], source: ["n", 3], attributes: ["ns", 4], importKind: ["e", 1, 2, ["value", "type"], true], phase: ["phase"] }, // 76
  { imported: ["n", 1], local: ["n", 2], importKind: ["e", 1, 0, ["value", "type"], true] }, // 77
  { local: ["n", 1] }, // 78
  { local: ["n", 1] }, // 79
  { key: ["n", 1], value: ["n", 2] }, // 80
  { declaration: ["n", 1], specifiers: ["ns", 2], source: ["n", 4], attributes: ["ns", 5], exportKind: ["e", 1, 0, ["value", "type"], true] }, // 81
  { declaration: ["n", 1], exportKind: ["c", "value", true] }, // 82
  { exported: ["n", 1], source: ["n", 2], attributes: ["ns", 3], exportKind: ["e", 1, 0, ["value", "type"], true] }, // 83
  { local: ["n", 1], exported: ["n", 2], exportKind: ["e", 1, 0, ["value", "type"], true] }, // 84
  { typeAnnotation: ["n", 1] }, // 85
  {}, // 86
  {}, // 87
  {}, // 88
  {}, // 89
  {}, // 90
  {}, // 91
  {}, // 92
  {}, // 93
  {}, // 94
  {}, // 95
  {}, // 96
  {}, // 97
  {}, // 98
  {}, // 99
  {}, // 100
  { typeName: ["n", 1], typeArguments: ["n", 2] }, // 101
  { left: ["n", 1], right: ["n", 2] }, // 102
  { exprName: ["n", 1], typeArguments: ["n", 2] }, // 103
  { source: ["n", 1], options: ["n", 2], qualifier: ["n", 3], typeArguments: ["n", 4] }, // 104
  { name: ["n", 1], constraint: ["n", 2], default: ["n", 3], in: ["b", 1], out: ["b", 2], const: ["b", 4] }, // 105
  { params: ["ns", 1] }, // 106
  { params: ["ns", 1] }, // 107
  { literal: ["n", 1] }, // 108
  { quasis: ["ns", 1], types: ["ns", 3] }, // 109
  { elementType: ["n", 1] }, // 110
  { objectType: ["n", 1], indexType: ["n", 2] }, // 111
  { elementTypes: ["ns", 1] }, // 112
  { label: ["n", 1], elementType: ["n", 2], optional: ["b", 1] }, // 113
  { typeAnnotation: ["n", 1] }, // 114
  { typeAnnotation: ["n", 1] }, // 115
  { typeAnnotation: ["n", 1], postfix: ["b", 1] }, // 116
  { typeAnnotation: ["n", 1], postfix: ["b", 1] }, // 117
  {}, // 118
  { types: ["ns", 1] }, // 119
  { types: ["ns", 1] }, // 120
  { checkType: ["n", 1], extendsType: ["n", 2], trueType: ["n", 3], falseType: ["n", 4] }, // 121
  { typeParameter: ["n", 1] }, // 122
  { operator: ["e", 3, 0, ["keyof", "unique", "readonly"]], typeAnnotation: ["n", 1] }, // 123
  { typeAnnotation: ["n", 1] }, // 124
  { typeParameters: ["n", 1], returnType: ["n", 3], params: ["params", 2] }, // 125
  { abstract: ["b", 1], typeParameters: ["n", 1], returnType: ["n", 3], params: ["params", 2] }, // 126
  { parameterName: ["n", 1], typeAnnotation: ["n", 2], asserts: ["b", 1] }, // 127
  { members: ["ns", 1] }, // 128
  { key: ["n", 1], constraint: ["n", 2], nameType: ["n", 3], typeAnnotation: ["n", 4], optional: ["e", 3, 0, [false, true, "+", "-"]], readonly: ["e", 3, 2, [null, true, "+", "-"]] }, // 129
  { key: ["n", 1], typeAnnotation: ["n", 2], computed: ["b", 1], optional: ["b", 2], readonly: ["b", 4], accessibility: ["c", null, true], static: ["c", false, true] }, // 130
  { key: ["n", 1], computed: ["b", 4], optional: ["b", 8], kind: ["e", 3, 0, ["method", "get", "set"]], typeParameters: ["n", 2], returnType: ["n", 4], accessibility: ["c", null], readonly: ["c", false], static: ["c", false], params: ["params", 3] }, // 131
  { typeParameters: ["n", 1], returnType: ["n", 3], params: ["params", 2] }, // 132
  { typeParameters: ["n", 1], returnType: ["n", 3], params: ["params", 2] }, // 133
  { parameters: ["ns", 1], typeAnnotation: ["n", 3], readonly: ["b", 1], static: ["b", 2, true], accessibility: ["c", null, true] }, // 134
  { id: ["n", 1], typeParameters: ["n", 2], typeAnnotation: ["n", 3], declare: ["b", 1] }, // 135
  { id: ["n", 1], typeParameters: ["n", 2], extends: ["ns", 3], body: ["n", 5], declare: ["b", 1] }, // 136
  { body: ["ns", 1] }, // 137
  { expression: ["n", 1], typeArguments: ["n", 2] }, // 138
  { expression: ["n", 1], typeArguments: ["n", 2] }, // 139
  { id: ["n", 1], body: ["n", 2], const: ["b", 1], declare: ["b", 2] }, // 140
  { members: ["ns", 1] }, // 141
  { id: ["n", 1], initializer: ["n", 2], computed: ["b", 1] }, // 142
  { id: ["n", 1], kind: ["e", 1, 0, ["namespace", "module"]], declare: ["b", 2], global: ["c", false], body: ["n?", 2] }, // 143
  { body: ["ns", 1] }, // 144
  { id: ["n", 1], body: ["n", 2], kind: ["c", "global"], declare: ["b", 1], global: ["c", true] }, // 145
  { decorators: ["ns", 1], parameter: ["n", 3], override: ["b", 1], readonly: ["b", 2], accessibility: ["e", 3, 2, [null, "public", "private", "protected"]], static: ["c", false, true] }, // 146
  { decorators: ["c", []], name: ["c", "this"], optional: ["c", false], typeAnnotation: ["n", 1] }, // 147
  { expression: ["n", 1], typeAnnotation: ["n", 2] }, // 148
  { expression: ["n", 1], typeAnnotation: ["n", 2] }, // 149
  { typeAnnotation: ["n", 1], expression: ["n", 2] }, // 150
  { expression: ["n", 1] }, // 151
  { expression: ["n", 1], typeArguments: ["n", 2] }, // 152
  { expression: ["n", 1] }, // 153
  { id: ["n", 1] }, // 154
  { id: ["n", 1], moduleReference: ["n", 2], importKind: ["e", 1, 0, ["value", "type"]] }, // 155
  { expression: ["n", 1] }, // 156
  { openingElement: ["n", 1], children: ["ns", 2], closingElement: ["n", 4] }, // 157
  { name: ["n", 1], attributes: ["ns", 3], selfClosing: ["b", 1], typeArguments: ["n", 2, true] }, // 158
  { name: ["n", 1] }, // 159
  { openingFragment: ["n", 1], children: ["ns", 2], closingFragment: ["n", 4] }, // 160
  {}, // 161
  {}, // 162
  { name: ["s", 1] }, // 163
  { namespace: ["n", 1], name: ["n", 2] }, // 164
  { object: ["n", 1], property: ["n", 2] }, // 165
  { name: ["n", 1], value: ["n", 2] }, // 166
  { argument: ["n", 1] }, // 167
  { expression: ["n", 1] }, // 168
  {}, // 169
  { value: ["jsxValue", 1], raw: ["s", 1] }, // 170
  { expression: ["n", 1] }, // 171
  {}, // 172 the dialect node, its shape defined by the compiled-in dialect
];

// the pseudo tags: formal_parameters decodes to a bare params array and
// formal_parameter unwraps to the pattern, so neither surfaces a node
const TAG_FORMAL_PARAMETERS = 6;
const TAG_FORMAL_PARAMETER = 7;
// the dialect node carries its children as a holey extras range at slot 1
const TAG_DIALECT = 172;

// node records start at word 10 (the 40-byte header) and stride 12 words
/** @internal */
export function wireWords(view: WireView): Int32Array {
  return view.words;
}

/** The wire tag of the node at a wire index. */
export function tagOf(view: WireView, index: number): number {
  return wireWords(view)[index * 12 + 10]! & 255;
}

/** The flags word of the node at a wire index. */
export function flagsOf(view: WireView, index: number): number {
  return wireWords(view)[index * 12 + 10]! >>> 16;
}

// the source slice over a node's span, decode's `raw` fields
function rawSource(view: WireView, index: number): string {
  return view.source.slice(view.startOf(index), view.endOf(index));
}

function readNumericLiteral(view: WireView, index: number): number {
  const raw = rawSource(view, index);
  const digits = raw.indexOf("_") === -1 ? raw : raw.replace(/_/g, "");
  // legacy octal has a bare 0 prefix, `0o` goes through Number
  if ((flagsOf(view, index) & 3) === 2 && digits[1] !== "o" && digits[1] !== "O") {
    return parseInt(digits.slice(1), 8);
  }
  return +digits;
}

function readBigintDigits(view: WireView, index: number): string {
  const words = wireWords(view);
  const b = index * 12 + 10;
  return view.str(words[b + 1]!, words[b + 2]!).replace(/_/g, "");
}

function readRegexParts(view: WireView, index: number): [string, string] {
  const words = wireWords(view);
  const b = index * 12 + 10;
  return [view.str(words[b + 1]!, words[b + 2]!), view.str(words[b + 3]!, words[b + 4]!)];
}

function specArity(kind: string): number {
  if (
    kind === "n" || kind === "n?" || kind === "s" || kind === "b" || kind === "c" ||
    kind === "params" || kind === "ns" || kind === "nsH" || kind === "jsxValue"
  ) {
    return 2;
  }
  if (kind === "nsR" || kind === "nsHR") return 3;
  if (kind === "e") return 4;
  return 1;
}

/**
 * The ESTree-visible child indexes of a node, in the decoder's field
 * emission order. Powers generic subtree walks without materializing.
 */
export function childIndexes(view: WireView, index: number): number[] {
  const words = wireWords(view);
  const b = index * 12 + 10;
  const tag = words[b]! & 255;
  if (tag === TAG_DIALECT) {
    const out: number[] = [];
    const start = words[b + 1]!;
    const count = words[b + 2]!;
    const extraBase = 10 + view.nodeCount * 12;
    for (let j = 0; j < count; j++) {
      const child = words[extraBase + start + j]!;
      if (child !== -1) out.push(child);
    }
    return out;
  }
  const specs = FIELD_SPECS[tag]!;
  const out: number[] = [];
  const extraBase = 10 + view.nodeCount * 12;
  for (const field of Object.keys(specs)) {
    const spec = specs[field]!;
    const kind = spec[0] as string;
    const arity = specArity(kind);
    if (spec.length === arity + 1 && spec[arity] === true && !view.isTs) continue;
    if (kind === "n" || kind === "n?") {
      const child = words[b + (spec[1] as number)]!;
      if (child !== -1) out.push(child);
      continue;
    }
    if (kind === "params") {
      for (const param of readParams(view, index, spec[1] as number)) out.push(param);
      continue;
    }
    if (kind === "ns" || kind === "nsH" || kind === "nsR" || kind === "nsHR") {
      const start = words[b + (spec[1] as number)]!;
      const count = words[b + (spec[1] as number) + 1]!;
      for (let j = 0; j < count; j++) {
        const child = words[extraBase + start + j]!;
        if (child !== -1) out.push(child);
      }
      if (kind === "nsR" || kind === "nsHR") {
        const rest = words[b + (spec[2] as number)]!;
        if (rest !== -1) out.push(rest);
      }
    }
  }
  return out;
}

// decode materializes the `params` array through the formal_parameters
// pseudo node: items unwrap formal_parameter wrappers, rest rides along
function readParams(view: WireView, index: number, slot: number): number[] {
  const words = wireWords(view);
  const paramsIndex = words[index * 12 + 10 + slot]!;
  if (paramsIndex === -1) return [];
  const pb = paramsIndex * 12 + 10;
  const start = words[pb + 1]!;
  const count = words[pb + 2]!;
  const rest = words[pb + 3]!;
  const extraBase = 10 + view.nodeCount * 12;
  const out: number[] = new Array(rest !== -1 ? count + 1 : count);
  for (let j = 0; j < count; j++) {
    let param = words[extraBase + start + j]!;
    if ((words[param * 12 + 10]! & 255) === TAG_FORMAL_PARAMETER) {
      param = words[param * 12 + 10 + 1]!;
    }
    out[j] = param;
  }
  if (rest !== -1) out[count] = rest;
  return out;
}

function readNodes(
  view: WireView,
  index: number,
  slot: number,
  holey: boolean,
  restSlot: number | undefined,
): (number | null)[] {
  const words = wireWords(view);
  const b = index * 12 + 10;
  const start = words[b + slot]!;
  const count = words[b + slot + 1]!;
  const extraBase = 10 + view.nodeCount * 12;
  const out: (number | null)[] = new Array(count);
  for (let j = 0; j < count; j++) {
    const child = words[extraBase + start + j]!;
    out[j] = holey && child === -1 ? null : child;
  }
  if (restSlot !== undefined) {
    const rest = words[b + restSlot]!;
    if (rest !== -1) out.push(rest);
  }
  return out;
}

/**
 * Reads a named field of the node at a wire index, by the wire layout.
 * Child nodes come back as wire indexes, array fields as fresh arrays of
 * them. A field absent in JavaScript mode reads as undefined, matching
 * the decoded object.
 */
export function readField(view: WireView, index: number, field: string): unknown {
  const words = wireWords(view);
  const b = index * 12 + 10;
  const tag = words[b]! & 255;
  const spec = FIELD_SPECS[tag]![field];
  if (spec === undefined) {
    throw new TypeError(`readField: no field "${field}" on wire tag ${tag}`);
  }
  const kind = spec[0] as string;
  const arity = specArity(kind);
  if (spec.length === arity + 1 && spec[arity] === true && !view.isTs) return undefined;
  const flags = words[b]! >>> 16;
  switch (kind) {
    case "n": {
      const child = words[b + (spec[1] as number)]!;
      return child === -1 ? null : child;
    }
    case "n?": {
      const child = words[b + (spec[1] as number)]!;
      return child === -1 ? undefined : child;
    }
    case "ns":
      return readNodes(view, index, spec[1] as number, false, undefined);
    case "nsH":
      return readNodes(view, index, spec[1] as number, true, undefined);
    case "nsR":
      return readNodes(view, index, spec[1] as number, false, spec[2] as number);
    case "nsHR":
      return readNodes(view, index, spec[1] as number, true, spec[2] as number);
    case "s":
      return view.str(words[b + (spec[1] as number)]!, words[b + (spec[1] as number) + 1]!);
    case "b":
      return (flags & (spec[1] as number)) !== 0;
    case "e":
      return (spec[3] as readonly unknown[])[(flags >>> (spec[2] as number)) & (spec[1] as number)];
    case "c": {
      const value = spec[1];
      // decode materializes a fresh array literal per node
      if (Array.isArray(value)) return [];
      return value;
    }
    case "params":
      return readParams(view, index, spec[1] as number);
    case "raw":
      return rawSource(view, index);
    case "litNum":
      return readNumericLiteral(view, index);
    case "litBig":
      return BigInt(readBigintDigits(view, index));
    case "litBigStr":
      return BigInt(readBigintDigits(view, index)).toString();
    case "litRegex": {
      const [pattern, flagText] = readRegexParts(view, index);
      try {
        return new RegExp(pattern, flagText);
      } catch {
        return null;
      }
    }
    case "regexRaw": {
      const [pattern, flagText] = readRegexParts(view, index);
      return "/" + pattern + "/" + flagText;
    }
    case "regexPair": {
      const [pattern, flagText] = readRegexParts(view, index);
      return { pattern, flags: flagText.split("").sort().join("") };
    }
    case "quasi":
      return {
        raw: rawSource(view, index).replace(/\r\n?/g, "\n"),
        cooked: (flags & 2) !== 0 ? null : view.str(words[b + 1]!, words[b + 2]!),
      };
    case "phase":
      return (flags & 1) !== 0 ? IMPORT_PHASES[(flags >> 1) & 1] : null;
    case "jsxValue":
      return jsxValue(
        view.str(words[b + (spec[1] as number)]!, words[b + (spec[1] as number) + 1]!),
      );
    default:
      throw new TypeError(`readField: unknown spec kind "${kind}"`);
  }
}

const IMPORT_PHASES = ["source", "defer"];

// JSX text decodes entities in `value` but not `raw`, mirroring decode.js
const JSX_ENTITY_NAMES = "quot:22 amp:26 apos lt:3c gt:3e nbsp:a0 iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml OElig:152 oelig Scaron:160 scaron Yuml:178 fnof:192 circ:2c6 tilde:2dc Alpha:391 Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho Sigma:3a3 Tau Upsilon Phi Chi Psi Omega alpha:3b1 beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega thetasym:3d1 upsih piv:3d6 ensp:2002 emsp thinsp:2009 zwnj:200c zwj lrm rlm ndash:2013 mdash lsquo:2018 rsquo sbquo ldquo:201c rdquo bdquo dagger:2020 Dagger bull hellip:2026 permil:2030 prime:2032 Prime lsaquo:2039 rsaquo oline:203e frasl:2044 euro:20ac image:2111 weierp:2118 real:211c trade:2122 alefsym:2135 larr:2190 uarr rarr darr harr crarr:21b5 lArr:21d0 uArr rArr dArr hArr forall:2200 part:2202 exist empty:2205 nabla:2207 isin notin ni:220b prod:220f sum:2211 minus lowast:2217 radic:221a prop:221d infin ang:2220 and:2227 or cap cup int there4:2234 sim:223c cong:2245 asymp:2248 ne:2260 equiv le:2264 ge sub:2282 sup nsub sube:2286 supe oplus:2295 otimes:2297 perp:22a5 sdot:22c5 lceil:2308 rceil lfloor rfloor lang:2329 rang loz:25ca spades:2660 clubs:2663 hearts:2665 diams";
const JSX_ENTITY = /&(?:#x([\da-fA-F]+)|#(\d+)|([\da-zA-Z]+));/g;
let jsxEntities: Map<string, number> | null = null;
function jsxEntity(name: string): number | undefined {
  if (jsxEntities === null) {
    jsxEntities = new Map();
    let cp = 0;
    for (const entry of JSX_ENTITY_NAMES.split(" ")) {
      const colon = entry.indexOf(":");
      cp = colon === -1 ? cp + 1 : parseInt(entry.slice(colon + 1), 16);
      jsxEntities.set(colon === -1 ? entry : entry.slice(0, colon), cp);
    }
  }
  return jsxEntities.get(name);
}
function jsxValue(raw: string): string {
  if (raw.indexOf("&") === -1) return raw;
  return raw.replace(JSX_ENTITY, (text, hex: string, dec: string, name: string) => {
    const cp = name === undefined
      ? parseInt(hex === undefined ? dec : hex, hex === undefined ? 10 : 16)
      : jsxEntity(name);
    return cp === undefined || cp > 0x10ffff ? text : String.fromCodePoint(cp);
  });
}

const utf8 = new TextDecoder("utf-8", { ignoreBOM: true });

// string reads replicate decode's geometry: coordinates below source_len
// slice the source (byte offsets, mapped to UTF-16 through the position
// map past the first non-ASCII byte), the rest address the string pool
function buildPosMap(src: string, byteLen: number, startByte: number): Uint32Array {
  const m = new Uint32Array(byteLen - startByte + 1);
  const len = src.length;
  let bp = 0, u16p = startByte, i = startByte;
  while (i < len) {
    if (i + 16 <= len) {
      let allAscii = true;
      for (let k = 0; k < 16; k++) {
        if (src.charCodeAt(i + k) >= 0x80) { allAscii = false; break; }
      }
      if (allAscii) {
        for (let k = 0; k < 16; k++) m[bp + k] = u16p + k;
        bp += 16; u16p += 16; i += 16;
        continue;
      }
    }
    const cu = src.charCodeAt(i);
    m[bp] = u16p;
    if (cu < 0x80) { bp++; u16p++; i++; }
    else if (cu < 0x800) { m[bp + 1] = u16p + 1; bp += 2; u16p++; i++; }
    // a lone surrogate encodes as U+FFFD, three bytes and one unit
    else if (cu < 0xD800 || cu >= 0xDC00 || (src.charCodeAt(i + 1) & 0xFC00) !== 0xDC00) {
      m[bp + 1] = u16p + 1; m[bp + 2] = u16p + 1;
      bp += 3; u16p++; i++;
    } else {
      m[bp + 1] = u16p + 1; m[bp + 2] = u16p + 2; m[bp + 3] = u16p + 2;
      bp += 4; u16p += 2; i += 2;
    }
  }
  m[byteLen - startByte] = u16p;
  return m;
}

/** @internal The wire view behind a module's analysis result. */
export function createWireView(decoded: Decoded, source: string): WireView {
  const buffer = decoded.wireBuffer;
  const bytes = new Uint8Array(buffer);
  const words = new Int32Array(buffer, 0, buffer.byteLength >> 2);
  const nodeCount = words[0]!;
  const extraCount = words[1]!;
  const sourceLength = words[3]!;
  const poolOffset = 40 + nodeCount * 48 + extraCount * 4;
  const firstNonAscii = words[9]!;

  let posMap: Uint32Array | null = null;
  function positionMap(): Uint32Array | null {
    if (posMap === null && firstNonAscii < sourceLength) {
      posMap = buildPosMap(source, sourceLength, firstNonAscii);
    }
    return posMap;
  }

  function poolDecode(s: number, e: number): string {
    const a = poolOffset + s - sourceLength, b = poolOffset + e - sourceLength;
    let hasEd = false;
    for (let i = a; i < b; i++) if (bytes[i] === 0xED) { hasEd = true; break; }
    if (!hasEd) return utf8.decode(bytes.subarray(a, b));
    let r = "";
    for (let i = a; i < b; ) {
      const c = bytes[i]!;
      if (c < 0x80) { r += String.fromCharCode(c); i++; }
      else if (c < 0xE0) {
        r += String.fromCharCode(((c & 0x1F) << 6) | (bytes[i + 1]! & 0x3F));
        i += 2;
      } else if (c < 0xF0) {
        r += String.fromCharCode(
          ((c & 0x0F) << 12) | ((bytes[i + 1]! & 0x3F) << 6) | (bytes[i + 2]! & 0x3F),
        );
        i += 3;
      } else {
        r += String.fromCodePoint(
          ((c & 0x07) << 18) | ((bytes[i + 1]! & 0x3F) << 12) |
            ((bytes[i + 2]! & 0x3F) << 6) | (bytes[i + 3]! & 0x3F),
        );
        i += 4;
      }
    }
    return r;
  }

  function str(s: number, e: number): string {
    if (s === e) return "";
    if (s >= sourceLength) return poolDecode(s, e);
    if (e <= firstNonAscii) return source.slice(s, e);
    const m = positionMap()!;
    return source.slice(s < firstNonAscii ? s : m[s - firstNonAscii]!, m[e - firstNonAscii]!);
  }

  return {
    buffer,
    words,
    source,
    nodeCount,
    programIndex: words[7]!,
    isTs: (words[8]! & 1) !== 0,
    nodeOf: (index) => decoded.nodeOf(index),
    indexOf: (node) => decoded.indexOf(node),
    parentIndex: (index) => decoded.parentIndex(index),
    startOf: (index) => decoded.startOf(index),
    endOf: (index) => decoded.endOf(index),
    str,
  };
}
