export interface CssNode {
  css?: {
    type: "Rule";
    children: {
      type: "Rule";
      selector: {
        type: "SelectorList";
        children: {
          children: [
            {
              type: "PseudoClassSelector";
              name: string;
              children: [{ value: string }];
            }
          ];
        }[];
      };
      block: { children: Array<unknown> };
    }[];
  };
}

export interface ElementNode {
  type: "Element";
  attributes: {
    type?: "Class";
    name?: "class";
    value: [{ raw: string }];
  }[];
}

export type From = "style" | "markup";

export function getClasses(node: ElementNode | CssNode, from: From) {
  if (from === "markup") {
    return (node as ElementNode).attributes
      .filter((attribute) => attribute.name === "class" || attribute.type === "Class")
      .map((attribute) => {
        if (attribute.name === "class") {
          return attribute.value[0].raw.split(" ");
        } else if (attribute.type === "Class") {
          return attribute.name;
        }
      })
      .flat();
  } else {
    return (node as CssNode)
      .css!.children.filter(
        (child) => child.type === "Rule" && child.selector.type === "SelectorList" && child.block.children.length > 0
      )
      .map((child) => {
        return child.selector.children
          .map((child) => {
            if (child.children[0].type === "PseudoClassSelector") {
              return child.children[0].children.map(({ value }) => value);
            }

            return child.children[0].name;
          })
          .flat();
      })
      .flat();
  }
}
