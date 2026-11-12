// Export a filtered snapshot with public/main as its only parent. Never push
// private branches or private commit subjects to the public repository.
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isPublicPath, needsVisualReview, parseDenyPatterns, privateDetailLocations } from "./publish-policy.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function git(cwd, args, { input, env, raw = false } = {}) {
  const result = spawnSync("git", args, { cwd, input, env: { ...process.env, ...env }, encoding: raw ? "buffer" : "utf8", maxBuffer: 64 << 20 });
  // stderr may contain remote URLs or private values. Keep failures bounded.
  if (result.status !== 0) throw new Error(`git ${args[0]} failed (exit ${result.status ?? "spawn"}).`);
  return raw ? result.stdout : result.stdout.trim();
}

/** Create a Git tree containing only public paths, without changing the checkout. */
export async function publicSnapshot(cwd, ref) {
  const entries = git(cwd, ["ls-tree", "-rz", "--full-tree", ref], { raw: true }).toString("utf8").split("\0").filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf("\t");
      const [mode, type, hash] = entry.slice(0, tab).split(" ");
      return { mode, type, hash, path: entry.slice(tab + 1) };
    }).filter((entry) => isPublicPath(entry.path));
  if (!entries.length) throw new Error("Public snapshot would be empty.");
  if (entries.some((entry) => entry.type !== "blob" || !["100644", "100755"].includes(entry.mode))) {
    throw new Error("Public paths must be regular files; symlinks and submodules are not exported.");
  }
  const work = await mkdtemp(join(tmpdir(), "t3plus-index-"));
  try {
    const env = { GIT_INDEX_FILE: join(work, "index") };
    git(cwd, ["read-tree", "--empty"], { env });
    const input = entries.map(({ mode, type, hash, path }) => `${mode} ${type} ${hash}\t${path}\0`).join("");
    git(cwd, ["update-index", "-z", "--index-info"], { env, input });
    return { tree: git(cwd, ["write-tree"], { env }), entries };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function publishPublic({ cwd = root, ref, push = false, imagesChecked = false, message, denyText, log = console.log } = {}) {
  // An explicit ref is already present (Actions checks out the triggering SHA).
  // Do not fetch a newer main and accidentally publish a different commit.
  if (!ref) git(cwd, ["fetch", "-q", "origin"]);
  const src = git(cwd, ["rev-parse", "--verify", `${ref ?? "origin/main"}^{commit}`]);
  const { tree, entries } = await publicSnapshot(cwd, src);
  const version = JSON.parse(git(cwd, ["show", `${src}:package.json`])).version;
  const commitMessage = message ?? `t3+ ${version}`;
  const deny = parseDenyPatterns(denyText ?? process.env.PUBLISH_DENY ?? await readFile(join(cwd, ".publish-deny"), "utf8"));
  const problems = privateDetailLocations("(commit message)", commitMessage, deny);
  const blobs = new Map();
  for (const entry of entries) {
    const pathProblems = privateDetailLocations("(path)", entry.path, deny);
    problems.push(...pathProblems);
    const blob = git(cwd, ["cat-file", "blob", entry.hash], { raw: true });
    blobs.set(entry.path, blob);
    if (!blob.includes(0)) problems.push(...privateDetailLocations(pathProblems.length ? "(private path)" : entry.path, blob.toString("utf8"), deny));
  }
  if (problems.length) throw new Error(`Private details found; nothing was pushed. Review: ${problems.join(", ")}`);

  git(cwd, ["fetch", "-q", "public"]);
  const previous = git(cwd, ["rev-parse", "--verify", "public/main^{commit}"]);
  const changed = git(cwd, ["diff", "--name-only", "--no-renames", "-z", `${previous}^{tree}`, tree], { raw: true })
    .toString("utf8").split("\0").filter(Boolean);
  const unreviewed = changed.filter((path) => blobs.has(path) && needsVisualReview(path, blobs.get(path)));
  if (unreviewed.length && !imagesChecked) throw new Error(`Changed images/binaries need visual review, then --images-checked: ${unreviewed.join(", ")}`);
  log(`${entries.length} public files checked; ${changed.length} changed file(s). Private paths and history are excluded.`);
  if (!push || !changed.length) {
    log(push ? "Public main already matches." : "Dry run. Add --push to publish.");
    return { tree, changed, head: previous };
  }
  const head = git(cwd, ["commit-tree", tree, "-p", previous, "-F", "-"], { input: commitMessage });
  // A normal push rejects races with another publisher; never force the mirror.
  git(cwd, ["push", "-q", "public", `${head}:refs/heads/main`]);
  log("Public snapshot pushed. Its Release workflow builds the public download.");
  return { tree, changed, head };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  try {
    await publishPublic({ ref: option("--ref"), push: args.includes("--push"), imagesChecked: args.includes("--images-checked"), message: option("-m") });
    if (args.includes("--release")) console.log("--release is now handled automatically by GitHub Actions after publishing.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
