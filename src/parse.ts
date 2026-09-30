import {
  isTrivia,
  Scanner,
  T_AT,
  T_CLOSE_CURLY,
  T_CLOSE_PAREN,
  T_CLOSE_SQUARE,
  T_COLON,
  T_COMMENT,
  T_EOF,
  T_OPEN_CURLY,
  T_OPEN_PAREN,
  T_OPEN_SQUARE,
  T_SEMICOLON,
  T_SPACE,
  T_WORD,
} from "./scan";
import {
  bail,
  type Child,
  CssNode,
  D_AFTER_SEMI,
  D_CUSTOM,
  D_SEMI,
  Decls,
  grow,
  N_AT_BLOCK,
  N_AT_STATEMENT,
  N_COMMENT,
  N_ROOT,
  N_RULE,
} from "./tree";

const COMMA = 0x2c;
const SEMICOLON = 0x3b;
const DASH = 0x2d;
const STAR = 0x2a;
const UNDERSCORE = 0x5f;

// The visitor walk and the emitter recurse once per level.
const MAX_DEPTH = 1000;

export class Parser {
  css: string;
  decls: Decls;
  private scanner: Scanner;
  private readDeclsIn: ReadonlySet<string> | undefined;
  private container: CssNode;
  private trivia: number;
  private semicolon = false;
  private depth = 0;
  private kinds = new Uint8Array(256);
  private starts = new Int32Array(256);
  private ends = new Int32Array(256);
  private count = 0;
  private closers: number[] = [];

  constructor(css: string, readDeclsIn?: ReadonlySet<string>) {
    this.css = css;
    // About one declaration per 32 bytes of compiled CSS.
    this.decls = new Decls(Math.max(64, css.length >> 5));
    this.readDeclsIn = readDeclsIn;
    const bom = css.charCodeAt(0);
    const start = bom === 0xfeff || bom === 0xfffe ? 1 : 0;
    this.scanner = new Scanner(css, start);
    this.container = new CssNode(N_ROOT, null, start);
    this.trivia = start;
  }

  parse(): CssNode {
    const scanner = this.scanner;
    const root = this.container;
    for (;;) {
      switch (scanner.next()) {
        case T_SPACE:
          break;
        case T_COMMENT:
          this.comment();
          break;
        case T_AT:
          this.atRule();
          break;
        case T_SEMICOLON:
          this.straySemicolon();
          break;
        case T_CLOSE_CURLY:
          this.close(scanner.to);
          break;
        case T_OPEN_CURLY:
          this.count = 0;
          this.rule();
          break;
        case T_EOF:
          if (this.container !== root) bail();
          if ((root.nodes as Child[]).length > 0) {
            root.semicolon = this.semicolon;
          }
          root.end = this.css.length;
          return root;
        default:
          this.declarationOrRule();
      }
    }
  }

  private add(child: Child): void {
    (this.container.nodes as Child[]).push(child);
  }

  private open(node: CssNode): void {
    if (++this.depth > MAX_DEPTH) bail();
    this.add(node);
    this.container = node;
    this.trivia = this.scanner.to;
    this.semicolon = false;
  }

  private close(end: number): void {
    const node = this.container;
    const parent = node.parent;
    if (parent === null) bail();
    if ((node.nodes as Child[]).length > 0) node.semicolon = this.semicolon;
    this.semicolon = false;
    node.end = end;
    this.depth--;
    this.container = parent;
    this.trivia = end;
  }

  private comment(): void {
    const scanner = this.scanner;
    const node = new CssNode(N_COMMENT, this.container, this.trivia);
    node.start = scanner.from;
    node.end = scanner.to;
    this.add(node);
    this.trivia = scanner.to;
  }

  private straySemicolon(): void {
    const nodes = this.container.nodes as Child[];
    const last = nodes[nodes.length - 1];
    if (typeof last === "object" && last.type === N_RULE && !last.semi) {
      last.semi = true;
      last.end = this.scanner.to;
      this.trivia = this.scanner.to;
    }
  }

  private push(kind: number, from: number, to: number): void {
    const i = this.count;
    if (i === this.kinds.length) {
      this.kinds = grow(this.kinds);
      this.starts = grow(this.starts);
      this.ends = grow(this.ends);
    }
    this.kinds[i] = kind;
    this.starts[i] = from;
    this.ends[i] = to;
    this.count = i + 1;
  }

  private skipTrivia(from: number, to: number): number {
    while (from < to && isTrivia(this.kinds[from])) from++;
    return from;
  }

  private trimTrivia(from: number, to: number): number {
    while (to > from && isTrivia(this.kinds[to - 1])) to--;
    return to;
  }

  private atRule(): void {
    const scanner = this.scanner;
    const at = scanner.from;
    const nameEnd = scanner.to;
    if (nameEnd === at + 1) bail();
    const closers = this.closers;
    let depth = 0;
    this.count = 0;
    let kind: number;
    for (;;) {
      kind = scanner.next();
      if (depth > 0 && kind === closers[depth - 1]) depth--;
      else if (kind === T_OPEN_PAREN) closers[depth++] = T_CLOSE_PAREN;
      else if (kind === T_OPEN_SQUARE) closers[depth++] = T_CLOSE_SQUARE;
      else if (kind === T_OPEN_CURLY && depth > 0) {
        closers[depth++] = T_CLOSE_CURLY;
      }
      if (
        depth === 0 &&
        (kind === T_SEMICOLON ||
          kind === T_OPEN_CURLY ||
          kind === T_CLOSE_CURLY)
      ) {
        break;
      }
      if (kind === T_EOF) break;
      this.push(kind, scanner.from, scanner.to);
    }

    const block = kind === T_OPEN_CURLY;
    const node = new CssNode(
      block ? N_AT_BLOCK : N_AT_STATEMENT,
      this.container,
      this.trivia,
    );
    node.start = at;
    node.name = this.css.slice(at + 1, nameEnd);
    if (this.readDeclsIn?.has(node.name.toLowerCase())) node.readDecls = true;

    const first = this.skipTrivia(0, this.count);
    const last = this.trimTrivia(first, this.count);
    if (first < last) {
      node.a = this.starts[first];
      node.b = this.ends[last - 1];
      node.clean = this.cleanText(first, last);
    }

    this.semicolon = false;
    if (block) {
      this.open(node);
      return;
    }
    this.add(node);
    if (kind === T_SEMICOLON) {
      node.semi = true;
      node.end = scanner.from;
      this.semicolon = true;
      this.trivia = scanner.to;
    } else if (kind === T_CLOSE_CURLY) {
      node.end = scanner.from;
      scanner.pos = scanner.from;
    } else {
      node.end = first < last ? node.b : scanner.from;
      this.trivia = node.end;
    }
  }

  private declarationOrRule(): void {
    const scanner = this.scanner;
    const css = this.css;
    const closers = this.closers;
    const from = scanner.from;
    const custom =
      scanner.kind === T_WORD &&
      css.charCodeAt(from) === DASH &&
      css.charCodeAt(from + 1) === DASH;
    let colon = -1;
    let depth = 0;
    let kind = scanner.kind;
    this.count = 0;
    for (;;) {
      if (depth > 0 && kind === closers[depth - 1]) depth--;
      else if (kind === T_OPEN_PAREN) closers[depth++] = T_CLOSE_PAREN;
      else if (kind === T_OPEN_SQUARE) closers[depth++] = T_CLOSE_SQUARE;
      else if (kind === T_OPEN_CURLY && custom && colon !== -1) {
        closers[depth++] = T_CLOSE_CURLY;
      } else if (depth === 0) {
        if (kind === T_COLON) {
          if (colon === -1) colon = this.count;
        } else if (kind === T_SEMICOLON) {
          if (colon === -1) bail();
          this.declaration(colon, custom, true);
          return;
        } else if (kind === T_OPEN_CURLY) {
          this.rule();
          return;
        } else if (kind === T_CLOSE_CURLY) {
          scanner.pos = scanner.from;
          break;
        }
      }
      if (kind === T_EOF) {
        if (depth > 0) bail();
        break;
      }
      this.push(kind, scanner.from, scanner.to);
      kind = scanner.next();
    }
    if (colon === -1) bail();
    this.declaration(colon, custom, false);
  }

  private rule(): void {
    const node = new CssNode(N_RULE, this.container, this.trivia);
    const last = this.trimTrivia(0, this.count);
    if (last === 0) {
      node.start = node.a = node.b = this.scanner.from;
    } else {
      node.start = node.a = this.starts[0];
      node.b = this.ends[last - 1];
      node.clean = this.cleanText(0, last);
    }
    this.open(node);
  }

  private declaration(colon: number, custom: boolean, semi: boolean): void {
    const css = this.css;
    const kinds = this.kinds;
    const starts = this.starts;
    const ends = this.ends;

    if (kinds[0] !== T_WORD) bail();
    for (let i = 1; i < colon; i++) if (!isTrivia(kinds[i])) bail();
    let start = starts[0];
    const hack = css.charCodeAt(start);
    if (hack === STAR || hack === UNDERSCORE) start++;

    if (!custom) {
      let parens = 0;
      for (let i = colon + 1; i < this.count; i++) {
        const kind = kinds[i];
        if (kind === T_OPEN_PAREN) parens++;
        else if (kind === T_CLOSE_PAREN) parens--;
        else if (
          kind === T_COLON &&
          parens === 0 &&
          !(
            kinds[i - 1] === T_WORD &&
            ends[i - 1] - starts[i - 1] === 6 &&
            css.startsWith("progid", starts[i - 1])
          )
        ) {
          bail();
        }
      }
    }

    const last =
      semi || custom ? this.count : this.trimTrivia(colon + 1, this.count);
    const end = ends[last - 1];

    let a = ends[colon];
    let b = end;
    let clean: string | null = null;
    if (this.container.readDecls) {
      [a, b, clean] = this.value(colon + 1, last, custom);
    }

    let flags = (semi ? D_SEMI : 0) | (custom ? D_CUSTOM : 0);
    if (
      starts[0] > this.trivia &&
      css.charCodeAt(starts[0] - 1) === SEMICOLON
    ) {
      flags |= D_AFTER_SEMI;
    }
    const index = this.decls.push(start, ends[0], a, b, end, flags);
    if (clean !== null) this.decls.clean.set(index, clean);
    this.add(index);
    this.semicolon = semi;
    this.trivia = semi ? this.scanner.to : end;
  }

  private value(
    from: number,
    to: number,
    custom: boolean,
  ): [a: number, b: number, clean: string | null] {
    const kinds = this.kinds;
    const starts = this.starts;
    const ends = this.ends;

    let first = this.skipTrivia(from, to);
    let last = to;
    const tail = this.trimTrivia(first, to) - 1;
    if (tail >= first) {
      const word = this.css.slice(starts[tail], ends[tail]).toLowerCase();
      if (word === "!important") {
        last = tail;
        while (last > first && kinds[last - 1] === T_SPACE) last--;
      } else if (word === "important") {
        last = this.barewordImportant(first, to, tail - first);
      }
    }

    if (last === first) first = from;
    if (!custom && last > first && kinds[last - 1] === T_SPACE) last--;
    if (last === first) return [ends[from - 1], ends[from - 1], null];
    return [starts[first], ends[last - 1], this.cleanText(first, last)];
  }

  private barewordImportant(first: number, to: number, steps: number): number {
    const css = this.css;
    let text = "";
    let cut = to;
    for (let k = steps; k >= 1; k--) {
      // PostCSS checks the token at `first + k`, not the one it removes.
      if (startsWithBang(text) && this.kinds[first + k] !== T_SPACE) break;
      cut--;
      text = css.slice(this.starts[cut], this.ends[cut]) + text;
    }
    return startsWithBang(text) ? cut : to;
  }

  private cleanText(first: number, last: number): string | null {
    const kinds = this.kinds;
    let i = first;
    while (i < last && kinds[i] !== T_COMMENT) i++;
    if (i === last) return null;

    const css = this.css;
    const starts = this.starts;
    const ends = this.ends;
    let text = css.slice(starts[first], starts[i]);
    // Reading the end of a `+=`-built string flattens it: quadratic.
    let lastCode = text.charCodeAt(text.length - 1);
    for (; i < last; i++) {
      if (
        kinds[i] === T_COMMENT &&
        (i === first ||
          i === last - 1 ||
          kinds[i - 1] === T_SPACE ||
          kinds[i + 1] === T_SPACE ||
          lastCode === COMMA)
      ) {
        continue;
      }
      const from = starts[i];
      const to = ends[i];
      if (to > from) {
        text += css.slice(from, to);
        lastCode = css.charCodeAt(to - 1);
      }
    }
    return text;
  }
}

function startsWithBang(text: string): boolean {
  return text.trim().charCodeAt(0) === 0x21;
}
