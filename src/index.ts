import { Emitter } from "./emit";
import { Parser } from "./parse";
import { SourceMapBuilder } from "./source-map";
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

export type SourceMap = {
  version: 3;
  sources: string[];
  sourcesContent?: string[];
  names: string[];
  mappings: string;
};

export type FilterResult = {
  css: string;
  /** The input was returned unchanged: a syntax error, or CSS caligula can't reproduce exactly. */
  skipped: boolean;
  removed: number;
  map?: SourceMap;
};

class Filter {
  removed = 0;
  private css: string;
  private decls: Decls;
  private options: FilterOptions;

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
      node.text = result;
      node.rewritten = true;
      markDirty(node);
    }
  }

  private visitAtRule(node: CssNode): void {
    const visitor = this.options.atRule;
    if (!visitor) return;
    const result = visitor({
      name: node.name,
      params: node.read(this.css),
      walkDecls: (callback) => {
        if (!node.readDecls) {
          throw new Error(`walkDecls: add "${node.name}" to readDecls`);
        }
        if (node.nodes !== null) this.walkDecls(node.nodes, callback);
      },
    });
    if (result === false) this.remove(node);
  }

  private walkDecls(
    nodes: Child[],
    callback: (prop: string, value: string) => void,
  ): void {
    const { css, decls } = this;
    for (let i = 0; i < nodes.length; i++) {
      const child = nodes[i];
      if (typeof child === "number") {
        callback(
          css.slice(decls.start[child], decls.propEnd[child]),
          decls.text.get(child) ??
            css.slice(decls.valueStart[child], decls.valueEnd[child]),
        );
      } else if (!child.removed && child.nodes !== null) {
        this.walkDecls(child.nodes, callback);
      }
    }
  }

  private remove(node: CssNode): void {
    node.removed = true;
    this.removed++;
    markDirty(node.parent);
  }
}

// A dirty ancestor means its own chain is already marked.
function markDirty(node: CssNode | null): void {
  for (let n = node; n !== null && !n.dirty; n = n.parent) n.dirty = true;
}

function discardEmpty(node: CssNode, css: string): void {
  if (node.rewritten && node.text === "") {
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
      typeof map === "object" ? map : {};
    result.map = {
      version: 3,
      sources: [source],
      ...(includeContent && { sourcesContent: [css] }),
      names: [],
      mappings: builder.mappings(),
    };
  }
  return result;
}
