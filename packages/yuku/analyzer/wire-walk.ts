// A walk over the module's AST driven directly by the binary wire
// buffer. Children come from a CSR index built once per module from the
// wire child slots, and a node is decoded into an ESTree object only
// when a visitor registered its type. `module.walk` drives the decoded
// object graph, so a subtree walk pays dispatch and property-traversal
// costs for every node it touches. The wire walk touches only typed
// arrays for the nodes nobody listens to.

import { ALIAS_GROUPS, type AliasMap, type AliasName } from "../ast/aliases";
import type { Node, NodeOfType, NodeType } from "../types";
import type { Module } from "./module";
import { wireWords, type WireView } from "./wire-read";

// ESTree type name per wire tag, in the NodeData union's declaration
// order (src/parser/ast.zig). null where the name depends on the node's
// flags (3 function, 27 class, 29 method_definition, 30
// property_definition, resolved by wireTypeName below), for the two
// pseudo tags (6 formal_parameters, 7 formal_parameter) that decode
// transparently and never surface as ESTree nodes, and for the dialect
// tag (172), whose name the compiled-in dialect owns.
const TAG_NAMES: readonly (string | null)[] = [
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
  "JSXText", "JSXSpreadChild", null,
];

// Child slots per wire tag, same tag order as TAG_NAMES, mirroring the
// decoder's private table. Pairs of (kind, slot) read against the
// node's 12-word record (transfer format v12). kind 0 is a single child
// index at word slot; kind 1 is an extras array, start at word slot and
// count at slot + 1. Slot order is ESTree field order, so children built
// from it come out in `module.walk` order.
const CHILD_SLOTS: readonly (readonly number[])[] = [
  [1, 1],
  [0, 1],
  [0, 1, 0, 2, 0, 3, 0, 4],
  [0, 1, 0, 2, 0, 3, 0, 4, 0, 5],
  [1, 1],
  [1, 1],
  [1, 1, 0, 3],
  [0, 1],
  [0, 1, 0, 2],
  [0, 1, 0, 2],
  [0, 1, 0, 2, 0, 3],
  [0, 1],
  [0, 1],
  [0, 1, 0, 2],
  [1, 1],
  [1, 1],
  [0, 1],
  [0, 1, 0, 2],
  [0, 1, 0, 2],
  [0, 1, 0, 2, 1, 3],
  [0, 1],
  [0, 1, 0, 2, 0, 3],
  [0, 1, 0, 2, 1, 3],
  [0, 1],
  [0, 1],
  [0, 1, 0, 2],
  [0, 1],
  [1, 1, 0, 3, 0, 4, 0, 5, 0, 6, 1, 7, 0, 9],
  [1, 1],
  [1, 1, 0, 3, 0, 4],
  [1, 1, 0, 3, 0, 4, 0, 5],
  [1, 1],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [1, 1, 1, 3],
  [],
  [],
  [],
  [1, 3, 0, 5],
  [],
  [],
  [0, 1],
  [0, 1, 0, 2, 0, 3],
  [0, 1, 1, 2],
  [0, 1, 1, 2],
  [0, 1, 0, 2, 0, 3, 0, 4],
  [0, 1, 0, 2, 0, 3],
  [0, 1, 0, 2, 0, 3],
  [0, 1, 0, 2],
  [0, 1, 0, 2],
  [0, 1],
  [0, 1],
  [0, 1, 0, 2],
  [0, 1, 0, 2],
  [0, 1],
  [0, 1],
  [0, 1, 0, 2, 0, 3],
  [0, 1, 0, 2],
  [],
  [],
  [1, 1],
  [0, 1, 0, 2],
  [0, 1],
  [1, 1, 0, 3, 0, 4, 0, 5],
  [1, 1, 0, 3, 0, 4],
  [1, 1, 1, 3, 0, 5, 0, 6],
  [1, 1, 1, 3, 0, 5, 0, 6],
  [0, 1, 0, 2],
  [1, 1],
  [0, 1, 0, 2],
  [1, 1, 0, 3, 1, 4],
  [0, 1, 0, 2],
  [0, 1],
  [0, 1],
  [0, 1, 0, 2],
  [0, 1, 1, 2, 0, 4, 1, 5],
  [0, 1],
  [0, 1, 0, 2, 1, 3],
  [0, 1, 0, 2],
  [0, 1],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [0, 1, 0, 2],
  [0, 1, 0, 2],
  [0, 1, 0, 2],
  [0, 1, 0, 2, 0, 3, 0, 4],
  [0, 1, 0, 2, 0, 3],
  [1, 1],
  [1, 1],
  [0, 1],
  [1, 1, 1, 3],
  [0, 1],
  [0, 1, 0, 2],
  [1, 1],
  [0, 1, 0, 2],
  [0, 1],
  [0, 1],
  [0, 1],
  [0, 1],
  [],
  [1, 1],
  [1, 1],
  [0, 1, 0, 2, 0, 3, 0, 4],
  [0, 1],
  [0, 1],
  [0, 1],
  [0, 1, 0, 2, 0, 3],
  [0, 1, 0, 2, 0, 3],
  [0, 1, 0, 2],
  [1, 1],
  [0, 1, 0, 2, 0, 3, 0, 4],
  [0, 1, 0, 2],
  [0, 1, 0, 2, 0, 3, 0, 4],
  [0, 1, 0, 2, 0, 3],
  [0, 1, 0, 2, 0, 3],
  [1, 1, 0, 3],
  [0, 1, 0, 2],
  [0, 1, 0, 2, 1, 3, 0, 5],
  [1, 1],
  [0, 1, 0, 2],
  [0, 1, 0, 2],
  [0, 1, 0, 2],
  [1, 1],
  [0, 1, 0, 2],
  [0, 1, 0, 2],
  [1, 1],
  [0, 1, 0, 2],
  [1, 1, 0, 3],
  [0, 1],
  [0, 1, 0, 2],
  [0, 1, 0, 2],
  [0, 1, 0, 2],
  [0, 1],
  [0, 1, 0, 2],
  [0, 1],
  [0, 1],
  [0, 1, 0, 2],
  [0, 1],
  [0, 1, 1, 2, 0, 4],
  [0, 1, 0, 2, 1, 3],
  [0, 1],
  [0, 1, 1, 2, 0, 4],
  [],
  [],
  [],
  [0, 1, 0, 2],
  [0, 1, 0, 2],
  [0, 1, 0, 2],
  [0, 1],
  [0, 1],
  [],
  [],
  [0, 1],
  [1, 1],
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
// decoder's `isTs` gate. Returns null for the pseudo tags and the
// dialect tag.
/** @internal */
export function wireTypeName(tag: number, flags: number, isTs: boolean): string | null {
  switch (tag) {
    case 3:
      return FUNCTION_TYPES[flags & 3]!;
    case 27:
      return CLASS_TYPES[flags & 1]!;
    case 29:
      return isTs && (flags & 64) !== 0 ? "TSAbstractMethodDefinition" : "MethodDefinition";
    case 30:
      if (isTs && (flags & 256) !== 0) {
        return (flags & 4) !== 0 ? "TSAbstractAccessorProperty" : "TSAbstractPropertyDefinition";
      }
      return (flags & 4) !== 0 ? "AccessorProperty" : "PropertyDefinition";
    default:
      return TAG_NAMES[tag]!;
  }
}

/** The ESTree type name of the node at a wire index. */
export function wireTypeOf(view: WireView, index: number): string | null {
  const word = wireWords(view)[index * 12 + 10]!;
  return wireTypeName(word & 255, word >>> 16, view.isTs);
}

// Runs `visit` on the ESTree-visible children of node `i`, in field
// order. Pseudo nodes are spliced: their children take their place,
// matching the decoded object graph. The pseudo nesting is
// formal_parameters over formal_parameter, so the recursion bottoms out
// at depth 2.
function forEachChild(
  u32: Int32Array,
  extraBase: number,
  i: number,
  visit: (child: number) => void,
): void {
  const b = i * 12 + 10;
  const ops = CHILD_SLOTS[u32[b]! & 255]!;
  for (let q = 0; q < ops.length; q += 2) {
    const slot = ops[q + 1]!;
    if (ops[q] === 0) {
      const child = u32[b + slot]!;
      if (child !== -1) visitChild(u32, extraBase, child, visit);
    } else {
      const start = u32[b + slot]!;
      const count = u32[b + slot + 1]!;
      for (let j = 0; j < count; j++) {
        const child = u32[extraBase + start + j]!;
        if (child !== -1) visitChild(u32, extraBase, child, visit);
      }
    }
  }
}

function visitChild(
  u32: Int32Array,
  extraBase: number,
  child: number,
  visit: (child: number) => void,
): void {
  const tag = u32[child * 12 + 10]! & 255;
  if (tag === TAG_FORMAL_PARAMETERS || tag === TAG_FORMAL_PARAMETER) {
    forEachChild(u32, extraBase, child, visit);
  } else {
    visit(child);
  }
}

interface WireIndex {
  view: WireView;
  u32: Int32Array;
  isTs: boolean;
  programIndex: number;
  offsets: Int32Array;
  children: Int32Array;
}

// one CSR child index per module, built on demand
const wireIndexCache = new WeakMap<Module, WireIndex>();

function wireIndexOf(module: Module): WireIndex {
  const cached = wireIndexCache.get(module);
  if (cached !== undefined) return cached;
  const view = module._wire();
  const u32 = wireWords(view);
  const nodeCount = u32[0]!;
  const extraBase = 10 + nodeCount * 12;
  const offsets = new Int32Array(nodeCount + 1);
  for (let i = 0; i < nodeCount; i++) {
    forEachChild(u32, extraBase, i, () => {
      offsets[i + 1] = offsets[i + 1]! + 1;
    });
  }
  for (let i = 0; i < nodeCount; i++) offsets[i + 1] = offsets[i + 1]! + offsets[i]!;
  const children = new Int32Array(offsets[nodeCount]!);
  const cursor = offsets.slice(0, nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    forEachChild(u32, extraBase, i, (child) => {
      children[cursor[i]!] = child;
      cursor[i] = cursor[i]! + 1;
    });
  }
  const built: WireIndex = {
    view,
    u32,
    isTs: (u32[8]! & 1) !== 0,
    programIndex: u32[7]!,
    offsets,
    children,
  };
  wireIndexCache.set(module, built);
  return built;
}

/**
 * The wire walk context: position info for the node being visited, plus
 * `skip` / `stop`. One object is reused across the whole walk; do not
 * hold onto it across nodes. The wire walk is read-only. The mutation
 * operations of `WalkContext` are not part of it and throw when called
 * on it.
 */
export interface WireWalkContext<T extends Node = Node> {
  /** The module being walked. */
  readonly module: Module;
  /** The node being visited. */
  readonly node: T;
  /** The node holding {@link node}, or null at the walk root. */
  readonly parent: Node | null;
  /** Do not descend into the current node's children. */
  skip(): void;
  /** Stop the walk entirely. */
  stop(): void;
}

/** Handler invoked with the precisely-typed node and the wire walk context. */
export type WireWalkHandler<T extends Node = Node> = (node: T, ctx: WireWalkContext<T>) => void;

/** Enter/leave pair for one node type in a wire walk. */
export interface WireWalkHooks<T extends Node = Node> {
  enter?: WireWalkHandler<T>;
  leave?: WireWalkHandler<T>;
}

/**
 * Visitors passed to {@link walkWire}: the same shape and per-node order
 * as {@link Module.walk} accepts, including alias keys and the universal
 * `enter` / `leave` catch-alls.
 */
export type WireVisitors = {
  [K in NodeType]?: WireWalkHandler<NodeOfType<K>> | WireWalkHooks<NodeOfType<K>>;
} & {
  [A in AliasName]?: WireWalkHandler<AliasMap[A]> | WireWalkHooks<AliasMap[A]>;
} & {
  enter?: WireWalkHandler;
  leave?: WireWalkHandler;
};

/**
 * The index walk context: like {@link WireWalkContext}, except `node`
 * and `parent` are wire indexes (`parent` is -1 at the walk root), so
 * the walk materializes nothing.
 */
export interface WireIndexContext {
  /** The module being walked. */
  readonly module: Module;
  /** The wire index of the node being visited. */
  readonly node: number;
  /** The wire index of the walked parent, or -1 at the walk root. */
  readonly parent: number;
  /** Do not descend into the current node's children. */
  skip(): void;
  /** Stop the walk entirely. */
  stop(): void;
}

/** Handler invoked with a wire index and the index walk context. */
export type WireIndexHandler = (index: number, ctx: WireIndexContext) => void;

/** Enter/leave pair for one node type in an index walk. */
export interface WireIndexHooks {
  enter?: WireIndexHandler;
  leave?: WireIndexHandler;
}

/** Visitors passed to {@link walkWireIndexes}, handlers receive wire indexes. */
export type WireIndexVisitors = {
  [K in NodeType]?: WireIndexHandler | WireIndexHooks;
} & {
  [A in AliasName]?: WireIndexHandler | WireIndexHooks;
} & {
  enter?: WireIndexHandler;
  leave?: WireIndexHandler;
};

interface HandlerEntry {
  enter: WireWalkHandler[];
  leave: WireWalkHandler[];
}

interface CompiledVisitors {
  enter: WireWalkHandler | null;
  leave: WireWalkHandler | null;
  byName: Map<string, HandlerEntry>;
}

// The visitors object compiled for the hot loop. The name-keyed map
// holds the handler lists. Enters accumulate in registration order with
// aliases before concrete types, leaves mirror in reverse, matching
// `module.walk`.
function compileVisitors(visitors: WireVisitors): CompiledVisitors {
  let enter: WireWalkHandler | null = null;
  let leave: WireWalkHandler | null = null;
  const byName = new Map<string, HandlerEntry>();
  const add = (type: string, handler: WireWalkHandler | WireWalkHooks): void => {
    const hooks = typeof handler === "function" ? { enter: handler } : handler;
    let entry = byName.get(type);
    if (entry === undefined) {
      entry = { enter: [], leave: [] };
      byName.set(type, entry);
    }
    if (hooks.enter) entry.enter.push(hooks.enter);
    if (hooks.leave) entry.leave.unshift(hooks.leave);
  };
  for (const [name, value] of Object.entries(visitors)) {
    if (value == null) continue;
    if (name === "enter") enter = value as WireWalkHandler;
    else if (name === "leave") leave = value as WireWalkHandler;
    else if (name in ALIAS_GROUPS) {
      for (const type of ALIAS_GROUPS[name as AliasName]) {
        add(type, value as WireWalkHandler | WireWalkHooks);
      }
    }
  }
  for (const [name, value] of Object.entries(visitors)) {
    if (value == null || name === "enter" || name === "leave" || name in ALIAS_GROUPS) continue;
    add(name, value as WireWalkHandler | WireWalkHooks);
  }
  return { enter, leave, byName };
}

class WalkState {
  readonly module: Module;
  view: WireView;
  node: Node | null = null;
  index = -1;
  rootIndex = -1;
  skipNext = false;
  stopped = false;
  deliverIndex = false;

  constructor(module: Module, view: WireView) {
    this.module = module;
    this.view = view;
  }

  // the walked parent, null at the walk root even when the root has a
  // structural parent in the module. In an index walk it is the parent
  // index instead, -1 at the root
  get parent(): Node | number | null {
    const index = this.index;
    if (index < 0 || index === this.rootIndex) return this.deliverIndex ? -1 : null;
    const parent = this.view.parentIndex(index);
    if (this.deliverIndex) return parent;
    return parent < 0 ? null : this.view.nodeOf(parent);
  }

  skip(): void {
    this.skipNext = true;
  }

  stop(): void {
    this.stopped = true;
  }

  replace(): never {
    throw new TypeError("walkWire: the wire walk is read-only, use module.walk to mutate");
  }

  remove(): never {
    throw new TypeError("walkWire: the wire walk is read-only, use module.walk to mutate");
  }

  insertBefore(): never {
    throw new TypeError("walkWire: the wire walk is read-only, use module.walk to mutate");
  }

  insertAfter(): never {
    throw new TypeError("walkWire: the wire walk is read-only, use module.walk to mutate");
  }
}

/**
 * Walks the module's AST (or the subtree under `root`) reading the
 * binary wire buffer directly: children come from an index built once
 * per module, and a node is decoded into an ESTree object only when a
 * visitor registered its type. Same traversal order and handler
 * contract as {@link Module.walk}, except the walk is read-only and the
 * program's synthesized Hashbang child is not a wire node and is not
 * visited.
 */
export function walkWire(module: Module, visitors: WireVisitors, root?: Node | number): void {
  walkWireImpl(module, visitors, root, false);
}

/**
 * The index-delivering twin of {@link walkWire}: handlers receive wire
 * indexes instead of decoded nodes, so the walk materializes nothing.
 */
export function walkWireIndexes(
  module: Module,
  visitors: WireIndexVisitors,
  root?: Node | number,
): void {
  walkWireImpl(module, visitors, root, true);
}

interface Scratch {
  memo: (HandlerEntry | null | undefined)[];
  stackIndex: Int32Array;
  stackNext: Int32Array;
  stackEntry: (HandlerEntry | null | undefined)[];
}

// per-call scratch buffers. walks are synchronous but handlers may nest
// further walks (a check inside a handler resolves types that walk
// again), so buffers come from a free-list rather than being singletons
const scratchPool: Scratch[] = [];
function acquireScratch(): Scratch {
  return scratchPool.pop() ?? {
    memo: new Array(TAG_NAMES.length),
    stackIndex: new Int32Array(64),
    stackNext: new Int32Array(64),
    stackEntry: new Array(64),
  };
}

function walkWireImpl(
  module: Module,
  visitors: WireVisitors | WireIndexVisitors,
  root: Node | number | undefined,
  deliverIndex: boolean,
): void {
  if (visitors === null || typeof visitors !== "object") {
    throw new TypeError("walkWire: visitors must be an object");
  }
  const wireIndex = wireIndexOf(module);
  const { view, u32, isTs, offsets, children } = wireIndex;
  const nodeCount = u32[0]!;
  const rootIndex =
    root === undefined
      ? wireIndex.programIndex
      : typeof root === "number"
        ? root
        : view.indexOf(root);
  if (rootIndex === undefined || rootIndex < 0 || rootIndex >= nodeCount) {
    throw new TypeError("walkWire: root does not belong to this module's AST");
  }
  const rootTag = u32[rootIndex * 12 + 10]! & 255;
  if (rootTag === TAG_FORMAL_PARAMETERS || rootTag === TAG_FORMAL_PARAMETER) {
    throw new TypeError("walkWire: root is a formal-parameters pseudo node, not an ESTree node");
  }

  const d = compileVisitors(visitors as unknown as WireVisitors);
  const nodeOf = view.nodeOf;
  const ctx = new WalkState(module, view);
  ctx.rootIndex = rootIndex;
  ctx.deliverIndex = deliverIndex;

  // entered frames. Node index, next child position, handler entry.
  const scratch = acquireScratch();
  const memo = scratch.memo;
  memo.fill(undefined);
  let { stackIndex, stackNext, stackEntry } = scratch;
  let depth = 0;

  // handler lookup memoized per tag for this call. The flags-dependent
  // tags stay unmemoized, their name varies per node.
  const handlersOf = (i: number): HandlerEntry | null => {
    const word = u32[i * 12 + 10]!;
    const tag = word & 255;
    const hit = memo[tag];
    if (hit !== undefined) return hit;
    const fixed = TAG_NAMES[tag]!;
    if (fixed !== null) {
      const entry = d.byName.get(fixed) ?? null;
      memo[tag] = entry;
      return entry;
    }
    const name = wireTypeName(tag, word >>> 16, isTs);
    return name === null ? null : (d.byName.get(name) ?? null);
  };

  // Fires enters and pushes the frame. Returns false when stopped.
  const enterNode = (i: number): boolean => {
    const entry = handlersOf(i);
    let skip = false;
    if (d.enter !== null || (entry !== null && entry.enter.length !== 0)) {
      const node = (deliverIndex ? i : nodeOf(i)) as Node;
      ctx.node = node;
      ctx.index = i;
      if (d.enter !== null) {
        d.enter(node, ctx as unknown as WireWalkContext);
        if (ctx.stopped) return false;
      }
      if (entry !== null) {
        for (const handler of entry.enter) {
          handler(node, ctx as unknown as WireWalkContext);
          if (ctx.stopped) return false;
        }
      }
      skip = ctx.skipNext;
      ctx.skipNext = false;
    }
    if (depth === stackIndex.length) {
      const grownIndex = new Int32Array(depth * 2);
      grownIndex.set(stackIndex);
      stackIndex = grownIndex;
      const grownNext = new Int32Array(depth * 2);
      grownNext.set(stackNext);
      stackNext = grownNext;
      stackEntry = stackEntry.concat(new Array(depth));
      scratch.stackIndex = stackIndex;
      scratch.stackNext = stackNext;
      scratch.stackEntry = stackEntry;
    }
    stackIndex[depth] = i;
    stackNext[depth] = skip ? offsets[i + 1]! : offsets[i]!;
    stackEntry[depth] = entry;
    depth++;
    return true;
  };

  // Fires leaves and pops the frame. Returns false when stopped.
  const leaveNode = (): boolean => {
    depth--;
    const entry = stackEntry[depth];
    stackEntry[depth] = undefined;
    if (d.leave !== null || (entry != null && entry.leave.length !== 0)) {
      const i = stackIndex[depth]!;
      const node = (deliverIndex ? i : nodeOf(i)) as Node;
      ctx.node = node;
      ctx.index = i;
      if (entry != null) {
        for (const handler of entry.leave) {
          handler(node, ctx as unknown as WireWalkContext);
          if (ctx.stopped) return false;
        }
      }
      if (d.leave !== null) {
        d.leave(node, ctx as unknown as WireWalkContext);
        if (ctx.stopped) return false;
      }
    }
    return true;
  };

  const finish = (): undefined => {
    scratchPool.push(scratch);
    return undefined;
  };
  if (!enterNode(rootIndex)) return finish();
  while (depth > 0) {
    const top = depth - 1;
    const i = stackIndex[top]!;
    const next = stackNext[top]!;
    if (next < offsets[i + 1]!) {
      stackNext[top] = next + 1;
      if (!enterNode(children[next]!)) return finish();
    } else if (!leaveNode()) {
      return finish();
    }
  }
  finish();
}
