// Content script entry. Bundled by build.mjs into dist/content.js (an IIFE,
// because MV3 content scripts cannot be ES modules).
//
// Read-only toward T3: this script touches only the DOM of the page and
// extension storage. It does not read cookies or credentials, call T3's
// WebSocket/RPC, or send anything to T3's server. The background worker handles
// feeds and private widget APIs.
import { createT3Plus } from "../app.js";
import { createGroupViewStore } from "../assistantGroup.js";
import { exportAll, importAll, mirrorToSync, restoreBackups } from "../backup.js";
import { createBackdropRenderer } from "../backdropRenderer.js";
import { createBotFeed } from "../botFeed.js";
import { createHomeFeed } from "../homeData.js";
import { createTasksFeed } from "../tasks.js";
import { createImmichFeed } from "../immich.js";
import { createCalendarFeed } from "../calendar.js";
import { createBotStore } from "../bots.js";
import { setBotArtEncoder } from "../botArt.js";
import { assembleApng } from "../apng.js";
import { createImageStore } from "../imageStore.js";
import { createProfileViewStore } from "../profiles.js";
import { createConfigProvider, createRuntimeFetcher } from "../remoteConfig.js";
import { createSettingsStore } from "../settings.js";
import { ASSISTANT_GROUP, IMMICH, TASKS_BASE } from "../personal.js";

const area = chrome.storage.local;
const sync = chrome.storage.sync;
const changed = chrome.storage.onChanged;

const fetchRemote = createRuntimeFetcher(chrome.runtime);
/** Tasks and the calendar share the task site's passkey session. */
async function openTaskSignIn(failure) {
  const response = await chrome.runtime.sendMessage({ type: "t3plus/tasks-signin" });
  if (!response?.ok) throw new Error(failure);
}

// Bot faces as small PNGs instead of per-pixel SVG (see botArt.js). One
// canvas for all of them, kept on the CPU (willReadFrequently): a GPU canvas
// per face, read back by toDataURL, cost tens of milliseconds each at startup.
// Animated faces also get an animated PNG of the same frames (apng.js).
let artCanvas = null;
const pngBytes = (dataUrl) => Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (c) => c.charCodeAt(0));
setBotArtEncoder((pixels, width, height, fills, { frames = 1, frameMs = 0 } = {}) => {
  if (!fills.every((hex) => /^#[0-9a-f]{6}$/i.test(hex))) return null;
  const palette = fills.map((hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)));
  artCanvas ??= document.createElement("canvas");
  const canvas = artCanvas;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let i = 0, o = 0; i < pixels.length; i += 1, o += 4) {
    const rgb = palette[pixels[i]];
    data[o] = rgb[0];
    data[o + 1] = rgb[1];
    data[o + 2] = rgb[2];
    data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const sheet = canvas.toDataURL("image/png");
  if (frames < 2 || width % frames) return sheet;
  let motion = null;
  try {
    const frameWidth = width / frames;
    const pngs = [];
    canvas.width = frameWidth;
    for (let f = 0; f < frames; f += 1) {
      ctx.putImageData(image, -f * frameWidth, 0);
      pngs.push(pngBytes(canvas.toDataURL("image/png")));
    }
    const apng = assembleApng(pngs, frameMs);
    if (apng) {
      let binary = "";
      for (const byte of apng) binary += String.fromCharCode(byte);
      motion = `data:image/png;base64,${btoa(binary)}`;
    }
  } catch {
    motion = null;
  }
  return { sheet, motion };
});

const app = createT3Plus({
  win: window,
  doc: document,
  settingsStore: createSettingsStore(area, changed),
  imageStore: createImageStore(area, changed),
  profileViewStore: createProfileViewStore(area, changed),
  configProvider: createConfigProvider({ area, changedEvent: changed, fetchRemote }),
  botStore: createBotStore(area, changed),
  groupViewStore: createGroupViewStore(area, changed),
  botFeed: createBotFeed({ area, fetchRemote }),
  homeFeed: createHomeFeed({ area, fetchRemote }),
  assistantGroup: ASSISTANT_GROUP,
  // Tasks and Calendar need a task API (TASKS_BASE); without one they stay off.
  calendarFeed: TASKS_BASE ? createCalendarFeed({
    requestRemote: () => chrome.runtime.sendMessage({ type: "t3plus/calendar" }),
    signIn: () => openTaskSignIn("Could not open sign-in."),
  }) : null,
  tasksFeed: TASKS_BASE ? createTasksFeed({
    requestRemote: (request) => chrome.runtime.sendMessage({ type: "t3plus/task-request", request }),
    signIn: () => openTaskSignIn("Could not open task sign-in."),
  }) : null,
  immichFeed: createImmichFeed({
    fetchRemote,
    requestImage: (url) => chrome.runtime.sendMessage({ type: "t3plus/immich-image", request: { url } }),
  }),
  immichConfig: IMMICH,
  backdropRenderer: createBackdropRenderer({ win: window, doc: document }),
  assetUrl: (path) => chrome.runtime.getURL(path),
  isAlive: () => Boolean(chrome.runtime?.id),
  backup: {
    export: () => exportAll(area, chrome.runtime.getManifest().version),
    import: (data) => importAll(area, data),
  },
});

// A fresh install (new version unpacked elsewhere, reinstall, another computer)
// gets its preferences back, from Chrome Sync or the copy in T3's page storage,
// before t3+ reads them. See backup.js.
let page = null;
try {
  page = window.localStorage;
} catch {
  page = null;
}
restoreBackups(area, { sync, page })
  .catch((error) => {
    console.warn("t3+: could not restore saved preferences", error);
    return [];
  })
  .then(() => {
    mirrorToSync({ local: area, sync, page, changedEvent: changed });
    return app.start();
  })
  .catch((error) => {
    console.warn("t3+: failed to start", error);
  });
