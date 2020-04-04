import { parse } from "cssom";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname, basename } from "path";
import { green, bold, red } from "chalk";
import * as fg from "fast-glob";
import { prefixClassName, getFileSize, getHash, getPercDiff, log } from "./utils";
import { getClasses, CssNode, ElementNode } from "./get-classes";
import { matchSelector, ClassesMap } from "./match-selector";
import { compiler } from "./compiler";
import { DEFAULT_INCLUDE } from "./constants";
import { minifier } from "./minifier";

interface CaligulaOptions {
  input?: string;
  output?: string;
  include?: string[];
  hash?: boolean;
  minifyOptions?: any; // cssnano options
  onMinify?: (css: string) => string;
}

interface DefaultCaligulaOptions {
  input: undefined;
  output: undefined;
  include: typeof DEFAULT_INCLUDE;
  hash: true;
  minifyOptions: { from: undefined };
  onMinify?: (css: string) => string;
}

export async function caligula(opts?: CaligulaOptions) {
  let options: DefaultCaligulaOptions = {
    input: undefined,
    output: undefined,
    include: DEFAULT_INCLUDE,
    hash: true,
    minifyOptions: { from: undefined },
    onMinify: undefined,
  };

  if (opts !== undefined) {
    options = { ...options, ...opts } as DefaultCaligulaOptions;
  }

  if (options.input === undefined) {
    throw Error("input is required.");
  }

  const files = await fg(options.include, { ignore: ["**/node_modules/**"] });
  const classes: ClassesMap = new Map();

  files.forEach((file) => {
    const source = readFileSync(file).toString();
    const ast = compiler.parse(source);

    compiler.walk(ast, {
      leave(node) {
        if ((node as CssNode).css !== undefined) {
          getClasses(node, "style").forEach((name) => {
            classes.set(prefixClassName(name), "style");
          });
        }

        if ((node as ElementNode).type === "Element") {
          getClasses(node, "markup").forEach((name) => {
            classes.set(prefixClassName(name), "markup");
          });
        }
      },
    });
  });

  const path = options.output! || options.input!;
  const out_dir = dirname(path);
  const stylesheet_name = basename(path);
  const stylesheet = readFileSync(options.input!).toString();
  const stylesheet_size = getFileSize(stylesheet);
  const stylesheet_ast = parse(stylesheet);
  const omitted_classes: string[] = [];

  stylesheet_ast.cssRules = stylesheet_ast.cssRules.filter((rule) => {
    if (rule.type === 1) {
      return matchSelector(rule as CSSStyleRule, classes, omitted_classes);
    } else if (rule.type === 4) {
      // @ts-ignore
      return (rule as CSSMediaRule).cssRules.forEach((rule) => {
        matchSelector(rule, classes, omitted_classes);
      });
    }

    return rule;
  });

  log(
    `Detected ${bold(classes.size + " class")}${bold(classes.size === 1 ? "" : "es")} from ${
      files.length
    } Svelte component${files.length === 1 ? "" : "s"}`
  );

  log(
    `Removed ${bold(omitted_classes.length + " class")}${bold(omitted_classes.length === 1 ? "" : "es")} from "${
      options.input
    }"`
  );

  const processed_rules = stylesheet_ast.toString();
  const minified = await minifier(processed_rules, options.minifyOptions);

  let minified_rules = minified.css;

  if (options.onMinify) {
    minified_rules = options.onMinify(minified_rules);
  }

  const minified_size = getFileSize(minified_rules);
  const diff_size = getPercDiff(stylesheet_size.raw, minified_size.raw);

  log(`${bold("Original size")}: ${red(`${bold(stylesheet_size.value)} ${stylesheet_size.unit}`)}`);
  log(`${bold("New size")}: ${green(`${bold(minified_size.value)} ${minified_size.unit}`)}`);
  log(`> ${bold(diff_size.value)} ${diff_size.unit} (${green(bold(diff_size.perc.toFixed(1) + "%"))}) smaller!`);

  const minified_stylesheet_name = [
    stylesheet_name.replace(/\.css/g, ""),
    options.hash ? getHash(minified_rules) : undefined,
    "css",
  ]
    .filter(Boolean)
    .join(".");

  const output_path = join(out_dir, minified_stylesheet_name);

  writeFileSync(output_path, minified_rules);
  log(`> Saved output to "${bold(output_path)}"`);
}
