import { type FilterOptions, type FilterResult, filterCss } from "caligula";
import postcss from "postcss";
import discardEmpty from "postcss-discard-empty";
import { SourceMapConsumer } from "source-map-js";

export function postcssReference(css: string, options: FilterOptions) {
  let removed = 0;
  const plugins: postcss.AcceptedPlugin[] = [
    {
      postcssPlugin: "reference",
      Rule(rule) {
        const result = options.rule?.({ selector: rule.selector });
        if (result === false) {
          rule.remove();
          removed++;
        } else if (typeof result === "string") {
          rule.selector = result;
        }
      },
      AtRule(atRule) {
        const result = options.atRule?.({
          name: atRule.name,
          params: atRule.params,
          walkDecls(callback) {
            atRule.walkDecls((decl) => callback(decl.prop, decl.value));
          },
        });
        if (result === false) {
          atRule.remove();
          removed++;
        }
      },
    },
  ];
  if (options.discardEmpty !== false) plugins.push(discardEmpty());
  return {
    css: postcss(plugins).process(css, { from: undefined }).css,
    removed,
  };
}

export type Scenario = (calls: string[]) => FilterOptions;

const UNUSED = "unused";

function pruneList(selector: string): string | false | undefined {
  const parts = selector.split(",");
  const kept = parts.filter((part) => !part.includes(UNUSED));
  if (kept.length === 0) return false;
  if (kept.length < parts.length) return kept.join(",");
}

const pruneRules =
  (calls: string[]): FilterOptions["rule"] =>
  ({ selector }) => {
    calls.push(selector);
    return pruneList(selector);
  };

const filterAtRules =
  (calls: string[]): FilterOptions["atRule"] =>
  (atRule) => {
    calls.push(`@${atRule.name}|${atRule.params}`);
    const name = atRule.name.toLowerCase();
    if (name === "keyframes" && atRule.params.trim() === "fade") return false;
    if (name === "foo" || atRule.params.includes(UNUSED)) return false;
    if (name === "font-face") {
      let weight = "";
      atRule.walkDecls((prop, value) => {
        calls.push(`  ${prop}=${value}`);
        if (prop === "font-weight") weight = value;
      });
      if (weight.trim() === "700") return false;
    }
  };

export const SCENARIOS: Record<string, Scenario> = {
  none: () => ({}),
  prune: (calls) => ({ rule: pruneRules(calls) }),
  rename: (calls) => ({
    rule({ selector }) {
      calls.push(selector);
      if (selector.includes(UNUSED)) return false;
      return selector.replaceAll(".btn", ".button");
    },
  }),
  atRules: (calls) => ({
    readDecls: ["font-face"],
    atRule: filterAtRules(calls),
  }),
  both: (calls) => ({
    readDecls: ["font-face"],
    rule: pruneRules(calls),
    atRule: filterAtRules(calls),
  }),
  keepEmpty: (calls) => ({
    discardEmpty: false,
    readDecls: ["font-face"],
    rule: pruneRules(calls),
    atRule: filterAtRules(calls),
  }),
  stateful: (calls) => {
    const pattern = /btn/g;
    return {
      rule({ selector }) {
        calls.push(selector);
        return pattern.test(selector);
      },
    };
  },
};

type Outcome =
  | { ok: true; css: string; removed: number; calls: string[] }
  | { ok: false };

export function reference(source: string, scenario: Scenario): Outcome {
  const calls: string[] = [];
  try {
    return { ok: true, ...postcssReference(source, scenario(calls)), calls };
  } catch {
    return { ok: false };
  }
}

export function filtered(source: string, scenario: Scenario) {
  const calls: string[] = [];
  const { css, skipped, removed } = filterCss(source, scenario(calls));
  return { skipped, outcome: { ok: true, css, removed, calls } as Outcome };
}

export function expectParity(source: string): { skipped: number } {
  let skipped = 0;
  for (const scenario of Object.values(SCENARIOS)) {
    const actual = filtered(source, scenario);
    if (actual.skipped) {
      expectSkipped(actual.outcome, source);
      skipped++;
    } else {
      expect(actual.outcome).toEqual(reference(source, scenario));
      expectSourceMap(source, scenario);
    }
  }
  return { skipped };
}

export function expectSkipped(outcome: Outcome, source: string): void {
  expect(outcome).toEqual({ ok: true, css: source, removed: 0, calls: [] });
}

export function expectSourceMap(source: string, scenario: Scenario): void {
  const plain = filterCss(source, scenario([]));
  let rewrote = false;
  const options = scenario([]);
  const rule = options.rule;
  if (rule) {
    options.rule = (r) => {
      const result = rule(r);
      if (typeof result === "string" && result !== r.selector) rewrote = true;
      return result;
    };
  }
  const { map, ...rest } = filterCss(source, { ...options, map: true });
  expect(rest).toEqual(plain);
  if (!map) throw new Error("expected a map");
  if (!rewrote)
    expect(checkSourceMap(source, rest.css, map).mismatches).toBe(0);
}

function lineOffsets(text: string) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n" || c === "\f" || (c === "\r" && text[i + 1] !== "\n")) {
      starts.push(i + 1);
    }
  }
  return (line: number, column: number) => starts[line - 1] + column;
}

export function checkSourceMap(
  source: string,
  output: string,
  map: NonNullable<FilterResult["map"]>,
) {
  const generated = lineOffsets(output);
  const original = lineOffsets(source);
  const segments: { g: number; o: number }[] = [];
  new SourceMapConsumer({ ...map, version: "3" }).eachMapping((m) => {
    segments.push({
      g: generated(m.generatedLine, m.generatedColumn),
      o: original(m.originalLine ?? 0, m.originalColumn ?? -1),
    });
  });
  let mismatches = 0;
  for (const [i, { g, o }] of segments.entries()) {
    const end = Math.min(g + 8, segments[i + 1]?.g ?? output.length);
    const inserted = output[g] === ";" && source[o] !== ";";
    if (!inserted && output.slice(g, end) !== source.slice(o, o + end - g)) {
      mismatches++;
    }
  }
  return { segments: segments.length, mismatches };
}
