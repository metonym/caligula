export const N_ROOT = 0;
export const N_RULE = 1;
export const N_AT_BLOCK = 2;
export const N_AT_STATEMENT = 3;
export const N_COMMENT = 4;

type NodeType =
  | typeof N_ROOT
  | typeof N_RULE
  | typeof N_AT_BLOCK
  | typeof N_AT_STATEMENT
  | typeof N_COMMENT;

export const BAIL: unique symbol = Symbol("bail");

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
  type: NodeType;
  flags: number;
  parent: CssNode | null;
  nodes: Child[] | null;
  /** Start of the leading whitespace and comments. */
  before: number;
  start: number;
  end: number;
  /** Selector or params span. */
  textStart: number;
  textEnd: number;
  name: string;
  /** Comment-stripped selector or params, or the rewritten selector. */
  text: string | null;

  constructor(type: NodeType, parent: CssNode | null, before: number) {
    this.type = type;
    this.flags = parent !== null ? parent.flags & F_READ_DECLS : 0;
    this.parent = parent;
    this.nodes =
      type === N_ROOT || type === N_RULE || type === N_AT_BLOCK ? [] : null;
    this.before = before;
    this.start = before;
    this.end = before;
    this.textStart = 0;
    this.textEnd = 0;
    this.name = "";
    this.text = null;
  }

  private set(flag: number, on: boolean): void {
    this.flags = on ? this.flags | flag : this.flags & ~flag;
  }

  /** Has its own trailing `;`. */
  get semi(): boolean {
    return (this.flags & F_SEMI) !== 0;
  }
  set semi(on: boolean) {
    this.set(F_SEMI, on);
  }

  /** Container whose last child ends in `;`. */
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

  get rewritten(): boolean {
    return (this.flags & F_REWRITTEN) !== 0;
  }
  set rewritten(on: boolean) {
    this.set(F_REWRITTEN, on);
  }

  read(css: string): string {
    return this.text ?? css.slice(this.textStart, this.textEnd);
  }
}

export const D_SEMI = 1;
export const D_CUSTOM = 2;
export const D_REMOVED = 4;
/**
 * Comments follow the value before `}`: PostCSS reads them as comment
 * nodes.
 */
export const D_COMMENTS = 8;

export function grow(array: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>;
export function grow(array: Int32Array<ArrayBuffer>): Int32Array<ArrayBuffer>;
export function grow(
  array: Uint8Array<ArrayBuffer> | Int32Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> | Int32Array<ArrayBuffer> {
  const next =
    array instanceof Int32Array
      ? new Int32Array(array.length * 2)
      : new Uint8Array(array.length * 2);
  next.set(array);
  return next;
}

// A container's children. A leaf has none, so asking is a bug.
export function childrenOf(node: CssNode): Child[] {
  const { nodes } = node;
  if (nodes === null) throw new Error(`node type ${node.type} has no children`);
  return nodes;
}

export class Decls {
  start: Int32Array<ArrayBuffer>;
  propEnd: Int32Array<ArrayBuffer>;
  valueStart: Int32Array<ArrayBuffer>;
  valueEnd: Int32Array<ArrayBuffer>;
  end: Int32Array<ArrayBuffer>;
  flags: Uint8Array<ArrayBuffer>;
  /** Comment-stripped values, only for declarations that had comments. */
  text: Map<number, string> = new Map<number, string>();
  count = 0;
  /**
   * Start of each declaration's leading whitespace, as `CssNode#before`.
   * Only kept for a `decl` visitor, which is all that removes declarations.
   */
  before: Int32Array<ArrayBuffer> | null = null;
  /** Declarations a `decl` visitor removed. */
  removed = 0;

  constructor(capacity: number) {
    this.start = new Int32Array(capacity);
    this.propEnd = new Int32Array(capacity);
    this.valueStart = new Int32Array(capacity);
    this.valueEnd = new Int32Array(capacity);
    this.end = new Int32Array(capacity);
    this.flags = new Uint8Array(capacity);
  }

  push(
    start: number,
    propEnd: number,
    valueStart: number,
    valueEnd: number,
    end: number,
    flags: number,
  ): number {
    const i = this.count;
    if (i === this.start.length) {
      this.start = grow(this.start);
      this.propEnd = grow(this.propEnd);
      this.valueStart = grow(this.valueStart);
      this.valueEnd = grow(this.valueEnd);
      this.end = grow(this.end);
      this.flags = grow(this.flags);
    }
    this.start[i] = start;
    this.propEnd[i] = propEnd;
    this.valueStart[i] = valueStart;
    this.valueEnd[i] = valueEnd;
    this.end[i] = end;
    this.flags[i] = flags;
    this.count = i + 1;
    return i;
  }

  /** Records the leading whitespace of declaration `i`, the last pushed. */
  setBefore(i: number, before: number): void {
    let array = this.before;
    if (array === null) array = new Int32Array(this.start.length);
    else if (i === array.length) array = grow(array);
    array[i] = before;
    this.before = array;
  }
}
