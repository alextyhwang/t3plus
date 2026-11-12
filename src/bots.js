import { botArt, botClipPath, botEdgeColor, defaultBotColor, MOOD_BY_STATUS } from "./botArt.js";
import {
  BOT_COLORS,
  BOT_LIMITS,
  BOT_MARKER_PATTERN,
  BOT_SHAPES,
  DEFAULT_BOT_MARKER,
  SIDEBAR_ROW_PREFIX,
  STORAGE_KEYS,
  T3PLUS,
} from "./config.js";
import { subscribeKey } from "./settings.js";

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

/** working | waiting | attention | failed | done | idle, from the row's aria-label. */
export function parseRowStatus(ariaLabel, title) {
  if (typeof ariaLabel !== "string" || !ariaLabel.startsWith(title)) return "idle";
  const rest = ariaLabel.slice(title.length);
  if (!rest.startsWith(", ")) return "idle";
  const next = rest.slice(2).split(", ")[0];
  return STATUS_BY_LABEL.get(next) ?? "idle";
}

/** Top-level: not nested under another thread (folder/shelf parents are fine). */
export function isTopLevelThread(thread) {
  const parent = thread.parent;
  return !parent || parent.startsWith(SIDEBAR_ROW_PREFIX.folder) || parent.startsWith(SIDEBAR_ROW_PREFIX.shelf);
}

/** Bots in a sidebar scan, with status and visible child count. */
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

// ---------- Per-bot presentation (local only) ----------
// Two choices per bot: a shape and a color. The color's gradient is fixed.

/** { shape, color }. `key` picks a stable default color for a bot with none saved. */
export function normalizeBotPrefs(raw, key = "") {
  const value = raw && typeof raw === "object" ? raw : {};
  return {
    shape: Object.hasOwn(BOT_SHAPES, value.shape) ? value.shape : "circle",
    color: Object.hasOwn(BOT_COLORS, value.color) ? value.color : defaultBotColor(key),
  };
}

const BOT_KEY = /^[^:\s]+:\S+$/;

export function normalizeBotPrefsMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw).slice(0, BOT_LIMITS.maxBots)) {
    if (BOT_KEY.test(key)) out[key] = normalizeBotPrefs(value, key);
  }
  return out;
}

/** Stores bot presentation keyed by "<environmentId>:<threadId>". Never sent anywhere. */
export function createBotStore(area, changedEvent) {
  const key = STORAGE_KEYS.bots;
  const knownKey = STORAGE_KEYS.knownBots;
  async function load() {
    return normalizeBotPrefsMap((await area.get(key))?.[key]);
  }
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
    subscribe(listener) {
      return subscribeKey(changedEvent, key, (value) => listener(normalizeBotPrefsMap(value)));
    },
    /** Bots seen in the sidebar: { key: { title, seenAt } }. Lets Settings list them. */
    async loadKnown() {
      const raw = (await area.get(knownKey))?.[knownKey];
      const out = {};
      if (raw && typeof raw === "object") {
        for (const [k, v] of Object.entries(raw).slice(0, BOT_LIMITS.maxBots * 2)) {
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
  const mood = MOOD_BY_STATUS[bot.status] ?? "awake";
  const art = botArt(p.color, p.shape, mood);
  return {
    label: bot.titleLabel || "Bot",
    shape: p.shape,
    color: p.color,
    mood,
    fill: art.url,
    frames: art.frames,
    duration: art.duration,
    clip: botClipPath(p.shape),
    edge: botEdgeColor(p.color, p.shape),
  };
}

const setAttr = (el, name, value) => {
  if (value === null || value === undefined) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
};
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
  setAttr(el, "data-t3plus-shape", view.shape);
  setAttr(el, "data-t3plus-mood", view.mood ?? null);
  setAttr(el, "data-animated", animated ? "" : null);
}

const LAYOUT_ATTRS = [
  "data-t3plus-bot-body",
  "data-t3plus-bot-top",
  "data-t3plus-bot-name",
  "data-t3plus-bot-title-line",
  "data-t3plus-bot-lines",
  "data-t3plus-bot-hide",
  "data-t3plus-bot-status",
];

/**
 * Tags T3's row lines so CSS can lay the bot out like a chat list entry:
 *   line 1: bot name ............ T3's status/time slot
 *   line 2: latest message, one line, truncated
 * T3's branch line is hidden and the row body sizes to these two lines, so
 * every bot row is the same compact height whether or not T3 gave it a branch.
 */
function markBotLayout(row, titleEl, label) {
  const body = [...row.children].find(
    (child) => child.classList?.contains("relative") && child.classList?.contains("z-10"),
  );
  if (!body) return;
  // T3's own lines only: t3+'s appended meta line is not one of them.
  const lines = [...body.children].filter((child) => child?.nodeType === 1 && !child.hasAttribute(T3PLUS.ownedAttr));
  const [top, titleLine, metaLine] = lines;
  setAttr(body, "data-t3plus-bot-body", "");
  setAttr(body, "data-t3plus-bot-lines", metaLine ? "3" : "2");
  if (top) {
    setAttr(top, "data-t3plus-bot-top", "");
    setAttr(top, "data-t3plus-bot-name", label);
    for (const child of [...top.children]) {
      if (child.classList?.contains("group/sidebar-status-slot")) setAttr(child, "data-t3plus-bot-status", "");
      else setAttr(child, "data-t3plus-bot-hide", "");
    }
  }
  if (titleLine) {
    setAttr(titleLine, "data-t3plus-bot-title-line", "");
    for (const child of [...titleLine.children]) {
      if (child !== titleEl && !child.contains(titleEl)) setAttr(child, "data-t3plus-bot-hide", "");
    }
  }
  if (metaLine) setAttr(metaLine, "data-t3plus-bot-hide", "");
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
 * @param {(key: string) => string} previewFor latest-message line for a bot
 */
export function decorateBotRows(doc, scan, bots, prefsByKey, previewFor = () => "") {
  const botRows = new Set();
  for (const bot of bots) {
    const { row, titleEl } = bot.thread;
    botRows.add(row);
    const view = resolveBotPresentation(bot, prefsByKey[bot.key]);
    const preview = previewFor(bot.key);
    setAttr(row, T3PLUS.botAttr, bot.status);
    setAttr(row, "aria-description", preview ? `t3+ bot: ${view.label}. ${preview}` : `t3+ bot: ${view.label}`);
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
    setAttr(avatar, "data-status", bot.status);

    if (titleEl) setAttr(titleEl, T3PLUS.botTitleAttr, preview);

    // Rows decorated by v0.5 carried a third (model/computer) line; drop it.
    for (const old of row.querySelectorAll(".t3plus-bot-metaline")) old.remove();
  }
  for (const row of scan.threads.map((t) => t.row)) {
    if (!botRows.has(row) && row.hasAttribute(T3PLUS.botAttr)) undecorateBotRow(row);
  }
}

export function undecorateBotRow(row) {
  row.removeAttribute(T3PLUS.botAttr);
  row.removeAttribute("aria-description");
  if (row.getAttribute("style") === "") row.removeAttribute("style");
  clearBotLayout(row);
  for (const el of row.querySelectorAll(`[${T3PLUS.botTitleAttr}]`)) el.removeAttribute(T3PLUS.botTitleAttr);
  for (const el of row.querySelectorAll(`[${T3PLUS.ownedAttr}]`)) el.remove();
}

/** Removes all bot decoration under `root` (feature off, or stop). */
export function clearBotDecoration(root) {
  for (const row of root.querySelectorAll(`[${T3PLUS.botAttr}]`)) undecorateBotRow(row);
  for (const el of root.querySelectorAll(`[${T3PLUS.ownedAttr}]`)) el.remove();
}

const BREADCRUMB_VARS = ["--t3plus-bot-fill", "--t3plus-bot-clip", "--t3plus-bot-edge"];

/** Decorates the active thread breadcrumb without changing T3's route/header structure. */
export function decorateBotBreadcrumb(doc, bot) {
  const heading = bot ? doc.querySelector('[aria-label="Thread breadcrumb"] h2') : null;
  for (const old of doc.querySelectorAll('[aria-label="Thread breadcrumb"] h2[data-t3plus-bot-breadcrumb]')) {
    if (old === heading) continue;
    old.removeAttribute("data-t3plus-bot-breadcrumb");
    old.removeAttribute("data-t3plus-bot-breadcrumb-label");
    old.removeAttribute("data-t3plus-shape");
    for (const name of BREADCRUMB_VARS) old.style.removeProperty(name);
  }
  if (!heading) return;
  const view = resolveBotPresentation(bot, bot.prefs);
  setAttr(heading, "data-t3plus-bot-breadcrumb", "");
  setAttr(heading, "data-t3plus-bot-breadcrumb-label", view.label);
  applyAvatarVars(heading, view);
}

/** The thread hover card's title line (ThreadHoverCard.tsx): first line of T3's tooltip popup. */
// T3 main uses font-medium; the open redesign stack (#28839-#28845) switches it to font-semibold.
export const HOVER_CARD_TITLE = '[data-slot="tooltip-popup"] div.truncate:is(.font-medium, .font-semibold)';

/**
 * T3's thread hover card shows the raw title, marker included. Like the
 * breadcrumb, t3+ hides that text and shows the bot's face and clean name.
 * Matches cards by title against the bots in the sidebar. Idempotent; a card
 * T3 reuses for another thread is re-checked by its text.
 * @param {Map<string, object>} botsByTitle raw title -> bot (from classifyBots)
 */
export function decorateBotHoverCards(root, botsByTitle, prefsByKey) {
  for (const el of root.querySelectorAll(HOVER_CARD_TITLE)) {
    const raw = el.textContent ?? "";
    if (el.getAttribute("data-t3plus-hover-raw") === raw && (el.hasAttribute("data-t3plus-bot-hover") || !botsByTitle.has(raw.trim()))) continue;
    el.setAttribute("data-t3plus-hover-raw", raw);
    const bot = botsByTitle.get(raw.trim());
    if (!bot) {
      el.removeAttribute("data-t3plus-bot-hover");
      el.removeAttribute("data-t3plus-bot-hover-label");
      continue;
    }
    const view = resolveBotPresentation(bot, prefsByKey[bot.key]);
    el.setAttribute("data-t3plus-bot-hover", "");
    el.setAttribute("data-t3plus-bot-hover-label", view.label);
    applyAvatarVars(el, view);
  }
}
