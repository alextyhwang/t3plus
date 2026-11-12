import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isPublicPath, parseDenyPatterns, privateDetailLocations } from "../tools/publish-policy.mjs";
import { publishPublic } from "../tools/publish-public.mjs";

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "t3plus-publish-test-"));
  const cwd = join(directory, "source");
  const remote = join(directory, "public.git");
  await mkdir(cwd);
  git(cwd, "init", "-b", "main");
  git(cwd, "config", "user.name", "Test Maintainer");
  git(cwd, "config", "user.email", "test@users.noreply.github.com");
  await writeFile(join(cwd, "package.json"), '{"version":"1.0.0"}');
  await writeFile(join(cwd, "README.md"), "Public extension");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "Initial public snapshot");
  git(cwd, "clone", "--bare", cwd, remote);
  git(cwd, "remote", "add", "public", remote);
  return { cwd, remote, clean: () => rm(directory, { recursive: true, force: true }) };
}

test("public path policy excludes personal configuration, unknown roots, and nested private files", () => {
  for (const path of ["private/notes.md", "personal.md", "t3plus.local.json", "server/config.local.json", "docs/private/notes.md", "src/.env", "src/.env.local", "tools/signing.key", ".github/workflows/internal.yml", ".github/workflows/publish-public.yml"]) {
    assert.equal(isPublicPath(path), false, path);
  }
  for (const path of ["README.md", "src/app.js", "server/config.example.json", ".github/workflows/release.yml"]) assert.equal(isPublicPath(path), true, path);
  assert.throws(() => parseDenyPatterns("# empty"), /at least one/);
  assert.throws(() => parseDenyPatterns("["), /Invalid private-detail pattern/);
  const privateText = "internal-host";
  assert.deepEqual(privateDetailLocations("doc", `safe\n${privateText}`, parseDenyPatterns(privateText)), ["doc:2"]);
  const windowsPath = ["C:", "Users", "person", "secret"].join("\\");
  assert.deepEqual(privateDetailLocations("doc", windowsPath, []), ["doc:1"]);
});

test("publishing pushes one filtered snapshot without private files, subjects, or ancestry; reruns are idempotent", async () => {
  const f = await fixture();
  try {
    const previous = git(f.remote, "rev-parse", "main");
    await mkdir(join(f.cwd, "private"));
    await writeFile(join(f.cwd, "private", "notes.md"), "internal-host personal details");
    await writeFile(join(f.cwd, "personal.md"), "internal-host");
    await writeFile(join(f.cwd, "t3plus.local.json"), '{"feedBase":"internal-host"}');
    await writeFile(join(f.cwd, "README.md"), "Updated public extension");
    git(f.cwd, "add", ".");
    git(f.cwd, "commit", "-m", "internal-host private work");
    const privateHead = git(f.cwd, "rev-parse", "HEAD");
    const options = { cwd: f.cwd, ref: privateHead, push: true, denyText: "internal-host", log() {} };
    const result = await publishPublic(options);
    assert.equal(git(f.remote, "rev-parse", "main^"), previous);
    assert.equal(git(f.remote, "rev-list", "--count", "main"), "2");
    assert.equal(git(f.remote, "show", "-s", "--format=%s", "main"), "t3+ 1.0.0");
    assert.deepEqual(git(f.remote, "ls-tree", "-r", "--name-only", "main").split("\n"), ["README.md", "package.json"]);
    assert.equal(await readFile(join(f.cwd, "private", "notes.md"), "utf8"), "internal-host personal details");
    assert.equal(git(f.cwd, "rev-parse", "HEAD"), privateHead, "checkout stays on the private commit");
    assert.equal(git(f.cwd, "status", "--porcelain"), "", "the real index is untouched");
    assert.equal((await publishPublic(options)).head, result.head, "no second mirror commit");
  } finally { await f.clean(); }
});

test("privacy violations and unreviewed binaries stop before a public push", async () => {
  const f = await fixture();
  try {
    const before = git(f.remote, "rev-parse", "main");
    await writeFile(join(f.cwd, "README.md"), "internal-host must stay private");
    git(f.cwd, "add", ".");
    git(f.cwd, "commit", "-m", "Private detail");
    const options = { cwd: f.cwd, ref: "HEAD", push: true, denyText: "internal-host", log() {} };
    await assert.rejects(publishPublic(options), (error) => /Private details/.test(error.message) && !error.message.includes("internal-host"));
    assert.equal(git(f.remote, "rev-parse", "main"), before);
    await mkdir(join(f.cwd, "docs"));
    await writeFile(join(f.cwd, "docs", "internal-host.md"), "internal-host");
    git(f.cwd, "add", ".");
    git(f.cwd, "commit", "-m", "Private filename");
    await assert.rejects(publishPublic(options), (error) => /Private details/.test(error.message) && !error.message.includes("internal-host"));
    await rm(join(f.cwd, "docs", "internal-host.md"));
    await writeFile(join(f.cwd, "README.md"), "Safe content");
    await mkdir(join(f.cwd, "icons"));
    await writeFile(join(f.cwd, "icons", "fixture.png"), Buffer.from([0, 1, 2]));
    git(f.cwd, "add", ".");
    git(f.cwd, "commit", "-m", "Image");
    await assert.rejects(publishPublic(options), /visual review/);
    assert.equal(git(f.remote, "rev-parse", "main"), before);
    await publishPublic({ ...options, imagesChecked: true });
    assert.notEqual(git(f.remote, "rev-parse", "main"), before);
  } finally { await f.clean(); }
});

test("a public symlink cannot expose a private file through the mirror", async () => {
  const f = await fixture();
  try {
    const result = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: f.cwd, encoding: "utf8", input: "private/notes.md" });
    assert.equal(result.status, 0, result.stderr);
    git(f.cwd, "update-index", "--add", "--cacheinfo", `120000,${result.stdout.trim()},src/link`);
    git(f.cwd, "commit", "-m", "Symlink fixture");
    const before = git(f.remote, "rev-parse", "main");
    await assert.rejects(publishPublic({ cwd: f.cwd, ref: "HEAD", push: true, denyText: "internal-host", log() {} }), /symlinks and submodules/);
    assert.equal(git(f.remote, "rev-parse", "main"), before);
  } finally { await f.clean(); }
});
