import assert from "node:assert/strict";
import { test } from "node:test";
import { createGroupViewStore, mergeGroupVisibility, planAssistantGroup } from "../src/assistantGroup.js";
import { parseBotFeedText } from "../src/botFeed.js";
import { classifyBots } from "../src/bots.js";
import { DEFAULT_BOT_MARKER, STORAGE_KEYS, T3PLUS } from "../src/config.js";
import { findSidebarInner, scanSidebar } from "../src/sidebar.js";
import { createApp, createDom, createFakeChromeStorage, settle } from "./helpers.js";

// Neutral stand-in data: one router bot ("Dispatcher") in project "ops".
const GROUP = { botThreadId: "bot1", projectId: "p-ops", skipTitlePrefixes: ["Worker:"] };
const BOT_TITLE = "[[t3plus:bot:v1]] Dispatcher";

const attr = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * A T3 card row (SidebarThreadRow.tsx card variant): project icon + name +
 * status slot; the title; the meta line (branch, then the icon group: the
 * computer icon and the agent icon, last).
 */
function cardRow({ key, title, project = "ops", status = null, parent = null, current = false }) {
  const label = [title, status, project].filter(Boolean).join(", ");
  return `
    <li data-thread-item="${attr(key)}" class="list-none">
      <div role="button" tabindex="0" data-sidebar-row="${attr(key)}"${parent ? ` data-sidebar-parent="${attr(parent)}"` : ""}
           aria-label="${attr(label)}"${current ? ' aria-current="page"' : ""} data-testid="sidebar-row-card">
        <span class="sr-only">${attr(title)}</span>
        <div class="relative z-10">
          <div class="h-5"><img class="project-icon" alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><span class="truncate">${attr(project)}</span><span class="group/sidebar-status-slot">${attr(status ?? "3h")}</span></div>
          <div class="mt-1"><span aria-hidden="true" dir="auto" class="truncate">${attr(title)}</span></div>
          <div class="mt-0.5"><span class="branch">main</span><span aria-hidden="true" class="icons"><svg class="computer"></svg><span class="agent"></span></span></div>
        </div>
      </div>
    </li>`;
}

function sidebar(rows) {
  return `
  <div data-slot="sidebar-container">
    <div data-sidebar="sidebar" data-slot="sidebar-inner">
      <div data-slot="scroll-area"><div data-slot="scroll-area-viewport">
        <div data-sidebar="content" data-slot="sidebar-content">
          <div data-slot="sidebar-group"><ul role="presentation" id="thread-list">${rows.join("")}</ul></div>
        </div>
      </div></div>
    </div>
  </div>`;
}

const ROWS = {
  bot: cardRow({ key: "env1:bot1", title: BOT_TITLE, status: "Working" }),
  helper: cardRow({ key: "env1:bot2", title: "[[t3plus:bot:v1]] Helper", project: "games" }),
  other: cardRow({ key: "env1:x1", title: "Fix login", project: "api" }),
  child: cardRow({ key: "env1:o1", title: "Draft release notes", status: "Working" }),
  child2: cardRow({ key: "env1:o2", title: "Compare hosting plans" }),
  worker: cardRow({ key: "env1:o3", title: "Worker: check calendar" }),
  workingShelf: cardRow({ key: "env1:o4", title: "Renew the domain", parent: "shelf:working", status: "Working" }),
  workingWorker: cardRow({ key: "env1:o9", title: "Worker: water the plants", parent: "shelf:working", status: "Working" }),
  settled: cardRow({ key: "env1:o5", title: "Archive invoices", parent: "shelf:settled" }),
  snoozed: cardRow({ key: "env1:o6", title: "Follow up next week", parent: "shelf:snoozed" }),
  subagent: cardRow({ key: "env1:o7", title: "/root/audit", parent: "env1:o1" }),
  otherEnv: cardRow({ key: "env2:o8", title: "Same name, other machine" }),
};
// The Assistant's threads that want the owner: unread done (T3's check), a question, a failed run.
const WANTING = {
  fresh: cardRow({ key: "env1:o10", title: "Book the dentist", status: "Done" }),
  asks: cardRow({ key: "env1:o11", title: "Pick a flight", status: "Input" }),
  broke: cardRow({ key: "env1:o12", title: "Sync the calendar", status: "Failed" }),
};

const FEED = parseBotFeedText(
  JSON.stringify({
    version: 1,
    environmentId: "env1",
    bots: { bot1: { text: "Started two threads.", role: "assistant", projectId: "p-ops", status: "idle", pinned: true, children: 2 } },
    threads: {
      o1: { title: "Draft release notes", projectId: "p-ops", status: "working", children: 3 },
      o2: { title: "Compare hosting plans", projectId: "p-ops", status: "idle", children: 0 },
      o4: { title: "Renew the domain", projectId: "p-ops", status: "working", children: 1 },
      x2: { title: "Another project's thread", projectId: "p-api", status: "idle" },
    },
  }),
);

function scanOf(rows, path = "/env1/x1") {
  const dom = createDom(path, sidebar(rows));
  const scan = scanSidebar(findSidebarInner(dom.window.document));
  return { dom, scan, bots: classifyBots(scan, DEFAULT_BOT_MARKER) };
}

const keys = (rows) => rows.map((r) => r.key);
const liKeys = (set) => [...set].map((li) => li.getAttribute("data-thread-item")).sort();

test("worker threads are skipped only when the title starts with the exact prefix", () => {
  const rows = [
    ROWS.bot,
    cardRow({ key: "env1:k1", title: "  Worker: leading spaces" }),
    cardRow({ key: "env1:k2", title: "Ask the Worker: later" }),
    cardRow({ key: "env1:k3", title: "worker: lower case" }),
  ];
  const { scan, bots } = scanOf(rows);
  const plan = planAssistantGroup({ scan, group: GROUP, bots, feed: FEED });
  assert.deepEqual(keys(plan.items), ["env1:k2", "env1:k3"]);
  assert.deepEqual(keys(plan.elsewhere), ["env1:k1"], "a skipped worker still reads as the Assistant's");
  const noPrefixes = planAssistantGroup({ scan, group: { ...GROUP, skipTitlePrefixes: undefined }, bots, feed: FEED });
  assert.deepEqual(keys(noPrefixes.items), ["env1:k1", "env1:k2", "env1:k3"], "no prefixes: nothing skipped");
});

test("the fold state is stored as one flag; older flags in storage are ignored", async () => {
  const storage = createFakeChromeStorage();
  const store = createGroupViewStore(storage.area, storage.onChanged);
  assert.deepEqual(await store.load(), { assistant: true }, "open by default");
  storage.area.data.set(STORAGE_KEYS.assistantGroup, { assistant: false, bots: false, expanded: false });
  assert.deepEqual(await store.load(), { assistant: false });
  storage.area.data.set(STORAGE_KEYS.assistantGroup, { normal: false });
  assert.deepEqual(await store.load(), { assistant: true });
});

test("bot feed: threads and thread state are parsed with safe defaults", () => {
  assert.equal(FEED.environmentId, "env1");
  const bot = FEED.entries.get("bot1");
  assert.deepEqual([bot.projectId, bot.status, bot.children], ["p-ops", "idle", 2]);
  assert.equal(FEED.threads.get("o1").children, 3);
  const odd = parseBotFeedText(JSON.stringify({ version: 1, bots: {}, threads: { a: { title: "x", status: "exploding", children: -4 }, b: { title: "" }, "c d": { title: "y" } } }));
  assert.deepEqual([...odd.threads.keys()], ["a"]);
  assert.equal(odd.threads.get("a").status, "idle");
  assert.equal(odd.threads.get("a").children, 0);
  // Feeds from before this version still parse (no threads section).
  assert.equal(parseBotFeedText(JSON.stringify({ version: 1, bots: { b: { text: "hi" } } })).threads.size, 0);
});

test("the Assistant heads its project's inbox threads, other bots follow, and the rest stays in the inbox or shelves", () => {
  const { scan, bots } = scanOf(Object.values(ROWS));
  const plan = planAssistantGroup({ scan, group: GROUP, bots, feed: FEED, routeKey: "env1:x1" });
  assert.equal(plan.header.thread.key, "env1:bot1");
  assert.equal(plan.header.label, "Dispatcher");
  assert.equal(plan.header.status, "working");
  // Only threads in T3's inbox (no shelf), in T3's order, with the feed's sub-thread count.
  assert.deepEqual(keys(plan.items), ["env1:o1", "env1:o2"]);
  assert.equal(plan.items[0].children, 3);
  assert.deepEqual(keys(plan.others), ["env1:bot2"], "every other bot row is in the Bots section");
  assert.equal(plan.hidden.size, 0);
  // The Assistant's threads elsewhere read as its own: in T3's shelves (o4, o9, o6, o5)
  // and the worker left in the inbox (o3); sub-threads and other projects never.
  assert.deepEqual(plan.elsewhere.map((t) => t.key).sort(), ["env1:o3", "env1:o4", "env1:o5", "env1:o6", "env1:o9"]);
  // Summary: o1 working (inbox), o4 working (in T3's Working shelf). o2 is read
  // (no status), so not done. The Working-shelf worker (o9) is skipped; settled and
  // snoozed threads are not counted.
  assert.equal(plan.working, 2);
  assert.equal(plan.openThreads, 3, "inbox and Working count once; workers, sub-threads, Snoozed and Settled are excluded");
});

test("summary counts threads T3 is not showing from the feed (a closed Working shelf)", () => {
  const { scan, bots } = scanOf([ROWS.bot, ROWS.child2]);
  const feed = parseBotFeedText(JSON.stringify({
    version: 1, environmentId: "env1", bots: { bot1: { projectId: "p-ops" } },
    threads: {
      o2: { title: "Compare hosting plans", projectId: "p-ops", status: "working" },
      r1: { title: "Running elsewhere", projectId: "p-ops", status: "working" },
      r2: { title: "Needs an answer", projectId: "p-ops", status: "attention" },
      r3: { title: "Worker: skipped", projectId: "p-ops", status: "working" },
      r4: { title: "Other project", projectId: "p-api", status: "working" },
      r5: { title: "Finished and read", projectId: "p-ops", status: "idle" },
    },
  }));
  const plan = planAssistantGroup({ scan, group: GROUP, bots, feed });
  // o2 is on screen: T3's row (no status: read) wins over the feed's "working".
  assert.equal(plan.working, 1);
  assert.deepEqual(plan.requests, { approvals: 0, questions: 0, attention: 1, failed: 0 });
  assert.equal(plan.openThreads, 4, "includes read threads and threads in a closed shelf without duplicating rendered rows");
});

test("a brand-new thread not yet in the feed joins by the header's project label", () => {
  const fresh = cardRow({ key: "env1:new", title: "Just started" });
  const { scan, bots } = scanOf([ROWS.bot, fresh, ROWS.other]);
  assert.deepEqual(keys(planAssistantGroup({ scan, group: GROUP, bots, feed: FEED }).items), ["env1:new"]);
  // Without the header row on screen there is nothing to compare with: not guessed.
  const alone = scanOf([fresh]);
  assert.deepEqual(planAssistantGroup({ scan: alone.scan, group: GROUP, bots: alone.bots, feed: FEED }).items, []);
});

test("the bot always heads the bots: drawn from the feed when T3 shows no row for it", () => {
  const { scan, bots } = scanOf([ROWS.child, ROWS.other]);
  const plan = planAssistantGroup({ scan, group: GROUP, bots, feed: FEED, knownBots: { "env1:bot1": { title: BOT_TITLE } } });
  assert.equal(plan.header.thread, null);
  assert.equal(plan.header.key, "env1:bot1");
  assert.equal(plan.header.label, "Dispatcher");
  assert.equal(plan.header.status, "idle");
  assert.deepEqual(keys(plan.items), ["env1:o1"]);
  assert.equal(planAssistantGroup({ scan, group: GROUP, bots, feed: FEED }).header.label, "Assistant");
  assert.equal(planAssistantGroup({ scan: { threads: [] }, group: GROUP, feed: null }), null);
  assert.equal(planAssistantGroup({ scan, group: null, feed: FEED }), null);
});

test("a folded Assistant hides its rows, except the open thread", () => {
  const { scan, bots } = scanOf([ROWS.bot, ROWS.helper, ROWS.child, ROWS.child2, ROWS.other, ROWS.worker]);
  const foldedAssistant = planAssistantGroup({ scan, group: GROUP, bots, feed: FEED, routeKey: "env1:o2", view: { assistant: false } });
  assert.deepEqual(liKeys(foldedAssistant.hidden), ["env1:o1"], "only the Assistant's threads fold, the open one stays");
});

test("mergeGroupVisibility: the Assistant's rows follow it through profiles; closed sections hide", () => {
  const { scan, bots } = scanOf([ROWS.bot, ROWS.child, ROWS.child2, ROWS.other]);
  const li = (key) => scan.threads.find((t) => t.key === key).li;
  const plan = planAssistantGroup({ scan, group: GROUP, bots, feed: FEED });
  const profileHid = { hidden: new Set([li("env1:o1"), li("env1:o2"), li("env1:x1")]), outside: null, visibleThreads: 1 };
  assert.deepEqual(liKeys(mergeGroupVisibility(profileHid, plan, true).hidden), ["env1:x1"]);
  assert.deepEqual(liKeys(mergeGroupVisibility({ hidden: new Set(), outside: null }, plan, false).hidden), ["env1:bot1", "env1:o1", "env1:o2"]);
  assert.equal(mergeGroupVisibility(profileHid, null, true), profileHid);
});

// ---------- In the app (jsdom) ----------

function startApp(rows, { path = "/env1/x1", feed = FEED, storage = createFakeChromeStorage(), group = GROUP } = {}) {
  const dom = createDom(path, sidebar(rows));
  const botFeed = { readCache: async () => feed, load: async () => feed };
  const groupViewStore = createGroupViewStore(storage.area, storage.onChanged);
  const { app } = createApp(dom, storage, { assistantGroup: group, groupViewStore, botFeed });
  return { dom, doc: dom.window.document, app, storage };
}

const listKeys = (doc) => [...doc.querySelectorAll("#thread-list > li")].map((li) => li.getAttribute("data-thread-item") ?? li.getAttribute("data-t3plus-section") ?? li.getAttribute(T3PLUS.standInAttr));
const order = (doc, key) => Number(doc.querySelector(`[data-thread-item="${key}"], [data-t3plus-section="${key}"]`).style.getPropertyValue("--t3plus-group-order") || 0);

test("app: bots on top, then the inbox; rows are ordered with CSS order, never moved", async () => {
  const rows = [ROWS.other, ROWS.child, ROWS.helper, ROWS.bot, ROWS.child2, ROWS.workingShelf, ROWS.settled];
  const { doc, app } = startApp(rows);
  const t3Order = listKeys(doc);
  await app.start();
  app.watcher.flush();

  // T3's <li>s are the same nodes in the same DOM order.
  assert.deepEqual(listKeys(doc).filter((k) => t3Order.includes(k)), t3Order);
  const sequence = ["env1:bot1", "env1:o1", "env1:o2", "env1:bot2", "env1:x1"].map((k) => order(doc, k));
  assert.deepEqual([...sequence].sort((a, b) => a - b), sequence, "Assistant, its threads, other bots, then inbox rows");
  assert.equal(doc.querySelector('[data-t3plus-section="bots"]'), null, "no Bots header: bots are always on top");
  assert.equal(doc.querySelector('[data-t3plus-section="normal"]'), null, "the inbox has no extra section header");
  // Rows outside the sections keep their place: no group attribute, no order (T3's Working and Settled shelves).
  for (const key of ["env1:x1", "env1:o4", "env1:o5"]) {
    const li = doc.querySelector(`[data-thread-item="${key}"]`);
    assert.equal(li.hasAttribute(T3PLUS.groupAttr), false, key);
    assert.equal(li.getAttribute("style"), null, key);
  }
  assert.equal(doc.querySelector('[data-thread-item="env1:bot2"]').getAttribute(T3PLUS.groupAttr), "bot");
  // Sub-thread count on the Assistant's threads only.
  assert.equal(doc.querySelector('[data-thread-item="env1:o1"] [dir="auto"]').getAttribute(T3PLUS.subCountAttr), "3");
  assert.equal(doc.querySelector('[data-thread-item="env1:o2"] [dir="auto"]').hasAttribute(T3PLUS.subCountAttr), false);
  assert.equal(doc.querySelector(".t3plus-group-end"), null, "no separator line between bots and the inbox");
  assert.equal(doc.querySelector(`[${T3PLUS.standInAttr}]`), null, "every row is T3's own");
  app.stop();
  assert.equal(doc.querySelector(`[${T3PLUS.groupAttr}]`), null);
  assert.equal(doc.querySelector("[data-t3plus-section]"), null);
  assert.equal(doc.querySelector(`[${T3PLUS.subCountAttr}]`), null);
});

test("app: restored custom marker does not hide default-marked bots when it matches no visible rows", async () => {
  const storage = createFakeChromeStorage();
  storage.area.data.set(STORAGE_KEYS.configLocal, {
    use: "local",
    text: JSON.stringify({ version: 1, botMarker: "[[old:bot]]", profiles: [] }),
  });
  const { doc, app } = startApp([ROWS.bot, ROWS.helper, ROWS.other], { storage });
  await app.start();
  app.watcher.flush();

  assert.equal(app.state.loaded.source, "local");
  assert.equal(app.state.loaded.config.botMarker, "[[old:bot]]");
  assert.deepEqual(app.state.bots.map((bot) => bot.key), ["env1:bot1", "env1:bot2"]);
  for (const key of ["env1:bot1", "env1:bot2"]) {
    const row = doc.querySelector(`[data-sidebar-row="${key}"]`);
    assert.equal(row.getAttribute(T3PLUS.botAttr) !== null, true, key);
    assert.equal(row.querySelectorAll(".t3plus-bot-avatar").length, 1, key);
    assert.equal(row.querySelector(`[${T3PLUS.botTitleAttr}]`).textContent.includes("[[t3plus:bot:v1]]"), true, key);
  }
  app.stop();
});

test("app: a custom marker stays authoritative when it matches a visible bot", async () => {
  const storage = createFakeChromeStorage();
  storage.area.data.set(STORAGE_KEYS.configLocal, {
    use: "local",
    text: JSON.stringify({ version: 1, botMarker: "[[old:bot]]", profiles: [] }),
  });
  const custom = cardRow({ key: "env1:custom", title: "[[old:bot]] Custom", project: "ops" });
  const { doc, app } = startApp([ROWS.bot, custom, ROWS.other], { storage });
  await app.start();
  app.watcher.flush();

  assert.deepEqual(app.state.bots.map((bot) => bot.key), ["env1:custom"]);
  assert.equal(doc.querySelector('[data-sidebar-row="env1:bot1"]').hasAttribute(T3PLUS.botAttr), false);
  assert.equal(doc.querySelector('[data-sidebar-row="env1:custom"]').hasAttribute(T3PLUS.botAttr), true);
  app.stop();
});

test("app: inbox rows stay visible when legacy Normal state is closed", async () => {
  const storage = createFakeChromeStorage();
  storage.area.data.set(STORAGE_KEYS.assistantGroup, { normal: false, assistant: true });
  const { doc, app } = startApp([ROWS.bot, ROWS.helper, ROWS.child, ROWS.other, ROWS.worker], { storage, path: "/env1/o1" });
  await app.start();
  app.watcher.flush();
  const hidden = (key) => doc.querySelector(`[data-thread-item="${key}"]`).hasAttribute("hidden");
  assert.equal(doc.querySelector('[data-t3plus-section="normal"]'), null);
  assert.deepEqual(["env1:bot1", "env1:bot2", "env1:o1", "env1:x1", "env1:o3"].map(hidden), [false, false, false, false, false]);
  assert.deepEqual(storage.area.data.get(STORAGE_KEYS.assistantGroup), { normal: false, assistant: true }, "legacy state is left readable but no longer controls the inbox");
  app.stop();
  assert.equal(hidden("env1:x1"), false);

  // A new tab reads the saved state.
  const next = startApp([ROWS.bot, ROWS.child, ROWS.other], { storage, path: "/env1/o1" });
  await next.app.start();
  next.app.watcher.flush();
  assert.equal(next.doc.querySelector('[data-thread-item="env1:x1"]').hasAttribute("hidden"), false);
  next.app.stop();
});

test("app: the Assistant's threads in T3's shelves (and workers in the inbox) show its name, no project name or branch", async () => {
  const { doc, app } = startApp([ROWS.bot, ROWS.child, ROWS.workingShelf, ROWS.worker, ROWS.other]);
  await app.start();
  app.watcher.flush();
  for (const key of ["env1:o4", "env1:o3"]) {
    const row = doc.querySelector(`[data-sidebar-row="${key}"]`);
    assert.equal(row.hasAttribute("data-t3plus-via"), true, key);
    assert.equal(row.querySelector(".h-5 > .truncate").getAttribute("data-t3plus-via-label"), "Dispatcher");
    assert.equal(row.querySelector(".h-5 > .t3plus-via-icon"), null, "T3's own project icon stays");
    assert.equal(row.querySelector(".h-5 > .truncate").textContent, "ops", "T3's text is untouched");
    assert.equal(doc.querySelector(`[data-thread-item="${key}"]`).hasAttribute(T3PLUS.groupAttr), false, "stays in T3's place");
  }
  assert.equal(doc.querySelector('[data-sidebar-row="env1:x1"]').hasAttribute("data-t3plus-via"), false, "other projects untouched");
  assert.equal(doc.querySelector('[data-sidebar-row="env1:o1"]').hasAttribute("data-t3plus-via"), false, "rows under the Assistant need no label");
  app.stop();
  assert.equal(doc.querySelector("[data-t3plus-via], .t3plus-via-icon, [data-t3plus-via-label]"), null);
});

test("app: the Assistant's second line is its summary and chevron; the chevron folds only its threads", async () => {
  const storage = createFakeChromeStorage();
  const { dom, doc, app } = startApp([ROWS.bot, ROWS.helper, ROWS.child, ROWS.child2, ROWS.workingShelf, ROWS.other], { storage });
  let rowClicks = 0;
  doc.querySelector('[data-sidebar-row="env1:bot1"]').addEventListener("click", () => (rowClicks += 1));
  await app.start();
  app.watcher.flush();
  const row = doc.querySelector('[data-sidebar-row="env1:bot1"]');
  // No latest message on the Assistant: its second line describes the workload.
  assert.equal(row.querySelector(`[${T3PLUS.botTitleAttr}]`).getAttribute(T3PLUS.botTitleAttr), "");
  const summary = row.querySelector("[data-t3plus-bot-title-line] > .t3plus-bot-summary");
  assert.ok(summary, "in the Assistant's second line");
  assert.equal(summary.hasAttribute("data-t3plus-bot-hide"), false);
  const chips = [...summary.querySelectorAll(".t3plus-bot-summary-count")].map((c) => [c.dataset.status, c.textContent]);
  assert.deepEqual(chips, [["working", "2 threads running · 3 open"]], "running work and the total open-thread count");
  assert.equal(summary.querySelector(".t3plus-bot-summary-counts").getAttribute("aria-label"), "2 threads running · 3 open");
  const toggle = summary.querySelector(".t3plus-bot-summary-toggle");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  toggle.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await settle();
  assert.equal(rowClicks, 0, "the chevron does not open the bot thread");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  const hidden = (key) => doc.querySelector(`[data-thread-item="${key}"]`).hasAttribute("hidden");
  assert.deepEqual(["env1:o1", "env1:o2", "env1:bot1", "env1:bot2", "env1:x1"].map(hidden), [true, true, false, false, false]);
  assert.deepEqual(storage.area.data.get(STORAGE_KEYS.assistantGroup), { assistant: false });
  app.stop();
  assert.equal(doc.querySelector(".t3plus-bot-summary"), null);
});

test("app: an idle Assistant still shows its open-thread count", async () => {
  const idleFeed = parseBotFeedText(JSON.stringify({
    version: 1,
    environmentId: "env1",
    bots: { bot1: { projectId: "p-ops", status: "idle" } },
    threads: { o2: { title: "Compare hosting plans", projectId: "p-ops", status: "idle" } },
  }));
  const { doc, app } = startApp([ROWS.bot, ROWS.child2], { feed: idleFeed });
  await app.start();
  app.watcher.flush();
  const counts = doc.querySelector(".t3plus-bot-summary-counts");
  assert.equal(counts.textContent, "1 open thread");
  assert.equal(counts.querySelector(".t3plus-bot-summary-count").dataset.status, "open");
  assert.equal(counts.getAttribute("aria-label"), "1 open thread");
  app.stop();
});

test("app: visible finished threads keep their own Done status without a duplicate summary check", async () => {
  const { dom, doc, app } = startApp([ROWS.bot, WANTING.fresh, ROWS.other], { feed: null });
  await app.start();
  try {
    app.watcher.flush();
    const counts = doc.querySelector(".t3plus-bot-summary-counts");
    const finished = doc.querySelector('[data-thread-item="env1:o10"]');
    const status = finished.querySelector('[class="group/sidebar-status-slot"]');
    for (const expanded of [true, false]) {
      assert.equal(doc.querySelector(".t3plus-bot-summary-toggle").getAttribute("aria-expanded"), String(expanded));
      assert.equal(counts.querySelector('[data-status="done"]'), null);
      assert.equal(counts.querySelector("svg"), null);
      assert.equal(counts.getAttribute("aria-label"), "1 open thread");
      assert.equal(finished.hidden, false, "finished thread stays visible while folded");
      assert.equal(status.textContent, "Done", "T3 keeps the thread's own status");
      if (expanded) {
        doc.querySelector(".t3plus-bot-summary-toggle").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
        await settle();
      }
    }
  } finally {
    app.stop();
  }
});

test("folded, the Assistant keeps threads that want you (unread done, a question, failed) until read", async () => {
  const rows = [ROWS.bot, ROWS.child, ROWS.child2, WANTING.fresh, WANTING.asks, WANTING.broke, ROWS.other];
  const { scan, bots } = scanOf(rows);
  const plan = planAssistantGroup({ scan, group: GROUP, bots, feed: FEED, view: { assistant: false } });
  // Working: o1, and o4 from the feed (not on screen).
  assert.equal(plan.working, 2);
  assert.deepEqual(liKeys(plan.hidden), ["env1:o1", "env1:o2"], "read and running threads fold; o10, o11, o12 stay");
  // Opened and left: T3 drops the Done status (read), and the row folds away.
  const read = scanOf([ROWS.bot, ROWS.child, ROWS.child2, cardRow({ key: "env1:o10", title: "Book the dentist" }), WANTING.asks, WANTING.broke, ROWS.other]);
  const after = planAssistantGroup({ scan: read.scan, group: GROUP, bots: read.bots, feed: FEED, view: { assistant: false } });
  assert.deepEqual(liKeys(after.hidden), ["env1:o1", "env1:o10", "env1:o2"]);
  // While open it stays, whatever its status.
  const open = planAssistantGroup({ scan: read.scan, group: GROUP, bots: read.bots, feed: FEED, routeKey: "env1:o10", view: { assistant: false } });
  assert.deepEqual(liKeys(open.hidden), ["env1:o1", "env1:o2"]);
});

test("CSS: one-line rows also under Title first (no dot line), and no 2rem status slot", async () => {
  const css = (await import("node:fs")).readFileSync(new URL("../src/styles/content.css", import.meta.url), "utf8");
  const block = css.split("/* ---------- The Assistant's threads: one line ----------")[1].split("/* Settle is just its check mark")[0];
  assert.match(block, /> \.mt-0\\\.5::before \{\s*content: none !important;/);
  assert.match(block, /min-width: 0 !important;/);
});

test("app: the drawn bot row opens its thread through T3's router", async () => {
  const { dom, doc, app } = startApp([ROWS.child, ROWS.other]);
  await app.start();
  app.watcher.flush();
  const header = doc.querySelector(`[${T3PLUS.standInAttr}="env1:bot1"]`);
  assert.equal(header.getAttribute(T3PLUS.groupAttr), "header");
  assert.ok(header.querySelector(".t3plus-bot-avatar").style.getPropertyValue("--t3plus-bot-fill"));
  assert.equal(header.querySelector(".t3plus-standin-title"), null, "no latest message: the summary line instead");
  assert.ok(header.querySelector(".t3plus-bot-summary .t3plus-bot-summary-toggle"));

  const pops = [];
  dom.window.addEventListener("popstate", (event) => pops.push(event.state));
  dom.window.history.replaceState({ __TSR_index: 4, key: "k", __TSR_key: "k" }, "");
  header.querySelector('[role="button"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(dom.window.location.pathname, "/env1/bot1");
  assert.equal(pops.length, 1);
  assert.equal(pops[0].__TSR_index, 5, "the next history entry, as T3's router expects");
  app.stop();
});

test("app: sections off with Bots off, and without a configured group", async () => {
  const { doc, app } = startApp([ROWS.bot, ROWS.child]);
  await app.start();
  app.watcher.flush();
  assert.ok(doc.querySelector(`[${T3PLUS.groupAttr}]`));
  await app.actions.setSidebarFeature("bots", false);
  app.watcher.flush();
  assert.equal(doc.querySelector(`[${T3PLUS.groupAttr}]`), null);
  app.stop();

  const off = startApp([ROWS.bot, ROWS.child], { group: null });
  await off.app.start();
  off.app.watcher.flush();
  assert.equal(off.doc.querySelector(`[${T3PLUS.groupAttr}]`), null);
  off.app.stop();
});

test("CSS: the Assistant's threads are one line (title, agent icon, status); branch, computer and project hidden", async () => {
  const css = (await import("node:fs")).readFileSync(new URL("../src/styles/content.css", import.meta.url), "utf8");
  const block = css.split("/* ---------- The Assistant's threads: one line ----------")[1].split("/* Settle is just its check mark")[0];
  assert.match(block, /> \.h-5 > :not\(\.group\\\/sidebar-status-slot\)/, "project icon, pin and name hidden");
  assert.match(block, /> \.mt-0\\\.5 > :not\(\[aria-hidden="true"\]\)/, "branch hidden");
  assert.match(block, /> :not\(:last-child\) \{\s*display: none/, "computer icon hidden, agent icon (last) kept");
});
