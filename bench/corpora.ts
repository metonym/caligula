import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const read = (path: string) => readFileSync(path, "utf8");

/** A `rule` visitor that removes every rule whose selector doesn't match. */
export const keepOnly =
  (keep: RegExp) =>
  ({ selector }: { selector: string }) =>
    keep.test(selector) || false;

export type Corpus = {
  name: string;
  css: string;
  keep: RegExp;
  keepClass: RegExp;
};

export const CARBON: Corpus = {
  name: "carbon white.css (minified)",
  css: read(require.resolve("carbon-components-svelte/css/white.css")),
  keep: /bx--(btn|grid|col|row|tag)/,
  keepClass: /^bx--(btn|grid|col|row|tag)/,
};

export const BOOTSTRAP: Corpus = {
  name: "bootstrap.css (formatted, comments)",
  css: read(require.resolve("bootstrap/dist/css/bootstrap.css")),
  keep: /\.(btn|col|row|container|alert)\b/,
  keepClass: /^(btn|col|row|container|alert)\b/,
};

export const BOOTSTRAP_MIN: Corpus = {
  name: "bootstrap.min.css",
  css: read(require.resolve("bootstrap/dist/css/bootstrap.min.css")),
  keep: /\.(btn|col|row|container|alert)\b/,
  keepClass: /^(btn|col|row|container|alert)\b/,
};

const SCALES = ["0", "1", "2", "4", "6", "8", "12", "16", "24", "32"];
const SIDES = ["", "x", "y", "t", "r", "b", "l"];
const COLORS = ["red", "blue", "green", "gray", "slate", "amber", "indigo"];
const SHADES = ["50", "100", "200", "300", "500", "700", "900"];
const VARIANTS: [string, (body: string) => string][] = [
  ["", (body) => body],
  ["hover\\:", (body) => `&:hover{@media (hover:hover){${body}}}`],
  ["focus\\:", (body) => `&:focus{${body}}`],
  ["md\\:", (body) => `@media (width>=48rem){${body}}`],
  ["lg\\:", (body) => `@media (width>=64rem){${body}}`],
  ["dark\\:", (body) => `@media (prefers-color-scheme:dark){${body}}`],
];

function utilityCss(): string {
  const theme: string[] = [];
  const utilities: string[] = [];
  for (const color of COLORS) {
    for (const [i, shade] of SHADES.entries()) {
      theme.push(
        `--color-${color}-${shade}:oklch(${(0.97 - i * 0.1).toFixed(2)} 0.1 ${COLORS.indexOf(color) * 50})`,
      );
    }
  }
  const add = (name: string, body: string) => {
    for (const [prefix, wrap] of VARIANTS) {
      const inner = prefix === "" ? body : wrap(body);
      utilities.push(`.${prefix}${name}{${inner}}`);
    }
  };
  for (const scale of SCALES) {
    for (const side of SIDES) {
      add(`p${side}-${scale}`, `padding:calc(var(--spacing)*${scale})`);
      add(`m${side}-${scale}`, `margin:calc(var(--spacing)*${scale})`);
    }
    add(`gap-${scale}`, `gap:calc(var(--spacing)*${scale})`);
    add(`w-${scale}`, `width:calc(var(--spacing)*${scale})`);
    add(`w-${scale}\\/12`, `width:calc(${scale}/12*100%)`);
  }
  for (const color of COLORS) {
    for (const shade of SHADES) {
      add(
        `bg-${color}-${shade}`,
        `background-color:var(--color-${color}-${shade})`,
      );
      add(`text-${color}-${shade}`, `color:var(--color-${color}-${shade})`);
      add(
        `border-${color}-${shade}\\/50`,
        `border-color:color-mix(in oklab,var(--color-${color}-${shade}) 50%,transparent)`,
      );
    }
  }
  for (const display of ["flex", "grid", "block", "hidden", "inline-flex"]) {
    add(display, `display:${display === "hidden" ? "none" : display}`);
  }
  add(
    "shadow-md",
    "--tw-shadow:0 4px 6px -1px var(--tw-shadow-color,rgb(0 0 0/0.1));box-shadow:var(--tw-inset-shadow),var(--tw-shadow)",
  );
  return [
    "/*! tailwindcss-shaped fixture */",
    `@layer theme{:root,:host{--spacing:0.25rem;${theme.join(";")}}}`,
    "@layer base{*,::after,::before{box-sizing:border-box;border:0 solid;margin:0;padding:0}html,:host{line-height:1.5;-webkit-text-size-adjust:100%}}",
    `@layer utilities{${utilities.join("")}}`,
    '@property --tw-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}',
    "@keyframes spin{to{transform:rotate(360deg)}}",
  ].join("\n");
}

export const UTILITIES: Corpus = {
  name: "tailwind v4-shaped utilities",
  css: utilityCss(),
  keep: /^\.(md\\:)?(p-|m-|flex|text-(red|slate)|bg-gray)/,
  keepClass: /^(md:)?(p-|m-|flex|text-(red|slate)|bg-gray)/,
};

export const CORPORA: Corpus[] = [CARBON, BOOTSTRAP, BOOTSTRAP_MIN, UTILITIES];
