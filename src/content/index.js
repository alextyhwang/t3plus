// Content script entry. Bundled by build.mjs into dist/content.js (an IIFE,
// because MV3 content scripts cannot be ES modules).
//
// Read-only toward T3: this script touches only the DOM of the page and
// extension storage. It does not read cookies or credentials, call T3's
// WebSocket/RPC, or send anything to T3's server. The one network read is the
// server-owned t3plus.json (and the t3plus-bots.json message feed), fetched by
// the background worker (src/background.js).
import { createT3Plus } from "../app.js";
import { exportAll, importAll, mirrorToSync, restoreBackups } from "../backup.js";
import { createBackdropRenderer } from "../backdropRenderer.js";
import { createBotFeed } from "../botFeed.js";
import { createHomeFeed } from "../homeData.js";
import { createBotStore } from "../bots.js";
import { setBotArtEncoder } from "../botArt.js";
import { createImageStore } from "../imageStore.js";
import { createProfileViewStore } from "../profiles.js";
import { createConfigProvider, createRuntimeFetcher } from "../remoteConfig.js";
import { createSettingsStore } from "../settings.js";

const area = chrome.storage.local;
const sync = chrome.storage.sync;
const changed = chrome.storage.onChanged;

const fetchRemote = createRuntimeFetcher(chrome.runtime);

// Bot faces as small PNGs instead of per-pixel SVG (see botArt.js).
setBotArtEncoder((pixels, width, height, fills) => {
  if (!fills.every((hex) => /^#[0-9a-f]{6}$/i.test(hex))) return null;
  const palette = fills.map((hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < pixels.length; i += 1) {
    const [r, g, b] = palette[pixels[i]];
    image.data.set([r, g, b, 255], i * 4);
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
});

const app = createT3Plus({
  win: window,
  doc: document,
  settingsStore: createSettingsStore(area, changed),
  imageStore: createImageStore(area, changed),
  profileViewStore: createProfileViewStore(area, changed),
  configProvider: createConfigProvider({ area, changedEvent: changed, fetchRemote }),
  botStore: createBotStore(area, changed),
  botFeed: createBotFeed({ area, fetchRemote }),
  homeFeed: createHomeFeed({ area, fetchRemote }),
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
  .catch(() => [])
  .then(() => {
    mirrorToSync({ local: area, sync, page, changedEvent: changed });
    return app.start();
  })
  .catch((error) => {
    console.warn("t3+: failed to start", error);
  });
