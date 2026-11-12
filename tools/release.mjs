// Shared packaging and GitHub release creation for both repositories.
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_FEED_BASE, hostPermissionsFor } from "../src/hosts.js";
import { writeZip } from "./zip.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export async function releaseInfo(cwd = root) {
  const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(cwd, "manifest.base.json"), "utf8"));
  const version = pkg.version;
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version) || version.split(".").some((part) => Number(part) > 65535)) {
    throw new Error("Release version must be a Chrome-compatible major.minor.patch version.");
  }
  if (manifest.version !== version) throw new Error("package.json and manifest.base.json versions must match.");
  const changelog = await readFile(join(cwd, "CHANGELOG.md"), "utf8");
  const section = changelog.split(/^## /m).find((s) => s.startsWith(`${version} `) || s.startsWith(`${version}\n`) || s.startsWith(`${version}\r\n`));
  if (!section?.includes("\n")) throw new Error(`CHANGELOG.md needs a section for ${version}.`);
  return { version, tag: `v${version}`, changes: section.slice(section.indexOf("\n") + 1).trim() };
}

export function releaseNotes(info, publicBuild) {
  return `${info.changes}

### Install

Unzip the download into your extension folder, reload t3+ in chrome://extensions (Developer mode), then refresh https://app.t3.codes.

${publicBuild ? "This public build has no personal feed configuration. See docs/setup.md to configure your own feeds." : "This personal build includes the configured feed URLs. Keep its ZIP in the private repository."}
`;
}

export async function packageRelease({ cwd = root, publicBuild = false, info } = {}) {
  info ??= await releaseInfo(cwd);
  const built = spawnSync(process.execPath, ["build.mjs", ...(publicBuild ? ["--public"] : [])], { cwd, stdio: "inherit" });
  if (built.status !== 0) throw new Error("Release build failed.");
  const manifest = JSON.parse(await readFile(join(cwd, "dist", "manifest.json"), "utf8"));
  if (manifest.version !== info.version) throw new Error("Built manifest has the wrong version.");
  if (publicBuild && JSON.stringify(manifest.host_permissions) !== JSON.stringify(hostPermissionsFor(DEFAULT_FEED_BASE))) {
    throw new Error("Public build unexpectedly contains configured feed permissions.");
  }
  const directory = join(cwd, "release");
  await mkdir(directory, { recursive: true });
  const name = `t3plus-${info.tag}${publicBuild ? "" : "-personal"}.zip`;
  const path = join(directory, name);
  await writeZip(join(cwd, "dist"), `t3plus-${info.tag}`, path);
  const notes = releaseNotes(info, publicBuild);
  await writeFile(join(directory, "notes.md"), notes);
  return { name, path, notes };
}

/** A draft is published only after its ZIP is uploaded; reruns resume drafts. */
export async function publishRelease({ cwd = root, publicBuild = false, repository = process.env.GITHUB_REPOSITORY, token = process.env.GH_TOKEN,
  target = process.env.GITHUB_SHA, fetchImpl = fetch, pack = packageRelease, log = console.log } = {}) {
  const info = await releaseInfo(cwd);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "") || !token || !/^[a-f0-9]{40}$/.test(target ?? "")) {
    throw new Error("Publishing needs GITHUB_REPOSITORY, GH_TOKEN, and a full GITHUB_SHA.");
  }
  const request = async (url, options = {}) => {
    const response = await fetchImpl(url, { ...options, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28", ...options.headers } });
    if (response.status === 404 && options.allowMissing) return null;
    if (!response.ok) throw new Error(`GitHub release request failed (HTTP ${response.status}).`);
    return response.status === 204 ? null : response.json();
  };
  const endpoint = `https://api.github.com/repos/${repository}/releases`;
  let release = await request(`${endpoint}/tags/${info.tag}`, { allowMissing: true });
  if (release && !release.draft) {
    log(`Release ${info.tag} already exists; bump the version for the next release.`);
    return { skipped: true, url: release.html_url };
  }
  if (release && release.target_commitish !== target) throw new Error("An unfinished release targets another commit; review it before retrying.");
  const artifact = await pack({ cwd, publicBuild, info });
  const json = (value) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  if (!release) {
    release = await request(endpoint, { method: "POST", ...json({ tag_name: info.tag, target_commitish: target, name: `t3+ ${info.version}`, body: artifact.notes, draft: true }) });
  }
  if (!Number.isSafeInteger(release.id)) throw new Error("GitHub returned an invalid release ID.");
  for (const asset of release.assets ?? []) {
    if (asset.name === artifact.name) await request(`${endpoint}/assets/${asset.id}`, { method: "DELETE" });
  }
  await request(`https://uploads.github.com/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(artifact.name)}`, {
    method: "POST", headers: { "Content-Type": "application/zip" }, body: await readFile(artifact.path),
  });
  release = await request(`${endpoint}/${release.id}`, { method: "PATCH", ...json({ draft: false, make_latest: "true" }) });
  log(`Released ${info.tag}: ${release.html_url}`);
  return { skipped: false, url: release.html_url };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const publicBuild = process.argv.includes("--public");
    if (process.argv.includes("--publish")) await publishRelease({ publicBuild });
    else console.log((await packageRelease({ publicBuild })).path);
  } catch (error) {
    // Do not print HTTP responses, headers, feed URLs, or subprocess environments.
    console.error(error.message);
    process.exitCode = 1;
  }
}
