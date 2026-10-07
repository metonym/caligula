// First-call latency, fresh process per stylesheet: `bun bench/cold.ts [src dir]`
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { filterCss as FilterCss } from "caligula";
import { BOOTSTRAP, CARBON, type Corpus, keepOnly, UTILITIES } from "./corpora";

const CORPORA: Record<string, Corpus> = {
  carbon: CARBON,
  bootstrap: BOOTSTRAP,
  utilities: UTILITIES,
};
const PROCESSES = 7;

const [src = resolve(import.meta.dir, "../src"), name] = process.argv.slice(2);

if (name !== undefined) {
  const { filterCss }: { filterCss: typeof FilterCss } = await import(
    `${src}/index.ts`
  );
  const { css, keep } = CORPORA[name];
  const options = { rule: keepOnly(keep) };
  const t0 = Bun.nanoseconds();
  filterCss(css, options);
  const t1 = Bun.nanoseconds();
  filterCss(css, options);
  const t2 = Bun.nanoseconds();
  console.log(
    JSON.stringify({ first: (t1 - t0) / 1e6, second: (t2 - t1) / 1e6 }),
  );
} else {
  console.log(`src: ${src}\n`);
  for (const [corpus, { css }] of Object.entries(CORPORA)) {
    const runs = Array.from({ length: PROCESSES }, () => {
      const child = spawnSync(
        process.execPath,
        [import.meta.path, src, corpus],
        {
          encoding: "utf8",
        },
      );
      if (child.status !== 0) throw new Error(child.stderr);
      return JSON.parse(child.stdout) as { first: number; second: number };
    });
    const median = (key: "first" | "second") =>
      runs.map((run) => run[key]).sort((a, b) => a - b)[PROCESSES >> 1];
    const kb = Math.round(css.length / 1000);
    console.log(
      `${`${corpus}, ${kb} kB`.padEnd(20)} first call ${median("first").toFixed(2)} ms, second ${median("second").toFixed(2)} ms`,
    );
  }
}
