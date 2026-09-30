<img alt="Caligula logo, portrait bust of emperor Caligula" src="https://raw.githubusercontent.com/metonym/caligula/master/artwork/caligula-logo.jpg" width="200" />

# caligula

> Zero-dependency CSS filter. PostCSS-identical output, 6–13× faster.

Remove rules and at-rules, or rewrite selectors, with PostCSS-style visitors. caligula edits the source text instead of building an AST, so its output is byte-identical to the same visitors run as a PostCSS plugin (with `postcss-discard-empty`), at a fraction of the cost.

```sh
bun i caligula
```

```ts
import { filterCss } from "caligula";

const { css, map, removed, skipped } = filterCss(source, {
  rule: ({ selector }) => used.has(selector) || false, // false = remove
  atRule: (atRule) =>
    atRule.name !== "keyframes" || usedKeyframes.has(atRule.params) || false,
  map: { source: "app.css" },
});
```

## API

### `filterCss(css, options?) => { css, skipped, removed, map? }`

| Option | Description |
|:---|:---|
| `rule({ selector })` | Return `false` to remove the rule, a string to replace its selector, or anything else to keep it. |
| `atRule({ name, params, walkDecls })` | Return `false` to remove the at-rule. |
| `readDecls` | At-rule names (case-insensitive) whose declarations `atRule` reads through `walkDecls(cb(prop, value))`, e.g. `["font-face"]`. |
| `discardEmpty` | Drop containers left with no children, like `postcss-discard-empty`. Default `true`. |
| `map` | `true` or `{ source, includeContent }` returns a v3 source map. |

`selector`, `params` and declaration values read exactly as PostCSS's `rule.selector`, `atRule.params` and `decl.value` would: comments dropped per PostCSS's `raw()` rule, `!important` stripped. Visitors run in PostCSS's order, and a rule whose selector was rewritten is visited again, as PostCSS's `Rule` visitor would be.

To list selectors without changing anything, return nothing from `rule` and check `skipped`.

## Features

- **PostCSS parity.** For every input it doesn't skip, the output equals `postcss([visitors, discardEmpty()]).process(css).css`, and visitors see the same strings in the same order. It's tested on Bootstrap, Carbon, Tailwind v4-style output and modern syntax (nesting, `@layer`, `@container`, `@scope`, `@property`), and by a differential fuzzer that also compares visitor calls and declaration values.
- **6–13× faster than PostCSS.** No value parsing and no re-printing: kept text is copied from the source.
- **Source maps.** Optional v3 maps for the output.
- **No-op is the identity.** With no visitor changes, the output is the input, byte for byte.
- **Fail-safe.** A syntax error, nesting deeper than 1,000 blocks, or anything else it can't reproduce exactly returns the input unchanged with `skipped: true`, before any visitor runs.
- **Small and portable.** No dependencies, no Node APIs, ~6 kB gzipped.
- **Deliberate differences from PostCSS:**
  - `<` is never escaped.
  - A reversed BOM (U+FFFE) is left as-is; PostCSS rewrites it to U+FEFF.
  - `postcss-discard-empty`'s extra deletions (empty declarations, rules with an empty selector in the source, paramless `@foo;`, duplicate empty named `@layer`) aren't reproduced. A rule a visitor rewrites to `""` is dropped, as PostCSS does.

## Benchmarks

Apple M2, medians of warm calls. The filter job drops every rule whose selector names none of a few kept classes.

| Stylesheet | Job | caligula | PostCSS | Lightning CSS[^lightning] |
|:---|:---|:---|:---|:---|
| Carbon `white.css`, 710 kB min | filter | **3.4 ms** | 26.8 ms (7.9×) | 31.7 ms (9.4×) |
| | filter + source map | **4.0 ms** | 23.7 ms (5.9×) | – |
| | round trip | **2.6 ms** | 18.0 ms (6.9×) | 11.3 ms (4.3×) |
| `bootstrap.css`, 280 kB formatted | filter | **1.4 ms** | 17.7 ms (13×) | 13.0 ms (9.6×) |
| | filter + source map | **1.8 ms** | 11.6 ms (6.5×) | – |
| | round trip | **1.2 ms** | 11.8 ms (9.9×) | 4.5 ms (3.8×) |
| `bootstrap.min.css`, 232 kB | filter | **1.0 ms** | 9.5 ms (9.3×) | 13.0 ms (13×) |
| | filter + source map | **1.4 ms** | 8.2 ms (6.1×) | – |
| | round trip | **0.96 ms** | 7.8 ms (8.2×) | 4.6 ms (4.7×) |
| Tailwind v4-shaped utilities, 145 kB | filter | **0.77 ms** | 5.8 ms (7.6×) | 13.9 ms (18×) |
| | round trip | **0.82 ms** | 6.3 ms (7.7×) | 4.3 ms (5.2×) |

The first call in a fresh process runs about 2–3× slower while the JIT warms up (Carbon: 9.7 ms). Peak memory is about 3–7× the input size.

[^lightning]: Lightning CSS does a different job: it re-prints the stylesheet (so it doesn't preserve the source) and can do much more (minify, lower syntax, bundle). Its filter runs a JS visitor; its round trip is native only.

## Limitations

- **Filter only.** It can remove rules and at-rules and rewrite selectors. It can't edit or remove individual declarations or insert nodes.
- **No input source map chaining.** It maps to the CSS it was given, not through a previous map.
- **Declaration values are only readable under `readDecls` at-rules.** That keeps the fail-safe check ahead of the visitors.
