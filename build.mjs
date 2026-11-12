// Builds the unpacked extension into dist/.
//   node build.mjs           one build
//   node build.mjs --watch   rebuild on change (reload the extension in chrome://extensions after)
//   node build.mjs --public  release build: no feed folder, whatever t3plus.local.json says
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { DEFAULT_FEED_BASE, HOST_MATCHES, hostPermissionsFor } from "./src/hosts.js";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const watch = process.argv.includes("--watch");

/**
 * Where the optional JSON feeds live: T3PLUS_FEED_BASE, else "feedBase" in the
 * untracked t3plus.local.json, else the .invalid placeholder (no feeds).
 */
export async function resolveFeedBase() {
  // --public: the release build, which never carries anyone's feed folder.
  if (process.argv.includes("--public")) return DEFAULT_FEED_BASE;
  if (process.env.T3PLUS_FEED_BASE) return process.env.T3PLUS_FEED_BASE;
  try {
    const local = JSON.parse(await readFile(join(root, "t3plus.local.json"), "utf8"));
    if (typeof local.feedBase === "string" && /^https:\/\/[^/*]+\//.test(local.feedBase)) return local.feedBase;
  } catch {
    // no local file: no feeds
  }
  return DEFAULT_FEED_BASE;
}

/** Fills the host placeholders in manifest.base.json from src/hosts.js. */
export async function buildManifest({ feedBase } = {}) {
  const base = JSON.parse(await readFile(join(root, "manifest.base.json"), "utf8"));
  const permissions = hostPermissionsFor(feedBase ?? (await resolveFeedBase()));
  const lists = { __HOST_MATCHES__: HOST_MATCHES, __CONFIG_HOST_PERMISSIONS__: permissions };
  const fill = (list) => list.flatMap((entry) => (lists[entry] ? [...lists[entry]] : [entry]));
  for (const script of base.content_scripts) script.matches = fill(script.matches);
  for (const resource of base.web_accessible_resources) resource.matches = fill(resource.matches);
  base.host_permissions = fill(base.host_permissions);
  return base;
}

async function copyStatic() {
  await writeFile(join(dist, "manifest.json"), `${JSON.stringify(await buildManifest(), null, 2)}\n`);
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
  define: { __T3PLUS_FEED_BASE__: JSON.stringify(await resolveFeedBase()) },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await copyStatic();
  if (watch) {
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
}
