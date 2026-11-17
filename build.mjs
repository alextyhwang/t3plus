// Builds the unpacked extension into dist/.
//   node build.mjs           one build
//   node build.mjs --watch   rebuild on change (reload the extension in chrome://extensions after)
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");

async function copyStatic() {
  await cp(join(root, "manifest.json"), join(dist, "manifest.json"));
  await cp(join(root, "src/styles/content.css"), join(dist, "content.css"));
  await cp(join(root, "assets"), join(dist, "assets"), { recursive: true });
  await cp(join(root, "icons"), join(dist, "icons"), { recursive: true, filter: (src) => !src.endsWith(".svg") });
}

const options = {
  entryPoints: {
    content: join(root, "src/content/index.js"),
    background: join(root, "src/background.js"),
  },
  outdir: dist,
  bundle: true,
  format: "iife",
  target: "chrome120",
  legalComments: "none",
  logLevel: "info",
};

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await copyStatic();
if (process.argv.includes("--watch")) {
  const ctx = await esbuild.context({
    ...options,
    plugins: [{ name: "static", setup: (build) => build.onEnd(() => copyStatic()) }],
  });
  await ctx.watch();
  console.log("t3+: watching for changes");
} else {
  await esbuild.build(options);
  console.log(`t3+: built ${dist}`);
}
