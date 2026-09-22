import { Analyzer } from "./analyzer.js";

export { Analyzer };
export { SymbolFlags, TokenKind, langFromPath, sourceTypeFromPath } from "./module.js";
export { walkWire, walkWireIndexes, wireTypeOf } from "./wire-walk.js";
export { childIndexes, flagsOf, readField, tagOf } from "./wire-read.js";

export function analyze(source, options = {}) {
  const { path = "input.js", ...rest } = options;
  return new Analyzer().addFile(path, source, rest);
}
