// Field reads on the wire buffer by field name. FIELD_SPECS is a
// hand-maintained map from wire tag to field layout, mirroring the
// decoder's emission order (validated field by field against decode's
// output in test/analyzer/wire-read.test.ts and the corpus harness).
// Spec tuple forms, with a trailing true marking TypeScript-only fields
// (absent properties in JavaScript mode):
//   ["n", slot]              child node index, -1 reads as null
//   ["n?", slot]             conditionally assigned child, absent reads
//                            as undefined (TSModuleDeclaration.body)
//   ["ns", slot]             extras array, start in slot and count in
//                            slot + 1 (transfer format v9)
//   ["nsH", slot]            the holey form, holes read as null
//   ["nsR", slot, restSlot]  pattern array with the rest element
//   ["nsHR", slot, restSlot] holey pattern array with rest
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
  { expressions: ["ns", 1] }, // 0
  { expression: ["n", 1] }, // 1
  { id: ["c",null], generator: ["c",false], async: ["b", 2], body: ["n", 4], expression: ["b", 1], typeParameters: ["n", 1, true], returnType: ["n", 3, true], params: ["params", 2] }, // 2
  { id: ["n", 1], generator: ["b", 4], async: ["b", 8], body: ["n", 5], expression: ["c",false], typeParameters: ["n", 2, true], returnType: ["n", 4, true], declare: ["b", 16, true], params: ["params", 3] }, // 3
  { body: ["ns", 1] }, // 4
  { body: ["ns", 1] }, // 5
  {}, // 6
  {}, // 7
  { left: ["n", 1], right: ["n", 2], operator: ["e", 31, 0, ["==","!=","===","!==","<","<=",">",">=","+","-","*","/","%","**","|","^","&","<<",">>",">>>","in","instanceof"]] }, // 8
  { left: ["n", 1], right: ["n", 2], operator: ["e", 3, 0, ["&&","||","??"]] }, // 9
  { test: ["n", 1], consequent: ["n", 2], alternate: ["n", 3] }, // 10
  { operator: ["e", 7, 0, ["-","+","!","~","typeof","void","delete"]], prefix: ["c",true], argument: ["n", 1] }, // 11
  { argument: ["n", 1], operator: ["e", 1, 0, ["++","--"]], prefix: ["b", 2] }, // 12
  { left: ["n", 1], right: ["n", 2], operator: ["e", 15, 0, ["=","+=","-=","*=","/=","%=","**=","<<=",">>=",">>>=","|=","^=","&=","||=","&&=","??="]] }, // 13
  { elements: ["ns", 1] }, // 14
  { properties: ["ns", 1] }, // 15
  { argument: ["n", 1] }, // 16
  { key: ["n", 1], value: ["n", 2], kind: ["e", 3, 0, ["init","get","set"]], method: ["b", 4], shorthand: ["b", 8], computed: ["b", 16], optional: ["c",false,true] }, // 17
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
  { decorators: ["ns", 1], key: ["n", 3], value: ["n", 4], kind: ["e", 3, 0, ["constructor","method","get","set"]], computed: ["b", 4], static: ["b", 8], override: ["b", 16, true], optional: ["b", 32, true], accessibility: ["e", 3, 7, [null,"public","private","protected"], true] }, // 29
  { decorators: ["ns", 1], key: ["n", 3], value: ["n", 5], computed: ["b", 1], static: ["b", 2], typeAnnotation: ["n", 4, true], declare: ["b", 8, true], override: ["b", 16, true], optional: ["b", 32, true], definite: ["b", 64, true], readonly: ["b", 128, true], accessibility: ["e", 3, 9, [null,"public","private","protected"], true] }, // 30
  { body: ["ns", 1] }, // 31
  {}, // 32
  { value: ["s", 1], raw: ["raw"] }, // 33
  { value: ["litNum"], raw: ["raw"] }, // 34
  { value: ["litBig"], raw: ["raw"], bigint: ["litBigStr"] }, // 35
  { value: ["b", 1], raw: ["e", 1, 0, ["false","true"]] }, // 36
  { value: ["c",null], raw: ["c","null"] }, // 37
  {}, // 38
  { value: ["litRegex"], raw: ["regexRaw"], regex: ["regexPair"] }, // 39
  { quasis: ["ns", 1], expressions: ["ns", 3] }, // 40
  { value: ["quasi"], tail: ["b", 1] }, // 41
  { name: ["s", 1], decorators: ["c",[],true], optional: ["c",false,true], typeAnnotation: ["c",null,true] }, // 42
  { name: ["s", 1] }, // 43
  { name: ["s", 1], decorators: ["ns", 3, true], typeAnnotation: ["n", 5, true], optional: ["b", 1, true] }, // 44
  { name: ["s", 1], decorators: ["c",[],true], optional: ["c",false,true], typeAnnotation: ["c",null,true] }, // 45
  { name: ["s", 1], decorators: ["c",[],true], optional: ["c",false,true], typeAnnotation: ["c",null,true] }, // 46
  { expression: ["n", 1], directive: ["c",null,true] }, // 47
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
  { kind: ["e", 7, 0, ["var","let","const","using","await using"]], declarations: ["ns", 1], declare: ["b", 8, true] }, // 66
  { id: ["n", 1], init: ["n", 2], definite: ["b", 1, true] }, // 67
  { expression: ["n", 1], directive: ["s", 2] }, // 68
  { left: ["n", 3], right: ["n", 5], decorators: ["ns", 1, true], typeAnnotation: ["n", 4, true], optional: ["b", 1, true] }, // 69
  { argument: ["n", 3], decorators: ["ns", 1, true], typeAnnotation: ["n", 4, true], optional: ["b", 1, true], value: ["c",null,true] }, // 70
  { decorators: ["ns", 1, true], optional: ["b", 1, true], typeAnnotation: ["n", 6, true], elements: ["nsHR", 3, 5] }, // 71
  { decorators: ["ns", 1, true], optional: ["b", 1, true], typeAnnotation: ["n", 6, true], properties: ["nsR", 3, 5] }, // 72
  { kind: ["c","init"], key: ["n", 1], value: ["n", 2], method: ["c",false], shorthand: ["b", 1], computed: ["b", 2], optional: ["c",false,true] }, // 73
  { body: ["ns", 1], sourceType: ["e", 1, 0, ["script","module"]] }, // 74
  { source: ["n", 1], options: ["n", 2], phase: ["phase"] }, // 75
  { specifiers: ["ns", 1], source: ["n", 3], attributes: ["ns", 4], importKind: ["e", 1, 2, ["value","type"], true], phase: ["phase"] }, // 76
  { imported: ["n", 1], local: ["n", 2], importKind: ["e", 1, 0, ["value","type"], true] }, // 77
  { local: ["n", 1] }, // 78
  { local: ["n", 1] }, // 79
  { key: ["n", 1], value: ["n", 2] }, // 80
  { declaration: ["n", 1], specifiers: ["ns", 2], source: ["n", 4], attributes: ["ns", 5], exportKind: ["e", 1, 0, ["value","type"], true] }, // 81
  { declaration: ["n", 1], exportKind: ["c","value",true] }, // 82
  { exported: ["n", 1], source: ["n", 2], attributes: ["ns", 3], exportKind: ["e", 1, 0, ["value","type"], true] }, // 83
  { local: ["n", 1], exported: ["n", 2], exportKind: ["e", 1, 0, ["value","type"], true] }, // 84
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
  { operator: ["e", 3, 0, ["keyof","unique","readonly"]], typeAnnotation: ["n", 1] }, // 123
  { typeAnnotation: ["n", 1] }, // 124
  { typeParameters: ["n", 1], returnType: ["n", 3], params: ["params", 2] }, // 125
  { abstract: ["b", 1], typeParameters: ["n", 1], returnType: ["n", 3], params: ["params", 2] }, // 126
  { parameterName: ["n", 1], typeAnnotation: ["n", 2], asserts: ["b", 1] }, // 127
  { members: ["ns", 1] }, // 128
  { key: ["n", 1], constraint: ["n", 2], nameType: ["n", 3], typeAnnotation: ["n", 4], optional: ["e", 3, 0, [false,true,"+","-"]], readonly: ["e", 3, 2, [null,true,"+","-"]] }, // 129
  { key: ["n", 1], typeAnnotation: ["n", 2], computed: ["b", 1], optional: ["b", 2], readonly: ["b", 4], accessibility: ["c",null,true], static: ["c",false,true] }, // 130
  { key: ["n", 1], computed: ["b", 4], optional: ["b", 8], kind: ["e", 3, 0, ["method","get","set"]], typeParameters: ["n", 2], returnType: ["n", 4], accessibility: ["c",null], readonly: ["c",false], static: ["c",false], params: ["params", 3] }, // 131
  { typeParameters: ["n", 1], returnType: ["n", 3], params: ["params", 2] }, // 132
  { typeParameters: ["n", 1], returnType: ["n", 3], params: ["params", 2] }, // 133
  { parameters: ["ns", 1], typeAnnotation: ["n", 3], readonly: ["b", 1], static: ["b", 2, true], accessibility: ["c",null,true] }, // 134
  { id: ["n", 1], typeParameters: ["n", 2], typeAnnotation: ["n", 3], declare: ["b", 1] }, // 135
  { id: ["n", 1], typeParameters: ["n", 2], extends: ["ns", 3], body: ["n", 5], declare: ["b", 1] }, // 136
  { body: ["ns", 1] }, // 137
  { expression: ["n", 1], typeArguments: ["n", 2] }, // 138
  { expression: ["n", 1], typeArguments: ["n", 2] }, // 139
  { id: ["n", 1], body: ["n", 2], const: ["b", 1], declare: ["b", 2] }, // 140
  { members: ["ns", 1] }, // 141
  { id: ["n", 1], initializer: ["n", 2], computed: ["b", 1] }, // 142
  { id: ["n", 1], kind: ["e", 1, 0, ["namespace","module"]], declare: ["b", 2], global: ["c",false], body: ["n?", 2] }, // 143
  { body: ["ns", 1] }, // 144
  { id: ["n", 1], body: ["n", 2], kind: ["c","global"], declare: ["b", 1], global: ["c",true] }, // 145
  { decorators: ["ns", 1], parameter: ["n", 3], override: ["b", 1], readonly: ["b", 2], accessibility: ["e", 3, 2, [null,"public","private","protected"]], static: ["c",false,true] }, // 146
  { decorators: ["c",[]], name: ["c","this"], optional: ["c",false], typeAnnotation: ["n", 1] }, // 147
  { expression: ["n", 1], typeAnnotation: ["n", 2] }, // 148
  { expression: ["n", 1], typeAnnotation: ["n", 2] }, // 149
  { typeAnnotation: ["n", 1], expression: ["n", 2] }, // 150
  { expression: ["n", 1] }, // 151
  { expression: ["n", 1], typeArguments: ["n", 2] }, // 152
  { expression: ["n", 1] }, // 153
  { id: ["n", 1] }, // 154
  { id: ["n", 1], moduleReference: ["n", 2], importKind: ["e", 1, 0, ["value","type"]] }, // 155
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
  { value: ["s", 1], raw: ["s", 1] }, // 170
  { expression: ["n", 1] }, // 171

];

// tag 7 (formal_parameter) decodes transparently to the wrapped pattern
const TAG_FORMAL_PARAMETER = 7;

// the u32 view per wire view, built once at view creation
export function wireWords(view) {
  return view.words;
}

export function tagOf(view, index) {
  return wireWords(view)[index * 12 + 11] & 255;
}

export function flagsOf(view, index) {
  return wireWords(view)[index * 12 + 11] >>> 16;
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
  const b = index * 12 + 11;
  return view.str(words[b + 1], words[b + 2]).replace(/_/g, "");
}

function readRegexParts(view, index) {
  const words = wireWords(view);
  const b = index * 12 + 11;
  return [view.str(words[b + 1], words[b + 2]), view.str(words[b + 3], words[b + 4])];
}

// the ESTree-visible child indexes of a node, in the decoder's field
// emission order. The generic reflection walk used by pattern and
// infer-parameter collection, without materializing anything
export function childIndexes(view, index) {
  const words = wireWords(view);
  const b = index * 12 + 11;
  const specs = FIELD_SPECS[words[b] & 255];
  const out = [];
  const extraBase = 11 + view.nodeCount * 12;
  for (const field of Object.keys(specs)) {
    const spec = specs[field];
    const kind = spec[0];
    const arity = kind === "n" || kind === "n?" || kind === "s" || kind === "b" || kind === "c" ||
        kind === "params" || kind === "ns" || kind === "nsH"
      ? 2
      : kind === "nsR" || kind === "nsHR"
        ? 3
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
      const count = words[b + spec[1] + 1];
      for (let j = 0; j < count; j++) {
        const child = words[extraBase + start + j];
        if (child !== -1) out.push(child);
      }
      if (kind === "nsR" || kind === "nsHR") {
        const rest = words[b + spec[2]];
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
  const paramsIndex = words[index * 12 + 11 + slot];
  if (paramsIndex === -1) return [];
  const pb = paramsIndex * 12 + 11;
  const start = words[pb + 1];
  const count = words[pb + 2];
  const rest = words[pb + 3];
  const extraBase = 11 + view.nodeCount * 12;
  const out = new Array(rest !== -1 ? count + 1 : count);
  for (let j = 0; j < count; j++) {
    let param = words[extraBase + start + j];
    if ((words[param * 12 + 11] & 255) === TAG_FORMAL_PARAMETER) {
      param = words[param * 12 + 11 + 1];
    }
    out[j] = param;
  }
  if (rest !== -1) out[count] = rest;
  return out;
}

function readNodes(view, index, slot, holey, restSlot) {
  const words = wireWords(view);
  const b = index * 12 + 11;
  const start = words[b + slot];
  const count = words[b + slot + 1];
  const extraBase = 11 + view.nodeCount * 12;
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
  const b = index * 12 + 11;
  const spec = FIELD_SPECS[words[b] & 255][field];
  if (spec === undefined) {
    throw new TypeError(`readField: no field "${field}" on wire tag ${words[b] & 255}`);
  }
  const kind = spec[0];
  const arity = kind === "n" || kind === "n?" || kind === "s" || kind === "b" || kind === "c" ||
      kind === "params" || kind === "ns" || kind === "nsH"
    ? 2
    : kind === "nsR" || kind === "nsHR"
      ? 3
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
      return readNodes(view, index, spec[1], false, undefined);
    case "nsH":
      return readNodes(view, index, spec[1], true, undefined);
    case "nsR":
      return readNodes(view, index, spec[1], false, spec[2]);
    case "nsHR":
      return readNodes(view, index, spec[1], true, spec[2]);
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
        cooked: (flags & 2) !== 0 ? null : view.str(words[b + 1], words[b + 2]),
      };
    case "phase":
      return (flags & 1) !== 0 ? IMPORT_PHASES[(flags >> 1) & 1] : null;
    default:
      throw new TypeError(`readField: unknown spec kind "${kind}"`);
  }
}

const IMPORT_PHASES = ["source", "defer"];
