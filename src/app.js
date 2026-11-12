import { createAppearancePanel, ensurePanelMounted, findAppearanceContainer } from "./appearancePanel.js";
import { SETTINGS_ROUTE, createSettingsNavItem, findSettingsNavAnchor, findSettingsPage } from "./settingsSection.js";
import {
  classifyBots,
  clearBotDecoration,
  decorateBotRows,
  normalizeBotPrefs,
  parseBotTitle,
  resolveBotPresentation,
  decorateBotBreadcrumb,
  decorateBotHoverCards,
} from "./bots.js";
import { applyComposerTheme, syncBackdropAnchor, syncBackdropHosts, syncComposerSurfaces } from "./composer.js";
import { botMetaText, botPreviewText } from "./botFeed.js";
import { BOT_FEED_POLL_MS, BOT_LIMITS, DOM_CHECK_THROTTLE_MS, HOME_FEED_POLL_MS, SAMPLE_IMAGE_PATH, T3_SELECTORS, T3PLUS } from "./config.js";
import { createHomeView } from "./homeWidgets.js";
import { createUsageDither } from "./usageDither.js";
import { createDemoMode } from "./demoMode.js";
import { providerKind } from "./homeData.js";
import { createDomWatcher } from "./domWatcher.js";
import { computeComposerTheme } from "./gradient.js";
import { dataUrlToBlob, prepareImageFile } from "./imageStore.js";
import { createProfileBar } from "./profileBar.js";
import {
  ALL_PROFILE_ID,
  normalizeProfileView,
  resolveActiveProfile,
  threadKeyFromPath,
  threadToRestore,
} from "./profiles.js";
import { emptyConfig, parseT3PlusConfigText } from "./remoteConfig.js";
import { defaultSettings } from "./settings.js";
import {
  applyProfileVisibility,
  clearProfileVisibility,
  computeProfileVisibility,
  findProfileBarSlot,
  findSidebarInner,
  isThreadInProfile,
  scanSidebar,
} from "./sidebar.js";

/**
 * Wires storage, the background/glass theme, the sidebar (profiles + bots),
 * the Appearance panel, and the DOM watcher. Everything browser-specific comes
 * in through `deps`, so tests can run this in jsdom.
 *
 * deps: {
 *   win, doc,
 *   settingsStore, imageStore,             settings.js / imageStore.js
 *   profileViewStore,                      profiles.js
 *   configProvider,                        remoteConfig.js (read-only t3plus.json)
 *   botStore,                              bots.js
 *   botFeed?,                              botFeed.js (latest message per bot, read-only)
 *   backdropRenderer?,                     backdropRenderer.js (canvas dither; omitted in jsdom tests)
 *   homeFeed?,                             homeData.js createHomeFeed (home widget data, read-only)
 *   assetUrl(path) -> string,              chrome.runtime.getURL in the extension
 *   prepareImage?(file, limits) -> record, defaults to prepareImageFile
 *   isAlive?() -> boolean, throttleMs?,
 * }
 */
export function createT3Plus(deps) {
  const { win, doc, settingsStore, imageStore, profileViewStore, configProvider, botStore, assetUrl } = deps;
  const prepareImage = deps.prepareImage ?? prepareImageFile;

  const state = {
    settings: defaultSettings(),
    image: null,
    imageUrl: null,
    message: "",
    view: normalizeProfileView(null),
    loaded: { config: emptyConfig(), errors: [], source: "none", diagnostic: null, fetchedAt: null, endpoint: configProvider.endpoint },
    local: { use: "remote", text: "" },
    configMessage: "",
    botPrefs: {},
    knownBots: {},
    botMessage: "",
    bots: [],
    botFeed: null,
    homeFeed: null,
  };
  let objectUrl = null;
  let objectUrlFor = null;
  let warnedOrphans = false;
  let lastScan = null;
  let lastRecordedThread = null;
  const unsubscribers = [];

  function resolveImageUrl() {
    const { imageSource } = state.settings.composerGradient;
    if (imageSource === "upload" && state.image) {
      if (objectUrlFor !== state.image.dataUrl) {
        if (objectUrl) win.URL.revokeObjectURL(objectUrl);
        objectUrl = win.URL.createObjectURL(dataUrlToBlob(state.image.dataUrl));
        objectUrlFor = state.image.dataUrl;
      }
      return objectUrl;
    }
    return assetUrl(SAMPLE_IMAGE_PATH);
  }

  /** Bots for the Settings list: every bot seen in the sidebar plus any with saved settings. */
  function botsForPanel() {
    const marker = state.loaded.config.botMarker;
    const keys = new Set([...Object.keys(state.knownBots), ...Object.keys(state.botPrefs)]);
    return [...keys].sort().map((key) => {
      const title = state.knownBots[key]?.title ?? "";
      const titleLabel = parseBotTitle(title, marker)?.label ?? "";
      const prefs = normalizeBotPrefs(state.botPrefs[key], key);
      const view = resolveBotPresentation({ key, titleLabel }, prefs);
      return { key, title, titleLabel, prefs, view, preview: botPreviewText(state.botFeed, key), meta: botMetaText(state.botFeed, key) };
    });
  }

  function render() {
    state.imageUrl = resolveImageUrl();
    applyComposerTheme(doc, computeComposerTheme(state.settings, state.imageUrl));
    panel.update({
      ...state,
      config: { ...state.loaded, profiles: state.loaded.config.profiles, local: state.local },
      bots: botsForPanel(),
      botMarker: state.loaded.config.botMarker,
    });
    watcher.schedule();
  }

  function activeProfile() {
    return state.settings.sidebar.profiles ? resolveActiveProfile(state.loaded.config, state.view) : null;
  }

  function isMember(profile, key) {
    if (!profile) return true;
    const thread = lastScan?.threads.find((t) => t.key === key);
    if (!thread) return profile.threads.includes(key);
    return isThreadInProfile(thread, profile) || (profile.showBots && state.bots.some((b) => b.key === key));
  }

  function findThreadRow(key) {
    return lastScan?.threads.find((t) => t.key === key && t.row.isConnected)?.row ?? null;
  }

  /** Opens a thread through T3's own row, so T3's router and click handling stay in charge. */
  function openThread(key) {
    const row = findThreadRow(key);
    if (!row) return false;
    row.click();
    return true;
  }

  function rememberBots(bots) {
    let changed = false;
    const next = { ...state.knownBots };
    for (const bot of bots) {
      if (next[bot.key]?.title !== bot.thread.title) {
        next[bot.key] = { title: bot.thread.title, seenAt: Date.now() };
        changed = true;
      }
    }
    if (!changed) return;
    const keep = Object.entries(next)
      .sort((a, b) => b[1].seenAt - a[1].seenAt)
      .slice(0, BOT_LIMITS.maxBots * 2);
    state.knownBots = Object.fromEntries(keep);
    botStore.saveKnown(state.knownBots).catch(() => {});
  }

  function syncSidebar() {
    const inner = findSidebarInner(doc);
    if (!inner) {
      lastScan = null;
      if (bar.element.isConnected) bar.element.remove();
      return;
    }
    const scan = scanSidebar(inner);
    lastScan = scan;
    const { sidebar } = state.settings;

    const bots = sidebar.bots ? classifyBots(scan, state.loaded.config.botMarker) : [];
    state.bots = bots;
    const shown = demoBots(bots);
    if (sidebar.bots) {
      decorateBotRows(doc, scan, shown, state.botPrefs, (key) => (demoOn() ? demo.label("botMessage", key) : botPreviewText(state.botFeed, key)));
      rememberBots(bots);
    } else {
      clearBotDecoration(inner);
    }

    const routeKey = threadKeyFromPath(win.location.pathname);
    const activeBot = shown.find((bot) => bot.key === routeKey) ?? null;
    decorateBotBreadcrumb(doc, activeBot ? { ...activeBot, prefs: state.botPrefs[activeBot.key] } : null);
    syncHoverCards();
    const profile = activeProfile();
    const visibility = computeProfileVisibility(scan, profile, {
      routeThreadKey: routeKey,
      botKeys: new Set(bots.map((b) => b.key)),
    });
    applyProfileVisibility(inner, visibility);

    // Remember the last thread opened under the active tab (only threads that belong to it).
    if (routeKey && routeKey !== lastRecordedThread && scan.threads.some((t) => t.key === routeKey)) {
      lastRecordedThread = routeKey;
      const activeId = profile?.id ?? ALL_PROFILE_ID;
      if (isMember(profile, routeKey) && state.view.lastThreadByProfile[activeId] !== routeKey) {
        state.view = { ...state.view, lastThreadByProfile: { ...state.view.lastThreadByProfile, [activeId]: routeKey } };
        profileViewStore.save(state.view).catch(() => {});
      }
    }

    // The profile strip is the only element t3+ adds to the sidebar.
    const slot = sidebar.profiles ? findProfileBarSlot(inner) : null;
    if (!slot) {
      if (bar.element.isConnected) bar.element.remove();
      return;
    }
    if (bar.element.parentElement !== slot.parent || bar.element.nextElementSibling !== slot.before) {
      slot.parent.insertBefore(bar.element, slot.before);
    }
    bar.update({
      profiles: demoOn() ? state.loaded.config.profiles.map((p) => ({ ...p, label: demo.label("profile", p.label) })) : state.loaded.config.profiles,
      activeId: profile?.id ?? ALL_PROFILE_ID,
      source: state.loaded.source,
      diagnostic: state.loaded.diagnostic,
      errors: state.loaded.errors,
      emptyProfile: Boolean(profile) && visibility.visibleThreads === 0,
    });
  }

  /** Feeds the canvas dither renderer: the conversation pane, or the Settings preview on the Appearance page. */
  function syncDither() {
    const renderer = deps.backdropRenderer;
    if (!renderer) return;
    const g = state.settings.composerGradient;
    const theme = computeComposerTheme(state.settings, state.imageUrl);
    const pane = doc.querySelector(T3_SELECTORS.conversationArea) ?? doc.querySelector(`[${T3PLUS.backdropHostAttr}]`);
    const preview = panel.element.isConnected ? panel.element.querySelector(".t3plus-preview-pane") : null;
    const anchor = Number.parseFloat(doc.documentElement.style.getPropertyValue("--t3plus-composer-x"));
    // On the new-thread page the composer floats mid-pane: center the glow on it.
    let cy = null;
    const hero = findHero();
    if (pane && hero) {
      const card = hero.overlay.querySelector(T3_SELECTORS.composerSurface) ?? hero.stack;
      const p = pane.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      if (p.height > 0 && c.height > 0) cy = Math.max(0, Math.min(1.2, (c.top + c.height * 0.9 - p.top) / p.height)); // around the composer
    }
    renderer.update({
      mode: g.dither ? theme.mode : null,
      settings: state.settings,
      imageSrc: g.imageSource === "upload" && state.image ? state.image.dataUrl : assetUrl(SAMPLE_IMAGE_PATH),
      host: pane ?? preview,
      cx: pane && Number.isFinite(anchor) ? anchor / 100 : 0.5,
      cy,
      wide: Boolean(pane && hero),
    });
  }

  // ---------- Bot hover cards ----------

  function syncHoverCards() {
    if (!state.settings.sidebar.bots || !state.bots.length) return;
    decorateBotHoverCards(doc, new Map(demoBots(state.bots).map((b) => [b.thread.title.trim(), b])), state.botPrefs);
    demo.applyPopups();
  }

  // T3's hover card is a tooltip popup portaled to a direct child of <body>.
  // Small observers handle it right away (before paint), so the raw marker
  // never flashes; the main watcher's throttle is meant for streaming, not
  // for this. They watch only <body>'s own children and, inside each portal,
  // its subtree, never the app root, so streaming chat text costs nothing here.
  let popupObserver = null;
  let portalObserver = null;
  function watchPopups() {
    const body = doc.body;
    if (!body) return;
    const watched = new WeakSet();
    portalObserver = new win.MutationObserver(() => syncHoverCards());
    const watchPortals = () => {
      for (const el of body.children) {
        if (watched.has(el)) continue;
        watched.add(el);
        // The app root and t3+'s own nodes are not popups.
        if (el.id === "root" || el.hasAttribute(T3PLUS.ownedAttr) || el.querySelector("[data-workspace-area], [data-slot='sidebar-wrapper']")) continue;
        portalObserver.observe(el, { childList: true, subtree: true, characterData: true });
      }
    };
    popupObserver = new win.MutationObserver(() => {
      watchPortals();
      syncHoverCards();
    });
    popupObserver.observe(body, { childList: true });
    watchPortals();
  }

  // ---------- Home widgets (new-thread page) ----------

  /** T3's draft hero: the composer overlay is centered (items-center) instead of docked at the bottom. */
  function findHero() {
    const overlay = doc.querySelector(T3_SELECTORS.composerOverlay);
    if (!overlay || !overlay.classList.contains("items-center")) return null;
    const stack = overlay.querySelector(T3_SELECTORS.composerStack);
    return stack ? { overlay, stack } : null;
  }

  const setRootVar = (name, value) => {
    if (doc.documentElement.style.getPropertyValue(name) !== value) doc.documentElement.style.setProperty(name, value);
  };

  function syncHome() {
    const hero = state.settings.home.widgets ? findHero() : null;
    if (!hero) {
      if (home.element.isConnected) home.element.remove();
      doc.documentElement.removeAttribute(T3PLUS.homeAttr);
      return;
    }
    if (home.element.parentElement !== hero.stack) hero.stack.append(home.element);
    if (!doc.documentElement.hasAttribute(T3PLUS.homeAttr)) doc.documentElement.setAttribute(T3PLUS.homeAttr, "");
    const pane = doc.querySelector(T3_SELECTORS.conversationArea) ?? hero.overlay;
    const p = pane.getBoundingClientRect();
    const s = hero.stack.getBoundingClientRect();
    if (p.width > 0) {
      // Centered on the composer (T3 shifts it when the details card is open), but
      // never wider than the room on its narrower side, so it stays inside the pane.
      const center = s.left + s.width / 2;
      const room = 2 * Math.min(center - p.left, p.left + p.width - center) - 48;
      // As wide as T3's composer (the stack), within the room on its narrower side.
      setRootVar("--t3plus-home-width", `${Math.round(Math.max(320, Math.min(s.width, room)))}px`);
    }
    // Place the whole hero block (headline, composer, widgets) a little above
    // the pane's middle: 35% of the spare height above it, 65% below. That is
    // close to T3's own spot on a laptop screen and scales with taller ones;
    // the widgets stay clear of the bottom edge.
    const overlayHeight = hero.overlay.clientHeight;
    if (overlayHeight > 0) {
      const above = hero.stack.querySelector(":scope > .absolute.bottom-full")?.offsetHeight ?? 84;
      const free = overlayHeight - (above + s.height + 16 + home.element.scrollHeight);
      const top = Math.max(24, Math.min(free - 24, free * 0.35));
      setRootVar("--t3plus-hero-top", `${Math.round(top + above)}px`);
    }
    if (p.height > 0) setRootVar("--t3plus-home-max-height", `${Math.round(Math.max(160, p.top + p.height - s.top - s.height - 40))}px`);
    // Fetched only while the widgets are on screen: on arrival when the copy is
    // older than one poll, then every poll while they stay.
    if (deps.homeFeed && !homeLoading && (!state.homeFeed || nowMs() - lastHomeFetch > HOME_FEED_POLL_MS)) refreshHomeFeed();
    home.update({ feed: state.homeFeed, profile: activeProfile() });
  }

  // ---------- Screenshot mode ----------
  // A read-only cover over T3's visible text (demoMode.js): stand-in thread
  // titles, projects, branches, machines, profiles, bot names and message
  // text. Toggled in Settings -> t3+ or with Alt+Shift+D.
  const demo = createDemoMode(doc);
  const demoOn = () => state.settings.demo.enabled;
  const demoBots = (bots) => (demoOn() ? bots.map((b) => ({ ...b, titleLabel: demo.label("bot", b.titleLabel || "Bot") })) : bots);
  let demoPrune = 0;
  function syncDemo() {
    const on = demoOn();
    doc.documentElement.toggleAttribute(T3PLUS.demoAttr, on);
    if (on) {
      demo.apply({ sidebarInner: findSidebarInner(doc) });
      if ((demoPrune += 1) % 50 === 0) demo.prune();
    } else if (demo.active) demo.restore();
  }
  function onDemoKey(event) {
    if (event.code !== "KeyD" || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    actions.setDemo(!demoOn());
  }

  // ---------- Thread details: the current provider's pool ----------
  // When T3's thread details show "Usage limits", t3+ replaces its rows with
  // the pool chart of the provider in the composer (Codex or Claude), the same
  // card as on the home page. On the new-thread page the section is hidden by
  // CSS, because the widgets below the composer already show both pools.
  function syncThreadDetails() {
    const card = doc.querySelector(T3_SELECTORS.threadDetailsCard);
    const section = card?.querySelector(T3_SELECTORS.threadDetailsUsage) ?? null;
    const picker = doc.querySelector(T3_SELECTORS.modelPicker);
    const kind = providerKind(picker?.getAttribute("aria-label") ?? picker?.textContent);
    const show = Boolean(section && kind && state.settings.home.widgets && !doc.documentElement.hasAttribute(T3PLUS.homeAttr));
    for (const old of doc.querySelectorAll(`[${T3PLUS.detailsPoolAttr}]`)) {
      if (old !== section || !show) old.removeAttribute(T3PLUS.detailsPoolAttr);
    }
    if (!show) {
      if (detailsPool.element.isConnected) detailsPool.element.remove();
      return;
    }
    if (detailsPool.element.parentElement !== section || section.lastElementChild !== detailsPool.element) section.append(detailsPool.element);
    if (section.getAttribute(T3PLUS.detailsPoolAttr) !== kind) section.setAttribute(T3PLUS.detailsPoolAttr, kind);
    if (deps.homeFeed && !homeLoading && (!state.homeFeed || nowMs() - lastHomeFetch > HOME_FEED_POLL_MS)) refreshHomeFeed();
    detailsPool.update({ feed: state.homeFeed, kind });
  }

  let homeLoading = false;
  let lastHomeFetch = -Infinity;
  const nowMs = () => win.performance?.now?.() ?? Date.now();
  async function refreshHomeFeed() {
    if (!deps.homeFeed || !state.settings.home.widgets) return;
    homeLoading = true;
    lastHomeFetch = nowMs();
    try {
      const next = await deps.homeFeed.load().catch(() => null);
      if (next) state.homeFeed = next;
    } finally {
      homeLoading = false;
    }
    watcher.schedule();
  }


  // ---------- Compact sidebar header ----------
  // CSS hides T3's logo row (identified by the "T3 Code home" link) and,
  // while the sidebar is open in a chat, moves T3's
  // own fixed sidebar control ([data-sidebar-control]) to the header, right
  // before the breadcrumbs. Nothing is moved in the DOM: T3 keeps its button,
  // its shortcut and its collapsed layout.
  let sidebarResize = null;
  let sidebarObserved = null;
  function syncCompactHeader() {
    const root = doc.documentElement;
    const on = state.settings.sidebar.compactHeader;
    root.toggleAttribute(T3PLUS.compactAttr, on);
    root.toggleAttribute(T3PLUS.titleFirstAttr, state.settings.sidebar.titleFirst);
    const wrapper = doc.querySelector('[data-slot="sidebar-wrapper"]');
    const inner = findSidebarInner(doc) ?? doc.querySelector(T3_SELECTORS.sidebarInner);
    const right = inner?.getBoundingClientRect().right ?? 0;
    const inHeader =
      on && wrapper?.getAttribute("data-sidebar-state") === "expanded" && right > 40 && doc.querySelector("[data-chat-header]") && doc.querySelector("[data-sidebar-control]");
    root.toggleAttribute(T3PLUS.controlInHeaderAttr, Boolean(inHeader));
    if (inHeader) setRootVar("--t3plus-sidebar-right", `${Math.round(right)}px`);
    // Dragging the sidebar wider changes no DOM we watch: follow its size.
    if (inner && inner !== sidebarObserved && win.ResizeObserver) {
      sidebarResize?.disconnect();
      sidebarResize = new win.ResizeObserver(() => watcher.schedule());
      sidebarResize.observe(inner);
      sidebarObserved = inner;
    }
  }

  // ---------- t3+ settings section ----------
  // An owned "t3+" entry after Appearance in T3's Settings sidebar. Opening it
  // is a view mode (see settingsSection.js); it closes on any T3 settings link
  // or when the path changes.
  const settingsNav = createSettingsNavItem(doc, () => {
    settingsOpenAt = win.location.pathname;
    checkDom();
    doc.querySelector("[data-settings-page-scroll]")?.scrollTo?.(0, 0);
  });
  let settingsOpenAt = null;
  let openedFromHash = false;
  function onSettingsClick(event) {
    const link = event.target?.closest?.("[data-settings-section]");
    if (!link || link.hasAttribute(T3PLUS.ownedAttr) || settingsOpenAt === null) return;
    settingsOpenAt = null;
    syncSettingsSection();
  }
  function syncSettingsSection() {
    const path = win.location.pathname;
    if (settingsOpenAt !== null && settingsOpenAt !== path) settingsOpenAt = null;
    const anchor = SETTINGS_ROUTE.test(path) ? findSettingsNavAnchor(doc) : null;
    // Opened from the toolbar icon (…/settings/appearance#t3plus): show t3+ once.
    if (anchor && !openedFromHash && win.location.hash === "#t3plus") {
      openedFromHash = true;
      settingsOpenAt = path;
    }
    let container = null;
    if (anchor) {
      settingsNav.mount(anchor);
      if (settingsOpenAt !== null) container = findSettingsPage(doc);
    } else {
      if (settingsNav.element.isConnected) settingsNav.element.remove();
      settingsOpenAt = null;
      // Older T3 without the settings nav hook: the panel stays under Appearance.
      container = findAppearanceContainer(doc, path);
    }
    const open = Boolean(anchor && container);
    settingsNav.setActive(open);
    doc.documentElement.toggleAttribute(T3PLUS.settingsAttr, open);
    if (container) ensurePanelMounted(container, panel.element);
    else if (panel.element.isConnected) panel.element.remove();
  }

  function checkDom() {
    // After the extension reloads, this old copy loses its chrome APIs. Bow out
    // so it does not fight the fresh copy over the panel.
    if (deps.isAlive && !deps.isAlive()) {
      api.stop();
      return;
    }
    syncSettingsSection();
    const result = syncComposerSurfaces(doc, state.settings.glass.enabled);
    syncBackdropHosts(doc, state.settings.composerGradient.enabled);
    syncBackdropAnchor(doc);
    syncDither();
    if (result.orphanEditors > 0 && !warnedOrphans) {
      warnedOrphans = true;
      win.console?.warn?.("t3+: found a composer editor without T3's surface/body hooks. Update src/config.js selectors.");
    }
    syncSidebar();
    syncCompactHeader();
    syncHome();
    syncThreadDetails();
    usageDither.sync();
    syncDemo();
  }

  // ---------- Settings ----------

  // Preview changes (slider drags, color picking) repaint without writing storage.
  function preview(update) {
    state.settings = update(state.settings);
    render();
  }
  const gradient = (patch) => (s) => ({ ...s, composerGradient: { ...s.composerGradient, ...patch } });
  const glass = (patch) => (s) => ({ ...s, glass: { ...s.glass, ...patch } });

  // Saves run one at a time and always write the latest local state, so quick
  // successive changes (toggle, then mode) cannot overwrite each other.
  let saveQueue = Promise.resolve();
  let pendingSaves = 0;
  function persist(update, message = "") {
    preview(update);
    pendingSaves += 1;
    saveQueue = saveQueue
      .catch(() => {})
      .then(() => settingsStore.save(state.settings))
      .finally(() => {
        pendingSaves -= 1;
      })
      .then(() => {
        state.message = message;
        render();
      });
    return saveQueue;
  }

  // Writes of the local override from this tab; their storage echo is ignored.
  let ownLocalWrites = 0;
  async function saveLocal(patch) {
    ownLocalWrites += 1;
    try {
      state.local = await configProvider.saveLocal(patch);
    } finally {
      ownLocalWrites -= 1;
    }
  }

  async function reloadConfig({ refresh = true, message = "" } = {}) {
    state.loaded = await configProvider.load({ refresh });
    state.local = await configProvider.readLocal();
    state.configMessage = message;
    render();
    watcher.flush();
  }

  const actions = {
    setEnabled: (enabled) => persist(gradient({ enabled })),
    setMode: (mode) => persist(gradient({ mode })),
    previewAccent: (accent) => preview(gradient({ accent })),
    setAccent: (accent) => persist(gradient({ accent })),
    previewIntensity: (intensity) => preview(gradient({ intensity })),
    setIntensity: (intensity) => persist(gradient({ intensity })),
    setDither: (dither) => persist(gradient({ dither })),
    setDitherSize: (ditherSize) => persist(gradient({ ditherSize })),
    setDitherStyle: (ditherStyle) => persist(gradient({ ditherStyle })),
    setLook: (look) => persist(gradient(look === "smooth" ? { dither: false } : { dither: true, ditherStyle: look })),
    useSample: () => persist(gradient({ imageSource: "sample" }), "Using the packaged sample image."),
    setGlass: (enabled) => persist(glass({ enabled })),
    previewGlassStrength: (strength) => preview(glass({ strength })),
    setGlassStrength: (strength) => persist(glass({ strength })),
    setSidebarFeature: (name, on) => persist((s) => ({ ...s, sidebar: { ...s.sidebar, [name]: on } })),
    setHomeWidgets: (on) => persist((s) => ({ ...s, home: { ...s.home, widgets: on } })),
    setDemo: (on) => persist((s) => ({ ...s, demo: { ...s.demo, enabled: on } })),
    async chooseImage(file) {
      state.message = "Preparing image…";
      render();
      try {
        const record = await prepareImage(file);
        state.image = await imageStore.save(record);
        await persist(gradient({ imageSource: "upload" }), `Saved ${state.image.name} in this browser.`);
      } catch (error) {
        state.message = error instanceof Error ? error.message : "Could not use that image.";
        render();
      }
    },
    async removeImage() {
      await imageStore.remove();
      state.image = null;
      await persist(gradient({ imageSource: "sample" }), "Removed the uploaded image.");
    },
    async exportSettings() {
      if (!deps.backup) return;
      try {
        const data = await deps.backup.export();
        const blob = new win.Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = win.URL.createObjectURL(blob);
        const link = doc.createElement("a");
        link.href = url;
        link.download = `t3plus-settings-${new Date().toISOString().slice(0, 10)}.json`;
        doc.body.append(link);
        link.click();
        link.remove();
        win.setTimeout(() => win.URL.revokeObjectURL(url), 5000);
        state.message = "Exported your t3+ settings.";
      } catch (error) {
        state.message = error instanceof Error ? error.message : "Could not export.";
      }
      render();
    },
    async importSettings(file) {
      if (!deps.backup) return;
      try {
        const keys = await deps.backup.import(JSON.parse(await file.text()));
        // The stores follow storage changes, so every open T3 tab updates by itself.
        state.message = `Restored ${keys.length} saved setting${keys.length === 1 ? "" : "s"} from ${file.name}.`;
      } catch (error) {
        state.message = error instanceof SyntaxError ? "That file is not valid JSON." : error instanceof Error ? error.message : "Could not import.";
      }
      render();
    },
    async reset() {
      await saveQueue.catch(() => {});
      state.settings = await settingsStore.reset();
      state.message = "t3+ appearance reset.";
      render();
    },

    // ---------- Profiles ----------
    async selectProfile(id) {
      const exists = id === ALL_PROFILE_ID || state.loaded.config.profiles.some((p) => p.id === id);
      if (!exists) return;
      const routeKey = threadKeyFromPath(win.location.pathname);
      const profile = id === ALL_PROFILE_ID ? null : state.loaded.config.profiles.find((p) => p.id === id);
      const target = threadToRestore({
        profileId: id,
        view: state.view,
        currentThreadKey: routeKey,
        isMember: (key) => isMember(profile, key),
        isAvailable: (key) => findThreadRow(key) !== null,
      });
      state.view = { ...state.view, activeProfileId: id };
      lastRecordedThread = routeKey; // switching tabs is not "opening" the current thread under the new tab
      watcher.flush();
      if (target) openThread(target);
      await profileViewStore.save(state.view);
    },
    refreshConfig: () => reloadConfig({ refresh: true, message: "Reloaded." }),
    async setConfigSource(use) {
      await saveLocal({ use });
      await reloadConfig({ refresh: true });
    },
    async saveLocalConfig(text) {
      const parsed = parseT3PlusConfigText(text);
      if (!parsed.parsed) {
        state.configMessage = `Not saved. ${parsed.errors[0]}`;
        render();
        return;
      }
      await saveLocal({ text });
      const note = parsed.errors.length ? ` ${parsed.errors.length} warning(s) listed above.` : "";
      await reloadConfig({ refresh: false, message: `Saved the local override.${note}` });
    },

    // ---------- Bots ----------
    async updateBot(key, patch) {
      try {
        state.botPrefs = await botStore.update(key, patch);
        state.botMessage = "";
      } catch (error) {
        state.botMessage = error instanceof Error ? error.message : "Could not save that bot setting.";
      }
      render();
    },
    async forgetBot(key) {
      state.botPrefs = await botStore.forget(key);
      const { [key]: _removed, ...rest } = state.knownBots;
      state.knownBots = rest;
      state.botMessage = "Forgot that bot's settings.";
      render();
    },
  };

  const panel = createAppearancePanel(doc, actions);
  const home = createHomeView(doc);
  const detailsPool = createHomeView(doc, { variant: "pool" });
  const usageDither = createUsageDither(doc);

  const bar = createProfileBar(doc, actions);
  // Streaming chat text lands inside T3's message list, which holds nothing
  // t3+ decorates or measures: those mutations never schedule a check.
  let timeline = null;
  let timelineLookup = -Infinity;
  const isNoise = (node) => {
    if (state.settings.demo.enabled) return false; // screenshot mode covers message text too
    if (!timeline?.isConnected) {
      // Look it up again at most every 250 ms (pages without a chat have none).
      const t = win.performance?.now?.() ?? Date.now();
      if (t - timelineLookup < 250) return false;
      timelineLookup = t;
      timeline = doc.querySelector(T3_SELECTORS.messageList);
    }
    return Boolean(timeline && timeline !== node && timeline.contains(node));
  };
  const watcher = createDomWatcher({ win, doc, check: checkDom, throttleMs: deps.throttleMs ?? DOM_CHECK_THROTTLE_MS, isNoise });

  // ---------- Bot feed (latest message per bot) ----------
  let feedTimer = null;
  async function refreshBotFeed() {
    if (!deps.botFeed || !state.settings.sidebar.bots) return;
    const next = await deps.botFeed.load().catch(() => null);
    if (!next && state.botFeed) return; // keep the last good copy on a failed read
    state.botFeed = next;
    render();
  }

  const onVisibility = () => {
    if (doc.visibilityState !== "visible") return;
    if (configProvider.isStale(state.loaded)) reloadConfig({ refresh: true }).catch(() => {});
    if (state.bots.length) refreshBotFeed();
    if (findHero() || detailsPool.element.isConnected) refreshHomeFeed();
  };

  const api = {
    state,
    panel,
    bar,
    watcher,
    actions,
    async start() {
      // A copy orphaned by an extension reload may have left its UI behind.
      doc.getElementById(panel.element.id)?.remove();
      doc.getElementById(bar.element.id)?.remove();
      for (const old of doc.querySelectorAll("[data-t3plus-settings-nav]")) old.closest("li")?.remove();
      doc.addEventListener("click", onSettingsClick, true);
      unsubscribers.push(() => doc.removeEventListener("click", onSettingsClick, true));
      doc.addEventListener("keydown", onDemoKey, true);
      unsubscribers.push(() => doc.removeEventListener("keydown", onDemoKey, true));
      const [settings, image, view, botPrefs, knownBots, local] = await Promise.all([
        settingsStore.load(),
        imageStore.load(),
        profileViewStore.load(),
        botStore.load(),
        botStore.loadKnown(),
        configProvider.readLocal(),
      ]);
      Object.assign(state, { settings, image, view, botPrefs, knownBots, local });
      // Paint from the cached server copy first; refresh from the network right after.
      state.loaded = await configProvider.load({ refresh: false });
      unsubscribers.push(
        // Other tabs (or this one) saving keeps every open T3 tab in sync.
        settingsStore.subscribe((next) => {
          // While this tab is saving, its local state is newer than the echo.
          if (pendingSaves > 0) return;
          state.settings = next;
          render();
        }),
        imageStore.subscribe((next) => {
          state.image = next;
          render();
        }),
        profileViewStore.subscribe((next) => {
          state.view = next;
          render();
        }),
        botStore.subscribe((next) => {
          state.botPrefs = next;
          render();
        }),
        botStore.subscribeKnown((next) => {
          state.knownBots = next;
          render();
        }),
        configProvider.subscribeLocal((value) => {
          // This tab's own write already reloaded; only follow other tabs.
          if (ownLocalWrites > 0 || (value?.use === state.local.use && value?.text === state.local.text)) return;
          reloadConfig({ refresh: false }).catch(() => {});
        }),
      );
      doc.addEventListener("visibilitychange", onVisibility);
      unsubscribers.push(() => doc.removeEventListener("visibilitychange", onVisibility));
      const onResize = () => watcher.schedule();
      win.addEventListener?.("resize", onResize, { passive: true });
      unsubscribers.push(() => win.removeEventListener?.("resize", onResize));
      if (deps.botFeed) {
        state.botFeed = await deps.botFeed.readCache().catch(() => null);
        feedTimer = win.setInterval(() => {
          if (doc.visibilityState !== "hidden" && state.bots.length) refreshBotFeed();
        }, BOT_FEED_POLL_MS);
        unsubscribers.push(() => win.clearInterval(feedTimer));
        refreshBotFeed();
      }
      if (deps.homeFeed) {
        state.homeFeed = await deps.homeFeed.readCache().catch(() => null);
        const homeTimer = win.setInterval(() => {
          if (doc.visibilityState !== "hidden" && state.settings.home.widgets && (findHero() || detailsPool.element.isConnected)) refreshHomeFeed();
        }, HOME_FEED_POLL_MS);
        unsubscribers.push(() => win.clearInterval(homeTimer));
      }
      watchPopups();
      unsubscribers.push(() => {
        popupObserver?.disconnect();
        portalObserver?.disconnect();
      });
      watcher.start();
      render();
      if (state.loaded.source === "cache") reloadConfig({ refresh: true }).catch(() => {});
    },
    stop() {
      watcher.stop();
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      panel.element.remove();
      settingsNav.element.remove();
      bar.element.remove();
      home.element.remove();
      home.destroy();
      detailsPool.element.remove();
      detailsPool.destroy();
      usageDither.clear();
      for (const el of doc.querySelectorAll(`[${T3PLUS.detailsPoolAttr}]`)) el.removeAttribute(T3PLUS.detailsPoolAttr);
      sidebarResize?.disconnect();
      doc.documentElement.removeAttribute(T3PLUS.compactAttr);
      doc.documentElement.removeAttribute(T3PLUS.titleFirstAttr);
      demo.restore();
      doc.documentElement.removeAttribute(T3PLUS.demoAttr);
      doc.documentElement.removeAttribute(T3PLUS.settingsAttr);
      doc.documentElement.removeAttribute(T3PLUS.controlInHeaderAttr);
      doc.documentElement.removeAttribute(T3PLUS.homeAttr);
      clearProfileVisibility(doc.documentElement);
      clearBotDecoration(doc.documentElement);
      syncComposerSurfaces(doc, false);
      syncBackdropHosts(doc, false);
      deps.backdropRenderer?.clear();
      const cleared = [...Object.keys(computeComposerTheme(state.settings, null).vars), "--t3plus-composer-x"].map((name) => [name, null]);
      applyComposerTheme(doc, { mode: null, glass: false, vars: Object.fromEntries(cleared) });
      if (objectUrl) win.URL.revokeObjectURL(objectUrl);
      objectUrl = null;
      objectUrlFor = null;
    },
  };
  return api;
}
