import { applyAvatarVars, botTitleLabel, botTitleLine, isTopLevelThread, parseRowStatus, requestKind, resolveBotPresentation } from "./bots.js";
import { environmentFromKey as envOf, threadIdFromKey } from "./threadKey.js";
import { groupWorkloadSummary } from "./botSummary.js";
import { SIDEBAR_ROW_PREFIX, STORAGE_KEYS, T3_SELECTORS, T3PLUS } from "./config.js";
import { createBuilder, setText, syncAttr } from "./dom.js";
import { createKeyStore } from "./storage.js";

// Bots and inbox rows (with the Assistant group). The owner keeps one
// project run by bots and every other project as plain code (see
// docs/assistant-group.md). T3's thread list reads, top to bottom:
//
//   (bots)          the router bot (the Assistant), the threads it runs under it,
//                   then every other bot row; always on top, no header
//   (inbox)          T3's inbox, as T3 orders it
//   Working / Snoozed / Settled   T3's own shelves, untouched
//
// The Assistant's threads that sit elsewhere (a shelf, or a skipped worker in
// the inbox) keep T3's row but read as the Assistant's: its small face and name
// in place of the project icon and name, and no branch.
//
// The Assistant's threads are the other top-level threads of its project in
// T3's inbox, except worker threads whose title starts with one of the group's
// skipTitlePrefixes. A thread T3 puts in one of its shelves (Working while it
// runs, Snoozed, Settled) stays in that shelf.
//
// Rows stay T3's own: t3+ leaves them where they are in the DOM and orders them
// with CSS `order` (T3's list is a flex column), so T3's click, hover card,
// context menu, drag, active state and status keep working. Only the bot,
// once settled with its shelf closed, has no row on the page; t3+ then draws a
// look-alike from the bot feed that opens the thread. Nothing is written to T3.

/** Statuses that keep a thread visible under a folded Assistant (parseRowStatus values). */
const WANTS_OWNER = new Set(["done", "attention", "failed"]);

/** True when a title starts with one of `prefixes` (exact case): worker threads kept out of the group. */
export function hasSkippedPrefix(title, prefixes = []) {
  const text = String(title ?? "").trimStart();
  return prefixes.some((prefix) => prefix && text.startsWith(prefix));
}

/** T3's shelf for a row, from its data-sidebar-parent ("shelf:working" -> "working"), else null. */
export function rowShelf(thread) {
  const parent = thread?.parent ?? "";
  return parent.startsWith(SIDEBAR_ROW_PREFIX.shelf) ? parent.slice(SIDEBAR_ROW_PREFIX.shelf.length) : null;
}

/**
 * Decides the sections from a sidebar scan and the bot feed. Pure.
 * @param {{
 *   scan: ReturnType<import("./sidebar.js").scanSidebar>,
 *   group: { botThreadId: string, projectId: string | null, skipTitlePrefixes?: string[] },
 *   bots?: Array<{ key: string, thread: object }>,   classifyBots result (every bot row)
 *   feed?: ReturnType<import("./botFeed.js").parseBotFeedText> | null,
 *   knownBots?: Record<string, { title: string }>,
 *   marker?: string,                               effective bot title marker
 *   routeKey?: string | null,
 *   view?: { assistant: boolean },                       open (true) or closed
 * }} input
 * @returns {null | {
 *   header: { key, thread, label, status, current },             the Assistant
 *   working: number,                                             its threads running (or waiting)
 *   requests: { approvals, questions, attention, failed },        actionable work, when its kind is known
 *   openThreads: number,                                         inbox and Working, including read threads
 *   items: Array<{ key, thread, status, children, current }>,     its threads
 *   others: Array<{ key, thread, current }>,                      other bot rows
 *   elsewhere: Array<thread>,           the Assistant's threads in a shelf or inbox (worker)
 *   view, hidden: Set<Element>,                                   <li>s a closed section hides
 * }}
 */
export function planAssistantGroup({ scan, group, bots = [], feed = null, knownBots = {}, marker, routeKey = null, view: viewIn = {} }) {
  const view = { assistant: viewIn.assistant !== false };
  if (!group?.botThreadId) return null;
  const headerThread = scan.threads.find((t) => threadIdFromKey(t.key) === group.botThreadId && isTopLevelThread(t)) ?? null;
  const environmentId = headerThread ? envOf(headerThread.key) : feed?.environmentId ?? (scan.threads[0] ? envOf(scan.threads[0].key) : null);
  if (!environmentId) return null;
  const headerKey = `${environmentId}:${group.botThreadId}`;
  const botEntry = feed?.entries.get(group.botThreadId) ?? null;
  const projectId = group.projectId ?? botEntry?.projectId ?? null;
  const headerProject = headerThread ? headerThread.folderKey ?? headerThread.projectKey : null;
  const isCurrent = (thread) => thread.key === routeKey || thread.current;

  /** Feed knowledge of a thread: an active project thread or a bot. */
  const feedOf = (id) => feed?.threads?.get(id) ?? feed?.entries.get(id) ?? null;
  const inProject = (thread) => {
    if (envOf(thread.key) !== environmentId) return false;
    const known = feedOf(threadIdFromKey(thread.key));
    if (known?.projectId && projectId) return known.projectId === projectId;
    // Not in the feed yet (a brand-new thread): same project label as the header row.
    const project = thread.folderKey ?? thread.projectKey;
    return Boolean(headerProject && project && project === headerProject);
  };

  const botKeys = new Set(bots.map((b) => b.key));
  const isAssistants = (thread) => !botKeys.has(thread.key) && !hasSkippedPrefix(thread.title, group.skipTitlePrefixes) && inProject(thread);
  const items = [];
  const others = [];
  const elsewhere = [];
  const openThreadIds = new Set();
  // The Assistant's threads by status, wherever T3 shows them (its inbox, or
  // the Working shelf while they run), for the summary on the Assistant's row.
  let working = 0;
  const requests = { approvals: 0, questions: 0, attention: 0, failed: 0 };
  const count = (status, kind = null) => {
    if (status === "working" || status === "waiting") working += 1;
    if (status === "failed") requests.failed += 1;
    else if (status === "attention") {
      if (kind === "approval") requests.approvals += 1;
      else if (kind === "question") requests.questions += 1;
      else requests.attention += 1;
    }
  };
  const rendered = new Set();
  for (const thread of scan.threads) {
    rendered.add(threadIdFromKey(thread.key));
    if (thread === headerThread || !isTopLevelThread(thread)) continue;
    const shelf = rowShelf(thread);
    if (shelf === "working" && isAssistants(thread)) count(parseRowStatus(thread.ariaLabel, thread.title), requestKind(thread));
    if ((!shelf || shelf === "working") && isAssistants(thread)) openThreadIds.add(threadIdFromKey(thread.key));
    // T3's shelves (Working, Snoozed, Settled) keep their threads; the Assistant's read as its own.
    if (shelf) {
      if (!botKeys.has(thread.key) && inProject(thread)) elsewhere.push(thread);
      continue;
    }
    if (botKeys.has(thread.key)) {
      others.push({ key: thread.key, thread, current: isCurrent(thread) });
    } else if (isAssistants(thread)) {
      const status = parseRowStatus(thread.ariaLabel, thread.title);
      items.push({ key: thread.key, thread, status, children: feedOf(threadIdFromKey(thread.key))?.children ?? 0, current: isCurrent(thread) });
      count(status, requestKind(thread));
    } else if (inProject(thread)) {
      elsewhere.push(thread);
    }
  }
  // Threads T3 is not showing (a closed Working shelf): the feed's word on them.
  for (const [id, entry] of feed?.threads ?? []) {
    if (rendered.has(id) || id === group.botThreadId || (projectId && entry.projectId !== projectId)) continue;
    if (hasSkippedPrefix(entry.title, group.skipTitlePrefixes)) continue;
    openThreadIds.add(id);
    count(entry.status);
  }

  const knownTitle = headerThread?.title ?? knownBots[headerKey]?.title ?? "";
  const header = {
    key: headerKey,
    thread: headerThread,
    label: botTitleLabel(knownTitle, marker) || "Assistant",
    status: headerThread ? parseRowStatus(headerThread.ariaLabel, headerThread.title) : botEntry?.status ?? "idle",
    current: headerKey === routeKey,
  };

  // The Assistant's own chevron folds just its threads, except the open one (as
  // T3's shelves do) and those that want the owner (unread done, a question or approval, failed):
  // once read and left, T3 drops their status and they fold away.
  const hidden = new Set();
  if (!view.assistant) for (const item of items) if (!item.current && !WANTS_OWNER.has(item.status)) hidden.add(item.thread.li);
  return {
    header,
    working,
    requests,
    items,
    others,
    elsewhere,
    openThreads: openThreadIds.size,
    view,
    hidden,
  };
}

/**
 * Profile visibility with the sections applied. The Assistant's rows follow
 * its header (shown while the profile keeps the bot); a closed section hides
 * its rows; everything else keeps the profile's decision.
 */
export function mergeGroupVisibility(visibility, plan, groupVisible) {
  if (!plan) return visibility;
  const hidden = new Set(visibility.hidden);
  for (const li of [plan.header.thread?.li, ...plan.items.map((item) => item.thread.li)].filter(Boolean)) {
    if (groupVisible && !plan.hidden.has(li)) hidden.delete(li);
    else hidden.add(li);
  }
  for (const li of plan.hidden) hidden.add(li);
  return { ...visibility, hidden };
}

export function normalizeGroupView(raw) {
  return { assistant: raw?.assistant !== false };
}

/** Which Assistant group sections are open, in extension storage (a viewing choice). */
export function createGroupViewStore(area, changedEvent) {
  return createKeyStore(area, changedEvent, STORAGE_KEYS.assistantGroup, normalizeGroupView);
}

// Lucide icons (T3 uses lucide-react).
const ICONS = {
  working: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  attention: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  failed: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  // T3's shelf headers: ChevronDownIcon, turned -90deg while closed.
  chevron: '<path d="m6 9 6 6 6-6"/>',
};
const STATUS_LABEL = { working: "Working", attention: "Needs input", failed: "Failed" };
function svg(doc, name) {
  const el = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("class", `t3plus-icon t3plus-icon-${name}`);
  el.innerHTML = ICONS[name];
  return el;
}

// Orders inside T3's flex list. T3's own items are all 0.
const ORDER = { assistant: -10000 };
const setOrder = (li, order) => {
  const value = String(order);
  if (li.style.getPropertyValue("--t3plus-group-order") !== value) li.style.setProperty("--t3plus-group-order", value);
};

/** T3's thread list: the flex column holding the row <li>s. */
export function findThreadList(inner, scan) {
  const li = scan?.threads.find((t) => t.li.parentElement)?.li;
  return li?.parentElement ?? inner?.querySelector(T3_SELECTORS.threadList) ?? null;
}

/**
 * Draws the sections into T3's list. Idempotent: re-running after every DOM
 * check writes only what changed. Run it after bots.js decorateBotRows for the
 * same scan: the Assistant's summary goes on the bot row's botTitleLine, and
 * decorateBotRows leaves that line's preview to it (its ownedSecondLine).
 * @param {{
 *   doc, list: Element | null, plan: ReturnType<typeof planAssistantGroup>,
 *   visible: boolean,               false while the active profile hides the Assistant
 *   botPrefs: Record<string, object>,
 *   text: (kind: "bot", value: string) => string,   t3+-drawn text, covered in screenshot mode
 *   onToggle: () => void, onOpen: (key: string) => void,
 * }} options
 */
export function syncAssistantGroup({ doc, list, plan, visible = true, botPrefs = {}, text = (_k, v) => v, onToggle, onOpen }) {
  const root = list ?? doc;
  const lifted = new Set();
  const owned = new Set();
  const via = new Set();
  if (list && plan) {
    const h = createBuilder(doc);
    const lift = (li, role, order) => {
      lifted.add(li);
      syncAttr(li, T3PLUS.groupAttr, role);
      setOrder(li, order);
    };
    if (plan.header.thread) {
      lift(plan.header.thread.li, "header", ORDER.assistant);
      const line = botTitleLine(plan.header.thread.row);
      if (line) owned.add(mountSummary(doc, h, line, plan, onToggle));
    } else {
      const li = headerStandIn(doc, h, list, plan, botPrefs, text, onOpen);
      syncAttr(li, "hidden", visible ? null : "");
      owned.add(li);
      owned.add(mountSummary(doc, h, li.querySelector(".t3plus-standin-body"), plan, onToggle));
    }
    plan.items.forEach((item, index) => {
      lift(item.thread.li, "item", ORDER.assistant + 1 + index);
      if (item.thread.titleEl) syncAttr(item.thread.titleEl, T3PLUS.subCountAttr, item.children > 0 ? item.children : null);
    });
    plan.others.forEach((bot, index) => lift(bot.thread.li, "bot", ORDER.assistant + 1 + plan.items.length + index));
    if (plan.elsewhere.length) {
      const label = text("bot", plan.header.label);
      for (const thread of plan.elsewhere) if (markVia(thread.row, label)) via.add(thread.row);
    }
  }
  for (const row of root.querySelectorAll(`[${VIA_ATTR}]`)) if (!via.has(row)) unmarkVia(row);
  for (const el of root.querySelectorAll(`[${T3PLUS.groupAttr}]`)) {
    if (lifted.has(el) || owned.has(el)) continue;
    if (el.hasAttribute(T3PLUS.ownedAttr)) {
      el.remove();
      continue;
    }
    el.removeAttribute(T3PLUS.groupAttr);
    el.style.removeProperty("--t3plus-group-order");
    if (el.getAttribute("style") === "") el.removeAttribute("style");
  }
  for (const el of root.querySelectorAll(".t3plus-bot-summary")) if (!owned.has(el)) el.remove();
  for (const el of root.querySelectorAll(`[${T3PLUS.subCountAttr}]`)) {
    const li = el.closest("li");
    if (!li || li.getAttribute(T3PLUS.groupAttr) !== "item" || !lifted.has(li)) el.removeAttribute(T3PLUS.subCountAttr);
  }
}

const VIA_ATTR = "data-t3plus-via";

/**
 * Makes a T3 card row read as the Assistant's: its name over the project name,
 * no branch. T3's project icon stays (give the bot's project an icon in T3 to
 * match the bot). Card rows only (T3's slim Settled rows show no project).
 * Idempotent.
 */
function markVia(row, label) {
  const name = row.querySelector(T3_SELECTORS.rowProjectName);
  if (!name) return false;
  syncAttr(row, VIA_ATTR, "");
  syncAttr(name, "data-t3plus-via-label", label);
  return true;
}

function unmarkVia(row) {
  row.removeAttribute(VIA_ATTR);
  for (const el of row.querySelectorAll("[data-t3plus-via-label]")) el.removeAttribute("data-t3plus-via-label");
}

export function clearAssistantGroup(root) {
  syncAssistantGroup({ doc: root.ownerDocument ?? root, list: null, plan: null });
}

/**
 * The Assistant's second line: questions and approvals first, then running
 * work, the open-thread count or All caught up, with the fold chevron on the right.
 */
function mountSummary(doc, h, line, plan, onToggle) {
  let summary = [...line.children].find((el) => el.classList?.contains("t3plus-bot-summary"));
  if (!summary) {
    const button = h("button", { type: "button", class: "t3plus-bot-summary-toggle" });
    button.append(svg(doc, "chevron"));
    // Inside T3's row: keep clicks, keys and drags away from T3's handlers.
    const stop = (event) => event.stopPropagation();
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.__t3plusToggle?.();
    });
    for (const type of ["pointerdown", "mousedown", "keydown", "dblclick", "contextmenu"]) button.addEventListener(type, stop);
    summary = h("span", { class: "t3plus-bot-summary", [T3PLUS.ownedAttr]: "" }, [h("span", { class: "t3plus-bot-summary-counts" }), button]);
    line.append(summary);
  }
  const summaryState = groupWorkloadSummary({ ...plan.requests, working: plan.working, open: plan.openThreads }, plan.header.status, plan.header.thread);
  const counts = summary.firstElementChild;
  const signature = `${summaryState.status}|${summaryState.text}`;
  if (counts.getAttribute("data-signature") !== signature) {
    counts.setAttribute("data-signature", signature);
    counts.replaceChildren(h("span", { class: "t3plus-bot-summary-count", "data-status": summaryState.status, text: summaryState.text }));
    syncAttr(counts, "aria-label", summaryState.text);
    syncAttr(counts, "title", summaryState.text);
    syncAttr(counts, "role", null);
  }
  const button = summary.lastElementChild;
  button.__t3plusToggle = () => onToggle?.();
  const n = plan.items.length;
  syncAttr(button, "aria-expanded", plan.view.assistant ? "true" : "false");
  syncAttr(button, "aria-label", `${plan.view.assistant ? "Hide" : "Show"} ${n} ${plan.header.label} thread${n === 1 ? "" : "s"}`);
  return summary;
}

function openOnActivate(row, key, onOpen) {
  if (row.__t3plusOpen) {
    row.__t3plusOpen = () => onOpen?.(key);
    return;
  }
  row.__t3plusOpen = () => onOpen?.(key);
  row.addEventListener("click", () => row.__t3plusOpen());
  row.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    row.__t3plusOpen();
  });
}

/** The bot's row when T3 renders none (the bot settled, its shelf closed): face, name, workload. */
function headerStandIn(doc, h, list, plan, botPrefs, text, onOpen) {
  const { header } = plan;
  let li = [...list.children].find((el) => el.getAttribute(T3PLUS.standInAttr) === header.key);
  if (!li) {
    li = h("li", { class: "list-none t3plus-standin", [T3PLUS.standInAttr]: header.key, [T3PLUS.ownedAttr]: "", [T3PLUS.groupAttr]: "header" }, [
      h("div", { role: "button", tabindex: "0", class: "t3plus-standin-row t3plus-standin-bot" }, [
        h("span", { class: "t3plus-bot-avatar", "aria-hidden": "true" }),
        h("div", { class: "t3plus-standin-body" }, [
          h("div", { class: "t3plus-standin-top" }, [h("span", { class: "t3plus-standin-name" }), h("span", { class: "t3plus-standin-status" })]),
        ]),
      ]),
    ]);
    list.prepend(li);
  }
  setOrder(li, ORDER.assistant);
  const row = li.firstElementChild;
  const label = text("bot", header.label);
  const avatar = row.querySelector(".t3plus-bot-avatar");
  applyAvatarVars(avatar, resolveBotPresentation({ key: header.key, titleLabel: label, status: header.status }, botPrefs[header.key]));
  syncAttr(avatar, "data-status", header.status);
  setText(row.querySelector(".t3plus-standin-name"), label);
  const slot = row.querySelector(".t3plus-standin-status");
  if (slot.getAttribute("data-status") !== header.status) {
    slot.setAttribute("data-status", header.status);
    const status = STATUS_LABEL[header.status];
    // Like T3's rows (see content.css "Status: icon and time"): the icon, no word.
    slot.replaceChildren(...(status ? [svg(doc, header.status)] : []));
  }
  syncAttr(row, "aria-label", [label, STATUS_LABEL[header.status]].filter(Boolean).join(", "));
  syncAttr(row, "aria-current", header.current ? "page" : null);
  openOnActivate(row, header.key, onOpen);
  return li;
}
