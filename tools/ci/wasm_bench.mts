// wasm parse benchmark, runtime-agnostic (bun or node).
// Protocol matches the native parse_bench: write the source into wasm
// memory once, then best-of-N with a ~300ms budget per file, printing
// min in ms. Run: bun|node tools/wasm_bench.ts <module.wasm> <file...>
import { readFileSync } from "node:fs";

const now =
  typeof Bun !== "undefined"
    ? () => Number(Bun.nanoseconds())
    : () => Number(process.hrtime.bigint());

const argv = (typeof Bun !== "undefined" ? Bun.argv : process.argv).slice(2);
if (argv.length < 2) {
  console.error("usage: (bun|node) wasm_bench.ts <module.wasm> <file...>");
  process.exit(1);
}
const [wasmPath, ...files] = argv;

const runtime = typeof Bun !== "undefined" ? "bun" : "node";
const { memory, alloc, free, parse: wasmParse } = new WebAssembly.Instance(
  new WebAssembly.Module(readFileSync(wasmPath)),
).exports as {
  memory: WebAssembly.Memory;
  alloc: (len: number) => number;
  free: (ptr: number, len: number) => void;
  parse: (ptr: number, len: number, flags: number) => number;
};

const LANGS = { js: 0, ts: 1, jsx: 2, tsx: 3, dts: 4 };
const SOURCE_TYPES = { script: 0, module: 1, commonjs: 2 };
const langOf = (p: string) =>
  /\.d\.[mc]?ts$/.test(p) ? LANGS.dts
  : p.endsWith(".tsx") ? LANGS.tsx
  : /\.[mc]?ts$/.test(p) ? LANGS.ts
  : p.endsWith(".jsx") ? LANGS.jsx
  : LANGS.js;
const sourceTypeOf = (p: string) =>
  p.endsWith(".cjs") || p.endsWith(".cts") ? SOURCE_TYPES.commonjs : SOURCE_TYPES.module;
const packFlags = (p: string) => {
  let f = sourceTypeOf(p) | (langOf(p) << 2);
  f |= 1 << 5; // preserveParens, matching the native harness defaults
  return f;
};

for (const path of files) {
  const source = readFileSync(path);
  const srcPtr = alloc(source.length);
  new Uint8Array(memory.buffer, srcPtr, source.length).set(source);
  const flags = packFlags(path);

  let best = Number.POSITIVE_INFINITY;
  let iters = 0;
  let ok = false;
  const t0 = now();
  while (true) {
    const s = now();
    const resultPtr = wasmParse(srcPtr, source.length, flags);
    const dt = now() - s;
    if (resultPtr === 0) throw new Error(`wasm parse failed: ${path}`);
    ok = true;
    const len = new DataView(memory.buffer).getUint32(resultPtr, true);
    free(resultPtr, 4 + len);
    if (dt < best) best = dt;
    iters++;
    if (now() - t0 >= 300e6 || iters >= 200) break;
  }
  free(srcPtr, source.length);
  if (!ok) throw new Error(`no iterations: ${path}`);
  const ms = best / 1e6;
  const mbps = source.length / 1e6 / (best / 1e9);
  console.log(
    `${path.split("/").pop()}\twasm-${runtime}\t${ms.toFixed(3)}ms\t${mbps.toFixed(0)}MB/s\t(${iters} iters)`,
  );
}
