import type { FilterOptions, filterCss } from "caligula";
import { BOOTSTRAP_MIN, CARBON, CORPORA, keepOnly, UTILITIES } from "./corpora";

export type Workload = {
  group: string;
  name: string;
  css: string;
  options: FilterOptions;
  expect: { skipped?: boolean; edits?: boolean };
  /** A small input to warm the JIT on before a first-call measurement. */
  warmup?: string;
};

export function checkWorkload(
  filter: typeof filterCss,
  workload: Workload,
): void {
  const result = filter(workload.css, workload.options);
  const label = `${workload.group}: ${workload.name}`;
  const skipped = workload.expect.skipped ?? false;
  if (result.skipped !== skipped) {
    throw new Error(`${label}: expected skipped=${skipped}`);
  }
  const edits = result.removed > 0 || result.css !== workload.css;
  const expected = workload.expect.edits;
  if (expected !== undefined && edits !== expected) {
    throw new Error(`${label}: expected edits=${expected}`);
  }
}

const FONT_WEIGHT_300 = /^\s*300\s*$/;
const kb = (css: string) => `${Math.round(css.length / 1000)} kB`;

export const WORKLOADS: Workload[] = [];

for (const { name, css, keep } of CORPORA) {
  const group = `${name}, ${kb(css)}`;
  const add = (label: string, options: FilterOptions, edits?: boolean) => {
    WORKLOADS.push({ group, name: label, css, options, expect: { edits } });
  };
  const removeMost = keepOnly(keep);

  add("no visitors (round trip)", {}, false);
  add("visitor keeps everything", { rule: () => undefined }, false);
  add("remove most rules", { rule: removeMost }, true);
  add(
    "remove a few rules",
    { rule: ({ selector }) => !keep.test(selector) },
    true,
  );
  add(
    "rewrite selector lists",
    {
      rule({ selector }) {
        if (!selector.includes(",")) return removeMost({ selector });
        const kept = selector.split(",").filter((part) => keep.test(part));
        return kept.length === 0 ? false : kept.join(",");
      },
    },
    true,
  );
  add("at-rules with readDecls", {
    readDecls: ["font-face"],
    atRule(atRule) {
      if (atRule.name === "keyframes") return false;
      if (atRule.name !== "font-face") return;
      let light = false;
      atRule.walkDecls((prop, value) => {
        if (prop === "font-weight") light = FONT_WEIGHT_300.test(value);
      });
      return !light;
    },
  });
  add("remove most rules + source map", { rule: removeMost, map: true }, true);
  WORKLOADS.push({
    group,
    name: "syntax error at the end (passthrough)",
    css: `${css}}`,
    options: {},
    expect: { skipped: true },
  });
}

for (const copies of [1, 4, 16]) {
  const css = BOOTSTRAP_MIN.css.repeat(copies);
  WORKLOADS.push({
    group: "scaling: bootstrap.min.css repeated",
    name: kb(css),
    css,
    options: { rule: keepOnly(BOOTSTRAP_MIN.keep) },
    expect: { edits: true },
  });
}

const TARGET = 200_000;
const fill = (unit: string) => unit.repeat(Math.ceil(TARGET / unit.length));
const list = (count: number, item: (i: number) => string) =>
  Array.from({ length: count }, (_, i) => item(i)).join(",");
const ADVERSARIAL: [string, string][] = [
  ["comments in selector lists", `${list(10_000, (i) => `.s${i}/*c*/`)}{a:b}`],
  ["one huge selector list", `${list(20_000, (i) => `.s${i}`)}{a:b}`],
  [
    "url() and parens in values",
    `a{${fill("b:url(x.png) calc((1px + 2px)*3) (c);")}}`,
  ],
  ["unsafe paren spans", `a{${fill("b:( \"x)\" ) ('y');")}}`],
  ["strings with escaped quotes", fill('.a{b:"\\"x\\"\\\\";c:\'\\\'\'}')],
  ["escaped class names", fill(".md\\:p-4\\/2,.\\31 0{a:b}.w-1\\/2\\.5{c:d}")],
  ["many declarations in one rule", `a{${fill("b:c;")}}`],
  ["comments between declarations", `a{${fill("/*x*/b:c/*y*/;")}}`],
  ["stray semicolons", fill(";;.a{b:c;};")],
  ["nesting 500 deep", fill(`${".a{".repeat(500)}b:c${"}".repeat(500)}`)],
  ["long at-rule params", `@media ${fill("(a:b) and ")}x{a{b:c}}`],
  ["custom properties with blocks", `a{${fill("--x:{b:c;d:e};--y: ;")}}`],
  [
    "removals 900 deep",
    `${".b{".repeat(900)}${fill(".a{b:c}")}${"}".repeat(900)}`,
  ],
];

for (const [name, css] of ADVERSARIAL) {
  WORKLOADS.push({
    group: "adversarial inputs, ~200 kB each",
    name,
    css,
    options: { rule: ({ selector }) => selector !== ".a" },
    expect: {},
  });
}

// `repeat` returns a rope; flatten it so `--peak-mem` doesn't count that.
for (const [label, corpus, copies] of [
  ["carbon", CARBON, 4],
  ["bootstrap.min", BOOTSTRAP_MIN, 16],
  ["utilities", UTILITIES, 16],
] as const) {
  const css = corpus.css.repeat(copies);
  css.charCodeAt(css.length - 1);
  const group = `memory: ${label} x${copies}, ${kb(css)}`;
  const warmup = corpus.css.slice(0, 20_000);
  const removeMost = keepOnly(corpus.keep);
  const add = (name: string, options: FilterOptions, edits: boolean) => {
    WORKLOADS.push({ group, name, css, options, expect: { edits }, warmup });
  };
  add("round trip", {}, false);
  add("remove most", { rule: removeMost }, true);
  add("remove most + map", { rule: removeMost, map: true }, true);
}
