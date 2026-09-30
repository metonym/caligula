// Packs dist/, installs the tarball into a scratch project, and checks it
// the way a consumer would: Node ESM at runtime, TypeScript via `exports`.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { $ } from "bun";

const root = resolve(import.meta.dir, "..");
const dir = await mkdtemp(join(tmpdir(), "caligula-package-"));

try {
  await $`bun run build`.cwd(root).quiet();

  const bundle = await readFile(join(root, "dist/index.js"), "utf8");
  for (const pattern of [
    /\bnode:/,
    /\brequire\(/,
    /\bprocess\./,
    /\bBuffer\b/,
  ]) {
    if (pattern.test(bundle))
      throw new Error(`dist/index.js matches ${pattern}`);
  }

  const packed = await $`npm pack --pack-destination ${dir} --silent`
    .cwd(join(root, "dist"))
    .text();
  const tarball = join(dir, packed.trim());

  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "consumer", private: true, type: "module" }),
  );
  await $`npm install ${tarball} --no-audit --no-fund --silent`.cwd(dir);

  await writeFile(
    join(dir, "smoke.js"),
    `import assert from "node:assert/strict";
import { filterCss } from "caligula";

const css = ".a{color:red}\\n.b{color:blue}\\n.c, .d{margin:0}";
const result = filterCss(css, {
  rule: ({ selector }) =>
    selector === ".b" ? false : selector.includes(",") ? ".c" : undefined,
  map: { source: "app.css" },
});
assert.equal(result.css, ".a{color:red}\\n.c{margin:0}");
assert.equal(result.removed, 1);
assert.equal(result.skipped, false);
assert.deepEqual(result.map.sources, ["app.css"]);
assert.equal(filterCss(".a{").skipped, true);
`,
  );
  await $`node smoke.js`.cwd(dir);

  await writeFile(
    join(dir, "consumer.ts"),
    `import { type FilterOptions, type FilterResult, filterCss } from "caligula";

const options: FilterOptions = {
  readDecls: ["font-face"],
  rule: ({ selector }) => selector.startsWith(".keep") || false,
  atRule: (atRule) => {
    let weight = "";
    atRule.walkDecls((prop, value) => {
      if (prop === "font-weight") weight = value;
    });
    return atRule.name !== "font-face" || weight !== "300";
  },
  map: true,
};
const result: FilterResult = filterCss("", options);
const mappings: string | undefined = result.map?.mappings;
void mappings;

// @ts-expect-error: only filterCss and its types are exported
import { walkRules } from "caligula";
void walkRules;
`,
  );
  const tsc = join(root, "node_modules/.bin/tsc");
  await $`${tsc} --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck false consumer.ts`.cwd(
    dir,
  );

  console.log("✓ Package works in Node and type-checks for consumers");
} finally {
  await rm(dir, { recursive: true, force: true });
}
