import {
  AT,
  BACKSLASH,
  CLOSE_CURLY,
  CLOSE_PAREN,
  CLOSE_SQUARE,
  COLON,
  CR,
  DQUOTE,
  FF,
  LF,
  LINE_SEPARATOR,
  LOWER_L,
  LOWER_R,
  LOWER_U,
  OPEN_CURLY,
  OPEN_PAREN,
  OPEN_SQUARE,
  PARAGRAPH_SEPARATOR,
  SEMICOLON,
  SLASH,
  SPACE,
  SQUOTE,
  STAR,
  TAB,
} from "./chars";
import { bail } from "./tree";

export const T_EOF = 0;
export const T_SPACE = 1;
export const T_COMMENT = 2;
export const T_WORD = 3;
const T_STRING = 4;
export const T_AT = 5;
const T_GROUP = 6;
export const T_OPEN_PAREN = 7;
export const T_CLOSE_PAREN = 8;
export const T_OPEN_SQUARE = 9;
export const T_CLOSE_SQUARE = 10;
export const T_OPEN_CURLY = 11;
export const T_CLOSE_CURLY = 12;
export const T_COLON = 13;
export const T_SEMICOLON = 14;

export function isTrivia(kind: number): boolean {
  return kind === T_SPACE || kind === T_COMMENT;
}

const C_SPACE = 1;
const C_WORD_END = 2;
const C_NAME_END = 4;
const C_HEX = 8;
const C_GROUP_UNSAFE = 16;

const CLASS = new Uint8Array(128);
const classify = (chars: string, flag: number) => {
  for (const c of chars) CLASS[c.charCodeAt(0)] |= flag;
};
classify(" \n\t\r\f", C_SPACE | C_WORD_END | C_NAME_END);
classify("!\"#'():;@[\\]{}/", C_WORD_END);
classify("\"#'()/;[\\]{}", C_NAME_END);
classify("0123456789abcdefABCDEF", C_HEX);
classify("\r\n\"'(/\\", C_GROUP_UNSAFE);

function has(code: number, flag: number): boolean {
  return code < 128 && (CLASS[code] & flag) !== 0;
}

function isEscaped(css: string, at: number): boolean {
  let i = at - 1;
  while (css.charCodeAt(i) === BACKSLASH) i--;
  return (at - 1 - i) % 2 === 1;
}

/** End of the first unescaped `char` after `from`, inclusive. */
function closeAfter(css: string, char: string, from: number): number {
  let at = from;
  do {
    at = css.indexOf(char, at + 1);
    if (at === -1) bail();
  } while (isEscaped(css, at));
  return at + 1;
}

export class Scanner {
  css: string;
  length: number;
  pos: number;
  kind = T_EOF;
  from: number;
  to: number;
  // `(` opens an unquoted `url(...)` if the word stack pops a `url` word.
  // Only the depths holding `url` are tracked.
  private words = 0;
  private urlDepths: number[] = [];
  private unsafeEnd = -1;

  constructor(css: string, start: number) {
    this.css = css;
    this.length = css.length;
    this.pos = start;
    this.from = start;
    this.to = start;
  }

  next(): number {
    const css = this.css;
    const length = this.length;
    const from = this.pos;
    this.from = from;
    if (from >= length) {
      this.to = from;
      this.kind = T_EOF;
      return T_EOF;
    }

    let to = from + 1;
    let kind: number;
    const code = css.charCodeAt(from);
    switch (code) {
      case SPACE:
      case LF:
      case TAB:
      case CR:
      case FF:
        while (to < length && has(css.charCodeAt(to), C_SPACE)) to++;
        kind = T_SPACE;
        break;
      case OPEN_CURLY:
        kind = T_OPEN_CURLY;
        break;
      case CLOSE_CURLY:
        kind = T_CLOSE_CURLY;
        break;
      case COLON:
        kind = T_COLON;
        break;
      case SEMICOLON:
        kind = T_SEMICOLON;
        break;
      case OPEN_SQUARE:
        kind = T_OPEN_SQUARE;
        break;
      case CLOSE_SQUARE:
        kind = T_CLOSE_SQUARE;
        break;
      case CLOSE_PAREN:
        kind = T_CLOSE_PAREN;
        break;
      case OPEN_PAREN:
        to = this.paren(from);
        kind = to === from + 1 ? T_OPEN_PAREN : T_GROUP;
        break;
      case DQUOTE:
        to = closeAfter(css, '"', from);
        kind = T_STRING;
        break;
      case SQUOTE:
        to = closeAfter(css, "'", from);
        kind = T_STRING;
        break;
      case AT:
        while (to < length && !has(css.charCodeAt(to), C_NAME_END)) to++;
        kind = T_AT;
        break;
      case BACKSLASH:
        to = this.escapeEnd(from);
        kind = T_WORD;
        break;
      default:
        if (code === SLASH && css.charCodeAt(to) === STAR) {
          const close = css.indexOf("*/", from + 2);
          if (close === -1) bail();
          to = close + 2;
          kind = T_COMMENT;
          break;
        }
        to = this.wordEnd(to);
        this.pushWord(from, to);
        kind = T_WORD;
    }
    this.pos = to;
    this.to = to;
    this.kind = kind;
    return kind;
  }

  private wordEnd(pos: number): number {
    const css = this.css;
    const length = this.length;
    while (pos < length) {
      const code = css.charCodeAt(pos);
      if (has(code, C_WORD_END)) {
        if (code !== SLASH || css.charCodeAt(pos + 1) === STAR) break;
      }
      pos++;
    }
    return pos;
  }

  private escapeEnd(from: number): number {
    const css = this.css;
    let to = from + 1;
    while (css.charCodeAt(to) === BACKSLASH) to++;
    if ((to - from) % 2 === 0 || to >= this.length) return to;
    const code = css.charCodeAt(to);
    if (code === SLASH || has(code, C_SPACE)) return to;
    to++;
    if (has(code, C_HEX)) {
      while (has(css.charCodeAt(to), C_HEX)) to++;
      if (css.charCodeAt(to) === SPACE) to++;
    }
    return to;
  }

  private paren(from: number): number {
    const css = this.css;
    const next = css.charCodeAt(from + 1);
    if (
      this.popWord() &&
      next !== DQUOTE &&
      next !== SQUOTE &&
      !has(next, C_SPACE)
    ) {
      return closeAfter(css, ")", from);
    }

    if (from <= this.unsafeEnd) return from + 1;
    const close = css.indexOf(")", from + 1);
    if (close === -1) {
      this.unsafeEnd = this.length;
      return from + 1;
    }
    for (let i = from + 1; i < close; i++) {
      if (has(css.charCodeAt(i), C_GROUP_UNSAFE)) {
        const before = css.charCodeAt(i - 1);
        if (
          before !== LF &&
          before !== CR &&
          before !== LINE_SEPARATOR &&
          before !== PARAGRAPH_SEPARATOR
        ) {
          this.unsafeEnd = close;
          return from + 1;
        }
      }
    }
    return close + 1;
  }

  private pushWord(from: number, to: number): void {
    const depth = ++this.words;
    const css = this.css;
    // Not `startsWith`: that stops this from being inlined into `next`.
    if (
      to - from === 3 &&
      css.charCodeAt(from) === LOWER_U &&
      css.charCodeAt(from + 1) === LOWER_R &&
      css.charCodeAt(from + 2) === LOWER_L
    ) {
      this.urlDepths.push(depth);
    }
  }

  private popWord(): boolean {
    const depth = this.words;
    if (depth === 0) return false;
    this.words = depth - 1;
    const urls = this.urlDepths;
    if (urls.length > 0 && urls[urls.length - 1] === depth) {
      urls.pop();
      return true;
    }
    return false;
  }
}
