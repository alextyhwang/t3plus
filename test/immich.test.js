import assert from "node:assert/strict";
import { test } from "node:test";
import { parseImmichFeedText, formatImmichUptime, createImmichFeed } from "../src/immich.js";
import { createImmichView } from "../src/immichWidgets.js";
import { fetchImmichImage } from "../src/background.js";
import { createApp, createDom, settle } from "./helpers.js";

const CONFIG = {
  projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  environmentId: "env1",
  feedEndpoint: "https://private.example/immich/widget.json",
  imageEndpoint: "https://private.example/immich/thumbs",
  libraryUrl: "https://private.example/photos",
  maxPhotos: 4,
};
const DRAFT_KEY = "t3code:composer-drafts:v1";
const details = `<aside data-workspace-area="details" data-workspace-focus-key="details:env1:draft-thread"><div data-thread-details-card="true"><div data-slot="scroll-area-viewport"><div data-measured="true"></div></div></div></aside><button data-draft-project-trigger>Project</button>`;

function setDraft(win, projectId = CONFIG.projectId, environmentId = CONFIG.environmentId) {
  win.localStorage.setItem(DRAFT_KEY, JSON.stringify({ state: { draftThreadsByThreadKey: { draft1: { projectId, environmentId, threadId: "draft-thread" } } }, version: 1 }));
}
function feedText(photos = [{ id: "11111111-1111-4111-8111-111111111111", fileCreatedAt: "2026-11-12T10:00:00Z" }]) {
  return JSON.stringify({ version: 1, generatedAt: "2026-11-13T12:00:00Z", photos, status: { state: "online", observedAt: "2026-11-13T12:00:00Z", uptimeSeconds: 90061, uptimeSource: "service", version: "3.3.6" } });
}

test("Immich feed normalization uses capture time, bounds rows, builds every URL, and labels measured uptime", () => {
  const parsed = parseImmichFeedText(feedText([
    { id: "11111111-1111-4111-8111-111111111111", fileCreatedAt: "2020-01-02T00:00:00Z" },
    { id: "22222222-2222-4222-8222-222222222222", fileCreatedAt: "2026-01-01T00:00:00Z" },
    { id: "bad", fileCreatedAt: "2029-01-01T00:00:00Z" },
  ]), { imageEndpoint: CONFIG.imageEndpoint, libraryUrl: CONFIG.libraryUrl, now: () => Date.parse("2026-11-13T12:00:00Z") });
  assert.deepEqual(parsed.photos.map((photo) => photo.id), ["22222222-2222-4222-8222-222222222222", "11111111-1111-4111-8111-111111111111"]);
  assert.equal(parsed.photos[0].thumbnailUrl, `${CONFIG.imageEndpoint}/22222222-2222-4222-8222-222222222222/thumbnail`);
  assert.equal(parsed.photos[0].link, `${CONFIG.libraryUrl}/22222222-2222-4222-8222-222222222222`);
  assert.equal(parsed.photos[0].date, "2026-01-01T00:00:00.000Z");
  assert.equal(formatImmichUptime(parsed.status, () => Date.parse("2026-11-13T12:00:00Z")), "1d 1h uptime");
  assert.equal(parseImmichFeedText(feedText(), { imageEndpoint: CONFIG.imageEndpoint, libraryUrl: CONFIG.libraryUrl, now: () => Date.parse("2026-11-14T00:00:00Z") }).status.state, "stale");
  assert.equal(parseImmichFeedText("not json", { imageEndpoint: CONFIG.imageEndpoint, libraryUrl: CONFIG.libraryUrl }), null);
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `${i}1111111-1111-4111-8111-111111111111`, fileCreatedAt: "2026-11-12T10:00:00Z" }));
  assert.equal(parseImmichFeedText(feedText(many), { maxPhotos: 4, now: () => Date.parse("2026-11-13T12:00:00Z") }).photos.length, 4);
});

test("Immich links use the configured library and thumbnail endpoints", () => {
  const [photo] = parseImmichFeedText(feedText(), { now: () => Date.parse("2026-11-13T12:00:00Z") }).photos;
  assert.equal(photo.link, "https://photos.example.test/photos/11111111-1111-4111-8111-111111111111");
  assert.equal(photo.thumbnailUrl, "https://photos.example.test/api/assets/11111111-1111-4111-8111-111111111111/thumbnail");
});

test("Immich image bridge allows only configured UUID thumbnail paths and GET blobs", async () => {
  const calls = [];
  const image = `${CONFIG.imageEndpoint}/11111111-1111-4111-8111-111111111111/thumbnail`;
  const response = await fetchImmichImage({ url: image }, async (url, init) => { calls.push([url, init]); return new Response(new Uint8Array([1, 2]), { status: 200, headers: { "content-type": "image/webp" } }); }, CONFIG.imageEndpoint);
  assert.equal(response.ok, true);
  assert.equal(atob(JSON.parse(JSON.stringify(response)).base64).length, 2);
  assert.equal(calls[0][1].method, "GET");
  assert.equal((await fetchImmichImage({ url: `${image}?key=secret` }, fetch, CONFIG.imageEndpoint)).ok, false);
  assert.equal((await fetchImmichImage({ url: `${CONFIG.imageEndpoint}/11111111-1111-4111-8111-111111111111` }, fetch, CONFIG.imageEndpoint)).ok, false);
  assert.equal((await fetchImmichImage({ url: "https://other.example/thumb/11111111-1111-4111-8111-111111111111" }, fetch, CONFIG.imageEndpoint)).ok, false);
});

test("Immich feed failures identify an unavailable publisher", async () => {
  for (const [status, error, expected] of [
    [404, "Not Found", /HTTP 404.*publisher.*reachable/i],
    [503, "Gateway unavailable", /HTTP 503.*Try again later.*Gateway unavailable/i],
    [0, "Failed to fetch", /Could not reach the photo service.*Failed to fetch/i],
  ]) {
    const feed = createImmichFeed({ fetchRemote: async () => ({ ok: false, status, error }), endpoint: CONFIG.feedEndpoint, imageEndpoint: CONFIG.imageEndpoint, libraryUrl: CONFIG.libraryUrl });
    await assert.rejects(feed.load(), thrown => thrown.message && thrown.status === status && expected.test(thrown.message));
  }
});

test("Immich widget mounts only for exact draft identity, ignores late data, and revokes images", async (t) => {
  const dom = createDom("/draft/draft1", details);
  setDraft(dom.window);
  const revoked = [];
  dom.window.URL.revokeObjectURL = (url) => revoked.push(url);
  let resolve;
  const feed = createImmichFeed({ fetchRemote: async () => ({ ok: true, status: 200, text: await new Promise((r) => { resolve = r; }) }), requestImage: async () => ({ ok: true, base64: btoa("image"), mimeType: "image/webp" }), endpoint: CONFIG.feedEndpoint, imageEndpoint: CONFIG.imageEndpoint, libraryUrl: CONFIG.libraryUrl });
  const { app } = createApp(dom, undefined, { immichFeed: feed, immichConfig: CONFIG });
  t.after(() => app.stop());
  await app.start(); app.watcher.flush();
  assert.equal(app.state.settings.home.widgets, true);
  assert.ok(dom.window.document.querySelector(".t3plus-immich"));
  dom.window.history.pushState({}, "", "/env1/other"); app.watcher.flush();
  resolve(feedText()); await settle(); app.watcher.flush();
  assert.equal(dom.window.document.querySelector(".t3plus-immich"), null);
  setDraft(dom.window); dom.window.history.pushState({}, "", "/draft/draft1"); app.watcher.flush(); await settle(); app.watcher.flush();
  assert.ok(dom.window.document.querySelector(".t3plus-immich"));
  resolve(feedText()); await settle(); await settle(); app.watcher.flush();
  const src = dom.window.document.querySelector(".t3plus-immich img")?.getAttribute("src");
  assert.match(src ?? "", /^blob:/, "the thumbnail is shown from a local object URL");
  assert.deepEqual(revoked, []);
  setDraft(dom.window, "other-project"); dom.window.history.pushState({}, "", "/draft/draft1"); app.watcher.flush();
  assert.equal(dom.window.document.querySelector(".t3plus-immich"), null, "another project's draft gets no widget");
  assert.deepEqual(revoked, [src], "its image URL is released");
});

test("Immich view handles constrained widths, missing images, and cleanup", async (t) => {
  const dom = createDom("/", "");
  const view = createImmichView(dom.window.document, { feed: { load: async () => ({ libraryUrl: CONFIG.libraryUrl, photos: [{ id: "11111111-1111-4111-8111-111111111111", date: null, thumbnailUrl: "https://private.example/immich/thumbs/11111111-1111-4111-8111-111111111111/thumbnail", link: CONFIG.libraryUrl }], status: { state: "degraded" } }), image: async () => { throw new Error("missing"); } } });
  t.after(() => view.destroy());
  const host = dom.window.document.body;
  view.sync({ key: "env1:project:thread:draft", host });
  await settle();
  assert.match(view.element.textContent, /Date unavailable/);
  assert.match(view.element.textContent, /Degraded/);
  assert.equal(view.element.querySelectorAll(".t3plus-immich-photo").length, 1);
  assert.equal(view.element.querySelector("a[target='_blank']").rel, "noopener noreferrer");
});

test("Immich view reports a failed feed as offline without a false empty state", async (t) => {
  const dom = createDom("/", "");
  const view = createImmichView(dom.window.document, { feed: { load: async () => { throw new Error("fixture unavailable"); } } });
  t.after(() => view.destroy());
  view.sync({ key: "env1:project:thread:draft", host: dom.window.document.body });
  await settle();
  assert.match(view.element.textContent, /fixture unavailable/);
  assert.match(view.element.textContent, /Offline · Uptime unavailable/);
  assert.doesNotMatch(view.element.textContent, /No recent photos/);
});


test("Immich view reloads the same draft's feed only after its refresh interval", async (t) => {
  const dom = createDom("/", "");
  let loads = 0, clock = 0;
  const view = createImmichView(dom.window.document, { now: () => clock, feed: { load: async () => { loads++; return { libraryUrl: CONFIG.libraryUrl, photos: [], status: { state: "online" } }; }, image: async () => { throw new Error("unused"); } } });
  t.after(() => view.destroy());
  const context = { key: "env1:project:thread:draft", host: dom.window.document.body };
  view.sync(context); await settle();
  clock = 5 * 60 * 1000 - 1; view.sync(context); await settle();
  assert.equal(loads, 1, "same draft within the interval keeps the loaded feed");
  clock = 5 * 60 * 1000; view.sync(context); await settle();
  assert.equal(loads, 2, "refreshes once the interval has passed");
  view.sync({ ...context, key: "env1:project:thread:other" }); await settle();
  assert.equal(loads, 3, "a new draft loads at once");
});
