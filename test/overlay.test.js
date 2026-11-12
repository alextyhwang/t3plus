// The overlay must stay small: t3+ decorates T3's own rows in place and adds
// exactly one compact strip to the sidebar. These tests use T3's current card
// row markup (SidebarThreadRow.tsx, card variant) and check content.css sizes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { T3PLUS } from "../src/config.js";
import { createApp, createDom, createFakeRemote, SAMPLE_CONFIG } from "./helpers.js";

const css = await readFile(new URL("../src/styles/content.css", import.meta.url), "utf8");
const attr = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** One row shaped like T3's card variant: sr-only title first, three lines, visible title on line 2. */
function cardRowHtml({ key, title, project, status = null, time = "5h", branch = "main", pinned = false }) {
  const label = [title, status, project].filter(Boolean).join(", ");
  return `
    <li data-thread-item="${attr(key)}" class="list-none py-0.5">
      <div role="button" tabindex="0" data-sidebar-row="${attr(key)}" aria-label="${attr(label)}" data-testid="sidebar-row-card"
           class="group/sidebar-row relative w-full cursor-pointer overflow-hidden rounded-md">
        <span class="sr-only">${attr(title)}</span>
        <div class="relative z-10 h-[4.875rem]">
          <div class="flex h-5 min-w-0 items-center gap-1.5">
            <img class="size-4 shrink-0" alt="">${pinned ? '<svg role="img" aria-label="Pinned"></svg>' : ""}
            <span class="min-w-0 flex-1 truncate text-xs">${attr(project)}</span>
            <span class="ml-auto flex h-5"><span class="flex items-center">${attr(status ?? time)}</span></span>
          </div>
          <div class="mt-1 flex min-w-0 items-center gap-1.5">
            <span aria-hidden="true" dir="auto" class="min-w-0 flex-1 truncate text-sm font-medium">${attr(title)}</span>
          </div>
          <div class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs"><span class="flex min-w-0 flex-1">${attr(branch)}</span></div>
        </div>
      </div>
    </li>`;
}

const BOT = { key: "env1:bot1", title: "[[t3plus:bot:v1]] Orchestrator", project: "ops", status: "Working", pinned: true };
const PLAIN = [
  { key: "env1:a1", title: "Fix login redirect", project: "acme-api", pinned: true },
  { key: "env1:w1", title: "Landing page hero", project: "acme-web", status: "Approval" },
  { key: "env2:n1", title: "Weekly notes", project: "notes" },
];

function cardSidebarHtml() {
  return `
  <div data-slot="sidebar-container">
    <div data-sidebar="sidebar" data-slot="sidebar-inner">
      <div class="relative flex h-[var(--workspace-topbar-height)]" id="t3-topbar">T3 Code</div>
      <div class="w-full shrink-0" id="t3-search"><div data-slot="sidebar-group"><input type="search" aria-label="Search threads"></div></div>
      <div data-slot="scroll-area" id="t3-scroll">
        <div data-slot="scroll-area-viewport">
          <div data-sidebar="content" data-slot="sidebar-content">
            <div data-slot="sidebar-group"><ul role="presentation" id="thread-list">${[BOT, ...PLAIN].map(cardRowHtml).join("")}</ul></div>
          </div>
        </div>
      </div>
      <div data-slot="sidebar-footer" id="t3-footer"></div>
    </div>
  </div>`;
}

const rowKeys = (doc) => [...doc.querySelectorAll("#thread-list > li")].map((li) => li.getAttribute("data-thread-item"));

test("a marked bot row is decorated in place; untagged rows and row order are untouched", async () => {
  const dom = createDom("/env1/a1", cardSidebarHtml());
  const doc = dom.window.document;
  const before = Object.fromEntries(PLAIN.map((t) => [t.key, doc.querySelector(`[data-thread-item="${t.key}"]`).outerHTML]));
  const botLi = doc.querySelector('[data-thread-item="env1:bot1"]');
  const botRow = botLi.querySelector("[data-sidebar-row]");
  const order = rowKeys(doc);
  let clicks = 0;
  botRow.addEventListener("click", () => (clicks += 1));

  const { app } = createApp(dom, undefined, { remote: createFakeRemote(SAMPLE_CONFIG) });
  await app.start();
  app.watcher.flush();

  // Untagged rows: byte-for-byte the same.
  for (const t of PLAIN) assert.equal(doc.querySelector(`[data-thread-item="${t.key}"]`).outerHTML, before[t.key], t.key);
  // Same nodes, same order, nothing cloned or re-parented.
  assert.deepEqual(rowKeys(doc), order);
  assert.equal(doc.querySelector('[data-thread-item="env1:bot1"]'), botLi);
  assert.equal(doc.querySelectorAll('[data-thread-item="env1:bot1"]').length, 1);

  // The bot row keeps T3's role, focus order, label, title text and click handler.
  assert.equal(botRow.getAttribute("role"), "button");
  assert.equal(botRow.getAttribute("tabindex"), "0");
  assert.equal(botRow.getAttribute("aria-label"), "[[t3plus:bot:v1]] Orchestrator, Working, ops");
  assert.equal(botRow.querySelector(".sr-only").textContent, BOT.title);
  const title = botRow.querySelector(`[${T3PLUS.botTitleAttr}]`);
  assert.equal(title.textContent, BOT.title, "T3's visible title text is not rewritten");
  assert.equal(title.getAttribute(T3PLUS.botTitleAttr), "", "no feed loaded: no preview text");
  assert.equal(botRow.querySelector("[data-t3plus-bot-top]").getAttribute("data-t3plus-bot-name"), "Orchestrator");
  botRow.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(clicks, 1);

  // The row itself remains T3-owned; t3+ adds only the avatar, no BOT pill or shortcut.
  const owned = botRow.querySelectorAll(`[${T3PLUS.ownedAttr}]`);
  assert.deepEqual([...owned].map((el) => el.className), ["t3plus-bot-avatar"]);
  for (const el of owned) assert.equal(el.getAttribute("aria-hidden"), "true");
  assert.equal(botRow.querySelector(".t3plus-bot-chip"), null);
  app.stop();
});

test("the profile strip is the only element t3+ adds to the sidebar, between T3's search and its list", async () => {
  const dom = createDom("/env1/a1", cardSidebarHtml());
  const doc = dom.window.document;
  const { app } = createApp(dom, undefined, { remote: createFakeRemote(SAMPLE_CONFIG) });
  await app.start();
  app.watcher.flush();

  const inner = doc.querySelector('[data-slot="sidebar-inner"]');
  const strip = doc.getElementById(T3PLUS.profileBarId);
  assert.deepEqual([...inner.children].map((el) => el.id), ["t3-topbar", "t3-search", T3PLUS.profileBarId, "t3-scroll", "t3-footer"]);
  assert.equal(strip.previousElementSibling.id, "t3-search");
  assert.equal(strip.nextElementSibling.id, "t3-scroll");

  // One row: the tabs and the tiny source button. No bot shelf, avatars or extra rows.
  assert.equal(strip.children.length, 1);
  const tabs = [...strip.querySelectorAll(".t3plus-profile-tab")];
  assert.deepEqual(tabs.map((t) => t.textContent), ["All", "Work", "Personal"]);
  assert.equal(strip.querySelectorAll("button").length, tabs.length + 1);
  assert.equal(doc.querySelectorAll(".t3plus-bot-shelf, [data-bot-key]").length, 0);

  // Nothing else t3+ puts in the sidebar besides the strip and the bot row's own avatar.
  const extras = [...inner.querySelectorAll(`[${T3PLUS.ownedAttr}], [id^="t3plus"], [class*="t3plus"]`)].filter((el) => !strip.contains(el));
  assert.deepEqual(extras.map((el) => el.className), ["t3plus-bot-avatar"]);
  for (const el of extras) assert.equal(el.closest("[data-sidebar-row]").getAttribute("data-sidebar-row"), "env1:bot1");
  app.stop();
});

test("with the server file unavailable, the strip shows only All and a one-character diagnostic", async () => {
  const dom = createDom("/env1/a1", cardSidebarHtml());
  const doc = dom.window.document;
  const { app } = createApp(dom, undefined, { remote: createFakeRemote({ ok: false, status: 404 }) });
  await app.start();
  app.watcher.flush();
  const strip = doc.getElementById(T3PLUS.profileBarId);
  assert.deepEqual([...strip.querySelectorAll(".t3plus-profile-tab")].map((t) => t.textContent), ["All"]);
  const status = strip.querySelector(".t3plus-profile-status");
  assert.equal(status.textContent, "!");
  assert.match(status.title, /404/);
  assert.equal(doc.querySelectorAll(`[${T3PLUS.filteredAttr}]`).length, 0, "nothing hidden");
  app.stop();
});

// ---------- content.css sizes ----------

/** Body of the first rule whose selector list is exactly `selector`. */
function ruleBody(selector) {
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const clean = sel.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (clean === selector) return body;
  }
  assert.fail(`no rule for ${selector}`);
}
const rem = (body, prop) => {
  const match = body.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([\\d.]+)rem`));
  assert.ok(match, `${prop} in rem`);
  return Number(match[1]);
};

test("profile strip CSS keeps native, compact control sizes", () => {
  const tab = ruleBody(".t3plus-profile-tab");
  assert.ok(rem(tab, "height") <= 1.5, "tab no taller than T3's small controls");
  assert.ok(rem(tab, "font-size") <= 0.75);
  assert.match(tab, /font:\s*inherit/, "uses T3's font");
  assert.ok(rem(ruleBody(".t3plus-profile-status"), "height") <= 1.5);
  assert.ok(rem(ruleBody(".t3plus-profile-status"), "width") <= 1.5);

  const bar = ruleBody(".t3plus-profilebar");
  assert.match(bar, /padding:\s*0 var\(--sidebar-content-inset[^)]*\) 0\.25rem;/, "same inset as T3's sidebar groups, 4px below");
  assert.doesNotMatch(bar, /background|border|box-shadow/, "no panel or card around the strip");
  // Strip height: tab + the tabs container's 2px padding top and bottom + 4px bottom padding.
  const tabs = ruleBody(".t3plus-profile-tabs");
  assert.ok(rem(tab, "height") + 2 * rem(tabs, "padding") + 0.25 <= 2, "whole strip at most 2rem tall");
  // Colors come from T3's theme variables.
  assert.match(tabs, /var\(--sidebar-foreground/);
  assert.match(ruleBody('.t3plus-profile-tab[aria-pressed="true"]'), /var\(--sidebar-row-active/);
});

test("bot rows: a 2rem avatar, name + a one-line truncated preview, same compact height for every bot", () => {
  const avatar = ruleBody(".t3plus-bot-avatar");
  assert.equal(rem(avatar, "width"), 2);
  assert.equal(rem(avatar, "height"), 2);
  assert.match(avatar, /pointer-events:\s*none/);
  const preview = ruleBody("[data-t3plus-bot-title]::after");
  assert.match(preview, /white-space:\s*nowrap/);
  assert.match(preview, /text-overflow:\s*ellipsis/);
  assert.equal(rem(preview, "line-height"), 1.25, "same height as T3's title line");
  assert.doesNotMatch(css, /line-clamp:\s*2[^}]*\}[^{]*\[data-t3plus-bot/, "no two-line previews");
  assert.doesNotMatch(css, /\.t3plus-bot-metaline\s*\{/, "no model/computer line");
  assert.match(ruleBody("[data-t3plus-bot-body]"), /height:\s*auto !important/, "branch or not, bot rows are the same height");
  assert.doesNotMatch(css, /\.t3plus-bot-(chip|shelf)/);
});

test("bot rows show one status signal: the face, plus T3's colored label (its status icon and t3+'s dot are gone)", () => {
  assert.match(css, /\[data-t3plus-bot-status\] svg:not\(button svg\)\s*\{\s*display:\s*none !important;/);
  assert.doesNotMatch(css, /\.t3plus-bot-avatar::after/, "no status dot on the avatar");
});

test("compact sidebar header: hides only T3's logo row and puts T3's own sidebar control before the breadcrumbs", () => {
  assert.match(css, /html\[data-t3plus-compact-sidebar\] \[data-t3plus-logo-row\]\s*\{\s*display:\s*none !important;/);
  assert.doesNotMatch(css, /sidebar-inner"\] > :has\(a\[aria-label="T3 Code home"\]\)/, "never hide a whole sidebar child by its home link");
  assert.match(css, /html\[data-t3plus-control-in-header\] \[data-sidebar-control\]\s*\{\s*left: calc\(var\(--t3plus-sidebar-right/);
  assert.match(css, /html\[data-t3plus-control-in-header\] \[data-chat-header\]\s*\{\s*padding-left:/);
});

// Both sidebar shapes T3 has shipped: header, search and list straight in
// sidebar-inner, and the same rows inside one wrapper (the reported nightly).
const SIDEBAR_SHAPES = {
  flat: (rows) => `<div data-slot="sidebar-inner">${rows}<div data-slot="sidebar-footer">Settings</div></div>`,
  wrapped: (rows) => `<div data-slot="sidebar-inner"><div id="wrapper">${rows}<div data-slot="sidebar-footer">Settings</div></div></div>`,
};
const SIDEBAR_ROWS = `
    <div id="logo-row"><div id="logo-inner"><a aria-label="T3 Code home" href="/">T3 Code</a></div></div>
    <div id="search-row"><div data-slot="sidebar-group"><input aria-label="Search threads"></div></div>
    <div id="scroll-root"><div id="viewport"><div data-slot="sidebar-content"><ul>
      ${cardRowHtml({ key: "env1:a1", title: "Fix flaky test", project: "api" })}
    </ul></div></div></div>`;

for (const [shape, wrap] of Object.entries(SIDEBAR_SHAPES)) {
  test(`compact header hides only the logo row and the strip sits above the list (${shape} sidebar)`, async () => {
    const dom = createDom("/env1/a1", wrap(SIDEBAR_ROWS));
    const doc = dom.window.document;
    const { app } = createApp(dom, undefined, { remote: createFakeRemote(SAMPLE_CONFIG) });
    await app.start();
    app.watcher.flush();
    try {
      const style = doc.createElement("style");
      style.textContent = css.split("/* ---------- Compact sidebar header ---------- */")[1]
        .split("/* ---------- Title-first thread rows ----------")[0];
      doc.head.append(style);
      doc.documentElement.setAttribute(T3PLUS.compactAttr, "");
      const display = (selector) => dom.window.getComputedStyle(doc.querySelector(selector)).display;
      const bar = doc.getElementById(T3PLUS.profileBarId);
      assert.ok(bar, "profile strip mounted");
      assert.equal(bar.previousElementSibling?.id, "search-row", "strip follows the search row");
      assert.equal(bar.nextElementSibling?.id, "scroll-root", "strip sits right above the scroll area");
      assert.equal(doc.getElementById("logo-row").hasAttribute(T3PLUS.logoRowAttr), true);
      assert.equal(display("#logo-row"), "none", "logo row hidden");
      for (const selector of [`#${T3PLUS.profileBarId}`, "#search-row", "#scroll-root", '[data-slot="sidebar-content"]', '[data-slot="sidebar-footer"]']) {
        assert.notEqual(display(selector), "none", `${selector} remains visible`);
      }
      if (shape === "wrapped") assert.notEqual(display("#wrapper"), "none", "the wrapper around the whole sidebar stays visible");
      assert.equal(dom.window.getComputedStyle(doc.querySelector('[data-slot="sidebar-group"]')).justifyContent, "center", "search controls keep their topbar alignment");
      doc.documentElement.removeAttribute(T3PLUS.compactAttr);
      assert.notEqual(display("#logo-row"), "none", "turning compact header off restores the logo");
    } finally {
      app.stop();
      dom.window.close();
    }
  });
}

test("compact sidebar header follows T3's sidebar state and the setting", async () => {
  const html = `<div data-slot="sidebar-wrapper" data-sidebar-state="expanded">
    <div data-sidebar-control><button data-sidebar="trigger" aria-label="Toggle main sidebar"></button></div>
    <div data-slot="sidebar-inner"><div><a aria-label="T3 Code home">T3</a></div>
      <ul><li data-thread-item="env1:a1"><div data-sidebar-row="env1:a1" aria-label="A"><span class="sr-only">A</span></div></li></ul></div>
    <main><header data-chat-header="true"><nav aria-label="Thread breadcrumb"><h2>A</h2></nav></header></main></div>`;
  const dom = createDom("/env1/a1", html);
  const doc = dom.window.document;
  doc.querySelector('[data-slot="sidebar-inner"]').getBoundingClientRect = () => ({ left: 0, right: 256, top: 0, bottom: 800, width: 256, height: 800 });
  const { app } = createApp(dom);
  try {
    await app.start();
    app.watcher.flush();
    const root = doc.documentElement;
    assert.ok(root.hasAttribute("data-t3plus-compact-sidebar"));
    assert.ok(root.hasAttribute("data-t3plus-control-in-header"));
    assert.equal(root.style.getPropertyValue("--t3plus-sidebar-right"), "256px");
    assert.ok(doc.querySelector('[data-sidebar-control] [data-sidebar="trigger"]'), "T3's button is not moved in the DOM");

    doc.querySelector('[data-slot="sidebar-wrapper"]').setAttribute("data-sidebar-state", "collapsed");
    app.watcher.flush();
    assert.equal(root.hasAttribute("data-t3plus-control-in-header"), false, "collapsed: T3's own layout");

    await app.actions.setSidebarFeature("compactHeader", false);
    app.watcher.flush();
    assert.equal(root.hasAttribute("data-t3plus-compact-sidebar"), false);
  } finally {
    app.stop();
  }
});
