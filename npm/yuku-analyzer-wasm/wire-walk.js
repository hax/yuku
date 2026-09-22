// A walk over the module's AST driven directly by the binary wire
// buffer. Children come from a CSR index built once per module from the
// wire child slots, and a node is decoded into an ESTree object only
// when a visitor registered its type. `module.walk` drives the decoded
// object graph, so a subtree walk pays dispatch and property-traversal
// costs for every node it touches. The wire walk touches only typed
// arrays for the nodes nobody listens to.
import { ALIAS_GROUPS } from "yuku-ast";
import { wireWords } from "./wire-read.js";

// ESTree type name per wire tag, in the NodeData union's declaration
// order (src/parser/ast.zig). null where the name depends on the node's
// flags (3 function, 27 class, 29 method_definition, 30
// property_definition, resolved by wireTypeName below), and for the two
// pseudo tags (6 formal_parameters, 7 formal_parameter) that decode
// transparently and never surface as ESTree nodes.
const TAG_NAMES = [
  "SequenceExpression", "ParenthesizedExpression", "ArrowFunctionExpression", null, "BlockStatement",
  "BlockStatement", null, null, "BinaryExpression", "LogicalExpression",
  "ConditionalExpression", "UnaryExpression", "UpdateExpression", "AssignmentExpression", "ArrayExpression",
  "ObjectExpression", "SpreadElement", "Property", "MemberExpression", "CallExpression",
  "ChainExpression", "TaggedTemplateExpression", "NewExpression", "AwaitExpression", "YieldExpression",
  "MetaProperty", "Decorator", null, "ClassBody", null,
  null, "StaticBlock", "Super", "Literal", "Literal",
  "Literal", "Literal", "Literal", "ThisExpression", "Literal",
  "TemplateLiteral", "TemplateElement", "Identifier", "PrivateIdentifier", "Identifier",
  "Identifier", "Identifier", "ExpressionStatement", "IfStatement", "SwitchStatement",
  "SwitchCase", "ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement",
  "DoWhileStatement", "BreakStatement", "ContinueStatement", "LabeledStatement", "WithStatement",
  "ReturnStatement", "ThrowStatement", "TryStatement", "CatchClause", "DebuggerStatement",
  "EmptyStatement", "VariableDeclaration", "VariableDeclarator", "ExpressionStatement", "AssignmentPattern",
  "RestElement", "ArrayPattern", "ObjectPattern", "Property", "Program",
  "ImportExpression", "ImportDeclaration", "ImportSpecifier", "ImportDefaultSpecifier", "ImportNamespaceSpecifier",
  "ImportAttribute", "ExportNamedDeclaration", "ExportDefaultDeclaration", "ExportAllDeclaration", "ExportSpecifier",
  "TSTypeAnnotation", "TSAnyKeyword", "TSUnknownKeyword", "TSNeverKeyword", "TSVoidKeyword",
  "TSNullKeyword", "TSUndefinedKeyword", "TSStringKeyword", "TSNumberKeyword", "TSIntKeyword",
  "TSBigIntKeyword", "TSBooleanKeyword", "TSSymbolKeyword", "TSObjectKeyword", "TSIntrinsicKeyword",
  "TSThisType", "TSTypeReference", "TSQualifiedName", "TSTypeQuery", "TSImportType",
  "TSTypeParameter", "TSTypeParameterDeclaration", "TSTypeParameterInstantiation", "TSLiteralType", "TSTemplateLiteralType",
  "TSArrayType", "TSIndexedAccessType", "TSTupleType", "TSNamedTupleMember", "TSOptionalType",
  "TSRestType", "TSJSDocNullableType", "TSJSDocNonNullableType", "TSJSDocUnknownType", "TSUnionType",
  "TSIntersectionType", "TSConditionalType", "TSInferType", "TSTypeOperator", "TSParenthesizedType",
  "TSFunctionType", "TSConstructorType", "TSTypePredicate", "TSTypeLiteral", "TSMappedType",
  "TSPropertySignature", "TSMethodSignature", "TSCallSignatureDeclaration", "TSConstructSignatureDeclaration", "TSIndexSignature",
  "TSTypeAliasDeclaration", "TSInterfaceDeclaration", "TSInterfaceBody", "TSInterfaceHeritage", "TSClassImplements",
  "TSEnumDeclaration", "TSEnumBody", "TSEnumMember", "TSModuleDeclaration", "TSModuleBlock",
  "TSModuleDeclaration", "TSParameterProperty", "Identifier", "TSAsExpression", "TSSatisfiesExpression",
  "TSTypeAssertion", "TSNonNullExpression", "TSInstantiationExpression", "TSExportAssignment", "TSNamespaceExportDeclaration",
  "TSImportEqualsDeclaration", "TSExternalModuleReference", "JSXElement", "JSXOpeningElement", "JSXClosingElement",
  "JSXFragment", "JSXOpeningFragment", "JSXClosingFragment", "JSXIdentifier", "JSXNamespacedName",
  "JSXMemberExpression", "JSXAttribute", "JSXSpreadAttribute", "JSXExpressionContainer", "JSXEmptyExpression",
  "JSXText", "JSXSpreadChild",
];

// Child slots per wire tag, same tag order as TAG_NAMES, mirroring the
// decoder's private table. Pairs of (kind, slot) read against the node's
// 11-word record. kind 0 is a single child index at word slot. Otherwise
// the extras start is at word slot and the count comes from word slot+1
// (kind 1), the low 16 bits of word 1 (kind 2), or its high 16 bits
// (kind 3). Slot order is ESTree field order, so children built from it
// come out in `module.walk` order.
const CHILD_SLOTS = [
  [2,2], [0,2], [0,2,0,3,0,4,0,5], [0,2,0,3,0,4,0,5,0,6], [2,2], [2,2], [2,2,0,3], [0,2],
  [0,2,0,3], [0,2,0,3], [0,2,0,3,0,4], [0,2], [0,2], [0,2,0,3], [2,2], [2,2],
  [0,2], [0,2,0,3], [0,2,0,3], [0,2,0,3,2,4], [0,2], [0,2,0,3,0,4], [0,2,0,3,2,4], [0,2],
  [0,2], [0,2,0,3], [0,2], [2,2,0,3,0,4,0,5,0,6,3,7,0,8], [2,2], [2,2,0,3,0,4], [2,2,0,3,0,4,0,5], [2,2],
  [], [], [], [], [], [], [], [],
  [2,2,3,3], [], [], [], [2,4,0,5], [], [], [0,2],
  [0,2,0,3,0,4], [0,2,2,3], [0,2,2,3], [0,2,0,3,0,4,0,5], [0,2,0,3,0,4], [0,2,0,3,0,4], [0,2,0,3], [0,2,0,3],
  [0,2], [0,2], [0,2,0,3], [0,2,0,3], [0,2], [0,2], [0,2,0,3,0,4], [0,2,0,3],
  [], [], [2,2], [0,2,0,3], [0,2], [2,2,0,3,0,4,0,5], [2,2,0,3,0,4], [2,2,3,3,0,4,0,5],
  [2,2,3,3,0,4,0,5], [0,2,0,3], [2,2], [0,2,0,3], [2,2,0,3,3,4], [0,2,0,3], [0,2], [0,2],
  [0,2,0,3], [0,2,2,3,0,4,3,5], [0,2], [0,2,0,3,2,4], [0,2,0,3], [0,2], [], [],
  [], [], [], [], [], [], [], [],
  [], [], [], [], [], [0,2,0,3], [0,2,0,3], [0,2,0,3],
  [0,2,0,3,0,4,0,5], [0,2,0,3,0,4], [2,2], [2,2], [0,2], [2,2,3,3], [0,2], [0,2,0,3],
  [2,2], [0,2,0,3], [0,2], [0,2], [0,2], [0,2], [], [2,2],
  [2,2], [0,2,0,3,0,4,0,5], [0,2], [0,2], [0,2], [0,2,0,3,0,4], [0,2,0,3,0,4], [0,2,0,3],
  [2,2], [0,2,0,3,0,4,0,5], [0,2,0,3], [0,2,0,3,0,4,0,5], [0,2,0,3,0,4], [0,2,0,3,0,4], [2,2,0,3], [0,2,0,3,0,4],
  [0,2,0,3,2,4,0,5], [2,2], [0,2,0,3], [0,2,0,3], [0,2,0,3], [2,2], [0,2,0,3], [0,2,0,3],
  [2,2], [0,2,0,3], [2,2,0,3], [0,2], [0,2,0,3], [0,2,0,3], [0,2,0,3], [0,2],
  [0,2,0,3], [0,2], [0,2], [0,2,0,3], [0,2], [0,2,2,3,0,4], [0,2,0,3,2,4], [0,2],
  [0,2,2,3,0,4], [], [], [], [0,2,0,3], [0,2,0,3], [0,2,0,3], [0,2],
  [0,2], [], [], [0,2],
];

// the flags-dependent names, mirroring the decoder exactly
const FUNCTION_TYPES = [
  "FunctionDeclaration",
  "FunctionExpression",
  "TSDeclareFunction",
  "TSEmptyBodyFunctionExpression",
];
const CLASS_TYPES = ["ClassDeclaration", "ClassExpression"];

// the pseudo tags: formal_parameters decodes to a bare params array and
// formal_parameter unwraps to the pattern, so neither surfaces a node.
// Their wire children belong to the enclosing node instead.
const TAG_FORMAL_PARAMETERS = 6;
const TAG_FORMAL_PARAMETER = 7;

// The ESTree type name of the node with the given wire tag and flags.
// The abstract renames happen only in TypeScript mode, matching the
// decoder's `isTs` gate. Returns null for the pseudo tags.
export function wireTypeName(tag, flags, isTs) {
  switch (tag) {
    case 3:
      return FUNCTION_TYPES[flags & 3];
    case 27:
      return CLASS_TYPES[flags & 1];
    case 29:
      return isTs && (flags & 64) !== 0 ? "TSAbstractMethodDefinition" : "MethodDefinition";
    case 30:
      if (isTs && (flags & 256) !== 0) {
        return (flags & 4) !== 0 ? "TSAbstractAccessorProperty" : "TSAbstractPropertyDefinition";
      }
      return (flags & 4) !== 0 ? "AccessorProperty" : "PropertyDefinition";
    default:
      return TAG_NAMES[tag];
  }
}

// Runs `visit` on the ESTree-visible children of node `i`, in field
// order. Pseudo nodes are spliced: their children take their place,
// matching the decoded object graph. The pseudo nesting is
// formal_parameters over formal_parameter, so the recursion bottoms out
// at depth 2.
function forEachChild(u32, extraBase, i, visit) {
  const b = i * 11 + 11;
  const ops = CHILD_SLOTS[u32[b] & 255];
  for (let q = 0; q < ops.length; q += 2) {
    const slot = ops[q + 1];
    if (ops[q] === 0) {
      const child = u32[b + slot];
      if (child !== -1) visitChild(u32, extraBase, child, visit);
    } else {
      const start = u32[b + slot];
      const word = u32[b + 1];
      const count = ops[q] === 1 ? u32[b + slot + 1] : ops[q] === 2 ? word & 65535 : word >>> 16;
      for (let j = 0; j < count; j++) {
        const child = u32[extraBase + start + j];
        if (child !== -1) visitChild(u32, extraBase, child, visit);
      }
    }
  }
}

function visitChild(u32, extraBase, child, visit) {
  const tag = u32[child * 11 + 11] & 255;
  if (tag === TAG_FORMAL_PARAMETERS || tag === TAG_FORMAL_PARAMETER) {
    forEachChild(u32, extraBase, child, visit);
  } else {
    visit(child);
  }
}

// the ESTree type name of the node at a wire index, null for pseudo tags
export function wireTypeOf(view, index) {
  const word = wireWords(view)[index * 11 + 11];
  return wireTypeName(word & 255, word >>> 16, view.isTs);
}

// one CSR child index per module, built on demand
const wireIndexCache = new WeakMap();

function wireIndexOf(module) {
  let cached = wireIndexCache.get(module);
  if (cached !== undefined) return cached;
  const view = module._wire();
  const u32 = wireWords(view);
  const nodeCount = u32[0];
  const extraBase = 11 + nodeCount * 11;
  const offsets = new Int32Array(nodeCount + 1);
  for (let i = 0; i < nodeCount; i++) {
    forEachChild(u32, extraBase, i, () => {
      offsets[i + 1]++;
    });
  }
  for (let i = 0; i < nodeCount; i++) offsets[i + 1] += offsets[i];
  const children = new Int32Array(offsets[nodeCount]);
  const cursor = offsets.slice(0, nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    forEachChild(u32, extraBase, i, (child) => {
      children[cursor[i]++] = child;
    });
  }
  cached = {
    view,
    u32,
    isTs: (u32[9] & 1) !== 0,
    programIndex: u32[8],
    offsets,
    children,
  };
  wireIndexCache.set(module, cached);
  return cached;
}

// The visitors object compiled for the hot loop. The name-keyed map
// holds the handler lists. Enters accumulate in registration order with
// aliases before concrete types, leaves mirror in reverse, matching
// `module.walk`.
function compileVisitors(visitors) {
  let enter = null;
  let leave = null;
  const byName = new Map();
  const add = (type, handler) => {
    const hooks = typeof handler === "function" ? { enter: handler } : handler;
    let entry = byName.get(type);
    if (entry === undefined) {
      entry = { enter: [], leave: [] };
      byName.set(type, entry);
    }
    if (hooks.enter) entry.enter.push(hooks.enter);
    if (hooks.leave) entry.leave.unshift(hooks.leave);
  };
  for (const name in visitors) {
    const value = visitors[name];
    if (value == null) continue;
    if (name === "enter") enter = value;
    else if (name === "leave") leave = value;
    else if (name in ALIAS_GROUPS) {
      for (const type of ALIAS_GROUPS[name]) add(type, value);
    }
  }
  for (const name in visitors) {
    const value = visitors[name];
    if (value == null || name === "enter" || name === "leave" || name in ALIAS_GROUPS) continue;
    add(name, value);
  }
  return { enter, leave, byName };
}

class WireWalkContext {
  constructor(module, view) {
    this.module = module;
    this._view = view;
    this._node = null;
    this._index = -1;
    this._rootIndex = -1;
    this._skip = false;
    this._stopped = false;
    this._deliverIndex = false;
  }
  get node() {
    return this._node;
  }
  // the walked parent, null at the walk root even when the root has a
  // structural parent in the module. In an index walk it is the parent
  // index instead, -1 at the root
  get parent() {
    const index = this._index;
    if (index < 0 || index === this._rootIndex) return this._deliverIndex ? -1 : null;
    const parent = this._view.parentIndex(index);
    if (this._deliverIndex) return parent;
    return parent < 0 ? null : this._view.nodeOf(parent);
  }
  skip() {
    this._skip = true;
  }
  stop() {
    this._stopped = true;
  }
  replace() {
    throw new TypeError("walkWire: the wire walk is read-only, use module.walk to mutate");
  }
  remove() {
    throw new TypeError("walkWire: the wire walk is read-only, use module.walk to mutate");
  }
  insertBefore() {
    throw new TypeError("walkWire: the wire walk is read-only, use module.walk to mutate");
  }
  insertAfter() {
    throw new TypeError("walkWire: the wire walk is read-only, use module.walk to mutate");
  }
}

export function walkWire(module, visitors, root) {
  walkWireImpl(module, visitors, root, false);
}

// The index-delivering twin of walkWire: handlers receive wire indexes
// instead of decoded nodes, so a walk over them materializes nothing.
export function walkWireIndexes(module, visitors, root) {
  walkWireImpl(module, visitors, root, true);
}

function walkWireImpl(module, visitors, root, deliverIndex) {
  if (visitors === null || typeof visitors !== "object") {
    throw new TypeError("walkWire: visitors must be an object");
  }
  const wireIndex = wireIndexOf(module);
  const { view, u32, isTs, offsets, children } = wireIndex;
  const rootIndex =
    root === undefined
      ? wireIndex.programIndex
      : typeof root === "number"
        ? root
        : view.indexOf(root);
  if (rootIndex === undefined || rootIndex < 0 || rootIndex >= u32[0]) {
    throw new TypeError("walkWire: root does not belong to this module's AST");
  }
  const rootWord = u32[rootIndex * 11 + 11];
  if (wireTypeName(rootWord & 255, rootWord >>> 16, isTs) === null) {
    throw new TypeError("walkWire: root is a formal-parameters pseudo node, not an ESTree node");
  }

  const d = compileVisitors(visitors);
  const nodeOf = view.nodeOf;
  const ctx = new WireWalkContext(module, view);
  ctx._rootIndex = rootIndex;
  ctx._deliverIndex = deliverIndex;

  // entered frames. Node index, next child position, handler entry.
  let stackIndex = new Int32Array(64);
  let stackNext = new Int32Array(64);
  let stackEntry = new Array(64);
  let depth = 0;

  // handler lookup memoized per tag for this call. The flags-dependent
  // tags stay unmemoized, their name varies per node.
  const memo = new Array(TAG_NAMES.length);
  const handlersOf = (i) => {
    const word = u32[i * 11 + 11];
    const tag = word & 255;
    const hit = memo[tag];
    if (hit !== undefined) return hit;
    const fixed = TAG_NAMES[tag];
    if (fixed !== null) {
      const entry = d.byName.get(fixed) ?? null;
      memo[tag] = entry;
      return entry;
    }
    const name = wireTypeName(tag, word >>> 16, isTs);
    return name === null ? null : (d.byName.get(name) ?? null);
  };

  // Fires enters and pushes the frame. Returns false when stopped.
  const enterNode = (i) => {
    const entry = handlersOf(i);
    let skip = false;
    if (d.enter !== null || (entry !== null && entry.enter.length !== 0)) {
      const node = deliverIndex ? i : nodeOf(i);
      ctx._node = node;
      ctx._index = i;
      if (d.enter !== null) {
        d.enter(node, ctx);
        if (ctx._stopped) return false;
      }
      if (entry !== null) {
        for (const handler of entry.enter) {
          handler(node, ctx);
          if (ctx._stopped) return false;
        }
      }
      skip = ctx._skip;
      ctx._skip = false;
    }
    if (depth === stackIndex.length) {
      const grownIndex = new Int32Array(depth * 2);
      grownIndex.set(stackIndex);
      stackIndex = grownIndex;
      const grownNext = new Int32Array(depth * 2);
      grownNext.set(stackNext);
      stackNext = grownNext;
      stackEntry = stackEntry.concat(new Array(depth));
    }
    stackIndex[depth] = i;
    stackNext[depth] = skip ? offsets[i + 1] : offsets[i];
    stackEntry[depth] = entry;
    depth++;
    return true;
  };

  // Fires leaves and pops the frame. Returns false when stopped.
  const leaveNode = () => {
    depth--;
    const entry = stackEntry[depth];
    stackEntry[depth] = undefined;
    if (d.leave !== null || (entry !== null && entry.leave.length !== 0)) {
      const i = stackIndex[depth];
      const node = deliverIndex ? i : nodeOf(i);
      ctx._node = node;
      ctx._index = i;
      if (entry !== null) {
        for (const handler of entry.leave) {
          handler(node, ctx);
          if (ctx._stopped) return false;
        }
      }
      if (d.leave !== null) {
        d.leave(node, ctx);
        if (ctx._stopped) return false;
      }
    }
    return true;
  };

  if (!enterNode(rootIndex)) return;
  while (depth > 0) {
    const top = depth - 1;
    const i = stackIndex[top];
    const next = stackNext[top];
    if (next < offsets[i + 1]) {
      stackNext[top] = next + 1;
      if (!enterNode(children[next])) return;
    } else if (!leaveNode()) {
      return;
    }
  }
}
