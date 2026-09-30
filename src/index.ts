import { Emitter } from "./emit";
import { Parser } from "./parse";
import { type SourceMap, SourceMapBuilder } from "./source-map";
import {
  BAIL,
  type Child,
  type CssNode,
  type Decls,
  N_AT_BLOCK,
  N_AT_STATEMENT,
  N_ROOT,
  N_RULE,
} from "./tree";

export type FilterOptions = {
  /** Return `false` to remove the rule, or a string to replace its selector. */
  rule?: (rule: { selector: string }) => boolean | string | undefined;
  /** Return `false` to remove the at-rule. */
  atRule?: (atRule: {
    name: string;
    params: string;
    /** Only for at-rules named in `readDecls`. */
    walkDecls(callback: (prop: string, value: string) => void): void;
  }) => boolean | undefined;
  /** At-rule names whose declarations `atRule` reads with `walkDecls`. */
  readDecls?: readonly string[];
  /** Drop rules and at-rules left empty, like `postcss-discard-empty`. Default `true`. */
  discardEmpty?: boolean;
  map?: boolean | { source?: string; includeContent?: boolean };
};

export type FilterResult = {
  css: string;
  /** The input was passed through unchanged: a syntax error, or input caligula can't reproduce exactly. */
  skipped: boolean;
  removed: number;
  map?: SourceMap;
};

class Filter {
  css: string;
  decls: Decls;
  options: FilterOptions;
  removed = 0;

  constructor(css: string, decls: Decls, options: FilterOptions) {
    this.css = css;
    this.decls = decls;
    this.options = options;
  }

  run(root: CssNode): void {
    if (this.options.rule || this.options.atRule) this.visit(root, true);
    while (root.dirty) {
      root.dirty = false;
      this.visit(root, false);
    }
    if (this.options.discardEmpty !== false) discardEmpty(root, this.css);
  }

  private visit(node: CssNode, all: boolean): void {
    if (node.type === N_RULE) this.visitRule(node);
    else if (node.type === N_AT_BLOCK || node.type === N_AT_STATEMENT) {
      this.visitAtRule(node);
    }
    const nodes = node.nodes;
    if (node.removed || nodes === null) return;
    for (let i = 0; i < nodes.length; i++) {
      const child = nodes[i];
      if (typeof child === "number" || child.removed) continue;
      if (all || child.dirty) {
        child.dirty = false;
        this.visit(child, all);
      }
    }
  }

  private visitRule(node: CssNode): void {
    const visitor = this.options.rule;
    if (!visitor) return;
    const selector = node.read(this.css);
    const result = visitor({ selector });
    if (result === false) {
      this.remove(node);
    } else if (typeof result === "string" && result !== selector) {
      node.selector = result;
      markDirty(node);
    }
  }

  private visitAtRule(node: CssNode): void {
    const visitor = this.options.atRule;
    if (!visitor) return;
    const { css, decls } = this;
    const result = visitor({
      name: node.name,
      params: node.read(css),
      walkDecls(callback) {
        if (!node.readDecls) {
          throw new Error(`walkDecls: add "${node.name}" to readDecls`);
        }
        if (node.nodes !== null) walkDecls(node.nodes, css, decls, callback);
      },
    });
    if (result === false) this.remove(node);
  }

  private remove(node: CssNode): void {
    node.removed = true;
    this.removed++;
    markDirty(node.parent);
  }
}

function walkDecls(
  nodes: Child[],
  css: string,
  decls: Decls,
  callback: (prop: string, value: string) => void,
): void {
  for (let i = 0; i < nodes.length; i++) {
    const child = nodes[i];
    if (typeof child === "number") {
      callback(
        css.slice(decls.start[child], decls.propEnd[child]),
        decls.clean.get(child) ?? css.slice(decls.a[child], decls.b[child]),
      );
    } else if (!child.removed && child.nodes !== null) {
      walkDecls(child.nodes, css, decls, callback);
    }
  }
}

// Stops at a dirty ancestor: the walk only climbs through nodes being
// visited now, which were cleared on entry, so that one's chain is marked.
function markDirty(node: CssNode | null): void {
  for (let n = node; n !== null && !n.dirty; n = n.parent) n.dirty = true;
}

function discardEmpty(node: CssNode, css: string): void {
  if (node.selector === "") {
    node.removed = true;
    return;
  }
  const nodes = node.nodes;
  if (nodes === null) return;
  let kept = 0;
  for (let i = 0; i < nodes.length; i++) {
    const child = nodes[i];
    if (typeof child !== "number") {
      if (child.removed) continue;
      discardEmpty(child, css);
      if (child.removed) continue;
    }
    kept++;
  }
  const namedLayer =
    node.type === N_AT_BLOCK &&
    node.name === "layer" &&
    node.read(css).trim() !== "";
  if (kept === 0 && node.type !== N_ROOT && !namedLayer) node.removed = true;
}

/**
 * Removes rules and at-rules, or rewrites selectors, with output identical to
 * the same visitors run as a PostCSS plugin plus `postcss-discard-empty`.
 */
export function filterCss(
  css: string,
  options: FilterOptions = {},
): FilterResult {
  const parser = new Parser(
    css,
    options.readDecls && new Set(options.readDecls.map((n) => n.toLowerCase())),
  );
  let root: CssNode;
  try {
    root = parser.parse();
  } catch (error) {
    if (error !== BAIL) throw error;
    return { css, skipped: true, removed: 0 };
  }

  const filter = new Filter(css, parser.decls, options);
  filter.run(root);

  const { map } = options;
  const builder = map ? new SourceMapBuilder(css) : null;
  const result: FilterResult = {
    css: new Emitter(css, parser.decls, builder).emit(root),
    skipped: false,
    removed: filter.removed,
  };
  if (builder) {
    const { source = "input.css", includeContent = true } =
      map === true ? {} : map || {};
    result.map = builder.toJSON(source, includeContent ? css : undefined);
  }
  return result;
}
