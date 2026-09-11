// Aggregate bench-raw.txt (alternating rounds, per-commit binaries) into
// min/median tables with per-commit deltas. Run: bun tools/ci/summarize.ts

import { readFileSync } from "node:fs";

type Samples = Record<string, number[]>; // "file\tside" -> ms[]

const samples: Samples = {};
let side = "";
for (const line of readFileSync("bench-raw.txt", "utf8").split("\n")) {
  const trimmed = line.trim();
  if (trimmed.startsWith("#")) {
    side = trimmed.split(/\s+/)[1]!;
    continue;
  }
  if (!trimmed.includes("ms")) continue;
  const parts = trimmed.split("\t");
  const file = parts[0]!.split("/").pop()!;
  const ms = Number.parseFloat(parts[2]!.replace("ms", ""));
  const key = `${file}\t${side}`;
  (samples[key] ??= []).push(ms);
}

const labels: Record<string, string> = {};
for (const line of readFileSync("commits.txt", "utf8").split("\n")) {
  const m = line.trim().match(/^(C\d+) = ([0-9a-f]+) (.*)$/);
  if (m) labels[m[1]!] = `${m[2]} ${m[3]!.slice(0, 40)}`;
}

const order = [...new Set(Object.keys(samples).map(k => k.split("\t")[1]!))]
  .sort((a, b) => Number.parseInt(a.slice(1), 10) - Number.parseInt(b.slice(1), 10));
const files = ["typescript.js", "checker.ts", "lib.dom.d.ts", "react.js"];
const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));

console.log(`${pad("file", 15)}${order.map(s => pad(s, 10)).join("")}`);
for (const [stat, fn] of [["MIN", (v: number[]) => Math.min(...v)], ["MEDIAN", median]] as const) {
  const val = (f: string, s: string) => samples[`${f}\t${s}`] ?? [Number.NaN];
  console.log(`--- ${stat} (ms) ---`);
  for (const f of files) {
    console.log(`${pad(f, 15)}${order.map(s => pad(fn(val(f, s)).toFixed(2), 10)).join("")}`);
  }
  console.log(`${pad("step delta", 15)}${order.slice(1).map(s => pad(s, 10)).join("")}`);
  for (const f of files) {
    const cells = order.slice(1).map((s, i) => {
      const a = fn(val(f, order[i]!));
      const b = fn(val(f, s));
      const d = (100 * (a - b)) / a;
      return pad(`${d >= 0 ? "+" : ""}${d.toFixed(1)}%`, 10);
    });
    console.log(`${pad(f, 15)}${" ".repeat(10)}${cells.join("")}`);
  }
}

console.log();
for (const s of order) {
  console.log(`${s}: ${labels[s] ?? "upstream/main (baseline)"}`);
}
