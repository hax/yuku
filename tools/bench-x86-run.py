#!/usr/bin/env python3
"""x86 CI 上的交错基准：old(215父) vs new(215) vs new+T4标量前奏。"""
import subprocess, statistics, json, sys

def run(binary, mode, path, iters):
    out = subprocess.run([binary, mode, path, str(iters)], capture_output=True, text=True)
    if out.returncode != 0:
        print(f"FAILED {binary} {mode} {path}: {out.stderr[:500]}"); sys.exit(1)
    return json.loads(out.stdout.strip().split("\n")[-1])

def main():
    files = "benchmark-files"
    cases = [("parse", "typescript.js", 10), ("parse", "checker.ts", 25), ("parse", "lib.dom.d.ts", 60)]
    bins = {"old": "/tmp/old", "new": "/tmp/new", "t4": "/tmp/t4"}
    rounds = 7
    for mode, name, iters in cases:
        path = f"{files}/{name}"
        samples = {k: [] for k in bins}
        checks = {}
        for r in range(rounds):
            for k, b in bins.items():
                r_ = run(b, mode, path, iters)
                samples[k].append(r_["ns_per_iter"])
                checks[k] = r_["check"]
        if len(set(checks.values())) != 1:
            print(f"{mode} {name}: CHECK MISMATCH {checks}"); sys.exit(2)
        med = {k: statistics.median(v) for k, v in samples.items()}
        base = med["old"]
        parts = "  ".join(f"{k}={med[k]/1e6:.3f}ms ({(med[k]-base)/base*100:+.1f}%)" for k in bins)
        print(f"{mode} {name}: {parts}  (vs old; rounds={rounds}; check={next(iter(checks.values()))})")

main()
