# Changelog

## 0.3.0 — 2026-10-11

**Features**

- Add a `caligula/selector` entry: `splitSelectorList`, `parseSelector`, `parseSelectorList`, and `requiredClasses`. They split a selector list and report the classes each compound requires, including those every branch of an `:is()` or `:where()` needs, so a consumer can decide what to keep without a parser of their own.
- `rule` receives `parsed`, that selector list from `parseSelectorList`, computed the first time it's read. A visitor that never reads `parsed` doesn't pay for it.
