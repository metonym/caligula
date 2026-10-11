# Contributing

This guide covers how caligula is built, the rules every change must keep, and how to verify a change before it merges. Read it in full before changing anything under `src/`.

## Setup

[Bun](https://bun.sh/) is the package manager, test runner and bundler.

```sh
bun ci
bun run test          # unit, PostCSS parity, hostile inputs, fuzzer
bun run test:package  # build, pack, install, and use it as a consumer would
bun run typecheck
bun run lint          # biome; `bun run lint:fix` formats and applies fixes
bun run build         # dist/: minified ESM, index.d.ts, slimmed package.json
```

## How it works

`filterCss` runs four steps over offsets into the source string. No token objects, and no per-declaration nodes.

1. **Scan** (`src/scan.ts`). `Scanner#next()` reads one token and leaves its kind and `[from, to)` span on the scanner. It carries two pieces of state across the whole input that decide how a `(` is read (the `url(` lookbehind and the last unsafe paren span).
2. **Parse** (`src/parse.ts`). `Parser` works one statement at a time: the first token picks the kind (comment, at-rule, stray `;`, `}`, empty `{`, declaration or rule), then it records tokens up to the terminator and builds the node from that record. Rules, at-rules and comments become `CssNode`s (`src/tree.ts`). Declarations are rows in the struct-of-arrays `Decls` store and appear in their container's `nodes` as numbers. Anything the parser can't reproduce exactly, and every syntax error, throws `BAIL`.
3. **Visit** (`src/index.ts`, `Filter`). It walks in PostCSS's order (visitor, then children), then replays PostCSS's revisit loop: a rewritten rule, and the parent of a removed node, are marked dirty and walked again until nothing is dirty. Then it applies `postcss-discard-empty`'s container rule.
4. **Emit** (`src/emit.ts`). It copies kept source spans, skips removed nodes with their leading trivia, inserts rewritten selectors, and adds or drops `;` per the stringifier's rules. Every chunk goes through `copy`/`insert`, which is where `src/source-map.ts` gets its segments. `src/chars.ts` holds the shared character codes.

`src/selector.ts` is the `caligula/selector` entry: it splits and parses selectors into compounds, combinators and the classes each compound requires. `filterCss` uses it only when a `rule` visitor reads `parsed`, so a visitor that doesn't read it pays nothing. It reads selectors with a local index rather than the scanner, and is lenient: malformed input parses as well as it can, and never throws (except `parseSelector` given a list).

## Rules every change must keep

- **PostCSS parity is the contract.** For every input the parser doesn't bail on, the output and every string a visitor sees (selector, at-rule name and params, `walkDecls` prop and value) must equal what PostCSS produces with the same visitors plus `postcss-discard-empty`. Behavior that intentionally differs is listed in the README under "Deliberate differences" and asserted in `tests/parity.test.ts` (`BEHAVIOR_CHANGES`). Adding to that list needs a strong reason.
- **Bail rather than guess.** When the parser can't be sure of PostCSS's reading, it throws `BAIL` and the input passes through unchanged (`skipped: true`). Every PostCSS syntax error must bail. Bailing on ordinary CSS costs coverage: Bootstrap, Carbon and the modern-syntax cases must never bail.
- **Original code only.** Don't copy or translate code from PostCSS or any other CSS parser. Learn PostCSS's behavior by running it (`postcss.parse`, inspecting nodes and `raws`, `toString()`) and encode it as tests. This keeps the package free of third-party license notices.
- **No runtime dependencies and no Node APIs in `src/`.** The build targets browsers, Node, Bun and Deno alike. Dev-only code (`tests/`, `bench/`, `scripts/`) may use anything.
- **Keep the public API small.** `src/index.ts` exports `filterCss` and the types it uses (`FilterOptions`, `FilterResult`, `SourceMap`, and the parsed selector types), nothing else; `src/selector.ts` exports the selector functions. `src/index.ts` declares every public type, so `dist/index.d.ts` is that file's own declaration emit, and `dist/selector.d.ts` imports its types from it. New options must default to current behavior.

## Tests

| File | Covers |
|:---|:---|
| `tests/api.test.ts` | The public API contract: options, results, skipping, errors, map options |
| `tests/selector.test.ts` | `caligula/selector`: splitting, compounds and combinators, `:is`/`:not`/`:has`, escapes, malformed input, and a cross-check against a naive reading of the corpora |
| `tests/parity.test.ts` | Parity on the real stylesheets in `bench/corpora.ts` (plus no-op identity and source maps), hostile inputs (`HOSTILE`), deliberate differences, syntax errors |
| `tests/fuzz.test.ts` | The seeded differential fuzzer |
| `tests/helpers.ts` | The PostCSS reference, the visitor scenarios, and the source map checker |
| `scripts/test-package.ts` | `bun run test:package`: packs `dist/`, installs it into a scratch project, runs it in Node, and type-checks a consumer against the published types |

Parity cases compare output, `removed`, and the full log of visitor calls (including `walkDecls` values) across seven visitor scenarios, and check the source map of each.

- **A behavior fix needs a hostile case** that fails before the fix and passes after, in `HOSTILE` (or `HOSTILE_KEEP_EMPTY` when `postcss-discard-empty` would hide it).
- **Run the long fuzz before merging parser or visitor changes:**

  ```sh
  for s in $(seq 1 20); do FUZZ_SEED=$s FUZZ_RUNS=20000 bun test tests/fuzz.test.ts -t fuzz; done
  ```

  A mismatch prints the failing stylesheet and scenario. Shrink it by hand, add it to `HOSTILE`, fix, repeat.
- **Keep the fuzz summary healthy.** The default run prints `matched / syntax errors / skipped / known divergences`. `skipped` counts bails on valid CSS and should stay near 2 of 2,000.

## Performance

Changes to `src/` must not make things slower. The workloads live in `bench/workloads.ts`: every code path on four stylesheets, size scaling, and adversarial inputs aimed at slow paths. Each workload fails loudly if it silently takes the passthrough path.

| Command | Use |
|:---|:---|
| `bun run bench:ab` | **The regression check** (`ostia ab`). Runs `HEAD` (or `--base <ref>`) and the working tree alternately in one process, re-checks anything flagged in fresh processes, and fails on a confirmed regression over 10% or a geomean over 1.5%. Also lists workloads whose output changed, so tasks return `filterCss`'s result. Narrow with `--filter 'source map' --rounds 21`. |
| `bun run bench:ab:mem` | The memory regression check: `ostia ab --peak-mem` on the `memory:` workloads. Reads how far the first call raises RSS on both sides, median of 3 fresh processes each, and fails when it grows over 20% and 1 MiB. Back-to-back runs of identical code differ by up to ~11% on peak, hence 20%; `--alloc` on these inputs is noisier still, so check leaks with `bench:caligula --alloc`. |
| `bun run bench:caligula` | Per-workload numbers with ostia (`--filter` to narrow, `--alloc` for retained heap per call: a leak check, ~0 is correct) |
| `bun run bench:mem` | Peak memory (`--peak-mem`) of the `memory:` workloads: how far the first call raises RSS, median of 3 fresh processes, after warming the JIT on a 20 kB slice |
| `bun run bench:cold [src dir]` | First-call latency, fresh process per stylesheet |
| `bun run bench` | caligula vs PostCSS vs Lightning CSS (the README table) |

Commit first, then run `bun run bench:ab` against the commit before your change (`--base <ref>` for anything older than `HEAD`). Don't trust numbers from two runs minutes apart, including `ostia compare` on saved documents: machine load drifts too much.

Pitfalls seen before:
- **`for…of` allocates an iterator** before the JIT's top tier compiles the loop; use indexed loops in tree walks.
- **Reading the end of a string built with `+=` flattens it**, which makes a loop quadratic; track the last character separately.
- **Walking every ancestor per removal** costs removals × depth; stop at the first node already marked.
- **`String#repeat` returns a rope**; flatten test inputs before timing or measuring memory.
- **Profile one workload at a time.** `--cpu` samples every 100µs, about 2,000 samples per task:

  ```sh
  bun run bench:caligula --cpu --filter 'carbon.*remove most rules$' --export-json cpu.json
  bunx ostia report cpu.json --format collapsed
  ```

  Inlined helpers count as their callers' self time, so a helper missing from the profile is in its callers.
- **Module-scope work in the suite hides `--peak-mem` readings**: memory it freed gets reused by the measured call. `bench/caligula.bench.ts` skips `checkWorkload` when `OSTIA_PEAK_MEM` is set; keep new setup behind that gate too.

## Style

- Match the surrounding code: TypeScript, biome formatting, plain-sentence comments at a similar density. Comments say what the code does and why, not how it relates to PostCSS's source.
- Conventional commits, as in the history: `feat`, `fix`, `perf`, `refactor`, `bench`, `test`, `docs`, with `!` for breaking changes. Put measured numbers in the body of `perf:` commits.
- Update the README when behavior, options or benchmark numbers change.

## Before you finish

- [ ] `bun run lint`, `bun run typecheck`, `bun run test` and `bun run test:package` pass.
- [ ] Parser or visitor changes: the 20-seed long fuzz passes, and a hostile case covers the change.
- [ ] `src/` changes: `bun run bench:ab` and `bun run bench:ab:mem` show no confirmed regression.
- [ ] The README and this guide still describe what the code does.
