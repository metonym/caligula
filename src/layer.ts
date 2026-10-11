import { COMMA, CR, DOT, FF, LF, SPACE, TAB } from "./chars";

/** Joins the segments of a layer name; no decoded name contains it. */
export const SEPARATOR = "\0";

const ESC = String.raw`\\(?:[\da-fA-F]{1,6}(?:\r\n|[ \t\n\r\f])?|[^\n\r\f])`;
const IDENT = new RegExp(
  String.raw`(?:--|-?(?:[A-Za-z_\u0080-\uffff]|${ESC}))(?:[\w\-\u0080-\uffff]|${ESC})*`,
  "y",
);
const ESCAPE = /\\(?:([\da-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?|([\s\S]))/g;
const CSS_WIDE = new Set([
  "initial",
  "inherit",
  "unset",
  "revert",
  "revert-layer",
]);

function decode(ident: string): string {
  if (!ident.includes("\\")) return ident;
  return ident.replace(ESCAPE, (_, hex: string | undefined, char: string) => {
    if (hex === undefined) return char;
    const point = Number.parseInt(hex, 16);
    return point === 0 ||
      (point >= 0xd800 && point <= 0xdfff) ||
      point > 0x10ffff
      ? "\uFFFD"
      : String.fromCodePoint(point);
  });
}

function isSpace(code: number): boolean {
  return (
    code === SPACE || code === TAB || code === LF || code === FF || code === CR
  );
}

/** Past the comments at `i`, and whitespace too if `spaces`. */
function skip(s: string, i: number, spaces: boolean): number {
  for (;;) {
    if (spaces && isSpace(s.charCodeAt(i))) i++;
    else if (s.startsWith("/*", i)) {
      const close = s.indexOf("*/", i + 2);
      i = close === -1 ? s.length : close + 2;
    } else return i;
  }
}

/**
 * The names in a `@layer` prelude, `<layer-name>#` (CSS Cascade 5), each
 * with its segments joined by `SEPARATOR`. `undefined` if the prelude is
 * empty or any name is invalid: browsers ignore such a rule.
 */
export function layerNames(params: string): string[] | undefined {
  const s = params.includes("\0") ? params.replaceAll("\0", "\uFFFD") : params;
  const names: string[] = [];
  let i = 0;
  for (;;) {
    i = skip(s, i, true);
    let name = "";
    for (;;) {
      IDENT.lastIndex = i;
      const match = IDENT.exec(s);
      if (match === null) return undefined;
      const segment = decode(match[0]);
      if (CSS_WIDE.has(segment.toLowerCase())) return undefined;
      name += (name && SEPARATOR) + segment;
      i = skip(s, IDENT.lastIndex, false);
      if (s.charCodeAt(i) !== DOT) break;
      i = skip(s, i + 1, false);
    }
    names.push(name);
    i = skip(s, i, true);
    if (i === s.length) return names;
    if (s.charCodeAt(i) !== COMMA) return undefined;
    i++;
  }
}
