import { existsSync, watch } from "node:fs";
import { cp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { $, build } from "bun";
import { bundleDts } from "./bundle-dts";

const STRIP_PKG_FIELDS = new Set(["devDependencies", "scripts"]);
const DIST_PREFIX = /^\.\/dist\//;

const isWatchMode =
  process.argv.includes("-w") || process.argv.includes("--watch");
const root = process.cwd();
const outDir = resolve(root, "dist");

await $`rm -rf ${outDir}; mkdir ${outDir}`;

await Promise.all(
  ["README.md", "LICENSE", "package.json"].map(async (asset) => {
    const path = resolve(root, asset);
    if (existsSync(path)) {
      await cp(path, resolve(outDir, asset));
    }
  }),
);

async function emitTypeDeclarations() {
  try {
    await bundleDts({
      root,
      source: resolve(root, "src/index.ts"),
      outFile: resolve(outDir, "index.d.ts"),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    if (!isWatchMode) {
      process.exit(1);
    }
  }
}

async function slimPackageManifest() {
  const manifestPath = resolve(outDir, "package.json");
  const pkg = await Bun.file(manifestPath).json();

  for (const key of STRIP_PKG_FIELDS) {
    delete pkg[key];
  }

  pkg.main = pkg.main.replace(DIST_PREFIX, "./");
  pkg.types = pkg.types.replace(DIST_PREFIX, "./");
  const exports = {
    ".": { types: pkg.types, import: pkg.main, default: pkg.main },
  };

  const ordered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(pkg)) {
    ordered[key] = value;
    if (key === "types") ordered.exports = exports;
  }

  await writeFile(manifestPath, `${JSON.stringify(ordered, null, 2)}\n`);
}

async function buildProject() {
  const result = await build({
    entrypoints: ["./src/index.ts"],
    outdir: outDir,
    format: "esm",
    target: "browser",
    minify: true,
  });

  if (!result.success) {
    console.error("Build failed");
    for (const log of result.logs) {
      console.error(log);
    }
    if (!isWatchMode) {
      process.exit(1);
    }
    return;
  }

  await emitTypeDeclarations();
  await slimPackageManifest();
  console.log("✓ Build completed");
}

if (isWatchMode) {
  console.log("Watching for changes...\n");

  await buildProject();

  let debounceTimer: Timer | null = null;
  let isBuilding = false;

  const watcher = watch(
    "./src",
    { recursive: true },
    (_eventType, filename) => {
      if (filename && !isBuilding) {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(async () => {
          console.log(`\nFile changed: ${filename}`);
          isBuilding = true;
          await buildProject();
          isBuilding = false;
        }, 100);
      }
    },
  );

  setInterval(() => {}, 1000);

  process.on("SIGINT", () => {
    console.log("\nStopping watch mode...");
    watcher.close();
    process.exit(0);
  });
} else {
  await buildProject();
}
