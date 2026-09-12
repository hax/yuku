// Aggregate per-commit wasm results (wasm-raw.txt, "# <Cn> <rt>" headers)
// against the native chain (bench-raw.txt, "# <Cn> parse"). Prints per-
// commit step deltas per runtime and the wasm/native ratio per commit.
// Run: bun tools/ci/summarize-wasm.ts
import { readFileSync } from "node:fs";

const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;

const load = (path: string, keyOf: (side: string[], file: string) => string | null) => {
  const out: Record<string, number[]> = {};
  let side: string[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (t.startsWith("#")) {
      side = t.split(/\s+/).slice(1);
      continue;
    }
    if (!t.includes("ms")) continue;
    const p = t.split("\t");
    const file = p[0]!.split("/").pop()!;
    const ms = Number.parseFloat(p[2]!.replace("ms", ""));
    const key = keyOf(side, file);
    if (key) (out[key] ??= []).push(ms);
  }
  return out;
};

const wasm = load("wasm-raw.txt", (side, file) =>
  side.length >= 2 ? `wasm-${side[1]}:${side[0]}:${file}` : null,
);
const nat = load("bench-raw.txt", (side, file) =>
  side.length >= 2 && side[1] === "parse" ? `native:${side[0]}:${file}` : null,
);

const order = [...new Set(Object.keys(wasm).map(k => k.split(":")[1]!))].sort(
  (a, b) => Number.parseInt(a.slice(1), 10) - Number.parseInt(b.slice(1), 10),
);
const files = ["typescript.js", "checker.ts", "lib.dom.d.ts", "react.js"];
const labels = Object.fromEntries(
  readFileSync("commits.txt", "utf8")
    .split("\n")
    .map(l => l.trim().match(/^(C\d+) = ([0-9a-f]+)/))
    .filter(Boolean)
    .map(m => [m![1]!, m![2]!]),
);

for (const [stat, fn] of [
  ["MIN", (v: number[]) => Math.min(...v)] as const,
  ["MEDIAN", median] as const,
]) {
  console.log(`=== wasm ${stat} ms (bun / node) ===`);
  console.log(`file           ` + order.map(s => s.padStart(19)).join(""));
  for (const f of files) {
    const cells = order.map(s => {
      const b = fn(wasm[`wasm-bun:${s}:${f}`] ?? [Number.NaN]);
      const n = fn(wasm[`wasm-node:${s}:${f}`] ?? [Number.NaN]);
      return `${b.toFixed(2)}/${n.toFixed(2)}`.padStart(19);
    });
    console.log(f.padEnd(15) + cells.join(""));
  }
  console.log(`step delta bun ` + order.slice(1).map(s => s.padStart(17)).join(""));
  for (const f of files) {
    const cells = order.slice(1).map((s, i) => {
      const a = fn(wasm[`wasm-bun:${order[i]}:${f}`] ?? [Number.NaN]);
      const b = fn(wasm[`wasm-bun:${s}:${f}`] ?? [Number.NaN]);
      const d = (100 * (a - b)) / a;
      return `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`.padStart(17);
    });
    console.log(f.padEnd(15) + "  " + cells.join(""));
  }
  console.log(`wasm/native bun` + order.map(s => s.padStart(15)).join(""));
  for (const f of files) {
    const cells = order.map(s => {
      const w = fn(wasm[`wasm-bun:${s}:${f}`] ?? [Number.NaN]);
      const n = fn(nat[`native:${s}:${f}`] ?? [Number.NaN]);
      return `${(w / n).toFixed(2)}x`.padStart(15);
    });
    console.log(f.padEnd(15) + " " + cells.join(""));
  }
  console.log("");
}
for (const s of order) console.log(`${s}: ${labels[s] ?? "upstream/main"}`);
