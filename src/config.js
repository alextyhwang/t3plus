// DOM hooks and constants that depend on T3 Code's private UI.
//
// T3 Nightly changes often. Every T3 selector t3+ relies on lives in this file.
// Composer/Appearance hooks were verified against pingdotgg/t3code @ 5e6cc2b8
// (2026-09-08); sidebar, workspace and composer-shell hooks against @ 9ef259e5
// (2026-11-11):
//   apps/web/src/components/chat/ChatComposer.tsx        composer surface/body
//   apps/web/src/components/chat/ComposerSurface.tsx     composer-shell glass layer
//   apps/web/src/components/ComposerPromptEditor.tsx     composer editor
//   apps/web/src/components/ChatView.tsx                 conversation area, composer overlay
//   apps/web/src/lib/workspaceFocus.ts                   data-workspace-area
//   apps/web/src/components/ui/sidebar.tsx               sidebar-inner, scroll area
//   apps/web/src/components/sidebar/SidebarThreadRow.tsx data-thread-item, data-sidebar-row/-parent
//   apps/web/src/components/sidebar/SidebarProjectFolderHeader.tsx  folder:<logicalProjectKey>
//   apps/web/src/components/settings/SettingsPanels.tsx  Appearance sections
// When one breaks, update it here and in src/styles/content.css (the CSS file
// repeats the composer/backdrop selectors because manifest CSS cannot import JS).

export const T3_SELECTORS = Object.freeze({
  /** Rounded composer card that wraps the body and footer. */
  composerSurface: '[data-chat-composer-surface="true"]',
  /** Padded body holding the Lexical editor. Its parent is the fallback card. */
  composerBody: '[data-chat-composer-body="true"]',
  /** Lexical contenteditable. Used only to detect a composer, never touched. */
  composerEditor: '[data-testid="composer-editor"]',
  /** T3's composer shell; its ::before is T3's own glass layer, tuned by CSS variables. */
  composerShell: '[data-slot="composer-shell"]',
  /** Conversation pane behind the timeline and composer: hosts the t3+ backdrop layer. */
  conversationArea: '[data-workspace-area="conversation"]',
  /** Composer overlay; its parent is the fallback backdrop host. On the new-thread
   *  page (draft hero) it is centered with `items-center` (ChatView.tsx). */
  composerOverlay: '[data-chat-composer-overlay="true"]',
  /** Where T3's chat composer lives (ChatView.tsx: the overlay is workspace area "composer"). Editors
   *  outside it (e.g. the font preview on Settings > Appearance) are not chat composers. */
  chatComposerArea: '[data-chat-composer-overlay="true"], [data-workspace-area="composer"], [data-workspace-area="conversation"]',
  /** The composer stack inside the overlay; the draft headline hangs above it (bottom-full). */
  composerStack: '[data-chat-composer-stack="true"]',
  /** Appearance page sections, in render order. t3+ appends after the last one found. */
  appearanceSections: ["section#appearance", "section#appearance-interface"],
  /** T3's thread details panel card (ThreadDetailsPanel) and its usage limits section. */
  threadDetailsCard: "[data-thread-details-card]",
  threadDetailsUsage: 'section[aria-label="Usage limits"]',
  /** The Usage page chart (UsageProviderChart): "Daily processed tokens by provider", "Hourly cost by provider". */
  usageChart: 'svg[role="img"][aria-label$=" by provider"]',
  /** The composer's model picker; its aria-label names the model ("Claude Opus 5.5, High"). */
  modelPicker: "[data-chat-provider-model-picker]",
  /** The chat's scrolling message list (MessagesTimeline). Mutations inside it are streaming text. */
  messageList: ".messages-timeline-scroll",

  /** Sidebar panel. Several can exist (left/right); t3+ picks the one with thread rows. */
  sidebarInner: '[data-slot="sidebar-inner"]',
  /** Scrolling list area inside the sidebar; the profile bar goes right above its root. */
  sidebarContent: '[data-slot="sidebar-content"]',
  /** Every keyboard-navigable sidebar row. Value: thread key, folder:<key>, shelf:<name>, draft:<id>. */
  sidebarRow: "[data-sidebar-row]",
  /** <li> around a thread row. Value: thread key "<environmentId>:<threadId>". */
  threadItem: "[data-thread-item]",
  /** <li> around a project folder header (Boring/project-grouped sidebar). */
  projectFolderItem: '[data-testid="sidebar-project-folder"]',
});

/** Prefixes of data-sidebar-row / data-sidebar-parent values. */
export const SIDEBAR_ROW_PREFIX = Object.freeze({
  folder: "folder:",
  shelf: "shelf:",
  draft: "draft:",
});

/** Path of T3's Settings -> Appearance page. */
export const APPEARANCE_ROUTE = /\/settings\/appearance\/?$/;

/** First path segments that are T3 app routes, not "/<environmentId>/<threadId>". */
export const NON_THREAD_ROUTE_SEGMENTS = Object.freeze(["settings", "draft", "new", "pull-requests", "api", "oauth"]);

/** Attributes and ids t3+ owns. */
export const T3PLUS = Object.freeze({
  /** On <html>: "half-circle" | "image" while a background is shown. */
  modeAttr: "data-t3plus-backdrop",
  /** On <html>: present while the glass composer is on. */
  glassAttr: "data-t3plus-glass",
  /** Set on fallback composer surfaces that lack T3's surface attribute. */
  surfaceAttr: "data-t3plus-surface",
  /** Set on the composer overlay's parent when T3's conversation-area hook is missing. */
  backdropHostAttr: "data-t3plus-backdrop-host",
  panelId: "t3plus-appearance",
  profileBarId: "t3plus-profilebar",
  /** Marks sidebar rows t3+ hid for the active profile (together with `hidden`). */
  filteredAttr: "data-t3plus-filtered",
  /** Marks the open thread's row when it is outside the active profile. */
  outsideAttr: "data-t3plus-outside",
  /** On a bot thread row. Value: status (working | attention | failed | done | waiting | idle). */
  botAttr: "data-t3plus-bot",
  /** On the visible title span inside a bot row. */
  botTitleAttr: "data-t3plus-bot-title",
  /** The home widgets under T3's new-thread composer. */
  homeId: "t3plus-home",
  /** On <html> while the compact sidebar header is on. */
  compactAttr: "data-t3plus-compact-sidebar",
  /** On <html> while sidebar rows show the title first. */
  titleFirstAttr: "data-t3plus-title-first",
  /** On T3's usage limits section while the t3+ pool replaces its rows. */
  detailsPoolAttr: "data-t3plus-details-pool",
  /** On <html> while screenshot mode covers T3's text. */
  demoAttr: "data-t3plus-demo",
  /** On <html> while the t3+ settings section is open. */
  settingsAttr: "data-t3plus-settings",
  /** On <html> while T3's sidebar control is shown in the chat header (sidebar open). */
  controlInHeaderAttr: "data-t3plus-control-in-header",
  /** On <html> while the home widgets are shown. */
  homeAttr: "data-t3plus-home",
  /** On elements t3+ inserted into T3's DOM (bot avatars). */
  ownedAttr: "data-t3plus-owned",
});

/** The exact title token that marks a thread as a bot/orchestrator. */
export const DEFAULT_BOT_MARKER = "[[t3plus:bot:v1]]";
/** Shape a configured marker must have: one [[...]] token, no spaces. */
export const BOT_MARKER_PATTERN = /^\[\[[A-Za-z0-9:._-]{1,48}\]\]$/;

export const STORAGE_KEYS = Object.freeze({
  settings: "t3plus.settings.v1",
  image: "t3plus.image.v1",
  /** Active profile and last thread per profile (viewing choices; local by design). */
  profileView: "t3plus.profileView.v1",
  /** Last good copy of the server t3plus.json, with its fetch time. */
  configCache: "t3plus.config.cache.v1",
  /** Optional local override of t3plus.json, and which source to use. */
  configLocal: "t3plus.config.local.v1",
  /** Per-bot presentation: shape and color. */
  bots: "t3plus.bots.v1",
  /** Bot threads seen in the sidebar, so Settings can list them. */
  knownBots: "t3plus.knownBots.v1",
  /** Last good copy of t3plus-bots.json (latest message per bot). */
  botFeedCache: "t3plus.botFeed.cache.v1",
  /** Last good copy of t3plus-home.json (home widget data). */
  homeFeedCache: "t3plus.homeFeed.cache.v1",
});

export const GRADIENT_MODES = Object.freeze(["half-circle", "image"]);
export const IMAGE_SOURCES = Object.freeze(["sample", "upload"]);

export const DEFAULT_SETTINGS = Object.freeze({
  version: 2,
  /** The background behind the composer (kept under its v1 name so v1 choices carry over). */
  composerGradient: Object.freeze({
    enabled: true,
    mode: "half-circle",
    /** "theme" follows T3's --primary; otherwise a #rrggbb color. */
    accent: "theme",
    /** 0-100. */
    intensity: 45,
    imageSource: "sample",
    /** Draw the background as a real ordered dither (pixelated), like the bot avatars. */
    dither: true,
    /** Dither cell size: "fine" (the bot avatars' pixel), "medium" or "large". */
    ditherSize: "medium",
    /** Pixel dither style: "bayer" (crosshatch), "grain" (organic noise) or "spectrum" (hue-shifting tones). */
    ditherStyle: "bayer",
  }),
  glass: Object.freeze({
    enabled: true,
    /** 0-100: how see-through the composer card is. */
    strength: 85,
  }),
  sidebar: Object.freeze({
    profiles: true,
    bots: true,
    /** Hide the "T3 Code" logo row and put T3's collapse button before the breadcrumbs. */
    compactHeader: true,
    titleFirst: false,
  }),
  home: Object.freeze({
    /** Activity, limits, spend and automations under the new-thread composer. */
    widgets: true,
  }),
  demo: Object.freeze({
    /** Screenshot mode: stand-in titles, projects and message text (demoMode.js). */
    enabled: false,
  }),
});

/** Packaged sample image, relative to the extension root. */
export const SAMPLE_IMAGE_PATH = "assets/sample-spectrum.svg";

/**
 * Bot avatar shapes: CSS clip-path for each. The avatar is a square tile
 * clipped to the shape; the status dot sits outside the clip.
 */
export const BOT_SHAPES = Object.freeze({
  circle: "circle(50% at 50% 50%)",
  square: "inset(4% round 26%)",
  triangle: "polygon(50% 4%, 97% 92%, 3% 92%)",
  diamond: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)",
  hexagon: "polygon(25% 4%, 75% 4%, 100% 50%, 75% 96%, 25% 96%, 0 50%)",
  star: "polygon(50% 0, 62% 35%, 99% 36%, 69% 58%, 80% 95%, 50% 73%, 20% 95%, 31% 58%, 1% 36%, 38% 35%)",
  // Balls (BOT_SKINS): the shape brings its own colors and markings.
  // A fat football on the diagonal (tips at the bottom-left and top-right corners), so it fills the tile.
  football: "polygon(4.7% 95.3%, 20.1% 97.7%, 31.8% 96.4%, 42.0% 93.7%, 51.3% 90.0%, 59.6% 85.5%, 67.2% 80.1%, 74.0% 74.0%, 80.1% 67.2%, 85.5% 59.6%, 90.0% 51.3%, 93.7% 42.0%, 96.4% 31.8%, 97.7% 20.1%, 95.3% 4.7%, 79.9% 2.3%, 68.2% 3.6%, 58.0% 6.3%, 48.7% 10.0%, 40.4% 14.5%, 32.8% 19.9%, 26.0% 26.0%, 19.9% 32.8%, 14.5% 40.4%, 10.0% 48.7%, 6.3% 58.0%, 3.6% 68.2%, 2.3% 79.9%)",
  basketball: "circle(50% at 50% 50%)",
});

/**
 * Shapes with a fixed look of their own: the bot's color is ignored and this
 * light -> mid -> dark ramp is used instead; src/botArt.js draws the markings
 * (football laces in white, basketball seams in the dark stop).
 */
export const BOT_SKINS = Object.freeze({
  football: Object.freeze({ stops: ["#d9915a", "#94491f", "#3f1a08"] }),
  // lift brightens the body so the dark seams stand out from the dither.
  basketball: Object.freeze({ stops: ["#ffc38a", "#f26f1d", "#4a1c06"], lift: 0.16 }),
});

/**
 * Bot avatar colors. Each is a fixed light -> mid -> dark ramp, rendered as an
 * ordered-dither gradient (src/botArt.js). Users pick the color, never the stops.
 */
export const BOT_COLORS = Object.freeze({
  blue: Object.freeze({ label: "Blue", stops: ["#a8d1ff", "#3b82f6", "#1e2f8a"] }),
  red: Object.freeze({ label: "Red", stops: ["#ffb4a8", "#ef4444", "#7f1d1d"] }),
  orange: Object.freeze({ label: "Orange", stops: ["#ffd59e", "#f97316", "#7c2d12"] }),
  yellow: Object.freeze({ label: "Yellow", stops: ["#fff4a8", "#eab308", "#6b3a0f"] }),
  green: Object.freeze({ label: "Green", stops: ["#bff7cb", "#22c55e", "#14532d"] }),
  teal: Object.freeze({ label: "Teal", stops: ["#aaf5ec", "#14b8a6", "#123f45"] }),
  purple: Object.freeze({ label: "Purple", stops: ["#ddd0ff", "#8b5cf6", "#3b0a64"] }),
  pink: Object.freeze({ label: "Pink", stops: ["#ffc6e4", "#ec4899", "#831843"] }),
  gray: Object.freeze({ label: "Gray", stops: ["#ececf0", "#7a7a85", "#26262c"] }),
});

export const IMAGE_LIMITS = Object.freeze({
  /** Files above this are rejected before decoding. */
  maxInputBytes: 15 * 1024 * 1024,
  /** Longest edge after downscaling. */
  maxEdgePx: 1600,
  /** Hard cap on the stored data URL (chrome.storage.local quota is 10 MB). */
  maxStoredChars: 3 * 1024 * 1024,
  acceptedTypes: Object.freeze(["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"]),
});

export const BOT_LIMITS = Object.freeze({
  /** Most bots t3+ keeps presentation for. */
  maxBots: 24,
  /** Longest preview text kept from the bot feed. */
  maxPreviewChars: 280,
});

/** How often the bot feed (latest message per bot) is re-read while the tab is visible. */
export const BOT_FEED_POLL_MS = 60 * 1000;
/** How often the home feed is re-read while the tab is visible. */
export const HOME_FEED_POLL_MS = 2 * 60 * 1000;

export const CONFIG_LIMITS = Object.freeze({
  /** Largest t3plus.json accepted, in characters. */
  maxChars: 256 * 1024,
  maxProfiles: 12,
  maxProjectsPerProfile: 500,
  maxThreadsPerProfile: 2000,
  /** A cached server copy older than this is refreshed when the tab becomes visible. */
  staleAfterMs: 5 * 60 * 1000,
});

/** Minimum gap between DOM checks triggered by mutations, in ms. */
export const DOM_CHECK_THROTTLE_MS = 200;
