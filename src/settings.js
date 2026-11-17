import { DEFAULT_SETTINGS, DITHER_SIZES, DITHER_STYLES, GRADIENT_MODES, IMAGE_SOURCES, STORAGE_KEYS, normalizeAccent } from "./config.js";
import { createKeyStore } from "./storage.js";

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const bool = (value, fallback) => (typeof value === "boolean" ? value : fallback);
const percent = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : fallback;
};

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
    version: d.version,
    composerGradient: {
      enabled: bool(g.enabled, d.composerGradient.enabled),
      mode: GRADIENT_MODES.includes(g.mode) ? g.mode : d.composerGradient.mode,
      accent: normalizeAccent(g.accent, d.composerGradient.accent),
      intensity: percent(g.intensity, d.composerGradient.intensity),
      imageSource: IMAGE_SOURCES.includes(g.imageSource) ? g.imageSource : d.composerGradient.imageSource,
      dither: bool(g.dither, d.composerGradient.dither),
      ditherSize: DITHER_SIZES.includes(g.ditherSize) ? g.ditherSize : d.composerGradient.ditherSize,
      ditherStyle: DITHER_STYLES.includes(g.ditherStyle) ? g.ditherStyle : d.composerGradient.ditherStyle,
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
 * sent to T3's server. subscribe(listener) reports saves from another tab or
 * this one.
 *
 * @param {chrome.storage.StorageArea} area
 * @param {chrome.storage.StorageChangedEvent | undefined} changedEvent
 */
export function createSettingsStore(area, changedEvent) {
  const store = createKeyStore(area, changedEvent, STORAGE_KEYS.settings, normalizeSettings);
  return {
    ...store,
    reset() {
      return store.save(defaultSettings());
    },
  };
}
