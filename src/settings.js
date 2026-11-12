import { DEFAULT_SETTINGS, GRADIENT_MODES, IMAGE_SOURCES, STORAGE_KEYS } from "./config.js";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const bool = (value, fallback) => (typeof value === "boolean" ? value : fallback);
const percent = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : fallback;
};

/** "theme" or a lowercase #rrggbb, else the fallback. */
export function normalizeAccent(value, fallback = "theme") {
  if (value === "theme") return "theme";
  return typeof value === "string" && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
}

/**
 * Returns a complete, valid settings object from anything read out of storage.
 * Unknown or invalid fields fall back to defaults, so a corrupt or older value
 * (including v1, which had only composerGradient) can never break the page.
 */
export function normalizeSettings(raw) {
  const source = isObject(raw) ? raw : {};
  const g = isObject(source.composerGradient) ? source.composerGradient : {};
  const glass = isObject(source.glass) ? source.glass : {};
  const sidebar = isObject(source.sidebar) ? source.sidebar : {};
  const home = isObject(source.home) ? source.home : {};
  const demo = isObject(source.demo) ? source.demo : {};

  const d = DEFAULT_SETTINGS;
  return {
    version: 2,
    composerGradient: {
      enabled: bool(g.enabled, d.composerGradient.enabled),
      mode: GRADIENT_MODES.includes(g.mode) ? g.mode : d.composerGradient.mode,
      accent: normalizeAccent(g.accent, d.composerGradient.accent),
      intensity: percent(g.intensity, d.composerGradient.intensity),
      imageSource: IMAGE_SOURCES.includes(g.imageSource) ? g.imageSource : d.composerGradient.imageSource,
      dither: bool(g.dither, d.composerGradient.dither),
      ditherSize: ["fine", "medium", "large"].includes(g.ditherSize) ? g.ditherSize : d.composerGradient.ditherSize,
      ditherStyle: ["bayer", "grain", "spectrum"].includes(g.ditherStyle) ? g.ditherStyle : d.composerGradient.ditherStyle,
    },
    glass: {
      enabled: bool(glass.enabled, d.glass.enabled),
      strength: percent(glass.strength, d.glass.strength),
    },
    sidebar: {
      profiles: bool(sidebar.profiles, d.sidebar.profiles),
      bots: bool(sidebar.bots, d.sidebar.bots),
      compactHeader: bool(sidebar.compactHeader, d.sidebar.compactHeader),
      titleFirst: bool(sidebar.titleFirst, d.sidebar.titleFirst),
    },
    home: {
      widgets: bool(home.widgets, d.home.widgets),
    },
    demo: {
      enabled: bool(demo.enabled, d.demo.enabled),
    },
  };
}

export function defaultSettings() {
  return normalizeSettings(DEFAULT_SETTINGS);
}

/**
 * Local visual preferences, persisted in an extension storage area
 * (chrome.storage.local in the extension; a fake in tests). Nothing here is
 * sent to T3's server.
 *
 * @param {chrome.storage.StorageArea} area
 * @param {chrome.storage.StorageChangedEvent | undefined} changedEvent
 */
export function createSettingsStore(area, changedEvent) {
  const key = STORAGE_KEYS.settings;

  async function load() {
    const result = await area.get(key);
    return normalizeSettings(result?.[key]);
  }

  async function save(settings) {
    const normalized = normalizeSettings(settings);
    await area.set({ [key]: normalized });
    return normalized;
  }

  return {
    load,
    save,
    /** Shallow-merges a patch into composerGradient and saves. */
    async updateGradient(patch) {
      const current = await load();
      return save({ ...current, composerGradient: { ...current.composerGradient, ...patch } });
    },
    async reset() {
      return save(defaultSettings());
    },
    /** Calls `listener(settings)` when another tab or this one saves. Returns an unsubscribe. */
    subscribe(listener) {
      return subscribeKey(changedEvent, key, (value) => listener(normalizeSettings(value)));
    },
  };
}

/** Shared chrome.storage.onChanged filter for one key in the "local" area. */
export function subscribeKey(changedEvent, key, listener) {
  if (!changedEvent) return () => {};
  const handler = (changes, areaName) => {
    if (areaName !== "local" || !(key in changes)) return;
    listener(changes[key].newValue);
  };
  changedEvent.addListener(handler);
  return () => changedEvent.removeListener(handler);
}
