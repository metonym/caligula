# Changelog

## 0.4.0 — 2026-11-14

**Features**

- Add a `decl` visitor. Return `false` to remove a declaration, with its leading whitespace, as `decl.remove()` would. It's called for every declaration in a kept rule or at-rule, after that container's visitor, and `removed` counts the declarations it removes. Values are only read for every declaration when `decl` is set.

**Fixes**

- Terminate a custom property after a stray semicolon, as postcss 8.5.29 does.
- Drop an empty `@layer` whose order is already fixed, as postcss-discard-empty 9.0.8 does.

## 0.3.0 — 2026-10-11

**Features**

- Add a `caligula/selector` entry: `splitSelectorList`, `parseSelector`, `parseSelectorList`, and `requiredClasses`. They split a selector list and report the classes each compound requires, including those every branch of an `:is()` or `:where()` needs, so a consumer can decide what to keep without a parser of their own.
- `rule` receives `parsed`, that selector list from `parseSelectorList`, computed the first time it's read. A visitor that never reads `parsed` doesn't pay for it.
