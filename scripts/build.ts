import { cp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "@typescript/typescript6";
import { build } from "bun";

const root = resolve(import.meta.dir, "..");
const outDir = resolve(root, "dist");
const entries = ["index", "selector"];
const entrypoints = entries.map((name) => resolve(root, `src/${name}.ts`));

await rm(outDir, { recursive: true, force: true });

const result = await build({
  entrypoints,
  outdir: outDir,
  format: "esm",
  target: "browser",
  minify: true,
});
if (!result.success) {
  console.error(result.logs.join("\n"));
  process.exit(1);
}

// `src/index.ts` declares every public type, so its declarations stand alone;
// `src/selector.ts` takes its types from there.
const program = ts.createProgram(entrypoints, {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  declaration: true,
  emitDeclarationOnly: true,
  types: [],
});
const dts = new Map<string, string>();
const emitted = program.emit(undefined, (file, text) => {
  dts.set(file.slice(file.lastIndexOf("/") + 1), text);
});
const imports = (file: string) =>
  [...(dts.get(file) ?? "").matchAll(/from "(\.[^"]*)"/g)].map((m) => m[1]);
const errors = [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics];
if (
  errors.length > 0 ||
  emitted.emitSkipped ||
  imports("index.d.ts").length > 0 ||
  imports("selector.d.ts").some((path) => path !== "./index.js")
) {
  console.error(
    ts.formatDiagnostics(errors, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    }) || "index.d.ts must stand alone, and selector.d.ts import only it",
  );
  process.exit(1);
}
await Promise.all(
  entries.map((name) =>
    writeFile(resolve(outDir, `${name}.d.ts`), dts.get(`${name}.d.ts`) ?? ""),
  ),
);

await Promise.all(
  ["README.md", "LICENSE"].map((file) =>
    cp(resolve(root, file), resolve(outDir, file)),
  ),
);

const manifest = await Bun.file(resolve(root, "package.json")).json();
const pkg = Object.fromEntries(
  Object.entries(manifest).filter(
    ([key]) => key !== "devDependencies" && key !== "scripts",
  ),
);
const exports = Object.fromEntries(
  entries.map((name) => {
    const js = `./${name}.js`;
    const types = `./${name}.d.ts`;
    return [
      name === "index" ? "." : `./${name}`,
      { types, import: js, default: js },
    ];
  }),
);
await writeFile(
  resolve(outDir, "package.json"),
  `${JSON.stringify(
    { ...pkg, main: "./index.js", types: "./index.d.ts", exports },
    null,
    2,
  )}\n`,
);

console.log("✓ Build completed");
