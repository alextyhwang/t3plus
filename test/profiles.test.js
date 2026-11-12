import assert from "node:assert/strict";
import { test } from "node:test";
import { STORAGE_KEYS, T3PLUS } from "../src/config.js";
import { normalizeProfileView, threadKeyFromPath, threadToRestore } from "../src/profiles.js";
import { normalizeT3PlusConfig } from "../src/remoteConfig.js";
import { computeProfileVisibility, findProfileBarSlot, findSidebarInner, scanSidebar } from "../src/sidebar.js";
import { createApp, createDom, createFakeChromeStorage, createFakeRemote, SAMPLE_CONFIG, settle, sidebarHtml } from "./helpers.js";

const profiles = normalizeT3PlusConfig(SAMPLE_CONFIG).config.profiles;
const work = profiles.find((p) => p.id === "work");
const personal = profiles.find((p) => p.id === "personal");
const flatWork = { ...work, threads: ["env1:a1"] };

function scanOf(html) {
  const dom = createDom("/", html);
  return { dom, scan: scanSidebar(findSidebarInner(dom.window.document)) };
}
const keysHidden = (scan, hidden) => scan.threads.filter((t) => hidden.has(t.li)).map((t) => t.key);
const visibleThreadKeys = (doc) =>
  [...doc.querySelectorAll("[data-thread-item]")].filter((li) => !li.hidden).map((li) => li.getAttribute("data-thread-item"));
const click = (dom, el) => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

test("threadKeyFromPath reads /<environmentId>/<threadId> and ignores app routes", () => {
  assert.equal(threadKeyFromPath("/env1/t1"), "env1:t1");
  assert.equal(threadKeyFromPath("/env%3Ax/t1/"), "env:x:t1");
  for (const path of ["/", "/settings/appearance", "/draft/abc", "/new", "/env1", "/a/b/c", "/pull-requests/x"]) {
    assert.equal(threadKeyFromPath(path), null, path);
  }
});

test("scanSidebar reads T3's row hooks: folders, threads, parents, titles, current row", () => {
  const { scan } = scanOf(sidebarHtml({ currentKey: "env1:w1" }));
  assert.equal(scan.folderMode, true);
  assert.deepEqual([...scan.folders.keys()], ["github.com/acme/api", "github.com/acme/web", "/home/me/notes"]);
  const a1 = scan.threads.find((t) => t.key === "env1:a1");
  assert.equal(a1.folderKey, "github.com/acme/api");
  assert.equal(a1.title, "Fix login");
  assert.equal(a1.titleEl.textContent, "Fix login");
  assert.equal(scan.threads.find((t) => t.current).key, "env1:w1");
});

test("project-grouped sidebar: a profile shows its folders and their threads", () => {
  const { scan } = scanOf(sidebarHtml());
  const { hidden } = computeProfileVisibility(scan, personal, {});
  assert.deepEqual(keysHidden(scan, hidden), ["env1:bot1", "env1:a1", "env1:w1"]);
  // The API folder stays because one of its threads (env1:a2) is an explicit member.
  assert.equal(hidden.has(scan.folders.get("github.com/acme/api").li), false);
  assert.equal(hidden.has(scan.folders.get("github.com/acme/web").li), true);
  assert.equal(hidden.has(scan.folders.get("/home/me/notes").li), false);

  const forWork = computeProfileVisibility(scan, work, {});
  assert.deepEqual(keysHidden(scan, forWork.hidden), ["env1:bot1", "env2:n1"]);
  assert.equal(computeProfileVisibility(scan, null, {}).hidden.size, 0, "All hides nothing");
});

test("flat sidebar: thread-level fallback, and a shelf with no visible rows is hidden", () => {
  const { scan } = scanOf(sidebarHtml({ folders: false }));
  assert.equal(scan.folderMode, false);
  const { hidden } = computeProfileVisibility(scan, flatWork, {});
  assert.deepEqual(keysHidden(scan, hidden), ["env1:bot1", "env2:n1"]);
  assert.ok(hidden.has(scan.shelves.get("shelf:settled")));
});

test("the open thread stays visible (deep link) and is flagged as outside the profile", () => {
  const { scan } = scanOf(sidebarHtml({ currentKey: "env1:w1" }));
  const { hidden, outside } = computeProfileVisibility(scan, personal, { routeThreadKey: "env1:w1" });
  assert.equal(keysHidden(scan, hidden).includes("env1:w1"), false);
  assert.equal(outside, scan.threads.find((t) => t.key === "env1:w1").row);
  assert.equal(hidden.has(scan.folders.get("github.com/acme/web").li), false, "its folder stays too");
});

test("bots stay visible across profiles unless the profile opts out", () => {
  const { scan } = scanOf(sidebarHtml());
  const botKeys = new Set(["env1:bot1"]);
  assert.equal(keysHidden(scan, computeProfileVisibility(scan, personal, { botKeys }).hidden).includes("env1:bot1"), false);
  const quiet = { ...personal, showBots: false };
  assert.ok(keysHidden(scan, computeProfileVisibility(scan, quiet, { botKeys }).hidden).includes("env1:bot1"));
});

test("threadToRestore: stay when already a member, else the profile's last available thread", () => {
  const view = normalizeProfileView({ lastThreadByProfile: { work: "env1:w1", personal: "env2:gone" } });
  const base = { view, isAvailable: (k) => k !== "env2:gone" };
  assert.equal(threadToRestore({ ...base, profileId: "all", currentThreadKey: "env2:n1", isMember: () => false }), null);
  assert.equal(threadToRestore({ ...base, profileId: "work", currentThreadKey: "env1:a1", isMember: () => true }), null);
  assert.equal(threadToRestore({ ...base, profileId: "work", currentThreadKey: "env2:n1", isMember: () => false }), "env1:w1");
  assert.equal(threadToRestore({ ...base, profileId: "personal", currentThreadKey: "env1:a1", isMember: () => false }), null, "stale thread");
  assert.equal(threadToRestore({ ...base, profileId: "work", currentThreadKey: null, isMember: () => false }), "env1:w1");
});

test("profile bar mounts under the fixed header, filters on click, and restores the last thread", async () => {
  const dom = createDom("/env2/n1", sidebarHtml({ currentKey: "env2:n1" }));
  const doc = dom.window.document;
  const storage = createFakeChromeStorage();
  storage.area.data.set(STORAGE_KEYS.profileView, { activeProfileId: "all", lastThreadByProfile: { work: "env1:w1" } });
  const { app } = createApp(dom, storage, { remote: createFakeRemote(SAMPLE_CONFIG) });
  await app.start();
  app.watcher.flush();

  const bar = doc.getElementById(T3PLUS.profileBarId);
  const slot = findProfileBarSlot(findSidebarInner(doc));
  assert.equal(bar.nextElementSibling, slot.before, "directly above the scroll area");
  assert.equal(bar.previousElementSibling.className, "w-full shrink-0", "right under T3's fixed header");
  const tabs = [...bar.querySelectorAll(".t3plus-profile-tab")];
  assert.deepEqual(tabs.map((t) => t.textContent), ["All", "Work", "Personal"]);
  assert.equal(tabs[0].getAttribute("aria-pressed"), "true");
  assert.equal(visibleThreadKeys(doc).length, 5);

  // Clicking T3's own row is how t3+ navigates; record it, and do what T3's
  // router would: change the URL and move aria-current to the new row.
  const opened = [];
  const navigate = (key) => {
    dom.window.history.pushState({}, "", `/${key.replace(":", "/")}`);
    for (const row of doc.querySelectorAll("[aria-current]")) row.removeAttribute("aria-current");
    doc.querySelector(`[data-sidebar-row="${key}"]`).setAttribute("aria-current", "page");
  };
  for (const row of doc.querySelectorAll("[data-thread-item] > [data-sidebar-row]")) {
    row.addEventListener("click", () => {
      opened.push(row.getAttribute("data-sidebar-row"));
      navigate(row.getAttribute("data-sidebar-row"));
    });
  }

  click(dom, tabs[1]);
  await settle();
  assert.deepEqual(opened, ["env1:w1"], "restored Work's last thread through T3's row");
  app.watcher.flush();
  assert.deepEqual(visibleThreadKeys(doc), ["env1:bot1", "env1:a1", "env1:a2", "env1:w1"]);
  assert.equal(doc.querySelector('[data-thread-item="env2:n1"]').getAttribute(T3PLUS.filteredAttr), "");
  assert.equal(tabs[1].getAttribute("aria-pressed"), "true");
  assert.equal(storage.area.data.get(STORAGE_KEYS.profileView).activeProfileId, "work");

  // Opening a Work thread updates Work's last thread.
  navigate("env1:a2");
  app.watcher.flush();
  assert.equal(storage.area.data.get(STORAGE_KEYS.profileView).lastThreadByProfile.work, "env1:a2");

  // Back to All shows everything and does not navigate.
  click(dom, tabs[0]);
  await settle();
  assert.equal(opened.length, 1);
  assert.equal(visibleThreadKeys(doc).length, 5);
  assert.equal(doc.querySelectorAll(`[${T3PLUS.filteredAttr}]`).length, 0);
  app.stop();
});

test("a deep link outside the saved profile is kept open and visible after reload", async () => {
  const storage = createFakeChromeStorage();
  storage.area.data.set(STORAGE_KEYS.profileView, { activeProfileId: "personal", lastThreadByProfile: { personal: "env2:n1" } });
  const dom = createDom("/env1/w1", sidebarHtml({ currentKey: "env1:w1" }));
  const doc = dom.window.document;
  const { app } = createApp(dom, storage, { remote: createFakeRemote(SAMPLE_CONFIG) });
  let navigated = false;
  doc.querySelector('[data-sidebar-row="env2:n1"]').addEventListener("click", () => (navigated = true));
  await app.start();
  app.watcher.flush();
  assert.equal(navigated, false, "startup never navigates away from a deep link");
  assert.deepEqual(visibleThreadKeys(doc), ["env1:bot1", "env1:a2", "env1:w1", "env2:n1"]);
  assert.ok(doc.querySelector('[data-sidebar-row="env1:w1"]').hasAttribute(T3PLUS.outsideAttr));
  assert.equal(storage.area.data.get(STORAGE_KEYS.profileView).lastThreadByProfile.personal, "env2:n1", "outside thread not recorded");
  app.stop();
});

test("filtering is re-applied after React re-renders the list, and cleared on stop", async () => {
  const storage = createFakeChromeStorage();
  storage.area.data.set(STORAGE_KEYS.profileView, { activeProfileId: "work", lastThreadByProfile: {} });
  const dom = createDom("/", sidebarHtml());
  const doc = dom.window.document;
  const { app } = createApp(dom, storage, { remote: createFakeRemote(SAMPLE_CONFIG) });
  await app.start();
  app.watcher.flush();
  assert.equal(doc.querySelector('[data-thread-item="env2:n1"]').hidden, true);

  // React replaces the list wholesale (fresh, unfiltered nodes).
  const list = doc.getElementById("thread-list");
  list.innerHTML = new dom.window.DOMParser().parseFromString(sidebarHtml(), "text/html").getElementById("thread-list").innerHTML;
  await settle();
  assert.equal(doc.querySelector('[data-thread-item="env2:n1"]').hidden, false);
  app.watcher.flush();
  assert.equal(doc.querySelector('[data-thread-item="env2:n1"]').hidden, true);

  app.stop();
  assert.equal(doc.querySelectorAll(`[${T3PLUS.filteredAttr}], [hidden]`).length, 0);
  assert.equal(doc.getElementById(T3PLUS.profileBarId), null);
});

test("with no server file the bar shows only All plus a diagnostic, and filters nothing", async () => {
  const storage = createFakeChromeStorage();
  storage.area.data.set(STORAGE_KEYS.profileView, { activeProfileId: "work", lastThreadByProfile: {} });
  const dom = createDom("/", sidebarHtml());
  const doc = dom.window.document;
  const { app } = createApp(dom, storage, { remote: createFakeRemote({ ok: false, status: 404 }) });
  await app.start();
  app.watcher.flush();
  const bar = doc.getElementById(T3PLUS.profileBarId);
  assert.deepEqual([...bar.querySelectorAll(".t3plus-profile-tab")].map((t) => t.textContent), ["All"]);
  const status = bar.querySelector(".t3plus-profile-status");
  assert.equal(status.dataset.state, "warn");
  assert.match(status.title, /404/);
  assert.equal(doc.querySelectorAll(`[${T3PLUS.filteredAttr}]`).length, 0);
  app.stop();
});

test("turning profile tabs off removes filtering and the strip but keeps bot rows decorated", async () => {
  const storage = createFakeChromeStorage();
  storage.area.data.set(STORAGE_KEYS.profileView, { activeProfileId: "work", lastThreadByProfile: {} });
  const dom = createDom("/", sidebarHtml());
  const doc = dom.window.document;
  const { app } = createApp(dom, storage, { remote: createFakeRemote(SAMPLE_CONFIG) });
  await app.start();
  await app.actions.setSidebarFeature("profiles", false);
  app.watcher.flush();
  assert.equal(doc.querySelectorAll(`[${T3PLUS.filteredAttr}]`).length, 0);
  assert.equal(doc.getElementById(T3PLUS.profileBarId), null);
  assert.equal(doc.querySelector('[data-sidebar-row="env1:bot1"]').getAttribute(T3PLUS.botAttr), "working");
  app.stop();
});

test("T3's fading exit clones (inert, aria-hidden) are ignored by the scan", () => {
  const dom = createDom("/", sidebarHtml());
  const doc = dom.window.document;
  const folder = doc.querySelector('[data-testid="sidebar-project-folder"]');
  const clone = folder.cloneNode(true);
  clone.removeAttribute("data-testid");
  clone.setAttribute("aria-hidden", "true");
  clone.setAttribute("inert", "");
  folder.parentElement.append(clone);
  const scan = scanSidebar(findSidebarInner(doc));
  assert.equal(scan.folders.get("github.com/acme/api").li, folder);
});

test("no profile bar on pages whose sidebar has no thread list", async () => {
  const dom = createDom("/settings/general", `<div data-slot="sidebar-inner"><div><nav>Settings nav</nav></div><div><div data-slot="sidebar-content"></div></div></div>`);
  const { app } = createApp(dom, undefined, { remote: createFakeRemote(SAMPLE_CONFIG) });
  await app.start();
  app.watcher.flush();
  assert.equal(dom.window.document.getElementById(T3PLUS.profileBarId), null);
  app.stop();
});
