// DOM hooks and constants that depend on T3 Code's private UI.
//
// T3 Nightly changes often. Most T3 selectors t3+ relies on live in this file.
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

const TOOLTIP_POPUP = '[data-slot="tooltip-popup"]';
/** Lines of a sidebar thread row (SidebarThreadRow.tsx): the body holds the top line (project, status slot) and the title line. */
const ROW_BODY = ".relative.z-10";
const ROW_TOP_LINE = ".h-5";
const ROW_PROJECT = ".truncate";
const CHAT_COLUMN_MAXIMIZED_AWAY_ATTR = "data-chat-column-maximized-away";

export const T3_SELECTORS = Object.freeze({
  /** Rounded composer card that wraps the body and footer. */
  composerSurface: '[data-chat-composer-surface="true"]',
  /** Padded body holding the Lexical editor. Its parent is the fallback card. */
  composerBody: '[data-chat-composer-body="true"]',
  /** Lexical contenteditable. Used only to detect a composer, never touched. */
  composerEditor: '[data-testid="composer-editor"]',
  /** T3's composer shell; its ::before is T3's own glass layer, tuned by CSS variables. */
  composerShell: '[data-slot="composer-shell"]',
  composerHost: '[data-slot="composer-host"]',
  composerMainSurface: '[data-chat-composer-main-surface]',

  /** Conversation pane behind the timeline and composer: hosts the t3+ backdrop layer. */
  conversationArea: '[data-workspace-area="conversation"]',
  /** Composer overlay; its parent is the fallback backdrop host. On the new-thread
   *  page (draft hero) it fills the pane (`inset-0`, a flex column since T3 @ da36859c,
   *  2026-11-26; `items-center` before); in a thread it is docked (`inset-x-0 bottom-0`). */
  composerOverlay: '[data-chat-composer-overlay="true"]',
  /** Any of these classes on the composer overlay marks the draft hero (current, then older T3). */
  heroOverlayClasses: Object.freeze(["inset-0", "items-center"]),
  /** Where T3's chat composer lives (ChatView.tsx: the overlay is workspace area "composer"). Editors
   *  outside it (e.g. the font preview on Settings > Appearance) are not chat composers. */
  chatComposerArea: '[data-chat-composer-overlay="true"], [data-workspace-area="composer"], [data-workspace-area="conversation"]',
  /** The composer stack inside the overlay; the draft headline hangs above it (bottom-full). */
  composerStack: '[data-chat-composer-stack="true"]',
  /** Appearance page sections, in render order. t3+ appends after the last one found. */
  appearanceSections: ["section#appearance", "section#appearance-interface"],
  /** T3's thread details panel card (ThreadDetailsPanel) and its usage limits section. */
  threadDetailsCard: "[data-thread-details-card]",
  draftProjectTrigger: "[data-draft-project-trigger]",
  threadDetailsUsage: 'section[aria-label="Usage limits"]',
  /** The Usage page chart (UsageProviderChart): "Daily processed tokens by provider", "Hourly cost by provider". */
  usageChart: 'svg[role="img"][aria-label$=" by provider"]',
  /** The composer's model picker; its aria-label names the model ("Claude Opus 5.5, High"). */
  modelPicker: "[data-chat-provider-model-picker]",
  /** The chat's scrolling message list (MessagesTimeline). Mutations inside it are streaming text. */
  messageList: ".messages-timeline-scroll",

  /** ThreadPreviewMiniPlayer / ChatCanvas, checked against upstream 9ef259e5.
   * Only browser mini players: device previews and the right panel stay native. */
  floatingBrowser: 'section[data-preview-mini-player^="browser:"][aria-label="Floating browser preview"]',
  previewSourceAttr: "data-preview-mini-player",
  previewResize: "[data-preview-mini-player-resize]",
  previewClose: 'button[aria-label="Close floating preview"]',
  nativeBrowserSurface: "[data-browser-surface-slot]",
  chatCanvas: "[data-chat-canvas]",
  chatColumn: "[data-chat-column]",
  /** On the chat column while the browser preview is maximized over it. */
  chatColumnMaximizedAwayAttr: CHAT_COLUMN_MAXIMIZED_AWAY_ATTR,
  chatColumnHidden: `[inert], [${CHAT_COLUMN_MAXIMIZED_AWAY_ATTR}="true"]`,
  threadFindBar: "[data-thread-find-bar]",
  previewThreadDetails: '[data-workspace-area="details"][aria-label="Thread details"]',
  sidebarGap: '[data-slot="sidebar-gap"]',

  /** Sidebar panel. Several can exist (left/right); t3+ picks the one with thread rows. */
  sidebarInner: '[data-slot="sidebar-inner"]',
  /** Scrolling list area inside the sidebar; the profile bar goes right above its root. */
  sidebarContent: '[data-slot="sidebar-content"]',
  /** Sidebar groups: the search row (search, filter, new project, new chat) and the list's own groups. */
  sidebarGroup: '[data-slot="sidebar-group"]',
  /** The "T3 Code" wordmark link in the sidebar's logo row (apps/web Sidebar header). */
  homeLink: 'a[aria-label="T3 Code home"]',
  /** Every keyboard-navigable sidebar row. Value: thread key, folder:<key>, shelf:<name>, draft:<id>. */
  sidebarRow: "[data-sidebar-row]",
  sidebarRowAttr: "data-sidebar-row",
  /** Inside a thread row: the body holding its lines, the top line in that body, and the project name on the top line. */
  rowBody: `:scope > ${ROW_BODY}`,
  rowTopLine: `:scope > ${ROW_TOP_LINE}`,
  rowProject: `:scope > ${ROW_PROJECT}`,
  /** The project name of a card row, from the row itself (rowBody > rowTopLine > rowProject). */
  rowProjectName: `:scope > ${ROW_BODY} > ${ROW_TOP_LINE} > ${ROW_PROJECT}`,
  /** Class of T3's status/time slot on the top line. */
  rowStatusSlotClass: "group/sidebar-status-slot",
  /** The sidebar's outer wrapper (ui/sidebar.tsx); data-sidebar-state="expanded" | "collapsed". */
  sidebarWrapper: '[data-slot="sidebar-wrapper"]',
  /** T3's fixed sidebar toggle, and the chat header it moves into while the compact header is on. */
  sidebarControl: "[data-sidebar-control]",
  chatHeader: "[data-chat-header]",
  /** The open thread's breadcrumb in the chat header; its <h2> is the thread title. */
  threadBreadcrumb: '[aria-label="Thread breadcrumb"]',
  /** T3's tooltip popups, portaled to <body>. */
  tooltipPopup: TOOLTIP_POPUP,
  /** The thread hover card's title line (ThreadHoverCard.tsx): first line of T3's tooltip popup.
   *  T3 main uses font-medium; the open redesign stack (#28839-#28845) switches it to font-semibold. */
  hoverCardTitle: `${TOOLTIP_POPUP} div.truncate:is(.font-medium, .font-semibold)`,
  /** Settings sidebar links (one per settings page), and the Appearance one t3+ follows. */
  settingsSectionLink: "[data-settings-section]",
  settingsAppearanceLink: '[data-settings-section="/settings/appearance"]',
  /** The settings page's scroller, and the column inside it that holds the page's sections. */
  settingsPageScroll: "[data-settings-page-scroll]",
  settingsPage: "[data-settings-page-scroll] > div",
  /** <li> around a thread row. Value: thread key "<environmentId>:<threadId>". */
  threadItem: "[data-thread-item]",
  /** <li> around a project folder header (Boring/project-grouped sidebar). */
  projectFolderItem: '[data-testid="sidebar-project-folder"]',
  /** T3's thread list (Sidebar.tsx): a flex column <ul role="presentation"> whose
   *  direct children are the row <li>s, shelf headers and the draft block. */
  threadList: '[data-slot="sidebar-content"] ul[role="presentation"]',
});

/** Prefixes of data-sidebar-row / data-sidebar-parent values. */
export const SIDEBAR_ROW_PREFIX = Object.freeze({
  folder: "folder:",
  shelf: "shelf:",
  draft: "draft:",
});

// T3 composer draft persistence; read only the current draft's identity fields.
export const T3_DRAFTS_STORAGE_KEY = "t3code:composer-drafts:v1";

/** Path of T3's Settings -> Appearance page. */
export const APPEARANCE_ROUTE = /\/settings\/appearance\/?$/;

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
  /** On a bot row's second line (T3's title line), set by bots.js; the Assistant group mounts its summary there. */
  botTitleLineAttr: "data-t3plus-bot-title-line",
  /** On the open bot thread's breadcrumb heading, and on a bot's thread hover card title. */
  botBreadcrumbAttr: "data-t3plus-bot-breadcrumb",
  botHoverAttr: "data-t3plus-bot-hover",
  /** On the t3+ entry in T3's Settings sidebar. */
  settingsNavAttr: "data-t3plus-settings-nav",
  /** The home widgets under T3's new-thread composer. */
  homeId: "t3plus-home",
  /** On a browser mini player while the fixed compact/expanded layout is applied. */
  floatingAttr: "data-t3plus-floating",
  previewDragAttr: "data-t3plus-preview-drag",
  previewControlsAttr: "data-t3plus-preview-controls",
  previewToolbarAttr: "data-t3plus-preview-toolbar",
  /** On <html> while the compact sidebar header is on. */
  compactAttr: "data-t3plus-compact-sidebar",
  /** On T3's logo row (the sidebar header that holds the home link); hidden by the compact header. */
  logoRowAttr: "data-t3plus-logo-row",
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
  /** On an Assistant group <li> (T3's own or a t3+ stand-in): "header" | "item" | "end". */
  groupAttr: "data-t3plus-group",
  /** On a t3+ stand-in <li>, drawn when T3 renders no row for a group thread. Value: thread key. */
  standInAttr: "data-t3plus-standin",
  /** On the visible title span of a group row with sub-threads: the count. */
  subCountAttr: "data-t3plus-subcount",
  /** Marks the read-only Assistant tasks section inside Thread Details. */
  detailsTasksAttr: "data-t3plus-details-tasks",
  detailsTasksLayoutAttr: "data-t3plus-tasks-layout",
  detailsTasksHostAttr: "data-t3plus-tasks-host",
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
  /** Assistant group view state: { expanded } (a viewing choice, local). */
  assistantGroup: "t3plus.assistantGroup.v1",
});

const options = (list) => Object.freeze(list.map(([value, label]) => Object.freeze({ value, label })));
const optionValues = (list) => Object.freeze(list.map(({ value }) => value));

/** Background styles (settings composerGradient.mode), with their Settings labels. */
export const GRADIENT_MODE_OPTIONS = options([["half-circle", "Glow"], ["image", "Image"]]);
export const GRADIENT_MODES = optionValues(GRADIENT_MODE_OPTIONS);
/** Dither cell sizes (composerGradient.ditherSize); each has a CSS size in DITHER_CELL_CSS. */
export const DITHER_SIZE_OPTIONS = options([["fine", "Fine"], ["medium", "Medium"], ["large", "Large"]]);
export const DITHER_SIZES = optionValues(DITHER_SIZE_OPTIONS);
/** The three background styles (composerGradient.ditherStyle). All are pixel art in the bot avatars' style. */
export const DITHER_STYLE_OPTIONS = options([["bayer", "Bayer"], ["grain", "Grain"], ["spectrum", "Spectrum"]]);
export const DITHER_STYLES = optionValues(DITHER_STYLE_OPTIONS);
/** Original, locally packaged wallpapers. IDs are saved; asset contents are not. */
export const WALLPAPERS = Object.freeze([
  { id: "sample", label: "Spectrum", path: "assets/sample-spectrum.svg" },
  { id: "aurora", label: "Aurora", path: "assets/wallpaper-aurora.svg" },
  { id: "contours", label: "Contours", path: "assets/wallpaper-contours.svg" },
  { id: "facets", label: "Facets", path: "assets/wallpaper-facets.svg" },
].map(Object.freeze));
export const IMAGE_SOURCES = Object.freeze([...WALLPAPERS.map(({ id }) => id), "upload"]);

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
    /** Activity, limits and spend under the new-thread composer. */
    widgets: true,
  }),
  demo: Object.freeze({
    /** Screenshot mode: stand-in titles, projects and message text (demoMode.js). */
    enabled: false,
  }),
});

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** An accent value (settings, profile colors): "theme" or a lowercase #rrggbb, else the fallback. */
export function normalizeAccent(value, fallback = "theme") {
  if (value === "theme") return "theme";
  return typeof value === "string" && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
}

/** Packaged sample image, relative to the extension root. */
export const SAMPLE_IMAGE_PATH = WALLPAPERS[0].path;

/**
 * Dither cell size in CSS px (settings composerGradient.ditherSize). "fine"
 * matches one pixel of a 32 px bot avatar (32 / 24 px). Sizes are in CSS px,
 * not device px: on a 2x Retina display a 2-device-pixel cell was only 1 CSS px
 * and the dither vanished.
 */
export const DITHER_CELL_CSS = Object.freeze({ fine: 4 / 3, medium: 2, large: 3 });

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

const MAX_BOTS = 24;
export const BOT_LIMITS = Object.freeze({
  /** Most bots t3+ keeps presentation for. */
  maxBots: MAX_BOTS,
  /** Most bot threads remembered from the sidebar (Settings lists them) or read from the bot feed. */
  maxKnownBots: MAX_BOTS * 2,
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
