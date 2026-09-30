// Peak memory per call, fresh process per case: `bun bench/mem.ts [src dir]`
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { filterCss as FilterCss, FilterOptions } from "caligula";
import { BOOTSTRAP_MIN, CARBON, type Corpus, UTILITIES } from "./corpora";

const INPUTS: Record<string, [Corpus, number]> = {
  "carbon x4": [CARBON, 4],
  "bootstrap.min x16": [BOOTSTRAP_MIN, 16],
  "utilities x16": [UTILITIES, 16],
};

const JOBS: Record<string, (keep: RegExp) => FilterOptions | "parse"> = {
  "parse only": () => "parse",
  "round trip": () => ({}),
  "remove most": (keep) => ({
    rule: ({ selector }) => keep.test(selector) || false,
  }),
  "remove most + map": (keep) => ({
    rule: ({ selector }) => keep.test(selector) || false,
    map: true,
  }),
};

const [src = resolve(import.meta.dir, "../src"), input, job] =
  process.argv.slice(2);

if (input !== undefined && job !== undefined) {
  const { filterCss }: { filterCss: typeof FilterCss } = await import(
    `${src}/index.ts`
  );
  const { Parser } = await import(`${src}/parse.ts`);
  const [corpus, copies] = INPUTS[input];
  const css = corpus.css.repeat(copies);
  css.charCodeAt(css.length - 1); // flatten the rope `repeat` returns
  const options = JOBS[job](corpus.keep);
  const warmup = corpus.css.slice(0, 20_000);
  for (let i = 0; i < 30; i++) {
    if (options !== "parse") filterCss(warmup, options);
    else {
      try {
        new Parser(warmup).parse();
      } catch {}
    }
  }
  Bun.gc(true);
  const before = process.resourceUsage().maxRSS;
  if (options === "parse") {
    new Parser(css).parse();
  } else if (filterCss(css, options).skipped) {
    throw new Error(`${input} / ${job}: skipped`);
  }
  const after = process.resourceUsage().maxRSS;
  console.log(JSON.stringify({ mb: (after - before) / 1024 }));
} else {
  console.log(`src: ${src}\n`);
  console.log(
    `${"case".padEnd(38)}${"input MB".padStart(9)}${"peak +MB".padStart(10)}${"× input".padStart(9)}`,
  );
  for (const [name, [corpus, copies]] of Object.entries(INPUTS)) {
    const inputMb = (corpus.css.length * copies) / 1e6;
    for (const jobName of Object.keys(JOBS)) {
      const readings = [0, 1, 2].map(() => {
        const child = spawnSync(
          process.execPath,
          [import.meta.path, src, name, jobName],
          { encoding: "utf8" },
        );
        if (child.status !== 0) throw new Error(child.stderr);
        return JSON.parse(child.stdout).mb as number;
      });
      const mb = readings.sort((a, b) => a - b)[1];
      console.log(
        `${`${name} / ${jobName}`.padEnd(38)}${inputMb.toFixed(2).padStart(9)}${mb.toFixed(1).padStart(10)}${(mb / inputMb).toFixed(1).padStart(9)}`,
      );
    }
  }
}
