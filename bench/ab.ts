// Paired A/B against a git ref: `bun bench/ab.ts [ref] [--threshold 10] [--geomean 1.5] [--rounds 15] [--grep text]`
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { filterCss } from "caligula";
import { checkWorkload, WORKLOADS, type Workload } from "./workloads";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    threshold: { type: "string", default: "10" },
    geomean: { type: "string", default: "1.5" },
    rounds: { type: "string", default: "15" },
    grep: { type: "string" },
    only: { type: "string" },
  },
});
const ref = positionals[0] ?? "HEAD";
const threshold = Number(values.threshold) / 100;
const rounds = Number(values.rounds);

const root = join(import.meta.dir, "..");
const git = (...args: string[]) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim());
  return result.stdout.trim();
};

const sha = git("rev-parse", "--verify", `${ref}^{commit}`);
const dir = join(root, "node_modules/.cache/caligula-ab", sha);
if (!existsSync(join(dir, "src/index.ts"))) {
  mkdirSync(dir, { recursive: true });
  const archive = spawnSync("git", ["archive", sha, "src"], { cwd: root });
  const tar = spawnSync("tar", ["-x", "-C", dir], { input: archive.stdout });
  if (archive.status !== 0 || tar.status !== 0) {
    throw new Error(`could not extract src/ at ${ref}`);
  }
}
const base: { filterCss: typeof filterCss } = await import(
  join(dir, "src/index.ts")
);

type Filter = typeof filterCss;

function batch(filter: Filter, workload: Workload, n: number): number {
  const { css, options } = workload;
  const start = Bun.nanoseconds();
  for (let i = 0; i < n; i++) filter(css, options);
  return (Bun.nanoseconds() - start) / 1e6;
}

function quantile(sorted: number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

function sameOutput(workload: Workload): boolean {
  const a = base.filterCss(workload.css, workload.options);
  const b = filterCss(workload.css, workload.options);
  return (
    a.css === b.css &&
    a.skipped === b.skipped &&
    a.removed === b.removed &&
    JSON.stringify(a.map) === JSON.stringify(b.map)
  );
}

type Verdict = "regressed" | "improved" | "";
type Measurement = {
  label: string;
  median: number;
  low: number;
  high: number;
  ms: number;
  verdict: Verdict;
};

const labelOf = (workload: Workload) => `${workload.group} / ${workload.name}`;

function measure(workload: Workload): Measurement {
  const once = Math.max(batch(filterCss, workload, 1), 0.001);
  const n = Math.max(1, Math.round(10 / once));
  for (let i = 0; i < 3; i++) {
    batch(base.filterCss, workload, n);
    batch(filterCss, workload, n);
  }

  const ratios: number[] = [];
  let totalA = 0;
  // Alternating A/B rounds cancel machine drift; fresh-process repeats rule out JIT luck.
  for (let r = 0; r < rounds; r++) {
    let a: number;
    let b: number;
    if (r % 2 === 0) {
      a = batch(base.filterCss, workload, n);
      b = batch(filterCss, workload, n);
    } else {
      b = batch(filterCss, workload, n);
      a = batch(base.filterCss, workload, n);
    }
    ratios.push(b / a);
    totalA += a;
  }
  ratios.sort((x, y) => x - y);
  const median = quantile(ratios, 0.5);
  const low = quantile(ratios, 0.25);
  const high = quantile(ratios, 0.75);
  let verdict: Verdict = "";
  if (median > 1 + threshold && low > 1) verdict = "regressed";
  else if (median < 1 - threshold && high < 1) verdict = "improved";
  const ms = totalA / rounds / n;
  return { label: labelOf(workload), median, low, high, ms, verdict };
}

function remeasure(label: string): Measurement {
  const result = spawnSync(
    process.execPath,
    [
      import.meta.path,
      sha,
      `--only=${label}`,
      `--threshold=${values.threshold}`,
      `--rounds=${rounds}`,
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}

const pct = (x: number) => `${x >= 1 ? "+" : ""}${((x - 1) * 100).toFixed(1)}%`;
const line = (m: Measurement) =>
  `${pct(m.median).padStart(8)}  [${pct(m.low)}, ${pct(m.high)}]  ${m.ms.toFixed(3)} ms  ${m.label}`;

if (values.only !== undefined) {
  const workload = WORKLOADS.find((w) => labelOf(w) === values.only);
  if (!workload) throw new Error(`no workload named ${values.only}`);
  console.log(JSON.stringify(measure(workload)));
  process.exit(0);
}

const selected = WORKLOADS.filter(
  (w) => !values.grep || labelOf(w).includes(values.grep),
);
console.log(
  `A = ${ref} (${sha.slice(0, 7)}), B = working tree; ${rounds} rounds, threshold ${values.threshold}%`,
);
console.log(
  "Columns: median B/A change, [p25, p75] over rounds, A's time per run.\n",
);

const flagged: Measurement[] = [];
const differs: string[] = [];
let logRatios = 0;
for (const workload of selected) {
  checkWorkload(filterCss, workload);
  if (!sameOutput(workload)) differs.push(labelOf(workload));
  const m = measure(workload);
  logRatios += Math.log(m.median);
  console.log(`${line(m)}  ${m.verdict}`);
  if (m.verdict !== "") flagged.push(m);
}

let regressed = 0;
if (flagged.length > 0) {
  console.log(`\nConfirming ${flagged.length} flagged in fresh processes:`);
  for (const m of flagged) {
    const repeats = [remeasure(m.label), remeasure(m.label)];
    const confirmed = repeats.every((r) => r.verdict === m.verdict);
    if (confirmed && m.verdict === "regressed") regressed++;
    const status = confirmed ? `${m.verdict}, confirmed` : "noise";
    console.log(
      `${line(m)}  ${status} (repeats: ${repeats.map((r) => pct(r.median)).join(", ")})`,
    );
  }
}

if (differs.length > 0) {
  console.log(`\nOutput differs between A and B (${differs.length}):`);
  for (const label of differs) console.log(`  ${label}`);
}
const geomean = Math.exp(logRatios / selected.length);
const geomeanFails = geomean > 1 + Number(values.geomean) / 100;
console.log(
  `\nGeomean change: ${pct(geomean)}${geomeanFails ? ` (over ${values.geomean}%: REGRESSED)` : ""}`,
);
console.log(`${regressed} confirmed regressions of ${selected.length}.`);
process.exitCode = regressed > 0 || geomeanFails ? 1 : 0;
