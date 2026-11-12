import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_FEED_BASE } from "../src/hosts.js";
import { publishRelease, releaseInfo, releaseNotes } from "../tools/release.mjs";

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "t3plus-release-test-"));
  await writeFile(join(cwd, "package.json"), '{"version":"1.2.3"}');
  await writeFile(join(cwd, "manifest.base.json"), '{"version":"1.2.3"}');
  await writeFile(join(cwd, "CHANGELOG.md"), "# Changes\r\n\r\n## Unreleased\r\n\r\n## 1.2.3 (2026-01-01)\r\n- Fixed it.\r\n\r\n## 1.2.2\r\nOld\r\n");
  return { cwd, clean: () => rm(cwd, { recursive: true, force: true }) };
}

test("release metadata validates matching versions and uses only that changelog section", async () => {
  const f = await fixture();
  try {
    const info = await releaseInfo(f.cwd);
    assert.deepEqual(info, { version: "1.2.3", tag: "v1.2.3", changes: "- Fixed it." });
    assert.match(releaseNotes(info, true), /no personal feed configuration/);
    assert.match(releaseNotes(info, false), /personal build/);
    await writeFile(join(f.cwd, "manifest.base.json"), '{"version":"1.2.4"}');
    await assert.rejects(releaseInfo(f.cwd), /versions must match/);
    await writeFile(join(f.cwd, "package.json"), '{"version":"1.2.4"}');
    await assert.rejects(releaseInfo(f.cwd), /needs a section/);
  } finally { await f.clean(); }
});

test("public builds ignore a configured personal feed environment", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e",
    "const { resolveFeedBase } = await import('./build.mjs'); console.log(await resolveFeedBase());", "--", "--public"], {
    cwd: new URL("..", import.meta.url), encoding: "utf8", env: { ...process.env, T3PLUS_FEED_BASE: "https://personal.example.test/feeds/" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), DEFAULT_FEED_BASE);
});

test("release upload publishes a draft only after the ZIP arrives; a published version is left intact", async () => {
  const f = await fixture();
  try {
    const path = join(f.cwd, "fixture.zip");
    await writeFile(path, "zip bytes");
    const calls = [];
    let published = false;
    let builds = 0;
    const options = { cwd: f.cwd, repository: "example/extension", token: "fixture-token", target: "a".repeat(40), log() {},
      pack: async ({ publicBuild }) => {
        builds++;
        assert.equal(publicBuild, true);
        return { name: "extension.zip", path, notes: "Release notes" };
      },
      fetchImpl: async (url, options) => {
        calls.push({ url, method: options.method ?? "GET", body: options.body });
        if (options.method === "PATCH") published = true;
        const missing = calls.length === 1;
        return { status: missing ? 404 : 200, ok: !missing, json: async () => ({ id: 5, draft: !published, html_url: "https://example.test/release" }) };
      }, publicBuild: true };
    await publishRelease(options);
    assert.deepEqual(calls.map((call) => call.method), ["GET", "POST", "POST", "PATCH"]);
    const draft = JSON.parse(calls[1].body);
    assert.equal(draft.draft, true);
    assert.equal(draft.target_commitish, options.target);
    assert.match(calls[2].url, /^https:\/\/uploads.github.com\//);
    assert.equal(calls[2].body.toString(), "zip bytes");
    assert.equal(JSON.parse(calls[3].body).draft, false);
    const result = await publishRelease(options);
    assert.equal(result.skipped, true);
    assert.equal(builds, 1);
    assert.equal(calls.length, 5, "rerun only reads the existing release");
  } finally { await f.clean(); }
});

test("GitHub errors are not mistaken for a missing release and cannot publish a ZIP", async () => {
  const f = await fixture();
  try {
    await assert.rejects(publishRelease({ cwd: f.cwd, repository: "example/extension", token: "fixture-token", target: "a".repeat(40),
      fetchImpl: async () => ({ status: 403, ok: false }), pack: async () => assert.fail("must not build"), log() {},
    }), /HTTP 403/);
  } finally { await f.clean(); }
});

test("an interrupted draft is resumed, but a failed upload never publishes it", async () => {
  const f = await fixture();
  try {
    const path = join(f.cwd, "fixture.zip");
    await writeFile(path, "zip bytes");
    const methods = [];
    const target = "a".repeat(40);
    await assert.rejects(publishRelease({ cwd: f.cwd, repository: "example/extension", token: "fixture-token", target,
      pack: async () => ({ name: "extension.zip", path, notes: "Notes" }), log() {},
      fetchImpl: async (_url, options) => {
        const method = options.method ?? "GET";
        methods.push(method);
        if (method === "POST") return { status: 500, ok: false };
        return { status: method === "DELETE" ? 204 : 200, ok: true,
          json: async () => ({ id: 5, draft: true, target_commitish: target, assets: [{ id: 9, name: "extension.zip" }] }) };
      },
    }), /HTTP 500/);
    assert.deepEqual(methods, ["GET", "DELETE", "POST"], "replace the unfinished asset, without publishing on upload failure");
    await assert.rejects(publishRelease({ cwd: f.cwd, repository: "example/extension", token: "fixture-token", target,
      fetchImpl: async () => ({ status: 200, ok: true, json: async () => ({ draft: true, target_commitish: "b".repeat(40) }) }),
      pack: async () => assert.fail("must not overwrite another commit's draft"), log() {},
    }), /another commit/);
  } finally { await f.clean(); }
});
