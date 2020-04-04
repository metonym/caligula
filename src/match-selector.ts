import { CLASS_SELECTOR, PSEUDO_CLASS } from "./constants";
import { From } from "./get-classes";

export type ClassesMap = Map<string, From>;

export function matchSelector(rule: CSSStyleRule, classes: ClassesMap, omitted_classes: string[]) {
  const { selectorText } = rule;

  if (!selectorText.includes(".")) return rule;

  const selector_classes: string[] = [];

  selectorText.match(CLASS_SELECTOR)?.forEach((selector, index, array) => {
    if (selector.startsWith(".")) {
      if (array[index + 1] && !array[index + 1].match(PSEUDO_CLASS)) {
        selector_classes.push(selector + array[index + 1]);
      } else {
        selector_classes.push(selector);
      }
    }
  });

  if (selector_classes !== undefined) {
    const hits = selector_classes.filter((selector) => classes.has(selector));

    if (hits.length > 0) return rule;

    omitted_classes.push(selectorText);

    return undefined;
  }

  return undefined;
}
