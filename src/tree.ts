export const N_ROOT = 0;
export const N_RULE = 1;
export const N_AT_BLOCK = 2;
export const N_AT_STATEMENT = 3;
export const N_COMMENT = 4;

export const BAIL = Symbol("bail");

export function bail(): never {
  throw BAIL;
}

export type Child = CssNode | number;

const F_SEMI = 1;
const F_SEMICOLON = 2;
const F_READ_DECLS = 4;
const F_REMOVED = 8;
const F_DIRTY = 16;
const F_REWRITTEN = 32;

export class CssNode {
  type: number;
  flags: number;
  parent: CssNode | null;
  nodes: Child[] | null;
  before: number;
  start: number;
  end: number;
  a: number;
  b: number;
  name: string;
  private text: string | null;

  constructor(type: number, parent: CssNode | null, before: number) {
    this.type = type;
    this.flags = parent !== null ? parent.flags & F_READ_DECLS : 0;
    this.parent = parent;
    this.nodes =
      type === N_ROOT || type === N_RULE || type === N_AT_BLOCK ? [] : null;
    this.before = before;
    this.start = before;
    this.end = before;
    this.a = 0;
    this.b = 0;
    this.name = "";
    this.text = null;
  }

  private set(flag: number, on: boolean): void {
    this.flags = on ? this.flags | flag : this.flags & ~flag;
  }

  get semi(): boolean {
    return (this.flags & F_SEMI) !== 0;
  }
  set semi(on: boolean) {
    this.set(F_SEMI, on);
  }

  get semicolon(): boolean {
    return (this.flags & F_SEMICOLON) !== 0;
  }
  set semicolon(on: boolean) {
    this.set(F_SEMICOLON, on);
  }

  get readDecls(): boolean {
    return (this.flags & F_READ_DECLS) !== 0;
  }
  set readDecls(on: boolean) {
    this.set(F_READ_DECLS, on);
  }

  get removed(): boolean {
    return (this.flags & F_REMOVED) !== 0;
  }
  set removed(on: boolean) {
    this.set(F_REMOVED, on);
  }

  get dirty(): boolean {
    return (this.flags & F_DIRTY) !== 0;
  }
  set dirty(on: boolean) {
    this.set(F_DIRTY, on);
  }

  get selector(): string | null {
    return (this.flags & F_REWRITTEN) !== 0 ? this.text : null;
  }
  set selector(text: string) {
    this.text = text;
    this.flags |= F_REWRITTEN;
  }

  get clean(): string | null {
    return (this.flags & F_REWRITTEN) !== 0 ? null : this.text;
  }
  set clean(text: string | null) {
    this.text = text;
  }

  /** The selector or params as a visitor reads them. */
  read(css: string): string {
    return this.text ?? css.slice(this.a, this.b);
  }
}

export const D_SEMI = 1;
export const D_CUSTOM = 2;
export const D_AFTER_SEMI = 4;

export function grow<T extends Uint8Array | Int32Array>(array: T): T {
  const next = new (array.constructor as new (size: number) => T)(
    array.length * 2,
  );
  next.set(array);
  return next;
}

export class Decls {
  start: Int32Array;
  propEnd: Int32Array;
  a: Int32Array;
  b: Int32Array;
  end: Int32Array;
  flags: Uint8Array;
  clean = new Map<number, string>();
  count = 0;

  constructor(capacity: number) {
    this.start = new Int32Array(capacity);
    this.propEnd = new Int32Array(capacity);
    this.a = new Int32Array(capacity);
    this.b = new Int32Array(capacity);
    this.end = new Int32Array(capacity);
    this.flags = new Uint8Array(capacity);
  }

  push(
    start: number,
    propEnd: number,
    a: number,
    b: number,
    end: number,
    flags: number,
  ): number {
    const i = this.count;
    if (i === this.start.length) {
      this.start = grow(this.start);
      this.propEnd = grow(this.propEnd);
      this.a = grow(this.a);
      this.b = grow(this.b);
      this.end = grow(this.end);
      this.flags = grow(this.flags);
    }
    this.start[i] = start;
    this.propEnd[i] = propEnd;
    this.a[i] = a;
    this.b[i] = b;
    this.end[i] = end;
    this.flags[i] = flags;
    this.count = i + 1;
    return i;
  }
}
