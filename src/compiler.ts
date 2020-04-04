import * as svelte from "svelte/compiler";
import { Ast } from "svelte/types/compiler/interfaces";
import { ElementNode, CssNode } from "./get-classes";

export const compiler = (svelte as unknown) as typeof svelte & {
  walk(ast: Ast, tree: { leave: (node: ElementNode | CssNode) => void }): void;
};
