import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchConfig } from "../src/background.js";
import { CONFIG_LIMITS, DEFAULT_BOT_MARKER, STORAGE_KEYS } from "../src/config.js";
import { CONFIG_ENDPOINTS } from "../src/hosts.js";
import { createConfigProvider, normalizeT3PlusConfig, parseT3PlusConfigText } from "../src/remoteConfig.js";
import { createFakeChromeStorage, createFakeRemote, SAMPLE_CONFIG } from "./helpers.js";

const provider = (storage, remote, now = () => 5_000) =>
  createConfigProvider({ area: storage.area, changedEvent: storage.onChanged, fetchRemote: remote, now });

test("normalizeT3PlusConfig keeps valid profiles and reports bad entries without dropping the rest", () => {
  const { config, errors } = normalizeT3PlusConfig({
    version: 1,
    botMarker: "[[acme:bot]]",
    controlThread: "env1:ctl",
    profiles: [
      { id: "Work", label: "Work stuff that is far too long for a tab", color: "#ABCDEF", projects: ["github.com/a/b", "github.com/a/b", 7], threads: ["env1:t1", "not a key"] },
      { id: "all", label: "Reserved" },
      { id: "bad id!" },
      { id: "work", label: "Duplicate" },
      { id: "home", color: "red", showBots: false },
    ],
  });
  assert.deepEqual(config.profiles.map((p) => p.id), ["work", "home"]);
  const work = config.profiles[0];
  assert.equal(work.label, "Work stuff that is far t");
  assert.equal(work.color, "#abcdef");
  assert.deepEqual(work.projects, ["github.com/a/b"]);
  assert.deepEqual(work.threads, ["env1:t1"]);
  assert.equal(config.profiles[1].color, null);
  assert.equal(config.profiles[1].showBots, false);
  assert.equal(config.botMarker, "[[acme:bot]]");
  assert.equal(config.controlThread, "env1:ctl");
  assert.equal(errors.length, 3);
});

test("a marker that is not one [[...]] token falls back to the default", () => {
  for (const botMarker of ["bot", "[[has space]]", "[[bot]]x", "​"]) {
    assert.equal(normalizeT3PlusConfig({ version: 1, profiles: [], botMarker }).config.botMarker, DEFAULT_BOT_MARKER);
  }
});

test("parseT3PlusConfigText rejects non-JSON and oversized files", () => {
  assert.equal(parseT3PlusConfigText("{nope").parsed, false);
  assert.match(parseT3PlusConfigText("{nope").errors[0], /Not valid JSON/);
  assert.equal(parseT3PlusConfigText(" ".repeat(CONFIG_LIMITS.maxChars + 1) + "{}").parsed, false);
  assert.equal(parseT3PlusConfigText(JSON.stringify(SAMPLE_CONFIG)).config.profiles.length, 2);
});

test("remote success is used and cached", async () => {
  const storage = createFakeChromeStorage();
  const remote = createFakeRemote(SAMPLE_CONFIG);
  const loaded = await provider(storage, remote).load();
  assert.equal(loaded.source, "remote");
  assert.equal(loaded.config.profiles.length, 2);
  assert.equal(loaded.diagnostic, null);
  assert.deepEqual(remote.calls, [CONFIG_ENDPOINTS[0]]);
  assert.equal(storage.area.data.get(STORAGE_KEYS.configCache).url, CONFIG_ENDPOINTS[0]);
});

test("an unreachable or unpublished file yields no profiles and a diagnostic, never invented data", async () => {
  const storage = createFakeChromeStorage();
  const notFound = await provider(storage, createFakeRemote({ ok: false, status: 404 })).load();
  assert.equal(notFound.source, "none");
  assert.deepEqual(notFound.config.profiles, []);
  assert.match(notFound.diagnostic, /404: t3plus\.json has not been published yet/);

  const offline = await provider(storage, createFakeRemote({ ok: false, status: 0, error: "Failed to fetch" })).load();
  assert.equal(offline.source, "none");
  assert.match(offline.diagnostic, /Could not reach .*Failed to fetch/);

  const thrown = await provider(storage, async () => {
    throw new Error("worker gone");
  }).load();
  assert.match(thrown.diagnostic, /worker gone/);

  const garbage = await provider(storage, createFakeRemote({ ok: true, status: 200, text: "<html>" })).load();
  assert.equal(garbage.source, "none");
  assert.match(garbage.diagnostic, /not a usable t3plus\.json/);
});

test("a failed refresh falls back to the cached copy, labelled with the reason", async () => {
  const storage = createFakeChromeStorage();
  const remote = createFakeRemote(SAMPLE_CONFIG);
  await provider(storage, remote, () => 1000).load();
  remote.response = { ok: false, status: 503 };
  const loaded = await provider(storage, remote, () => 2000).load();
  assert.equal(loaded.source, "cache");
  assert.equal(loaded.fetchedAt, 1000);
  assert.equal(loaded.config.profiles.length, 2);
  assert.match(loaded.diagnostic, /HTTP 503\. Showing the copy fetched earlier\./);

  // refresh: false reads the cache without a network call.
  const calls = remote.calls.length;
  const quick = await provider(storage, remote).load({ refresh: false });
  assert.equal(quick.source, "cache");
  assert.equal(remote.calls.length, calls);
});

test("the local override is used only when chosen, and is labelled as local", async () => {
  const storage = createFakeChromeStorage();
  const remote = createFakeRemote({ ok: false, status: 404 });
  const p = provider(storage, remote);
  await p.saveLocal({ text: JSON.stringify({ version: 1, profiles: [{ id: "solo", label: "Solo" }] }) });
  assert.equal((await p.load()).source, "none", "saving text alone does not switch sources");

  await p.saveLocal({ use: "local" });
  const before = remote.calls.length;
  const loaded = await p.load();
  assert.equal(loaded.source, "local");
  assert.deepEqual(loaded.config.profiles.map((x) => x.id), ["solo"]);
  assert.match(loaded.diagnostic, /local override/);
  assert.equal(remote.calls.length, before, "no network call while the local override is active");

  await p.saveLocal({ text: "{broken" });
  const broken = await p.load();
  assert.equal(broken.source, "none");
  assert.match(broken.diagnostic, /Local override is unusable/);
});

test("the background worker fetches only the configured endpoint, without credentials or redirects", async () => {
  const seen = [];
  const fakeFetch = async (url, init) => {
    seen.push({ url, init });
    return { ok: true, status: 200, text: async () => "{}" };
  };
  assert.deepEqual(await fetchConfig("https://evil.example/t3plus.json", fakeFetch), {
    ok: false,
    status: 0,
    error: "URL is not a configured t3+ endpoint.",
  });
  assert.equal(seen.length, 0);
  const ok = await fetchConfig(CONFIG_ENDPOINTS[0], fakeFetch);
  assert.deepEqual(ok, { ok: true, status: 200, text: "{}" });
  assert.deepEqual(seen[0].init, { cache: "no-store", credentials: "omit", redirect: "error" });
  const big = await fetchConfig(CONFIG_ENDPOINTS[0], async () => ({ ok: true, status: 200, text: async () => "x".repeat(CONFIG_LIMITS.maxChars + 1) }));
  assert.equal(big.ok, false);
  const missing = await fetchConfig(CONFIG_ENDPOINTS[0], async () => ({ ok: false, status: 404 }));
  assert.deepEqual(missing, { ok: false, status: 404 });
});
