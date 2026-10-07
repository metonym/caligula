import { type FilterOptions, filterCss } from "caligula";
import { CORPORA, keepOnly } from "../bench/corpora";
import {
  checkSourceMap,
  expectParity,
  expectSkipped,
  filtered,
  postcssReference,
  reference,
  SCENARIOS,
} from "./helpers";

describe("real stylesheets", () => {
  for (const { name, css, keep } of CORPORA) {
    test(name, () => {
      const options: FilterOptions = {
        readDecls: ["font-face"],
        rule({ selector }) {
          if (!keep.test(selector)) return false;
          if (selector.includes(",")) {
            return selector
              .split(",")
              .filter((s) => keep.test(s))
              .join(",");
          }
        },
        atRule(atRule) {
          if (atRule.name === "keyframes") return false;
          if (atRule.name !== "font-face") return;
          let weight = "";
          atRule.walkDecls((prop, value) => {
            if (prop === "font-weight") weight = value;
          });
          return weight !== "300";
        },
      };
      const result = filterCss(css, options);
      expect(result.skipped).toBe(false);
      expect(result.removed).toBeGreaterThan(0);
      expect(result.css).toBe(postcssReference(css, options).css);

      expect(filterCss(css).css).toBe(css);

      const { map, ...mapped } = filterCss(css, {
        rule: keepOnly(keep),
        map: { source: name },
      });
      if (!map) throw new Error("expected a map");
      expect(map.sources).toEqual([name]);
      expect(map.sourcesContent).toEqual([css]);
      const { segments, mismatches } = checkSourceMap(css, mapped.css, map);
      expect(segments).toBeGreaterThan(100);
      expect(mismatches).toBe(0);
    });
  }
});

const FF = (family: string, style: string, weight: string) =>
  `@font-face{font-family:${family};font-style:${style};font-weight:${weight}}`;

const HOSTILE: Record<string, string> = {
  nesting: ".btn{color:red;&:hover{color:blue}.unused &{color:green}}",
  "nested @media": ".btn{color:red;@media (min-width:1px){.unused{c:d}}}",
  "@property":
    "@property --p{syntax:'<length>';inherits:false;initial-value:0}.unused{a:b}",
  "@container": "@container card (min-width: 400px){.unused{a:b}.btn{c:d}}",
  "@import with layer()":
    "@import url(a.css) layer(base) supports(display:grid);@layer a,b;@layer a{.unused{a:b}}",
  "@scope": "@scope (.card) to (.content){img{a:b}.unused{c:d}}",
  "@starting-style": "@starting-style{.unused{opacity:0}}.btn{a:b}",
  "Tailwind v4 shape":
    "@layer utilities{.unused{--tw-a:1}.p-4{padding:calc(var(--spacing)*4)}}@supports (color:oklch(0 0 0)){.unused{color:oklch(50% .1 200)}}",
  "single kept": ".btn{color:red}",
  "single removed": ".unused{color:red}",
  BOM: "\uFEFF.unused{a:b}.btn{c:d}",
  "BOM only": "\uFEFF\n.unused{a:b}\n",
  "tabs crlf": ".btn\r\n{\r\n\tcolor:red;\r\n}\r\n.unused{x:y}\r\n",
  "lone cr and form feed": ".btn\r{\fcolor:red;\r}\f.unused{x:y}\r",
  unicode: '.btn::before{content:"→ ünïcödé"}.ünused{x:y}.unused💥{x:y}',
  "leading ws inherited by new first node": "\n\n.unused{a:b}\n.btn{c:d}\n",
  "leading ws chain":
    ".unused1{}\n.unused2{a:b}\n\n.unused3{a:b}\n.btn{a:b}\n.unused4{a:b}",
  "all removed": "\n.unused{a:b}\n.unused2{c:d}\n\n",
  "sourceMappingURL comment": ".unused{a:b}\n/*# sourceMappingURL=x.css.map */",
  "comment statements": "/* h */\n.btn{/*c*/a:b/*d*/}\n.unused{/*x*/}/* end */",
  "comment in selector": ".btn, /*c*/ .unused{a:b}",
  "comment trailing selector": ".btn /*c*/ {a:b}.unused/*c*/{a:b}",
  "comment in decl": ".btn{a:b /*c*/;c:d}",
  "comment after last decl": ".btn{a:b /*c*/}",
  "comment after custom decl": ".btn{--x:1 /*c*/}",
  "comment around params": "@media /*a*/ screen /*b*/ {.unused{a:b}}",
  "comment inside params": "@media screen /*b*/ and (x){.unused{a:b}}",
  "comment between prop and colon": ".btn{color /*c*/: red;a:b}",
  "leading comment in decl value": ".btn{color: /*c*/ red}.unused{a:b}",
  "string braces": '.btn{content:"}{;"}.unused{content:"{"}',
  "string escaped quote": ".btn{content:'a\\'b'}.unused{a:b}",
  "url data":
    ".btn{background:url(data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E)}.unused{a:b}",
  "url quoted paren": '.btn{background:url("x)y")}.unused{a:b}',
  "url unquoted quote": '.btn{background:url(x"y)}.unused{a:b}',
  "url escaped paren": ".btn{background:url(a\\)b)}.unused{a:b}",
  "url word stack": ".btn{background:url x () (y'z)}.unused{a:b}",
  "bad bracket u2028": '.btn{a:( \u2028"x)}.unused{a:b}',
  "attr brace": '.btn[b="{"]{a:b}.unused[b;c]{a:b}',
  "not is": ".btn:not(.unused){a:b}:is(.btn, .unused){a:b}",
  "stray close paren": ".btn{a:b)}.unused{a:)b:c}",
  media:
    "@media (min-width:1px){.unused{a:b}.btn{c:d}}@media x{.unused{a:b}}@media y{}",
  "media brace in params": "@media (a{b){.unused{a:b}}.btn{c:d}",
  "media removed by params": "@media unused{.btn{a:b}}@supports (unused:1){}",
  "font-face keep": FF("Plex", "normal", "400") + FF("Plex", "italic", "600"),
  "font-face drop": FF("Plex", "italic", "700") + FF("Plex", "normal", "700"),
  "font-face spacing":
    "@font-face{font-family: Plex ;font-style:\tnormal;font-weight:\n700 }",
  "font-face important":
    "@font-face{font-family:Plex;font-style:normal;font-weight:700 !important}",
  "font-face upper": "@FONT-FACE{font-family:Plex;font-weight:700}",
  "font-face empty": "@font-face{}.btn{a:b}",
  "font-face nested": "@font-face{font-weight:400;.unused{a:b}}",
  "font-face nested decls": "@font-face{a:b;@media x{font-weight:700}}",
  "font-face duplicates": "@font-face{font-weight:700;font-weight:400}",
  "font-face star hack": "@font-face{*font-weight:700;font-style:normal}",
  "font-face bareword important":
    "@font-face{font-weight:700 ! z important}@font-face{font-weight:400 ! z important}",
  "font-face comments": "@font-face{font-weight:/*a*/700/*b*/;/*c*/}",
  "font-face custom property important":
    "@font-face{--a:!important;--b: !important;--c:red!important;--d: 7 !important ;--e:a /*c*/ !important;--f: /*c*/ !important;--g:x ! y important;--h:a!b}@font-face{--i:x ! y important \n ;--j:x ! y important/**/ ;k:x ! y important \n ;--l : x ! y important\n}",
  "font-face trailing trivia":
    "@font-face{a:b /*c*/ ;c:d/*c*/ ;e: /*c*/ ;f:g ! important }",
  "font-face custom property":
    "@font-face{--w:700;font-weight:var(--w)}@font-face{--x: ;--y:\n}@font-face{--z:}",
  keyframes:
    "@keyframes fade{from{opacity:0}to{opacity:1}}@keyframes  fade  {}@-webkit-keyframes fade{}",
  "keyframes comment":
    "@keyframes fade/*x*/{from{opacity:0}}@keyframes/*x*/fade{}",
  "keyframes statement": "@keyframes fade;.btn{@keyframes fade;a:b}",
  "keyframes statement last": ".btn{@keyframes fade}",
  "charset import": '@charset "utf-8";@import url(x.css);.unused{a:b}',
  "import eof": ".unused{a:b}@import 'x'  \n",
  "foo statement": "@foo x;.btn{@foo y}@foo z{.btn{a:b}}",
  layer: "@layer a{.unused{a:b}}",
  "at last child no semi": ".btn{@x y }.unused{@x y}",
  "decl forms": ".btn{color:red}.a{color:red;}.b{color:red ; }",
  "decl important":
    ".btn{color:red!important;a:red !IMPORTANT ;b:x ! y important}",
  "custom property": ".btn{--x:{a:b};--y:;--z: ;--w:a:b;c:d}",
  "custom no colon": ".btn{--x{a:b}}",
  "ie hacks": ".btn{*zoom:1}",
  progid: ".btn{filter:progid:DX(a)}",
  "colon in url string paren": '.btn{a:url(c:d);b:"c:d";c:(d:e)}',
  "root decl": "color:red;.unused{a:b}x:y",
  "free semicolons": ".btn{b:c;;}",
  "own semicolon": ".unused{};.btn{}",
  "nesting removed child": ".btn{.unused{x:y}}.unused{.btn{x:y}}",
  "nesting semicolon dropped": ".btn{b:c;.unused{x:y}}",
  "nesting semicolon kept":
    ".btn{--x:1;/*k*/.unused{x:y}}.a{b:1;/*k*/.unused{x:y}}",
  "nesting decl after": ".btn{.unused{x:y} b:c}.a{@media x{.unused{a:b}}c:d}",
  "nesting all removed": ".btn{.unused{.unused2{c:d}}}",
  "nesting rewritten parent": ".btn,.unused{.btn{a:b}.unused{c:d}}",
  "comma lists":
    ".btn,.unused{a:b}.unused,\n.btn\n{a:b}.btn , .unused , button{a:b}",
  "comma edges": ".btn,{a:b},.btn{a:b}.btn,,.unused{a:b}",
  "selector whitespace":
    ".btn  \t{a:b}.unused \n {a:b}.btn\v.unused{a:b}.btn {a:b}",
  "selector escapes":
    ".btn\\:hover{a:b}.unused\\{{a:b}.\\31 0.unused{a:b}.btn\\\\{a:b}",
  "nested removals and rewrites revisit in PostCSS's order":
    ".btn{.btn{.btn,.unused{.unused{a:b}.btn{c:d}}.unused{e:f}}.unused{}}.btn,.unused{.btn{.unused{g:h}}}",
  "empty selector rule": "{}.btn{a:b}",
  "empty rules": ".btn{}.unused{}a{}",
  "custom property after a stray semicolon":
    ".btn{a:b;;--x:y;/**/.unused{c:d}}.a{;--x:y;/**/.unused{c:d}}.b{--x:y;/**/.unused{c:d}}.c{; --x:y;/**/.unused{c:d}}",
  "custom property inherits a stray semicolon":
    ";.unused{a:b}--x:y;/**/.unused{c:d}",
  "paren inside an unsafe paren span": '.btn{b:((url) (x;"y))}.unused{a:b}',
  "comment right after a paren": ".btn(/*c*/ x){a:b}.unused(/*c*/ x){a:b}",
};

describe("hostile inputs", () => {
  for (const [name, source] of Object.entries(HOSTILE)) {
    test(name, () => {
      expect(expectParity(source).skipped).toBe(0);
    });
  }
});

// Parity holds only with `discardEmpty` off: `postcss-discard-empty` drops
// what `filterCss` keeps on purpose.
const HOSTILE_KEEP_EMPTY: Record<string, string> = {
  "paramless at-rule at EOF owns its trailing whitespace": ".btn{a:b}@foo \n",
  "paramless at-rule at EOF owns its trailing comment": ".btn{a:b}@foo/**/",
};

describe("hostile inputs, discardEmpty off", () => {
  for (const [name, source] of Object.entries(HOSTILE_KEEP_EMPTY)) {
    test(name, () => {
      const actual = filtered(source, SCENARIOS.keepEmpty);
      expect(actual.skipped).toBe(false);
      expect(actual.outcome).toEqual(reference(source, SCENARIOS.keepEmpty));
    });
  }
});

const BEHAVIOR_CHANGES: Record<
  string,
  [source: string, css: string, removed: number]
> = {
  "reversed BOM left as-is, not rewritten to U+FEFF": [
    "\uFFFE.unused{a:b}.btn{c:d}",
    "\uFFFE.btn{c:d}",
    1,
  ],
  "`<` not escaped": [
    '.btn{content:"</style>"}.unused{a:b}',
    '.btn{content:"</style>"}',
    1,
  ],
  "paramless at-rule statement kept": ["@bar;.btn{a:b}", "@bar;.btn{a:b}", 0],
  "declaration with an empty value kept": [
    ".btn{color:;a:b}",
    ".btn{color:;a:b}",
    0,
  ],
  "declaration with a whitespace-only value kept": [
    ".btn{a:b;color: }",
    ".btn{a:b;color: }",
    0,
  ],
  "bare `!important` (empty value) kept": [
    ".btn{color:!important;a:b}",
    ".btn{color:!important;a:b}",
    0,
  ],
  "non-empty rule with an empty selector kept": [
    "{color:red}.btn{a:b}",
    "{color:red}.btn{a:b}",
    0,
  ],
  "duplicate empty named @layer kept, not deduplicated": [
    "@layer a{.btn{c:d}}@layer a{.unused{a:b}}",
    "@layer a{.btn{c:d}}@layer a{}",
    1,
  ],
};

describe("deliberate differences from PostCSS", () => {
  for (const [name, [source, css, removed]] of Object.entries(
    BEHAVIOR_CHANGES,
  )) {
    test(name, () => {
      const ref = reference(source, SCENARIOS.prune);
      expect(ref.ok && ref.css).not.toBe(css);
      expect(filtered(source, SCENARIOS.prune)).toMatchObject({
        skipped: false,
        outcome: { css, removed },
      });
    });
  }
});

const SYNTAX_ERRORS: Record<string, string> = {
  "unclosed comment": ".btn{a:b}/*",
  "unclosed string": '.btn{content:"a}',
  "url unclosed": ".btn{background:url(a}",
  "unclosed bracket": ".btn[a{b:c}",
  "at unnamed": "@{}.btn{a:b}",
  "missed semicolon": ".btn{b:c:d}",
  "square colon": ".btn{b:[c:d]}",
  "unknown word": ".btn{b}",
  "backslash eof": ".btn{a:b}\\",
  "close at root": ".btn{a:b}}",
  "unclosed block": ".btn{a:b",
};

describe("syntax errors skip", () => {
  for (const [name, source] of Object.entries(SYNTAX_ERRORS)) {
    test(name, () => {
      for (const scenario of Object.values(SCENARIOS)) {
        expect(reference(source, scenario).ok).toBe(false);
        const actual = filtered(source, scenario);
        expect(actual.skipped).toBe(true);
        expectSkipped(actual.outcome, source);
      }
    });
  }
});
