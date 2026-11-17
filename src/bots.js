import { botArt, botClipPath, botEdgeColor, defaultBotColor } from "./botArt.js";
import {
  BOT_COLORS,
  BOT_LIMITS,
  BOT_MARKER_PATTERN,
  BOT_SHAPES,
  DEFAULT_BOT_MARKER,
  SIDEBAR_ROW_PREFIX,
  STORAGE_KEYS,
  T3_SELECTORS,
  T3PLUS,
} from "./config.js";
import { syncAttr } from "./dom.js";
import { createKeyStore, subscribeKey } from "./storage.js";
import { THREAD_KEY } from "./threadKey.js";

// Bot/orchestrator threads: top-level thread rows whose title carries the
// exact marker token (default [[t3plus:bot:v1]]) as its first or last
// whitespace-separated word. No substring or zero-width matching. t3+ never
// renames, pins or reorders threads: the user applies the marker and T3's
// native pin through T3 itself.

/**
 * @returns {{ label: string } | null} label = the title without the marker token.
 */
export function parseBotTitle(title, marker = DEFAULT_BOT_MARKER) {
  if (typeof title !== "string" || !BOT_MARKER_PATTERN.test(marker)) return null;
  const words = title.trim().split(/\s+/);
  if (words[0] === marker) return { label: words.slice(1).join(" ") };
  if (words.length > 1 && words[words.length - 1] === marker) return { label: words.slice(0, -1).join(" ") };
  return null;
}

/**
 * Markers to read titles with, in order. A restored local override can outlive
 * the server marker it was created for: an intentional custom marker stays
 * authoritative whenever it matches, and the built-in marker recovers
 * default-marked bots when it does not. A compatibility fallback for restored
 * preferences, not a selector change or a settings reset.
 */
function markersToTry(marker) {
  return marker === DEFAULT_BOT_MARKER ? [marker] : [marker, DEFAULT_BOT_MARKER];
}

/** A bot title's label (the title without its marker), with the built-in marker as fallback; "" when neither marks it. */
export function botTitleLabel(title, marker = DEFAULT_BOT_MARKER) {
  for (const m of markersToTry(marker)) {
    const label = parseBotTitle(title, m)?.label;
    if (label) return label;
  }
  return "";
}

// T3's row aria-label is "<title>, <status label>, <project>" (Sidebar.logic.ts
// resolveSidebarRowAccessibility); status labels from SidebarThreadRow.tsx.
const STATUS_BY_LABEL = new Map([
  ["Setting up", "working"],
  ["Goal", "working"],
  ["Working", "working"],
  ["Waiting", "waiting"],
  ["Approval", "attention"],
  ["Input", "attention"],
  ["Request", "attention"],
  ["Limited", "failed"],
  ["Failed", "failed"],
  ["Woke", "attention"], // a snoozed thread woke up: it wants you (T3 shows it in warning color)
  ["Done", "done"],
]);

/** T3's status label from a row's aria-label, or null when it does not start with the title. */
function rowStatusLabel(ariaLabel, title) {
  const prefix = `${title}, `;
  if (typeof ariaLabel !== "string" || !ariaLabel.startsWith(prefix)) return null;
  return ariaLabel.slice(prefix.length).split(", ")[0];
}

/** working | waiting | attention | failed | done | idle, from the row's aria-label. */
export function parseRowStatus(ariaLabel, title) {
  return STATUS_BY_LABEL.get(rowStatusLabel(ariaLabel, title)) ?? "idle";
}

/** T3's row distinguishes approvals from questions; older feeds only know attention. */
export function requestKind(thread) {
  const label = rowStatusLabel(thread?.ariaLabel, thread?.title);
  return label === "Approval" ? "approval" : label === "Input" ? "question" : null;
}

/** Top-level: not nested under another thread (folder/shelf parents are fine). */
export function isTopLevelThread(thread) {
  const parent = thread.parent;
  return !parent || parent.startsWith(SIDEBAR_ROW_PREFIX.folder) || parent.startsWith(SIDEBAR_ROW_PREFIX.shelf);
}

export function classifyBots(scan, marker) {
  const childCounts = new Map();
  for (const thread of scan.threads) {
    if (thread.parent) childCounts.set(thread.parent, (childCounts.get(thread.parent) ?? 0) + 1);
  }
  const bots = [];
  for (const thread of scan.threads) {
    if (!isTopLevelThread(thread)) continue;
    const parsed = parseBotTitle(thread.title, marker);
    if (!parsed) continue;
    bots.push({
      key: thread.key,
      thread,
      titleLabel: parsed.label,
      status: parseRowStatus(thread.ariaLabel, thread.title),
      childCount: childCounts.get(thread.key) ?? 0,
    });
  }
  return bots;
}

/**
 * classifyBots with the configured marker, or with the built-in marker when
 * the configured one matches no row (see markersToTry).
 * @returns {{ bots: ReturnType<typeof classifyBots>, marker: string }} marker: the one that produced `bots`
 */
export function classifyBotsWithFallback(scan, marker) {
  for (const m of markersToTry(marker)) {
    const bots = classifyBots(scan, m);
    if (bots.length) return { bots, marker: m };
  }
  return { bots: [], marker };
}

// Per-bot presentation, kept locally: a shape and a color. The color's gradient is fixed.

/** { shape, color }. `key` picks a stable default color for a bot with none saved. */
export function normalizeBotPrefs(raw, key = "") {
  const value = raw && typeof raw === "object" ? raw : {};
  return {
    shape: Object.hasOwn(BOT_SHAPES, value.shape) ? value.shape : "circle",
    color: Object.hasOwn(BOT_COLORS, value.color) ? value.color : defaultBotColor(key),
  };
}

function normalizeBotPrefsMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw).slice(0, BOT_LIMITS.maxBots)) {
    if (THREAD_KEY.test(key)) out[key] = normalizeBotPrefs(value, key);
  }
  return out;
}

/** Stores bot presentation keyed by "<environmentId>:<threadId>". Never sent anywhere. */
export function createBotStore(area, changedEvent) {
  const key = STORAGE_KEYS.bots;
  const knownKey = STORAGE_KEYS.knownBots;
  // update() and forget() write the map they built from load() as it is.
  const prefs = createKeyStore(area, changedEvent, key, normalizeBotPrefsMap);
  const { load } = prefs;
  return {
    load,
    async update(botKey, patch) {
      const all = await load();
      if (!all[botKey] && Object.keys(all).length >= BOT_LIMITS.maxBots) {
        throw new Error(`t3+ keeps settings for at most ${BOT_LIMITS.maxBots} bots. Forget one first.`);
      }
      all[botKey] = normalizeBotPrefs({ ...all[botKey], ...patch }, botKey);
      await area.set({ [key]: all });
      return all;
    },
    async forget(botKey) {
      const all = await load();
      delete all[botKey];
      await area.set({ [key]: all });
      const known = await this.loadKnown();
      delete known[botKey];
      await area.set({ [knownKey]: known });
      return all;
    },
    subscribe: prefs.subscribe,
    /** Bots seen in the sidebar: { key: { title, seenAt } }. Lets Settings list them. */
    async loadKnown() {
      const raw = (await area.get(knownKey))?.[knownKey];
      const out = {};
      if (raw && typeof raw === "object") {
        for (const [k, v] of Object.entries(raw).slice(0, BOT_LIMITS.maxKnownBots)) {
          if (v && typeof v.title === "string") out[k] = { title: v.title.slice(0, 120), seenAt: Number(v.seenAt) || 0 };
        }
      }
      return out;
    },
    async saveKnown(known) {
      await area.set({ [knownKey]: known });
    },
    subscribeKnown(listener) {
      return subscribeKey(changedEvent, knownKey, (value) => listener(value && typeof value === "object" ? value : {}));
    },
  };
}

/**
 * Display values for one bot: name, shape, color and the CSS values that draw
 * its avatar. The face follows bot.status (closed eyes when idle, animated
 * when working, ...); without a status it is the neutral open-eyed face.
 */
export function resolveBotPresentation(bot, prefs) {
  const p = normalizeBotPrefs(prefs, bot.key);
  // Every row and feed status is also a botArt mood; no status = the neutral face.
  const mood = bot.status ?? "awake";
  const art = botArt(p.color, p.shape, mood);
  return {
    label: bot.titleLabel || "Bot",
    shape: p.shape,
    color: p.color,
    mood,
    fill: art.url,
    frames: art.frames,
    duration: art.duration,
    motion: art.motion,
    clip: botClipPath(p.shape),
    edge: botEdgeColor(p.color, p.shape),
  };
}

const setVar = (el, name, value) => {
  if (value === null) {
    if (el.style.getPropertyValue(name)) el.style.removeProperty(name);
  } else if (el.style.getPropertyValue(name) !== value) {
    el.style.setProperty(name, value);
  }
};

/** Writes the avatar CSS variables onto `el` (row avatar, breadcrumb, Settings preview). */
export function applyAvatarVars(el, view) {
  setVar(el, "--t3plus-bot-fill", view.fill);
  setVar(el, "--t3plus-bot-clip", view.clip);
  setVar(el, "--t3plus-bot-edge", view.edge);
  const animated = view.frames > 1;
  setVar(el, "--t3plus-bot-frames", animated ? String(view.frames) : null);
  setVar(el, "--t3plus-bot-duration", animated ? `${view.duration}s` : null);
  // The animated PNG plays the same frames off the main thread (apng.js).
  const motion = animated && view.motion ? view.motion : null;
  setVar(el, "--t3plus-bot-motion", motion);
  syncAttr(el, "data-t3plus-shape", view.shape);
  syncAttr(el, "data-t3plus-mood", view.mood ?? null);
  syncAttr(el, "data-animated", animated ? (motion ? "image" : "") : null);
}

/** Removes everything applyAvatarVars writes. */
export function clearAvatarVars(el) {
  for (const name of ["--t3plus-bot-fill", "--t3plus-bot-clip", "--t3plus-bot-edge", "--t3plus-bot-frames", "--t3plus-bot-duration", "--t3plus-bot-motion"]) {
    el.style.removeProperty(name);
  }
  for (const name of ["data-t3plus-shape", "data-t3plus-mood", "data-animated"]) el.removeAttribute(name);
}

const LAYOUT_ATTRS = [
  "data-t3plus-bot-body",
  "data-t3plus-bot-top",
  "data-t3plus-bot-name",
  T3PLUS.botTitleLineAttr,
  "data-t3plus-bot-lines",
  "data-t3plus-bot-hide",
  "data-t3plus-bot-status",
];

/**
 * Tags T3's row lines so CSS can lay the bot out like a chat list entry:
 *   line 1: bot name ............ T3's status/time slot
 *   line 2: workload or next scheduled update, one line, truncated
 * T3's branch line is hidden and the row body sizes to these two lines, so
 * every bot row is the same compact height whether or not T3 gave it a branch.
 * t3+'s own elements on line 2 (the Assistant group's summary) stay visible.
 */
function markBotLayout(row, titleEl, label) {
  const body = row.querySelector(T3_SELECTORS.rowBody);
  if (!body) return;
  // T3's own lines only: t3+'s appended meta line is not one of them.
  const lines = [...body.children].filter((child) => child?.nodeType === 1 && !child.hasAttribute(T3PLUS.ownedAttr));
  const [top, titleLine, metaLine] = lines;
  syncAttr(body, "data-t3plus-bot-body", "");
  syncAttr(body, "data-t3plus-bot-lines", metaLine ? "3" : "2");
  if (top) {
    syncAttr(top, "data-t3plus-bot-top", "");
    syncAttr(top, "data-t3plus-bot-name", label);
    for (const child of [...top.children]) {
      if (child.classList?.contains(T3_SELECTORS.rowStatusSlotClass)) syncAttr(child, "data-t3plus-bot-status", "");
      else syncAttr(child, "data-t3plus-bot-hide", "");
    }
  }
  if (titleLine) {
    syncAttr(titleLine, T3PLUS.botTitleLineAttr, "");
    for (const child of [...titleLine.children]) {
      if (child !== titleEl && !child.contains(titleEl) && !child.hasAttribute(T3PLUS.ownedAttr)) syncAttr(child, "data-t3plus-bot-hide", "");
    }
  }
  if (metaLine) syncAttr(metaLine, "data-t3plus-bot-hide", "");
}

/**
 * A decorated bot row's second line (T3's title line), or null. decorateBotRows
 * marks it, so read it after that has run for the current scan.
 */
export function botTitleLine(row) {
  return row.querySelector(`[${T3PLUS.botTitleLineAttr}]`);
}

function clearBotLayout(row) {
  const selector = LAYOUT_ATTRS.map((name) => `[${name}]`).join(", ");
  for (const el of row.querySelectorAll(selector)) for (const name of LAYOUT_ATTRS) el.removeAttribute(name);
}

/**
 * Styles bot rows in place: data attributes on T3's row and lines, and one
 * t3+-owned avatar element. Idempotent: only changed values are written, so
 * re-running after each mutation is cheap. Undecorates rows that stopped
 * being bots.
 * @param {(key: string) => string} previewFor workload or next-update line for a bot
 * @param {{ ownedSecondLine?: Set<string> }} [options] ownedSecondLine: bots whose
 *   second line another module fills (the Assistant group's summary, mounted
 *   on botTitleLine), so they get no preview of their own
 */
export function decorateBotRows(doc, scan, bots, prefsByKey, previewFor = () => "", { ownedSecondLine = new Set() } = {}) {
  const botRows = new Set();
  for (const bot of bots) {
    const { row, titleEl } = bot.thread;
    botRows.add(row);
    const view = resolveBotPresentation(bot, prefsByKey[bot.key]);
    const preview = ownedSecondLine.has(bot.key) ? "" : previewFor(bot.key);
    syncAttr(row, T3PLUS.botAttr, bot.status);
    syncAttr(row, "aria-description", preview ? `t3+ bot: ${view.label}. ${preview}` : `t3+ bot: ${view.label}`);
    markBotLayout(row, titleEl, view.label);

    let avatar = [...row.children].find((child) => child.classList?.contains("t3plus-bot-avatar"));
    if (!avatar) {
      avatar = doc.createElement("span");
      avatar.className = "t3plus-bot-avatar";
      avatar.setAttribute(T3PLUS.ownedAttr, "");
      avatar.setAttribute("aria-hidden", "true");
      row.append(avatar);
    }
    applyAvatarVars(avatar, view);
    syncAttr(avatar, "data-status", bot.status);

    if (titleEl) syncAttr(titleEl, T3PLUS.botTitleAttr, preview);
  }
  for (const row of scan.threads.map((t) => t.row)) {
    if (!botRows.has(row) && row.hasAttribute(T3PLUS.botAttr)) undecorateBotRow(row);
  }
}

function undecorateBotRow(row) {
  row.removeAttribute(T3PLUS.botAttr);
  row.removeAttribute("aria-description");
  if (row.getAttribute("style") === "") row.removeAttribute("style");
  clearBotLayout(row);
  for (const el of row.querySelectorAll(`[${T3PLUS.botTitleAttr}]`)) el.removeAttribute(T3PLUS.botTitleAttr);
  for (const el of row.querySelectorAll(`[${T3PLUS.ownedAttr}]`)) el.remove();
}

/** Removes every bot decoration under `root`: rows, t3+'s owned elements, the breadcrumb and hover cards. */
export function clearBotDecoration(root) {
  for (const row of root.querySelectorAll(`[${T3PLUS.botAttr}]`)) undecorateBotRow(row);
  for (const el of root.querySelectorAll(`[${T3PLUS.ownedAttr}]`)) el.remove();
  for (const el of root.querySelectorAll(`[${T3PLUS.botBreadcrumbAttr}]`)) undecorateBreadcrumb(el);
  for (const el of root.querySelectorAll(`[${HOVER_RAW_ATTR}]`)) {
    undecorateHoverCard(el);
    el.removeAttribute(HOVER_RAW_ATTR);
  }
}

const BREADCRUMB_HEADING = `${T3_SELECTORS.threadBreadcrumb} h2`;
const BREADCRUMB_LABEL_ATTR = "data-t3plus-bot-breadcrumb-label";

function undecorateBreadcrumb(el) {
  el.removeAttribute(T3PLUS.botBreadcrumbAttr);
  el.removeAttribute(BREADCRUMB_LABEL_ATTR);
  clearAvatarVars(el);
}

/** Decorates the active thread breadcrumb without changing T3's route/header structure. */
export function decorateBotBreadcrumb(doc, bot) {
  const heading = bot ? doc.querySelector(BREADCRUMB_HEADING) : null;
  for (const old of doc.querySelectorAll(`${BREADCRUMB_HEADING}[${T3PLUS.botBreadcrumbAttr}]`)) {
    if (old !== heading) undecorateBreadcrumb(old);
  }
  if (!heading) return;
  const view = resolveBotPresentation(bot, bot.prefs);
  syncAttr(heading, T3PLUS.botBreadcrumbAttr, "");
  syncAttr(heading, BREADCRUMB_LABEL_ATTR, view.label);
  applyAvatarVars(heading, view);
}

const HOVER_LABEL_ATTR = "data-t3plus-bot-hover-label";
/** The card text last checked, so an unchanged card is skipped. */
const HOVER_RAW_ATTR = "data-t3plus-hover-raw";

function undecorateHoverCard(el) {
  el.removeAttribute(T3PLUS.botHoverAttr);
  el.removeAttribute(HOVER_LABEL_ATTR);
  clearAvatarVars(el);
}

/**
 * T3's thread hover card shows the raw title, marker included. Like the
 * breadcrumb, t3+ hides that text and shows the bot's face and clean name.
 * Matches cards by title against the bots in the sidebar. Idempotent; a card
 * T3 reuses for another thread is re-checked by its text.
 * @param {Map<string, object>} botsByTitle raw title -> bot (from classifyBots)
 */
export function decorateBotHoverCards(root, botsByTitle, prefsByKey) {
  for (const el of root.querySelectorAll(T3_SELECTORS.hoverCardTitle)) {
    const raw = el.textContent ?? "";
    if (el.getAttribute(HOVER_RAW_ATTR) === raw && (el.hasAttribute(T3PLUS.botHoverAttr) || !botsByTitle.has(raw.trim()))) continue;
    el.setAttribute(HOVER_RAW_ATTR, raw);
    const bot = botsByTitle.get(raw.trim());
    if (!bot) {
      undecorateHoverCard(el);
      continue;
    }
    const view = resolveBotPresentation(bot, prefsByKey[bot.key]);
    el.setAttribute(T3PLUS.botHoverAttr, "");
    el.setAttribute(HOVER_LABEL_ATTR, view.label);
    applyAvatarVars(el, view);
  }
}
