import { BindingFlags as bindingFlags } from "../core/decode";
import type { FileOptions } from "../types";
import { Analyzer, type AnalyzerOptions, type ParseOptions } from "./analyzer";
import type { BindingFlagMap, Module } from "./module";
import { childIndexes, flagsOf, readField, tagOf } from "./wire-read";
import { walkWire, walkWireIndexes, wireTypeOf } from "./wire-walk";

export { Analyzer };
export type { AnalyzerOptions, SetFileOptions } from "./analyzer";
export type {
  AsyncSemanticVisitors,
  AsyncSemanticWalkHandler,
  AsyncSemanticWalkHooks,
  Binding,
  Capture,
  Definition,
  Export,
  ExportKind,
  Import,
  ImportKind,
  Module,
  ModuleFlags,
  Reference,
  Scope,
  ScopeKind,
  SemanticVisitors,
  SemanticWalkContext,
  SemanticWalkHandler,
  SemanticWalkHooks,
  Space,
} from "./module";
/** Alias of {@link Binding}, the name the wire API first shipped with. */
export type { Binding as Symbol } from "./module";
export { childIndexes, flagsOf, readField, tagOf };
export type { WireView } from "./wire-read";
export { walkWire, walkWireIndexes, wireTypeOf };
export type {
  WireIndexContext,
  WireIndexHandler,
  WireIndexHooks,
  WireIndexVisitors,
  WireVisitors,
  WireWalkContext,
  WireWalkHandler,
  WireWalkHooks,
} from "./wire-walk";

export interface AnalyzeOptions extends FileOptions, ParseOptions, Pick<AnalyzerOptions, "wasm"> {}

/** Kinds and modifiers of a {@link Binding}, tested with `has` and `hasAll`. */
export const BindingFlags: BindingFlagMap = bindingFlags;

/** Alias of {@link BindingFlags}, the name the wire API first shipped with. */
export const SymbolFlags: BindingFlagMap = bindingFlags;

/** Analyzes one file. */
export function analyze(source: string | Uint8Array, options: AnalyzeOptions = {}): Module {
  const { path = "", wasm, ...rest } = options;
  return new Analyzer({ wasm }).setFile(path, source, rest);
}
