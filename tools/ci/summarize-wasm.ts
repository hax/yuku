// Aggregate wasm-raw.txt (alternating rounds over runtime × module) and
// the native chain results (bench-raw.txt, C6 = branch tip) into a
// wasm/native ratio table. Run: bun tools/ci/summarize-wasm.ts
import { readFileSync } from "node:fs";

const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;

// wasm samples: "# <runtime> <module>" header lines, then
// "<file>\twasm-<runtime>\t<ms>ms\t..."
const wasm: Record<string, number[]> = {};
let side = "";
for (const line of readFileSync("wasm-raw.txt", "utf8").split("\n")) {
  const t = line.trim();
  if (t.startsWith("#")) {
    const parts = t.split(/\s+/);
    side = `${parts[1]}-${parts[2]!.includes("fast") ? "fast" : "small"}`;
    continue;
  }
  if (!t.includes("ms")) continue;
  const p = t.split("\t");
  const file = p[0]!.split("/").pop()!;
  const ms = Number.parseFloat(p[2]!.replace("ms", ""));
  (wasm[`${file}\t${side}`] ??= []).push(ms);
}

// native tip samples from the chain (C6 = last commit)
const nat: Record<string, number[]> = {};
for (const line of readFileSync("bench-raw.txt", "utf8").split("\n")) {
  const t = line.trim();
  if (t.startsWith("#")) {
    side = t.split(/\s+/)[1]!;
    continue;
  }
  if (!t.includes("ms")) continue;
  if (side !== "C6") continue;
  const p = t.split("\t");
  const file = p[0]!.split("/").pop()!;
  const ms = Number.parseFloat(p[2]!.replace("ms", ""));
  (nat[file] ??= []).push(ms);
}

const files = ["typescript.js", "checker.ts", "lib.dom.d.ts", "react.js"];
const variants = ["bun-small", "node-small", "bun-fast", "node-fast"];
const pick = (f: string, v: string) => wasm[`${f}\t${v}`] ?? [Number.NaN];

console.log(`${"\t".repeat(0)}min ms (wasm) vs native tip, and wasm/native ratios`);
console.log(`file\t native\t${variants.join("\t")}\t ratios (${variants.join("/")})`);
for (const f of files) {
  const n = Math.min(...(nat[f] ?? [Number.NaN]));
  const vals = variants.map(v => Math.min(...pick(f, v)));
  const ratios = vals.map(x => (x / n).toFixed(2));
  console.log(
    `${f}\t${n.toFixed(2)}\t${vals.map(x => x.toFixed(2)).join("\t")}\t${ratios.join("/")}`,
  );
}
console.log("\nmedian check:");
for (const f of files) {
  const n = median(nat[f] ?? [Number.NaN]);
  const vals = variants.map(v => median(pick(f, v)));
  console.log(`${f}\t${n.toFixed(2)}\t${vals.map(x => x.toFixed(2)).join("\t")}\t${vals.map(x => (x / n).toFixed(2)).join("/")}`);
}
