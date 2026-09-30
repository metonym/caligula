import type { SourceMapBuilder } from "./source-map";
import {
  type Child,
  type CssNode,
  D_AFTER_SEMI,
  D_CUSTOM,
  D_SEMI,
  type Decls,
  N_AT_BLOCK,
  N_AT_STATEMENT,
  N_COMMENT,
  N_ROOT,
  N_RULE,
} from "./tree";

const SEMICOLON = 0x3b;

export class Emitter {
  css: string;
  decls: Decls;
  out: string[];
  cursor: number;
  map: SourceMapBuilder | null;

  constructor(css: string, decls: Decls, map: SourceMapBuilder | null) {
    this.css = css;
    this.decls = decls;
    this.out = [];
    this.cursor = 0;
    this.map = map;
  }

  private copy(from: number, to: number): void {
    this.out.push(this.css.slice(from, to));
    this.map?.copy(this.css, from, to);
  }

  private insert(text: string, origin: number): void {
    this.out.push(text);
    this.map?.insert(text, origin);
  }

  private flush(to: number): void {
    if (to > this.cursor) this.copy(this.cursor, to);
    this.cursor = to;
  }

  emit(root: CssNode): string {
    this.body(root);
    this.flush(this.css.length);
    return this.out.join("");
  }

  private body(container: CssNode): void {
    const nodes = container.nodes as Child[];
    const decls = this.decls;
    let keptCount = 0;
    let last = -1;
    for (let k = 0; k < nodes.length; k++) {
      const node = nodes[k];
      if (typeof node === "number") {
        last = keptCount;
      } else {
        if (node.removed) continue;
        if (node.type !== N_COMMENT) last = keptCount;
      }
      keptCount++;
    }

    const first = nodes[0];
    const inherited =
      container.type === N_ROOT &&
      nodes.length > 1 &&
      typeof first !== "number" &&
      first.removed
        ? first
        : null;

    let i = 0;
    for (let k = 0; k < nodes.length; k++) {
      const node = nodes[k];
      if (typeof node !== "number" && node.removed) {
        this.flush(node.before);
        this.cursor =
          node.semi && node.type !== N_RULE ? node.end + 1 : node.end;
        continue;
      }

      // PostCSS hands a removed first root node's leading whitespace to the
      // node that takes its place.
      const inherits = inherited !== null && i === 0;
      if (inherits) {
        this.copy(inherited.before, inherited.start);
        this.cursor = typeof node === "number" ? decls.start[node] : node.start;
      }
      const semicolon = i !== last || container.semicolon;
      const hasNext = i < keptCount - 1;

      if (typeof node === "number") {
        const flags = decls.flags[node];
        // A custom property keeps its `;` before a comment unless the text
        // before it ends with a stray `;`.
        const afterSemi = inherits
          ? inherited.start > inherited.before &&
            this.css.charCodeAt(inherited.start - 1) === SEMICOLON
          : (flags & D_AFTER_SEMI) !== 0;
        const forced = (flags & D_CUSTOM) !== 0 && !afterSemi;
        this.semicolon(
          decls.end[node],
          (flags & D_SEMI) !== 0,
          semicolon || (forced && hasNext),
        );
      } else if (node.type === N_RULE) {
        if (node.selector !== null) {
          this.flush(node.a);
          this.insert(node.selector, node.a);
          this.cursor = node.b;
        }
        this.body(node);
      } else if (node.type === N_AT_BLOCK) {
        this.body(node);
      } else if (node.type === N_AT_STATEMENT) {
        this.semicolon(node.end, node.semi, semicolon || hasNext);
      }
      i++;
    }
  }

  private semicolon(end: number, has: boolean, wanted: boolean): void {
    if (has === wanted) return;
    this.flush(end);
    if (wanted) this.insert(";", end);
    else this.cursor = end + 1;
  }
}
