import { filterCss } from "caligula";

test("removes and rewrites rules", () => {
  const css = ".a{color:red}\n.b{color:blue}\n.c, .d{margin:0}";
  const result = filterCss(css, {
    rule: ({ selector }) =>
      selector === ".b" ? false : selector.includes(",") ? ".c" : undefined,
  });
  expect(result).toEqual({
    css: ".a{color:red}\n.c{margin:0}",
    skipped: false,
    removed: 1,
  });
});

test("drops emptied containers unless discardEmpty is false", () => {
  const css = "@media print{.a{color:red}}.b{}";
  const rule = () => false;
  expect(filterCss(css, { rule }).css).toBe("");
  expect(filterCss(css, { rule, discardEmpty: false }).css).toBe(
    "@media print{}",
  );
});

test("passes input it can't reproduce through without calling visitors", () => {
  const rule = jest.fn();
  const nest = (depth: number) =>
    `${".a{".repeat(depth)}b:c${"}".repeat(depth)}`;
  expect(filterCss(nest(1000), { rule }).skipped).toBe(false);
  rule.mockClear();
  for (const css of [".a{color:red", nest(20_000)]) {
    expect(filterCss(css, { rule })).toEqual({
      css,
      skipped: true,
      removed: 0,
    });
  }
  expect(rule).not.toHaveBeenCalled();
});

test("visitor errors propagate", () => {
  const error = new Error("boom");
  expect(() =>
    filterCss(".a{}", {
      rule() {
        throw error;
      },
    }),
  ).toThrow(error);
});

test("walkDecls needs the at-rule in readDecls, matched case-insensitively", () => {
  const css = "@FONT-FACE{font-weight:400}@page{margin:0}";
  const seen: string[] = [];
  filterCss(css, {
    readDecls: ["font-face"],
    atRule(atRule) {
      if (atRule.name === "page") {
        expect(() => atRule.walkDecls(() => {})).toThrow("readDecls");
      } else {
        atRule.walkDecls((prop, value) => seen.push(`${prop}=${value}`));
      }
    },
  });
  expect(seen).toEqual(["font-weight=400"]);
});

test("source map options", () => {
  const css = ".a{color:red}.b{}";
  expect(filterCss(css).map).toBeUndefined();
  expect(filterCss(css, { map: true }).map).toMatchObject({
    version: 3,
    sources: ["input.css"],
    sourcesContent: [css],
  });
  const map = filterCss(css, {
    map: { source: "a.css", includeContent: false },
  }).map;
  expect(map?.sources).toEqual(["a.css"]);
  expect(map).not.toHaveProperty("sourcesContent");
});
