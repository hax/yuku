// Field reads on the wire buffer by field name. FIELD_SPECS is a
// hand-maintained map from wire tag to field layout, mirroring the
// decoder's emission order (validated field by field against decode's
// output in test/analyzer/wire-read.test.ts and the corpus harness).
// Spec tuple forms, with a trailing true marking TypeScript-only fields
// (absent properties in JavaScript mode):
//   ["n", slot]              child node index, -1 reads as null
//   ["n?", slot]             conditionally assigned child, absent reads
//                            as undefined (TSModuleDeclaration.body)
//   ["ns", slot, half]       extras array, half 0 takes the count from
//                            the low 16 bits of word 1, 1 the high 16
//   ["nsH", slot, half]      the holey form, holes read as null
//   ["nsR", slot, half, restSlot]   pattern array with the rest element
//   ["nsHR", slot, half, restSlot]  holey pattern array with rest
//   ["s", slot]              string pool read over slot and slot + 1
//   ["b", mask]              flags bit
//   ["e", mask, shift, table]  flags bit field through a value table
//   ["c", value]             a constant the decoder writes literally
//   ["params", slot]         formal parameter list (pseudo node splice)
//   ["raw"]                  the source slice over the node's span
//   ["litNum"] | ["litBig"] | ["litBigStr"] | ["litRegex"] |
//   ["regexRaw"] | ["regexPair"] | ["quasi"] | ["phase"]
//                            literal and import-phase specials, mirroring
//                            the decoder's value math exactly
export const FIELD_SPECS = [
  { expressions: ["ns", 2, 0] }, // 0
  { expression: ["n", 2] }, // 1
  { id: ["c", null], generator: ["c", false], async: ["b", 2], body: ["n", 5], expression: ["b", 1], typeParameters: ["n", 2, true], returnType: ["n", 4, true], params: ["params", 3] }, // 2
  { id: ["n", 2], generator: ["b", 4], async: ["b", 8], body: ["n", 6], expression: ["c", false], typeParameters: ["n", 3, true], returnType: ["n", 5, true], declare: ["b", 16, true], params: ["params", 4] }, // 3
  { body: ["ns", 2, 0] }, // 4
  { body: ["ns", 2, 0] }, // 5
  {}, // 6
  {}, // 7
  { left: ["n", 2], right: ["n", 3], operator: ["e", 31, 0, ["==","!=","===","!==","<","<=",">",">=","+","-","*","/","%","**","|","^","&","<<",">>",">>>","in","instanceof"]] }, // 8
  { left: ["n", 2], right: ["n", 3], operator: ["e", 3, 0, ["&&","||","??"]] }, // 9
  { test: ["n", 2], consequent: ["n", 3], alternate: ["n", 4] }, // 10
  { operator: ["e", 7, 0, ["-","+","!","~","typeof","void","delete"]], prefix: ["c", true], argument: ["n", 2] }, // 11
  { argument: ["n", 2], operator: ["e", 1, 0, ["++","--"]], prefix: ["b", 2] }, // 12
  { left: ["n", 2], right: ["n", 3], operator: ["e", 15, 0, ["=","+=","-=","*=","/=","%=","**=","<<=",">>=",">>>=","|=","^=","&=","||=","&&=","??="]] }, // 13
  { elements: ["ns", 2, 0] }, // 14
  { properties: ["ns", 2, 0] }, // 15
  { argument: ["n", 2] }, // 16
  { key: ["n", 2], value: ["n", 3], kind: ["e", 3, 0, ["init","get","set"]], method: ["b", 4], shorthand: ["b", 8], computed: ["b", 16], optional: ["c", false, true] }, // 17
  { object: ["n", 2], property: ["n", 3], computed: ["b", 1], optional: ["b", 2] }, // 18
  { callee: ["n", 2], arguments: ["ns", 4, 0], optional: ["b", 1], typeArguments: ["n", 3, true] }, // 19
  { expression: ["n", 2] }, // 20
  { tag: ["n", 2], quasi: ["n", 4], typeArguments: ["n", 3, true] }, // 21
  { callee: ["n", 2], arguments: ["ns", 4, 0], typeArguments: ["n", 3, true] }, // 22
  { argument: ["n", 2] }, // 23
  { argument: ["n", 2], delegate: ["b", 1] }, // 24
  { meta: ["n", 2], property: ["n", 3] }, // 25
  { expression: ["n", 2] }, // 26
  { decorators: ["ns", 2, 0], id: ["n", 3], superClass: ["n", 5], body: ["n", 8], typeParameters: ["n", 4, true], superTypeArguments: ["n", 6, true], implements: ["ns", 7, 1, true], abstract: ["b", 2, true], declare: ["b", 4, true] }, // 27
  { body: ["ns", 2, 0] }, // 28
  { decorators: ["ns", 2, 0], key: ["n", 3], value: ["n", 4], kind: ["e", 3, 0, ["constructor","method","get","set"]], computed: ["b", 4], static: ["b", 8], override: ["b", 16, true], optional: ["b", 32, true], accessibility: ["e", 3, 7, [null,"public","private","protected"], true] }, // 29
  { decorators: ["ns", 2, 0], key: ["n", 3], value: ["n", 5], computed: ["b", 1], static: ["b", 2], typeAnnotation: ["n", 4, true], declare: ["b", 8, true], override: ["b", 16, true], optional: ["b", 32, true], definite: ["b", 64, true], readonly: ["b", 128, true], accessibility: ["e", 3, 9, [null,"public","private","protected"], true] }, // 30
  { body: ["ns", 2, 0] }, // 31
  {}, // 32
  { value: ["s", 2], raw: ["raw"] }, // 33
  { value: ["litNum"], raw: ["raw"] }, // 34
  { value: ["litBig"], raw: ["raw"], bigint: ["litBigStr"] }, // 35
  { value: ["b", 1], raw: ["e", 1, 0, ["false", "true"]] }, // 36
  { value: ["c", null], raw: ["c", "null"] }, // 37
  {}, // 38
  { value: ["litRegex"], raw: ["regexRaw"], regex: ["regexPair"] }, // 39
  { quasis: ["ns", 2, 0], expressions: ["ns", 3, 1] }, // 40
  { value: ["quasi"], tail: ["b", 1] }, // 41
  { name: ["s", 2], decorators: ["c", [], true], optional: ["c", false, true], typeAnnotation: ["c", null, true] }, // 42
  { name: ["s", 2] }, // 43
  { name: ["s", 2], decorators: ["ns", 4, 0, true], typeAnnotation: ["n", 5, true], optional: ["b", 1, true] }, // 44
  { name: ["s", 2], decorators: ["c", [], true], optional: ["c", false, true], typeAnnotation: ["c", null, true] }, // 45
  { name: ["s", 2], decorators: ["c", [], true], optional: ["c", false, true], typeAnnotation: ["c", null, true] }, // 46
  { expression: ["n", 2], directive: ["c", null, true] }, // 47
  { test: ["n", 2], consequent: ["n", 3], alternate: ["n", 4] }, // 48
  { discriminant: ["n", 2], cases: ["ns", 3, 0] }, // 49
  { test: ["n", 2], consequent: ["ns", 3, 0] }, // 50
  { init: ["n", 2], test: ["n", 3], update: ["n", 4], body: ["n", 5] }, // 51
  { left: ["n", 2], right: ["n", 3], body: ["n", 4] }, // 52
  { left: ["n", 2], right: ["n", 3], body: ["n", 4], await: ["b", 1] }, // 53
  { test: ["n", 2], body: ["n", 3] }, // 54
  { body: ["n", 2], test: ["n", 3] }, // 55
  { label: ["n", 2] }, // 56
  { label: ["n", 2] }, // 57
  { label: ["n", 2], body: ["n", 3] }, // 58
  { object: ["n", 2], body: ["n", 3] }, // 59
  { argument: ["n", 2] }, // 60
  { argument: ["n", 2] }, // 61
  { block: ["n", 2], handler: ["n", 3], finalizer: ["n", 4] }, // 62
  { param: ["n", 2], body: ["n", 3] }, // 63
  {}, // 64
  {}, // 65
  { kind: ["e", 7, 0, ["var","let","const","using","await using"]], declarations: ["ns", 2, 0], declare: ["b", 8, true] }, // 66
  { id: ["n", 2], init: ["n", 3], definite: ["b", 1, true] }, // 67
  { expression: ["n", 2], directive: ["s", 3] }, // 68
  { left: ["n", 3], right: ["n", 5], decorators: ["ns", 2, 0, true], typeAnnotation: ["n", 4, true], optional: ["b", 1, true] }, // 69
  { argument: ["n", 3], decorators: ["ns", 2, 0, true], typeAnnotation: ["n", 4, true], optional: ["b", 1, true], value: ["c", null, true] }, // 70
  { decorators: ["ns", 2, 0, true], optional: ["b", 1, true], typeAnnotation: ["n", 5, true], elements: ["nsHR", 3, 1, 4] }, // 71
  { decorators: ["ns", 2, 0, true], optional: ["b", 1, true], typeAnnotation: ["n", 5, true], properties: ["nsR", 3, 1, 4] }, // 72
  { kind: ["c", "init"], key: ["n", 2], value: ["n", 3], method: ["c", false], shorthand: ["b", 1], computed: ["b", 2], optional: ["c", false, true] }, // 73
  { body: ["ns", 2, 0], sourceType: ["e", 1, 0, ["script", "module"]] }, // 74
  { source: ["n", 2], options: ["n", 3], phase: ["phase"] }, // 75
  { specifiers: ["ns", 2, 0], source: ["n", 3], attributes: ["ns", 4, 1], importKind: ["e", 1, 2, ["value","type"], true], phase: ["phase"] }, // 76
  { imported: ["n", 2], local: ["n", 3], importKind: ["e", 1, 0, ["value","type"], true] }, // 77
  { local: ["n", 2] }, // 78
  { local: ["n", 2] }, // 79
  { key: ["n", 2], value: ["n", 3] }, // 80
  { declaration: ["n", 2], specifiers: ["ns", 3, 0], source: ["n", 4], attributes: ["ns", 5, 1], exportKind: ["e", 1, 0, ["value","type"], true] }, // 81
  { declaration: ["n", 2], exportKind: ["c", "value", true] }, // 82
  { exported: ["n", 2], source: ["n", 3], attributes: ["ns", 4, 0], exportKind: ["e", 1, 0, ["value","type"], true] }, // 83
  { local: ["n", 2], exported: ["n", 3], exportKind: ["e", 1, 0, ["value","type"], true] }, // 84
  { typeAnnotation: ["n", 2] }, // 85
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
  { typeName: ["n", 2], typeArguments: ["n", 3] }, // 101
  { left: ["n", 2], right: ["n", 3] }, // 102
  { exprName: ["n", 2], typeArguments: ["n", 3] }, // 103
  { source: ["n", 2], options: ["n", 3], qualifier: ["n", 4], typeArguments: ["n", 5] }, // 104
  { name: ["n", 2], constraint: ["n", 3], default: ["n", 4], in: ["b", 1], out: ["b", 2], const: ["b", 4] }, // 105
  { params: ["ns", 2, 0] }, // 106
  { params: ["ns", 2, 0] }, // 107
  { literal: ["n", 2] }, // 108
  { quasis: ["ns", 2, 0], types: ["ns", 3, 1] }, // 109
  { elementType: ["n", 2] }, // 110
  { objectType: ["n", 2], indexType: ["n", 3] }, // 111
  { elementTypes: ["ns", 2, 0] }, // 112
  { label: ["n", 2], elementType: ["n", 3], optional: ["b", 1] }, // 113
  { typeAnnotation: ["n", 2] }, // 114
  { typeAnnotation: ["n", 2] }, // 115
  { typeAnnotation: ["n", 2], postfix: ["b", 1] }, // 116
  { typeAnnotation: ["n", 2], postfix: ["b", 1] }, // 117
  {}, // 118
  { types: ["ns", 2, 0] }, // 119
  { types: ["ns", 2, 0] }, // 120
  { checkType: ["n", 2], extendsType: ["n", 3], trueType: ["n", 4], falseType: ["n", 5] }, // 121
  { typeParameter: ["n", 2] }, // 122
  { operator: ["e", 3, 0, ["keyof","unique","readonly"]], typeAnnotation: ["n", 2] }, // 123
  { typeAnnotation: ["n", 2] }, // 124
  { typeParameters: ["n", 2], returnType: ["n", 4], params: ["params", 3] }, // 125
  { abstract: ["b", 1], typeParameters: ["n", 2], returnType: ["n", 4], params: ["params", 3] }, // 126
  { parameterName: ["n", 2], typeAnnotation: ["n", 3], asserts: ["b", 1] }, // 127
  { members: ["ns", 2, 0] }, // 128
  { key: ["n", 2], constraint: ["n", 3], nameType: ["n", 4], typeAnnotation: ["n", 5], optional: ["e", 3, 0, [false,true,"+","-"]], readonly: ["e", 3, 2, [null,true,"+","-"]] }, // 129
  { key: ["n", 2], typeAnnotation: ["n", 3], computed: ["b", 1], optional: ["b", 2], readonly: ["b", 4], accessibility: ["c", null, true], static: ["c", false, true] }, // 130
  { key: ["n", 2], computed: ["b", 4], optional: ["b", 8], kind: ["e", 3, 0, ["method","get","set"]], typeParameters: ["n", 3], returnType: ["n", 5], accessibility: ["c", null], readonly: ["c", false], static: ["c", false], params: ["params", 4] }, // 131
  { typeParameters: ["n", 2], returnType: ["n", 4], params: ["params", 3] }, // 132
  { typeParameters: ["n", 2], returnType: ["n", 4], params: ["params", 3] }, // 133
  { parameters: ["ns", 2, 0], typeAnnotation: ["n", 3], readonly: ["b", 1], static: ["b", 2, true], accessibility: ["c", null, true] }, // 134
  { id: ["n", 2], typeParameters: ["n", 3], typeAnnotation: ["n", 4], declare: ["b", 1] }, // 135
  { id: ["n", 2], typeParameters: ["n", 3], extends: ["ns", 4, 0], body: ["n", 5], declare: ["b", 1] }, // 136
  { body: ["ns", 2, 0] }, // 137
  { expression: ["n", 2], typeArguments: ["n", 3] }, // 138
  { expression: ["n", 2], typeArguments: ["n", 3] }, // 139
  { id: ["n", 2], body: ["n", 3], const: ["b", 1], declare: ["b", 2] }, // 140
  { members: ["ns", 2, 0] }, // 141
  { id: ["n", 2], initializer: ["n", 3], computed: ["b", 1] }, // 142
  { id: ["n", 2], kind: ["e", 1, 0, ["namespace","module"]], declare: ["b", 2], global: ["c", false], body: ["n?", 3] }, // 143
  { body: ["ns", 2, 0] }, // 144
  { id: ["n", 2], body: ["n", 3], kind: ["c", "global"], declare: ["b", 1], global: ["c", true] }, // 145
  { decorators: ["ns", 2, 0], parameter: ["n", 3], override: ["b", 1], readonly: ["b", 2], accessibility: ["e", 3, 2, [null,"public","private","protected"]], static: ["c", false, true] }, // 146
  { decorators: ["c", []], name: ["c", "this"], optional: ["c", false], typeAnnotation: ["n", 2] }, // 147
  { expression: ["n", 2], typeAnnotation: ["n", 3] }, // 148
  { expression: ["n", 2], typeAnnotation: ["n", 3] }, // 149
  { typeAnnotation: ["n", 2], expression: ["n", 3] }, // 150
  { expression: ["n", 2] }, // 151
  { expression: ["n", 2], typeArguments: ["n", 3] }, // 152
  { expression: ["n", 2] }, // 153
  { id: ["n", 2] }, // 154
  { id: ["n", 2], moduleReference: ["n", 3], importKind: ["e", 1, 0, ["value","type"]] }, // 155
  { expression: ["n", 2] }, // 156
  { openingElement: ["n", 2], children: ["ns", 3, 0], closingElement: ["n", 4] }, // 157
  { name: ["n", 2], attributes: ["ns", 4, 0], selfClosing: ["b", 1], typeArguments: ["n", 3, true] }, // 158
  { name: ["n", 2] }, // 159
  { openingFragment: ["n", 2], children: ["ns", 3, 0], closingFragment: ["n", 4] }, // 160
  {}, // 161
  {}, // 162
  { name: ["s", 2] }, // 163
  { namespace: ["n", 2], name: ["n", 3] }, // 164
  { object: ["n", 2], property: ["n", 3] }, // 165
  { name: ["n", 2], value: ["n", 3] }, // 166
  { argument: ["n", 2] }, // 167
  { expression: ["n", 2] }, // 168
  {}, // 169
  { value: ["s", 2], raw: ["s", 2] }, // 170
  { expression: ["n", 2] }, // 171

];

// tag 7 (formal_parameter) decodes transparently to the wrapped pattern
const TAG_FORMAL_PARAMETER = 7;

// the u32 view per wire view, built once
const wordsCache = new WeakMap();

export function wireWords(view) {
  let words = wordsCache.get(view);
  if (words === undefined) {
    words = new Int32Array(view.buffer, 0, view.buffer.byteLength >> 2);
    wordsCache.set(view, words);
  }
  return words;
}

export function tagOf(view, index) {
  return wireWords(view)[index * 11 + 11] & 255;
}

export function flagsOf(view, index) {
  return wireWords(view)[index * 11 + 11] >>> 16;
}

// the source slice over a node's span, decode's `raw` fields
function rawSource(view, index) {
  return view.source.slice(view.startOf(index), view.endOf(index));
}

function readNumericLiteral(view, index) {
  const raw = rawSource(view, index);
  const digits = raw.indexOf("_") === -1 ? raw : raw.replace(/_/g, "");
  // legacy octal has a bare 0 prefix, `0o` goes through Number
  if ((flagsOf(view, index) & 3) === 2 && digits[1] !== "o" && digits[1] !== "O") {
    return parseInt(digits.slice(1), 8);
  }
  return +digits;
}

function readBigintDigits(view, index) {
  const words = wireWords(view);
  const b = index * 11 + 11;
  return view.str(words[b + 2], words[b + 3]).replace(/_/g, "");
}

function readRegexParts(view, index) {
  const words = wireWords(view);
  const b = index * 11 + 11;
  return [view.str(words[b + 2], words[b + 3]), view.str(words[b + 4], words[b + 5])];
}

// the ESTree-visible child indexes of a node, in the decoder's field
// emission order. The generic reflection walk used by pattern and
// infer-parameter collection, without materializing anything
export function childIndexes(view, index) {
  const words = wireWords(view);
  const b = index * 11 + 11;
  const specs = FIELD_SPECS[words[b] & 255];
  const out = [];
  const extraBase = 11 + view.nodeCount * 11;
  for (const field of Object.keys(specs)) {
    const spec = specs[field];
    const kind = spec[0];
    const arity = kind === "n" || kind === "n?" || kind === "s" || kind === "b" || kind === "c" ||
        kind === "params"
      ? 2
      : kind === "ns" || kind === "nsH"
        ? 3
        : kind === "nsR" || kind === "nsHR"
          ? 4
          : kind === "e"
            ? 4
            : 1;
    if (spec.length === arity + 1 && spec[arity] === true && !view.isTs) continue;
    if (kind === "n" || kind === "n?") {
      const child = words[b + spec[1]];
      if (child !== -1) out.push(child);
      continue;
    }
    if (kind === "params") {
      for (const param of readParams(view, index, spec[1])) out.push(param);
      continue;
    }
    if (kind === "ns" || kind === "nsH" || kind === "nsR" || kind === "nsHR") {
      const start = words[b + spec[1]];
      const word = words[b + 1];
      const count = spec[2] === 0 ? word & 65535 : word >>> 16;
      for (let j = 0; j < count; j++) {
        const child = words[extraBase + start + j];
        if (child !== -1) out.push(child);
      }
      if (kind === "nsR" || kind === "nsHR") {
        const rest = words[b + spec[3]];
        if (rest !== -1) out.push(rest);
      }
    }
  }
  return out;
}

// decode materializes the `params` array through the formal_parameters
// pseudo node: items unwrap formal_parameter wrappers, rest rides along
function readParams(view, index, slot) {
  const words = wireWords(view);
  const paramsIndex = words[index * 11 + 11 + slot];
  if (paramsIndex === -1) return [];
  const pb = paramsIndex * 11 + 11;
  const count = words[pb + 1] & 65535;
  const start = words[pb + 2];
  const rest = words[pb + 3];
  const extraBase = 11 + view.nodeCount * 11;
  const out = new Array(rest !== -1 ? count + 1 : count);
  for (let j = 0; j < count; j++) {
    let param = words[extraBase + start + j];
    if ((words[param * 11 + 11] & 255) === TAG_FORMAL_PARAMETER) {
      param = words[param * 11 + 11 + 2];
    }
    out[j] = param;
  }
  if (rest !== -1) out[count] = rest;
  return out;
}

function readNodes(view, index, slot, half, holey, restSlot) {
  const words = wireWords(view);
  const b = index * 11 + 11;
  const start = words[b + slot];
  const word = words[b + 1];
  const count = half === 0 ? word & 65535 : word >>> 16;
  const extraBase = 11 + view.nodeCount * 11;
  const out = new Array(count);
  for (let j = 0; j < count; j++) {
    const child = words[extraBase + start + j];
    out[j] = holey && child === -1 ? null : child;
  }
  if (restSlot !== undefined) {
    const rest = words[b + restSlot];
    if (rest !== -1) out.push(rest);
  }
  return out;
}

// Read field `field` of the node at `index`, by the wire layout. Child
// nodes come back as wire indexes, arrays as fresh arrays of them.
// A field absent in JavaScript mode reads as undefined, matching the
// decoded object.
export function readField(view, index, field) {
  const words = wireWords(view);
  const b = index * 11 + 11;
  const spec = FIELD_SPECS[words[b] & 255][field];
  if (spec === undefined) {
    throw new TypeError(`readField: no field "${field}" on wire tag ${words[b] & 255}`);
  }
  const kind = spec[0];
  const arity = kind === "n" || kind === "n?" || kind === "s" || kind === "b" || kind === "c" ||
      kind === "params"
    ? 2
    : kind === "ns" || kind === "nsH"
      ? 3
      : kind === "nsR" || kind === "nsHR"
        ? 4
        : kind === "e"
          ? 4
          : 1;
  if (spec.length === arity + 1 && spec[arity] === true && !view.isTs) return undefined;
  const flags = words[b] >>> 16;
  switch (kind) {
    case "n": {
      const child = words[b + spec[1]];
      return child === -1 ? null : child;
    }
    case "n?": {
      const child = words[b + spec[1]];
      return child === -1 ? undefined : child;
    }
    case "ns":
      return readNodes(view, index, spec[1], spec[2], false, undefined);
    case "nsH":
      return readNodes(view, index, spec[1], spec[2], true, undefined);
    case "nsR":
      return readNodes(view, index, spec[1], spec[2], false, spec[3]);
    case "nsHR":
      return readNodes(view, index, spec[1], spec[2], true, spec[3]);
    case "s":
      return view.str(words[b + spec[1]], words[b + spec[1] + 1]);
    case "b":
      return (flags & spec[1]) !== 0;
    case "e":
      return spec[3][(flags >>> spec[2]) & spec[1]];
    case "c": {
      const value = spec[1];
      // decode materializes a fresh array literal per node
      if (Array.isArray(value)) return [];
      return value;
    }
    case "params":
      return readParams(view, index, spec[1]);
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
        cooked: (flags & 2) !== 0 ? null : view.str(words[b + 2], words[b + 3]),
      };
    case "phase":
      return (flags & 1) !== 0 ? IMPORT_PHASES[(flags >> 1) & 1] : null;
    default:
      throw new TypeError(`readField: unknown spec kind "${kind}"`);
  }
}

const IMPORT_PHASES = ["source", "defer"];
