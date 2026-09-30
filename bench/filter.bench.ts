import { filterCss } from "caligula";
import { transform } from "lightningcss";
import { group, task } from "ostia";
import postcss, { type Rule } from "postcss";
import discardEmpty from "postcss-discard-empty";
import { CORPORA } from "./corpora";

type LightningSelector = { type: string; name?: string }[];

for (const { name, css, keep, keepClass } of CORPORA) {
  const kb = Math.round(Buffer.byteLength(css) / 1000);
  const code = Buffer.from(css);

  const postcssFilter = postcss([
    {
      postcssPlugin: "filter",
      Rule(rule: Rule) {
        if (!keep.test(rule.selector)) rule.remove();
      },
    },
    discardEmpty(),
  ]);

  const lightningVisitor = {
    Rule: {
      style(rule: { value: { selectors: LightningSelector[] } }) {
        const kept = rule.value.selectors.some((selector) =>
          selector.some(
            (c) => c.type === "class" && keepClass.test(c.name ?? ""),
          ),
        );
        return kept ? undefined : [];
      },
    },
  };

  group(`${name}, ${kb} kB: filter`, () => {
    task("caligula", () => {
      filterCss(css, { rule: ({ selector }) => keep.test(selector) || false });
    });
    task("postcss + discard-empty", () => {
      postcssFilter.process(css, { from: undefined }).css;
    });
    task("lightningcss (JS visitor)", () => {
      transform({
        filename: "in.css",
        code,
        errorRecovery: true,
        // biome-ignore lint/suspicious/noExplicitAny: visitor types are generic over custom at-rules
        visitor: lightningVisitor as any,
      });
    });
  });

  group(`${name}, ${kb} kB: filter + source map`, () => {
    task("caligula", () => {
      filterCss(css, {
        rule: ({ selector }) => keep.test(selector) || false,
        map: true,
      });
    });
    task("postcss + discard-empty", () => {
      const result = postcssFilter.process(css, {
        from: "in.css",
        map: { inline: false, annotation: false },
      });
      result.css;
      result.map.toJSON();
    });
  });

  group(`${name}, ${kb} kB: round trip, no visitor`, () => {
    task("caligula", () => {
      filterCss(css);
    });
    // `postcss([]).process()` skips parsing, so parse and stringify directly.
    task("postcss", () => {
      postcss.parse(css).toString();
    });
    task("lightningcss (native only)", () => {
      transform({ filename: "in.css", code, errorRecovery: true });
    });
  });
}
