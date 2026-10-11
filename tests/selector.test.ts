import { filterCss } from "caligula";
import {
  type Compound,
  parseSelector,
  parseSelectorList,
  requiredClasses,
  splitSelectorList,
} from "caligula/selector";
import { CORPORA } from "../bench/corpora";

const classesOf = (compounds: readonly Compound[]) =>
  compounds.map((c) => c.classes);

test("splits on top-level commas only", () => {
  expect(splitSelectorList(".a, .b:is(.c, .d)")).toEqual([
    ".a",
    ".b:is(.c, .d)",
  ]);
  expect(
    splitSelectorList(
      " a[title=\"x,y\"], b[data-x='),'] ,c:not(:is(.d,.e)),, /* , */ e\\,f ",
    ),
  ).toEqual([
    'a[title="x,y"]',
    "b[data-x='),']",
    "c:not(:is(.d,.e))",
    "/* , */ e\\,f",
  ]);
  expect(splitSelectorList("")).toEqual([]);
  expect(splitSelectorList(" , ")).toEqual([]);
  expect(splitSelectorList(".a\\ ")).toEqual([".a\\ "]);
});

test("splits a selector into compounds and combinators", () => {
  const parsed = parseSelector(".x .y > .z:not(.w)");
  expect(parsed).toEqual({
    text: ".x .y > .z:not(.w)",
    compounds: [
      { classes: ["x"], negated: [] },
      { classes: ["y"], negated: [] },
      { classes: ["z"], negated: ["w"] },
    ],
    combinators: [" ", ">"],
    subject: { classes: ["z"], negated: ["w"] },
  });
  expect(parsed.subject).toBe(parsed.compounds[2]);

  expect(parseSelector("a.b+c.d~e.f>g.h").combinators).toEqual(["+", "~", ">"]);
  expect(parseSelector("  a \n\t>  b  ").combinators).toEqual([">"]);
  expect(parseSelector("a/* x */ b").combinators).toEqual([" "]);
  expect(classesOf(parseSelector(".a/**/.b").compounds)).toEqual([["a", "b"]]);
});

test("a leading combinator gets an empty compound for the implicit &", () => {
  const parsed = parseSelector("> .a");
  expect(classesOf(parsed.compounds)).toEqual([[], ["a"]]);
  expect(parsed.combinators).toEqual([">"]);
  expect(classesOf(parseSelector("&.a .b").compounds)).toEqual([["a"], ["b"]]);
});

test("reads every kind of simple selector without mistaking it for a class", () => {
  const parsed = parseSelector(
    'svg|a#id.b[title=".c"][x="]"]:hover::before:nth-child(2n of .d):lang(en)',
  );
  expect(classesOf(parsed.compounds)).toEqual([["b"]]);
  expect(parseSelector("12.5%").subject.classes).toEqual([]);
  expect(parseSelector(".a.-b.--c.-1.").subject.classes).toEqual([
    "a",
    "-b",
    "--c",
  ]);
  expect(parseSelector(".a.a").subject.classes).toEqual(["a"]);
  expect(parseSelector("*").subject.classes).toEqual([]);
  expect(parseSelector("").compounds).toEqual([{ classes: [], negated: [] }]);
});

test("unescapes class names", () => {
  expect(
    parseSelector(".sm\\:p-4.\\31 23.a\\.b.\\@x.caf\\E9.\\0").subject.classes,
  ).toEqual(["sm:p-4", "123", "a.b", "@x", "café", "�"]);
  expect(parseSelector(".a\\ b").subject.classes).toEqual(["a b"]);
  expect(parseSelector(".\\31\r\n.x").subject.classes).toEqual(["1", "x"]);
  expect(parseSelector(".😀").subject.classes).toEqual(["😀"]);
});

test(":is() and :where() require what every branch requires", () => {
  expect(parseSelector(".a:is(.b.c, .c.b, .x .c.d)").subject.classes).toEqual([
    "a",
    "c",
  ]);
  expect(parseSelector(":where(.b, .c)").subject.classes).toEqual([]);
  expect(parseSelector(":IS(.b)").subject.classes).toEqual(["b"]);
  expect(
    parseSelector(":-webkit-any(.b):-moz-any(.c):matches(.d)").subject.classes,
  ).toEqual(["b", "c", "d"]);
  expect(parseSelector(":is(:is(.a, .b).c, .c)").subject.classes).toEqual([
    "c",
  ]);
  expect(parseSelector(":is(.a .b) .c").compounds[0].classes).toEqual(["b"]);
});

test(":not() classes are negated, :has() classes are not required", () => {
  const parsed = parseSelector(".a:not(.b, .c.d, .x .e):has(> .f, .g)");
  expect(parsed.subject).toEqual({
    classes: ["a"],
    negated: ["b", "c", "d", "e"],
  });
  expect(parseSelector(":not(:is(.a, .b), .c)").subject.negated).toEqual(["c"]);
  expect(parseSelector(":not(:not(.a))").subject).toEqual({
    classes: [],
    negated: [],
  });
  expect(parseSelector('.a:not([x=")"], .b)').subject.negated).toEqual(["b"]);
  expect(parseSelector("::slotted(.a)").subject.classes).toEqual([]);
});

test("survives malformed and deeply nested input", () => {
  expect(parseSelector(".a:not(.b").subject).toEqual({
    classes: ["a"],
    negated: ["b"],
  });
  expect(parseSelector(".a) .b").subject.classes).toEqual(["b"]);
  expect(parseSelector('[x="unclosed .a').subject.classes).toEqual([]);
  expect(parseSelector(".a\\").subject.classes).toEqual(["a"]);
  expect(parseSelector(".a >").compounds).toHaveLength(1);
  const deep = 100_000;
  expect(
    parseSelector(`.a${":is(".repeat(deep)}.b${")".repeat(deep)}`).subject
      .classes,
  ).toEqual(["a"]);
  expect(
    splitSelectorList(`${"(".repeat(deep)},${")".repeat(deep)},.b`),
  ).toHaveLength(2);
});

test("parseSelector rejects a list; parseSelectorList reads one", () => {
  expect(() => parseSelector(".a, .b")).toThrow("parseSelectorList");
  expect(parseSelectorList(".a, .b:not(.c), ").map((p) => p.text)).toEqual([
    ".a",
    ".b:not(.c)",
  ]);
});

test("requiredClasses lists classes across compounds, optionally by prefix", () => {
  const selector =
    ".bx--a .x:is(.bx--b.c, .c.bx--b) > .bx--a.bx--d:has(.bx--e):not(.bx--f)";
  expect(requiredClasses(selector)).toEqual([
    "bx--a",
    "x",
    "bx--b",
    "c",
    "bx--d",
  ]);
  expect(requiredClasses(selector, { prefix: "bx--" })).toEqual([
    "bx--a",
    "bx--b",
    "bx--d",
  ]);
  expect(requiredClasses(parseSelector(selector), { prefix: "c" })).toEqual([
    "c",
  ]);
});

const CLASS = /\.(-?[A-Za-z_][\w-]*)/g;
const NOT_SIMPLE = /[([\\]/;

test("agrees with a naive reading on simple corpus selectors", () => {
  for (const { css } of CORPORA) {
    let checked = 0;
    filterCss(css, {
      rule({ selector }) {
        const parsed = parseSelectorList(selector);
        expect(parsed.map((p) => p.text)).toEqual(splitSelectorList(selector));
        for (const { text } of parsed) {
          if (NOT_SIMPLE.test(text)) continue;
          checked++;
          const naive = [
            ...new Set(Array.from(text.matchAll(CLASS), (m) => m[1])),
          ];
          expect(requiredClasses(text)).toEqual(naive);
        }
      },
    });
    expect(checked).toBeGreaterThan(100);
  }
});
