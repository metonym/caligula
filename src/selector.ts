import {
  BACKSLASH,
  CLOSE_PAREN,
  CLOSE_SQUARE,
  COLON,
  COMMA,
  CR,
  DASH,
  DOT,
  DQUOTE,
  FF,
  GREATER,
  LF,
  OPEN_PAREN,
  OPEN_SQUARE,
  PLUS,
  SLASH,
  SQUOTE,
  STAR,
  TILDE,
} from "./chars";
import type { Combinator, Compound, ParsedSelector } from "./index.js";

export type { Combinator, Compound, ParsedSelector } from "./index.js";

const EMPTY: readonly string[] = Object.freeze([]);

/** `:is()` inside `:not()` inside …: deeper arguments are skipped, not read. */
const MAX_DEPTH = 32;

// Character classes below U+0080 (0 for the rest); everything above is a
// name character.
const NAME = 1;
const NAME_START = 3;
const WHITESPACE = 4;
const KIND = new Uint8Array(128);
for (let c = 0x30; c <= 0x39; c++) KIND[c] = NAME;
for (let c = 0x41; c <= 0x5a; c++) KIND[c] = NAME_START;
for (let c = 0x61; c <= 0x7a; c++) KIND[c] = NAME_START;
KIND[0x5f] = NAME_START;
KIND[DASH] = NAME;
for (const c of [0x20, 0x09, 0x0a, 0x0d, 0x0c]) KIND[c] = WHITESPACE;

// Reading past the end with `charCodeAt` returns `NaN`, which makes the JIT
// drop its fast path, so reads that can run off the end go through `at`.
function at(s: string, i: number): number {
  return i < s.length ? s.charCodeAt(i) : -1;
}

function isName(code: number): boolean {
  return code < 128 ? code >= 0 && (KIND[code] & NAME) !== 0 : true;
}

function isNameStart(code: number): boolean {
  return code < 128 ? code >= 0 && KIND[code] === NAME_START : true;
}

function isWhitespace(code: number): boolean {
  return code >= 0 && code < 128 && KIND[code] === WHITESPACE;
}

function isHex(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x61 && code <= 0x66) ||
    (code >= 0x41 && code <= 0x46)
  );
}

/** A backslash at `i` that starts an escape, not a line continuation. */
function isEscape(s: string, i: number): boolean {
  if (at(s, i) !== BACKSLASH || i + 1 >= s.length) return false;
  const next = s.charCodeAt(i + 1);
  return next !== LF && next !== CR && next !== FF;
}

function isIdentStart(s: string, i: number): boolean {
  const code = at(s, i);
  if (isNameStart(code) || isEscape(s, i)) return true;
  if (code !== DASH) return false;
  const next = at(s, i + 1);
  return isNameStart(next) || next === DASH || isEscape(s, i + 1);
}

// Where the last `readEscape`, `readName` or `complex` call stopped reading.
let end = 0;

/** The character the escape at `i` stands for. */
function readEscape(s: string, i: number): string {
  const from = i + 1;
  let to = from;
  while (to < s.length && to - from < 6 && isHex(s.charCodeAt(to))) to++;
  if (to === from) {
    const point = s.codePointAt(from) as number;
    end = from + (point > 0xffff ? 2 : 1);
    return String.fromCodePoint(point);
  }
  let point = Number.parseInt(s.slice(from, to), 16);
  if (point === 0 || (point >= 0xd800 && point <= 0xdfff) || point > 0x10ffff) {
    point = 0xfffd;
  }
  if (at(s, to) === CR && at(s, to + 1) === LF) to += 2;
  else if (isWhitespace(at(s, to))) to++;
  end = to;
  return String.fromCodePoint(point);
}

/** Past the name characters at `i`, stopping at an escape. */
function nameCharsEnd(s: string, i: number): number {
  const length = s.length;
  while (i < length) {
    const code = s.charCodeAt(i);
    if (code < 128 && (KIND[code] & NAME) === 0) break;
    i++;
  }
  return i;
}

/** The name at `i`, unescaped. */
function readName(s: string, i: number): string {
  let from = i;
  i = nameCharsEnd(s, i);
  if (!isEscape(s, i)) {
    end = i;
    return s.slice(from, i);
  }
  let out = "";
  do {
    out += s.slice(from, i) + readEscape(s, i);
    from = end;
    i = nameCharsEnd(s, end);
  } while (isEscape(s, i));
  end = i;
  return out + s.slice(from, i);
}

/** Past the name at `i`. */
function skipName(s: string, i: number): number {
  i = nameCharsEnd(s, i);
  while (isEscape(s, i)) {
    readEscape(s, i);
    i = nameCharsEnd(s, end);
  }
  return i;
}

/** Past the comment, string or escape at `i`, or `i` if none starts there. */
function skipToken(s: string, i: number, code: number): number {
  if (code === SLASH) {
    if (at(s, i + 1) !== STAR) return i;
    const close = s.indexOf("*/", i + 2);
    return close === -1 ? s.length : close + 2;
  }
  if (code === DQUOTE || code === SQUOTE) {
    for (i++; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === code) break;
      if (c === BACKSLASH) i++;
      else if (c === LF || c === CR || c === FF) break;
    }
    return i < s.length ? i + 1 : s.length;
  }
  if (code !== BACKSLASH) return i;
  return i + 2 < s.length ? i + 2 : s.length;
}

/** Past the `close` that ends the block whose opener is just before `i`. */
function skipBlock(s: string, i: number, close: number): number {
  let depth = 1;
  while (i < s.length) {
    const code = s.charCodeAt(i);
    if (code === close) {
      i++;
      if (--depth === 0) return i;
    } else if (code === OPEN_PAREN && close === CLOSE_PAREN) {
      i++;
      depth++;
    } else if (
      code === SLASH ||
      code === DQUOTE ||
      code === SQUOTE ||
      code === BACKSLASH
    ) {
      const next = skipToken(s, i, code);
      i = next === i ? i + 1 : next;
    } else {
      i++;
    }
  }
  return i;
}

/** The next comma at `i` or after, outside brackets, or the end. */
function selectorEnd(s: string, i: number): number {
  while (i < s.length) {
    const code = s.charCodeAt(i);
    if (code === COMMA) return i;
    if (code === OPEN_PAREN) i = skipBlock(s, i + 1, CLOSE_PAREN);
    else if (code === OPEN_SQUARE) i = skipBlock(s, i + 1, CLOSE_SQUARE);
    else if (
      code === SLASH ||
      code === DQUOTE ||
      code === SQUOTE ||
      code === BACKSLASH
    ) {
      const next = skipToken(s, i, code);
      i = next === i ? i + 1 : next;
    } else {
      i++;
    }
  }
  return i;
}

function compound(
  classes: string[] | null,
  negated: string[] | null,
): Compound {
  return { classes: classes ?? EMPTY, negated: negated ?? EMPTY };
}

function addClass(classes: string[] | null, name: string): string[] {
  if (classes === null) {
    // A third faster over Carbon's selectors than the literal `[name]`.
    const created: string[] = [];
    created.push(name);
    return created;
  }
  // Lengths first: faster than `includes` on freshly sliced names.
  for (let k = 0; k < classes.length; k++) {
    const other = classes[k];
    if (other.length === name.length && other === name) return classes;
  }
  classes.push(name);
  return classes;
}

const P_OTHER = 0;
const P_NOT = 1;
/** `:is()` and its aliases. */
const P_IS = 2;
const IS_NAMES = ["is", "where", "matches", "-webkit-any", "-moz-any"];

/** Whether `s[from, to)` is the lowercase `name`, ignoring ASCII case. */
function isNamed(s: string, from: number, to: number, name: string): boolean {
  if (to - from !== name.length) return false;
  for (let k = 0; k < name.length; k++) {
    const code = s.charCodeAt(from + k);
    const lower = code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
    if (lower !== name.charCodeAt(k)) return false;
  }
  return true;
}

/** Which functional pseudo-class `s[from, to)` names, without allocating. */
function pseudoKind(s: string, from: number, to: number): number {
  for (let k = from; k < to; k++) {
    if (s.charCodeAt(k) === BACKSLASH) {
      const name = readName(s, from).toLowerCase();
      return name === "not" ? P_NOT : IS_NAMES.includes(name) ? P_IS : P_OTHER;
    }
  }
  if (isNamed(s, from, to, "not")) return P_NOT;
  for (let k = 0; k < IS_NAMES.length; k++) {
    if (isNamed(s, from, to, IS_NAMES[k])) return P_IS;
  }
  return P_OTHER;
}

// The combinators of the last `complex` call.
let combinatorsOut: Combinator[] = [];

/**
 * Reads one complex selector at `i`, up to a comma, the end, or (in an
 * argument list, `depth > 0`) the closing parenthesis. Returns its compounds;
 * `combinatorsOut` holds the combinators between them.
 */
function complex(s: string, i: number, depth: number): Compound[] {
  const compounds: Compound[] = [];
  const combinators: Combinator[] = [];
  let classes: string[] | null = null;
  let negated: string[] | null = null;
  // Whether the current compound has anything in it yet.
  let open = false;
  let combinator: Combinator = " ";

  while (i < s.length) {
    const code = s.charCodeAt(i);
    if (code === COMMA || (code === CLOSE_PAREN && depth > 0)) break;
    if (isWhitespace(code)) {
      i++;
      if (open) {
        compounds.push(compound(classes, negated));
        classes = null;
        negated = null;
        open = false;
        combinator = " ";
      }
      continue;
    }
    if (code === SLASH && at(s, i + 1) === STAR) {
      i = skipToken(s, i, code);
      continue;
    }
    if (code === GREATER || code === PLUS || code === TILDE) {
      i++;
      if (open) {
        compounds.push(compound(classes, negated));
        classes = null;
        negated = null;
        open = false;
      } else if (compounds.length === 0) {
        // A leading combinator, as in a nested `> .a`: the compound before
        // it is the implicit `&`.
        compounds.push(compound(null, null));
      }
      combinator = s[i - 1] as Combinator;
      continue;
    }

    if (!open) {
      if (compounds.length > 0) combinators.push(combinator);
      open = true;
    }
    if (isName(code)) {
      i = skipName(s, i + 1);
    } else if (code === DOT && isIdentStart(s, i + 1)) {
      classes = addClass(classes, readName(s, i + 1));
      i = end;
    } else if (code === COLON) {
      i++;
      const element = at(s, i) === COLON;
      if (element) i++;
      const from = i;
      i = skipName(s, i);
      if (at(s, i) !== OPEN_PAREN) continue;
      const kind =
        element || depth >= MAX_DEPTH ? P_OTHER : pseudoKind(s, from, i);
      i++;
      if (kind === P_NOT) {
        const branches = list(s, i, depth + 1);
        i = end;
        for (let b = 0; b < branches.length; b++) {
          const required = branches[b].classes;
          for (let c = 0; c < required.length; c++) {
            negated = addClass(negated, required[c]);
          }
        }
      } else if (kind === P_IS) {
        const branches = list(s, i, depth + 1);
        i = end;
        const first = branches[0].classes;
        for (let c = 0; c < first.length; c++) {
          let everyBranch = true;
          for (let b = 1; b < branches.length && everyBranch; b++) {
            everyBranch = branches[b].classes.includes(first[c]);
          }
          if (everyBranch) classes = addClass(classes, first[c]);
        }
      } else {
        // `:has()` is about other elements; the rest name no classes.
        i = skipBlock(s, i, CLOSE_PAREN);
      }
    } else if (code === OPEN_SQUARE) {
      i = skipBlock(s, i + 1, CLOSE_SQUARE);
    } else if (isEscape(s, i)) {
      i = skipName(s, i);
    } else {
      const next = skipToken(s, i, code);
      i = next === i ? i + 1 : next;
    }
  }

  if (open || compounds.length === combinators.length) {
    compounds.push(compound(classes, negated));
  }
  end = i;
  combinatorsOut = combinators;
  return compounds;
}

/** Reads a selector list argument at `i` and its `)`, returning each branch's subject. */
function list(s: string, i: number, depth: number): Compound[] {
  const subjects: Compound[] = [];
  for (;;) {
    const compounds = complex(s, i, depth);
    i = end;
    subjects.push(compounds[compounds.length - 1]);
    if (at(s, i) !== COMMA) break;
    i++;
  }
  end = at(s, i) === CLOSE_PAREN ? i + 1 : i;
  return subjects;
}

/** `s[from, to)` without surrounding whitespace, keeping an escaped trailing space. */
function trimmed(s: string, from: number, to: number): string {
  while (from < to && isWhitespace(s.charCodeAt(from))) from++;
  while (to > from && isWhitespace(s.charCodeAt(to - 1))) {
    let slashes = 0;
    while (
      to - 2 - slashes >= from &&
      s.charCodeAt(to - 2 - slashes) === BACKSLASH
    ) {
      slashes++;
    }
    if (slashes % 2 === 1) break;
    to--;
  }
  return s.slice(from, to);
}

function parsed(text: string, compounds: Compound[]): ParsedSelector {
  return {
    text,
    compounds,
    combinators: combinatorsOut,
    subject: compounds[compounds.length - 1],
  };
}

/**
 * Splits a selector list on its top-level commas: not those in parentheses,
 * attribute selectors, strings or comments. Selectors come back trimmed;
 * empty ones are dropped.
 */
export function splitSelectorList(list: string): string[] {
  const selectors: string[] = [];
  for (let from = 0; ; ) {
    const to = selectorEnd(list, from);
    const text = trimmed(list, from, to);
    if (text !== "") selectors.push(text);
    if (to >= list.length) return selectors;
    from = to + 1;
  }
}

/** Parses each selector in a list; `splitSelectorList` then `parseSelector`, in one pass. */
export function parseSelectorList(list: string): ParsedSelector[] {
  const selectors: ParsedSelector[] = [];
  for (let from = 0; ; ) {
    const compounds = complex(list, from, 0);
    const to = end;
    const text = trimmed(list, from, to);
    if (text !== "") selectors.push(parsed(text, compounds));
    if (to >= list.length) return selectors;
    from = to + 1;
  }
}

/**
 * Parses one selector into compounds and the combinators between them.
 * Throws on a selector list; use `parseSelectorList` for those.
 */
export function parseSelector(selector: string): ParsedSelector {
  const compounds = complex(selector, 0, 0);
  if (end < selector.length) {
    throw new TypeError(
      `parseSelector: "${selector}" is a selector list; use parseSelectorList`,
    );
  }
  return parsed(trimmed(selector, 0, selector.length), compounds);
}

/**
 * Every class an element chain must carry to match `selector`, in order of
 * first appearance across its compounds. `prefix` keeps only classes that
 * start with it.
 */
export function requiredClasses(
  selector: string | ParsedSelector,
  options: { prefix?: string } = {},
): string[] {
  const { compounds } =
    typeof selector === "string" ? parseSelector(selector) : selector;
  const { prefix } = options;
  const classes: string[] = [];
  for (let i = 0; i < compounds.length; i++) {
    const names = compounds[i].classes;
    for (let j = 0; j < names.length; j++) {
      const name = names[j];
      if (prefix !== undefined && !name.startsWith(prefix)) continue;
      if (!classes.includes(name)) classes.push(name);
    }
  }
  return classes;
}
