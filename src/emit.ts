import { CR, FF, LF, SPACE, TAB } from "./chars";
import type { SourceMapBuilder } from "./source-map";
import {
  type Child,
  type CssNode,
  D_COMMENTS,
  D_CUSTOM,
  D_REMOVED,
  D_SEMI,
  type Decls,
  N_AT_BLOCK,
  N_AT_STATEMENT,
  N_COMMENT,
  N_ROOT,
  N_RULE,
} from "./tree";

export class Emitter {
  private css: string;
  private decls: Decls;
  private map: SourceMapBuilder | null;
  private out: string[] = [];
  private cursor = 0;

  constructor(css: string, decls: Decls, map: SourceMapBuilder | null) {
    this.css = css;
    this.decls = decls;
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
    const declsRemoved = decls.removed > 0;
    let keptCount = 0;
    let last = -1;
    for (let k = 0; k < nodes.length; k++) {
      const node = nodes[k];
      if (typeof node === "number") {
        if (declsRemoved && (decls.flags[node] & D_REMOVED) !== 0) {
          // Its trailing comments stay, as nodes that end the container.
          if ((decls.flags[node] & D_COMMENTS) !== 0) keptCount++;
          continue;
        }
        last = keptCount;
      } else {
        if (node.removed) continue;
        if (node.type !== N_COMMENT) last = keptCount;
      }
      keptCount++;
    }

    // The first root node's leading whitespace passes to its successor.
    let inheritFrom = -1;
    let inheritTo = -1;
    if (container.type === N_ROOT && nodes.length > 1) {
      const first = nodes[0];
      if (typeof first !== "number") {
        if (first.removed) {
          inheritFrom = first.before;
          inheritTo = first.start;
        }
      } else if (declsRemoved && (decls.flags[first] & D_REMOVED) !== 0) {
        inheritFrom = (decls.before as Int32Array)[first];
        inheritTo = decls.start[first];
      }
    }

    let i = 0;
    for (let k = 0; k < nodes.length; k++) {
      const node = nodes[k];
      if (typeof node === "number") {
        if (declsRemoved && (decls.flags[node] & D_REMOVED) !== 0) {
          // A comment after it that becomes the root's first node inherits
          // the first node's leading whitespace in place of its own.
          if (i !== 0 || container.type !== N_ROOT) {
            this.skipDecl(node, -1, -1);
          } else if (k === 0) {
            const before = decls.before as Int32Array;
            this.skipDecl(node, before[node], decls.start[node]);
          } else {
            this.skipDecl(node, inheritFrom, inheritTo);
          }
          continue;
        }
      } else if (node.removed) {
        this.flush(node.before);
        this.cursor =
          node.semi && node.type !== N_RULE ? node.end + 1 : node.end;
        continue;
      }

      if (inheritFrom !== -1 && i === 0) {
        this.copy(inheritFrom, inheritTo);
        this.cursor = typeof node === "number" ? decls.start[node] : node.start;
      }
      const semicolon = i !== last || container.semicolon;
      const hasNext = i < keptCount - 1;

      if (typeof node === "number") {
        const flags = decls.flags[node];
        // A custom property keeps its `;` before a following node.
        const forced = (flags & D_CUSTOM) !== 0;
        this.semicolon(
          decls.end[node],
          (flags & D_SEMI) !== 0,
          semicolon || (forced && hasNext),
        );
      } else if (node.type === N_RULE) {
        if (node.rewritten) {
          this.flush(node.textStart);
          this.insert(node.text as string, node.textStart);
          this.cursor = node.textEnd;
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

  /**
   * Skips removed declaration `i` and its leading whitespace. Trailing
   * comments it had get the whitespace in `[from, to)` instead of their own,
   * unless `from` is -1.
   */
  private skipDecl(i: number, from: number, to: number): void {
    const decls = this.decls;
    const flags = decls.flags[i];
    this.flush((decls.before as Int32Array)[i]);
    if (from !== -1 && (flags & D_COMMENTS) !== 0) {
      this.copy(from, to);
      this.cursor = skipSpace(this.css, decls.end[i]);
    } else {
      this.cursor = decls.end[i] + ((flags & D_SEMI) !== 0 ? 1 : 0);
    }
  }

  private semicolon(end: number, has: boolean, wanted: boolean): void {
    if (has === wanted) return;
    this.flush(end);
    if (wanted) this.insert(";", end);
    else this.cursor = end + 1;
  }
}

function skipSpace(css: string, from: number): number {
  let i = from;
  for (; i < css.length; i++) {
    const c = css.charCodeAt(i);
    if (c !== SPACE && c !== TAB && c !== LF && c !== CR && c !== FF) {
      break;
    }
  }
  return i;
}
