import { cp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "@typescript/typescript6";
import { build } from "bun";

const root = resolve(import.meta.dir, "..");
const outDir = resolve(root, "dist");
const entry = resolve(root, "src/index.ts");

await rm(outDir, { recursive: true, force: true });

const result = await build({
  entrypoints: [entry],
  outdir: outDir,
  format: "esm",
  target: "browser",
  minify: true,
});
if (!result.success) {
  console.error(result.logs.join("\n"));
  process.exit(1);
}

// `src/index.ts` declares every public type, so its own declaration file
// is already self-contained.
const program = ts.createProgram([entry], {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  declaration: true,
  emitDeclarationOnly: true,
  types: [],
});
let dts = "";
const emitted = program.emit(program.getSourceFile(entry), (_, text) => {
  dts = text;
});
const errors = [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics];
if (errors.length > 0 || emitted.emitSkipped || /from "\./.test(dts)) {
  console.error(
    ts.formatDiagnostics(errors, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    }) || "index.d.ts must not import other source files",
  );
  process.exit(1);
}
await writeFile(resolve(outDir, "index.d.ts"), dts);

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
const main = "./index.js";
const types = "./index.d.ts";
await writeFile(
  resolve(outDir, "package.json"),
  `${JSON.stringify(
    {
      ...pkg,
      main,
      types,
      exports: { ".": { types, import: main, default: main } },
    },
    null,
    2,
  )}\n`,
);

console.log("✓ Build completed");
