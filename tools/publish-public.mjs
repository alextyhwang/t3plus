// Mirrors the private repo to the public one.
//
// This checkout's `origin` is the private repo (full history, day-to-day work);
// `public` is the public repo, which has its own short history. Publishing copies
// the files of a private commit (default: origin/main) onto public/main as ONE
// new commit, so private history, branches and pull requests never leave.
//
//   npm run publish:public                      dry run: what would change, checks
//   npm run publish:public -- --push            commit and push to public/main
//   npm run publish:public -- --push --release  ...and create the GitHub release for
//                                               package.json's version if it is missing
// Options: --ref <commit> (default origin/main), -m "<message>",
//          --images-checked (required when images or other binary files changed:
//          a scan can't read them, so look at each one first).
//
// Before anything is pushed, every text file and the commit message are checked
// against the patterns in .publish-deny (untracked: one case-insensitive regex per
// line, for names, hosts and paths that must stay private) and a few built-in
// checks (Windows user paths, e-mail addresses, local config files).
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeZip } from "./zip.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function run(cmd, cmdArgs, { input, allowFail = false, raw = false } = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: root, input, encoding: raw ? "buffer" : "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`${cmd} ${cmdArgs.join(" ")} failed:\n${r.stderr?.toString() ?? ""}`);
  }
  return raw ? r.stdout : (r.stdout ?? "").trim();
}
const git = (...a) => run("git", a);
const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

// ---- What to publish ----
git("fetch", "-q", "origin");
git("fetch", "-q", "public");
const ref = option("--ref") ?? "origin/main";
const src = git("rev-parse", "--verify", `${ref}^{commit}`);
const srcTree = git("rev-parse", `${src}^{tree}`);
const pub = git("rev-parse", "--verify", "public/main^{commit}");
const pubTree = git("rev-parse", `${pub}^{tree}`);
const repo = git("remote", "get-url", "public").match(/github\.com[/:]([^/]+\/[^/.]+)/)?.[1];
if (!repo) fail("`public` is not a GitHub remote.");

// The newest private commit already published (same files as public/main).
const recent = git("rev-list", "--max-count=1000", src).split("\n");
const base = recent.find((c) => git("rev-parse", `${c}^{tree}`) === pubTree);
const subjects = base ? git("log", "--no-merges", "--format=%s", `${base}..${src}`).split("\n").filter(Boolean) : [];
const changed = srcTree === pubTree ? [] : git("diff", "--name-status", pubTree, srcTree).split("\n").filter(Boolean);
const version = JSON.parse(git("show", `${src}:package.json`)).version;

console.log(`private ${ref} ${src.slice(0, 7)} -> public ${repo} main ${pub.slice(0, 7)}`);
console.log(base ? `last published private commit: ${base.slice(0, 7)}` : "last published private commit: not found in the last 1000 commits");
console.log(changed.length ? `\n${changed.length} changed file(s):\n  ${changed.join("\n  ")}` : "\nNo file changes: public/main already matches.");

// ---- Checks ----
const message = option("-m") ?? `t3+ ${version}${subjects.length ? `\n\n${subjects.map((s) => `- ${s}`).join("\n")}` : ""}`;
let denyText = "";
try {
  denyText = await readFile(join(root, ".publish-deny"), "utf8");
} catch {
  fail("Missing .publish-deny (untracked). Add one regex per line for names, hosts and paths that must stay private.");
}
const deny = denyText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => new RegExp(l, "i"));
const builtIn = [
  { why: "a Windows user path", re: /\b[a-z]:[\\/]+users[\\/]+(?!me\b|you\b)[a-z0-9._-]+/i },
  { why: "an e-mail address", re: /[a-z0-9._%+-]+@(?!users\.noreply\.github\.com)[a-z0-9-]+\.[a-z0-9.-]*[a-z]{2,}/i },
];
const problems = [];
const check = (where, text) => {
  text.split(/\r?\n/).forEach((line, i) => {
    for (const re of deny) if (re.test(line)) problems.push(`${where}:${i + 1}  matches /${re.source}/  ${line.trim().slice(0, 120)}`);
    for (const { why, re } of builtIn) if (re.test(line)) problems.push(`${where}:${i + 1}  ${why}  ${line.trim().slice(0, 120)}`);
  });
};
const files = git("ls-tree", "-r", "--name-only", src).split("\n").filter(Boolean);
for (const f of files) {
  if (/(^|\/)(t3plus\.local\.json|config\.local\.json|\.publish-deny)$/.test(f)) problems.push(`${f}  local-only file is committed`);
}
const binaryChanged = [];
const changedPaths = new Set(changed.map((l) => l.split("\t").pop()));
for (const f of files) {
  const blob = run("git", ["show", `${src}:${f}`], { raw: true });
  if (blob.includes(0)) {
    if (changedPaths.has(f)) binaryChanged.push(f);
    continue;
  }
  check(f, blob.toString("utf8"));
}
check("(commit message)", message);
if (problems.length) fail(`Private details found; nothing was pushed:\n  ${problems.join("\n  ")}`);
console.log("\n✓ No private details found in text files or the message.");
if (binaryChanged.length && !flag("--images-checked")) {
  fail(`Binary files changed; a scan can't read them. Look at each, then rerun with --images-checked:\n  ${binaryChanged.join("\n  ")}`);
}
console.log(`\nCommit message:\n${message.replace(/^/gm, "  ")}`);

if (!flag("--push")) {
  console.log("\nDry run. Add --push to publish (and --release to cut the release).");
  process.exit(0);
}

// ---- Publish ----
let head = pub;
if (changed.length) {
  head = run("git", ["commit-tree", srcTree, "-p", pub, "-F", "-"], { input: message });
  git("push", "-q", "public", `${head}:refs/heads/main`);
  git("fetch", "-q", "public");
  console.log(`\n✓ Pushed ${head.slice(0, 7)} to ${repo} main.`);
}

if (!flag("--release")) process.exit(0);

// ---- Release ----
const tag = `v${version}`;
if (run("gh", ["release", "view", tag, "-R", repo], { allowFail: true })) {
  console.log(`Release ${tag} already exists; bump the version to cut a new one.`);
  process.exit(0);
}
if (git("rev-parse", "HEAD^{tree}") !== srcTree || git("status", "--porcelain")) {
  fail(`To build the release, check out ${ref} with a clean working tree.`);
}
run(process.execPath, ["build.mjs", "--public"]);
const work = await mkdtemp(join(tmpdir(), "t3plus-release-"));
try {
  const zip = join(work, `t3plus-${tag}.zip`);
  await writeZip(join(root, "dist"), `t3plus-${tag}`, zip);
  const changelog = git("show", `${src}:CHANGELOG.md`);
  const section = changelog.split(/^## /m).find((s) => s.startsWith(`${version} `) || s.startsWith(`${version}\n`));
  const notes = `${section ? section.slice(section.indexOf("\n") + 1).trim() : `t3+ ${version}`}

### Install

1. Download \`t3plus-${tag}.zip\` below and unzip it.
2. Open \`chrome://extensions\` and turn on Developer mode.
3. Click Load unpacked and pick the unzipped \`t3plus-${tag}\` folder.
4. Reload https://app.t3.codes and click the t3+ toolbar icon.

This zip fetches nothing. The usage widgets, bot messages and profile tabs need feeds and a build from source: see [docs/setup.md](https://github.com/${repo}/blob/main/docs/setup.md).
`;
  check("(release notes)", notes);
  if (problems.length) fail(`Private details found in the release notes:\n  ${problems.join("\n  ")}`);
  const notesFile = join(work, "notes.md");
  await writeFile(notesFile, notes);
  run("gh", ["release", "create", tag, zip, "-R", repo, "--target", head, "--title", `t3+ ${version}`, "--notes-file", notesFile, "--latest"]);
  console.log(`✓ Released ${tag}: https://github.com/${repo}/releases/tag/${tag}`);
} finally {
  await rm(work, { recursive: true, force: true });
  run(process.execPath, ["build.mjs"]); // back to this machine's own build
}
