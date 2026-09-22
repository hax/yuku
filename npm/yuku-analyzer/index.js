import { Analyzer } from "./analyzer.js";

export { Analyzer };
export { BindingFlags } from "./decode.js";
export { walkWire } from "./wire-walk.js";

export function analyze(source, options = {}) {
  const { path = "input.js", core, ...rest } = options;
  return new Analyzer({ core }).setFile(path, source, rest);
}
