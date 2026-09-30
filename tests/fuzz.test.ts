import {
  expectSkipped,
  expectSourceMap,
  filtered,
  reference,
  SCENARIOS,
} from "./helpers";

// FUZZ_SEED=n FUZZ_RUNS=n for longer runs.
const SEED = Number(process.env.FUZZ_SEED ?? 12345);
const RUNS = Number(process.env.FUZZ_RUNS ?? 2000);

test(`fuzz (seed ${SEED}, ${RUNS} sheets)`, () => {
  let seed = SEED;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const pick = <T>(items: T[]) => items[Math.floor(rnd() * items.length)];
  const chance = (p: number) => rnd() < p;

  const WS = ["", "", " ", "\n", "\r\n", "\t", "\f", " \n "];
  const COMMENTS = ["/*c*/", "/**/", "/* unused */"];
  const SELECTORS = [
    ".btn",
    ".btn--primary",
    ".unused",
    ".accordion__item",
    ".body .btn",
    ".header .unused",
    "button",
    "*",
    ":root",
    "::before",
    "a>b",
    "a+b",
    '[data-x="{"]',
    ".btn:not(.unused)",
    ":is(.btn, .unused)",
    ".btn\\:hover",
    ".\\31 0.btn",
    "button.btn.btn--primary",
    "from",
    "to",
    ".btn[data-x=url(a'b)]",
    ".btn ",
    "#id.unused",
    "&:hover",
    "& .unused",
  ];
  const PROPS = [
    "color",
    "font-family",
    "font-weight",
    "--x",
    "src",
    "content",
    "*zoom",
  ];
  const VALUES = [
    "red",
    "#fff",
    "Plex",
    "400",
    "700",
    "700 ",
    "'Plex Sans'",
    "url(x.png)",
    "url(data:image/svg+xml;charset=utf8,%3Csvg%3E)",
    'url("x)y")',
    'url(x"y)',
    "url( x)",
    '"}{;"',
    "calc((1px + 2px) * 3)",
    "(a:b)",
    "[c:d]",
    "a:b",
    "",
    " ",
    "!important",
    "red!important",
    "700 !important ",
    "x ! y important",
    "b)",
    ")c:d",
    "@b",
    "x /*c*/",
    "/*c*/ 700",
    "{a:b}",
  ];
  const AT_NAMES = [
    "media",
    "supports",
    "font-face",
    "keyframes",
    "layer",
    "import",
    "foo",
    "",
  ];
  const AT_PARAMS = [
    "",
    " (min-width:1px)",
    " screen",
    " fade",
    " unused",
    " 'x'",
    " x /*c*/",
    " a /*c*/ b",
    " (a{b)",
  ];

  // Set when a sheet hits a deliberate difference from PostCSS.
  let divergesFromPostcss = false;
  const EMPTY_VALUES = new Set(["", " ", "!important"]);

  const comment = () => (chance(0.06) ? pick(COMMENTS) : "");
  const decl = () => {
    const prop = pick(PROPS);
    const value = pick(VALUES);
    if (prop !== "--x" && EMPTY_VALUES.has(value)) divergesFromPostcss = true;
    return `${comment()}${pick(WS)}${prop}${pick(WS)}:${pick(WS)}${value}${chance(0.08) ? comment() : ""}`;
  };
  const body = (depth: number): string => {
    const parts: string[] = [];
    const n = Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const r = rnd();
      if (depth > 3 || r < 0.55) {
        parts.push(decl());
        if (chance(0.85) || i < n - 1) parts.push(`${pick(WS)};`);
        if (chance(0.03)) parts.push(";");
      } else if (r < 0.85) {
        parts.push(rule(depth));
      } else {
        parts.push(atrule(depth));
      }
      if (chance(0.05)) parts.push(pick(COMMENTS));
    }
    return parts.join("");
  };
  const rule = (depth: number): string => {
    let sel = pick(SELECTORS);
    if (chance(0.3)) sel += `,${pick(WS)}${pick(SELECTORS)}`;
    if (chance(0.05)) sel += ",";
    if (chance(0.05)) sel = `${sel} ${pick(COMMENTS)} ${pick(SELECTORS)}`;
    return `${comment()}${pick(WS)}${sel}${pick(WS)}${chance(0.05) ? pick(COMMENTS) : ""}{${body(depth + 1)}${pick(WS)}}${chance(0.03) ? ";" : ""}`;
  };
  const atrule = (depth: number): string => {
    const params = pick(AT_PARAMS);
    const name = pick(AT_NAMES);
    if (name === "layer") divergesFromPostcss = true;
    const head = `${comment()}${pick(WS)}@${name}${params}${pick(WS)}`;
    if (chance(0.25)) {
      if (params === "") divergesFromPostcss = true;
      return `${head};`;
    }
    if (chance(0.03)) {
      divergesFromPostcss = true;
      return head;
    }
    return `${head}{${body(depth + 1)}${pick(WS)}}`;
  };
  const sheet = (): string => {
    const parts: string[] = [];
    const n = 1 + Math.floor(rnd() * 6);
    for (let i = 0; i < n; i++) {
      const r = rnd();
      if (r < 0.65) parts.push(rule(0));
      else if (r < 0.9) parts.push(atrule(0));
      else if (r < 0.95) parts.push(`${decl()}${chance(0.7) ? ";" : ""}`);
      else parts.push(pick(COMMENTS));
      if (chance(0.03)) parts.push(";");
      if (chance(0.02)) parts.push("}");
    }
    let css = parts.join(pick(WS)) + pick(WS);
    if (chance(0.02)) css = `\uFEFF${css}`;
    if (chance(0.02)) {
      css = css.slice(0, Math.floor(rnd() * css.length));
      divergesFromPostcss = true;
    }
    return css;
  };

  const scenarios = Object.entries(SCENARIOS);
  let matched = 0;
  let skipped = 0;
  let postcssErrored = 0;
  let diverged = 0;
  for (let i = 0; i < RUNS; i++) {
    divergesFromPostcss = false;
    const source = sheet();
    const [name, scenario] = pick(scenarios);
    const { skipped: wasSkipped, outcome: actual } = filtered(source, scenario);
    const ref = reference(source, scenario);
    if (!ref.ok) {
      expect(wasSkipped).toBe(true);
      postcssErrored++;
    }
    if (wasSkipped) {
      expectSkipped(actual, source);
      if (ref.ok) skipped++;
      continue;
    }
    if (divergesFromPostcss) {
      diverged++;
      continue;
    }
    if (!Bun.deepEquals(actual, ref)) {
      console.error(`fuzz: ${name} differs for ${JSON.stringify(source)}`);
    }
    expect(actual).toEqual(ref);
    expectSourceMap(source, scenario);
    matched++;
  }
  console.log(
    `fuzz: ${matched} matched, ${postcssErrored} syntax errors, ${skipped} skipped, ${diverged} known divergences`,
  );
  expect(matched).toBeGreaterThan(RUNS * 0.2);
  expect(postcssErrored).toBeGreaterThan(RUNS * 0.2);
});
