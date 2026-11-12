// Origins t3+ talks to. This file is the single source of truth: `build.mjs`
// copies these lists into dist/manifest.json.
//
// HOST_MATCHES: pages the content script runs on.
// - https://app.t3.codes/* is the official hosted T3 Code web client.
// To add a self-hosted T3 web origin, append its match pattern here, e.g.
// "https://t3.example.ts.net/*", then run `npm run build` and reload the
// extension. Never use "<all_urls>": t3+ must only see T3 pages.
export const HOST_MATCHES = Object.freeze(["https://app.t3.codes/*"]);

// FEED_BASE: the folder URL the three optional JSON feeds are read from
// (t3plus.json, t3plus-bots.json, t3plus-home.json). The build sets it from
// T3PLUS_FEED_BASE or t3plus.local.json (see README, "Feeds"). Left unset, it is
// a placeholder on the reserved .invalid domain and t3+ fetches nothing.
/* global __T3PLUS_FEED_BASE__ */
export const DEFAULT_FEED_BASE = "https://feeds.t3plus.invalid/";
const injected = typeof __T3PLUS_FEED_BASE__ === "string" ? __T3PLUS_FEED_BASE__ : "";
export const FEED_BASE = injected || DEFAULT_FEED_BASE;
export const FEEDS_CONFIGURED = FEED_BASE !== DEFAULT_FEED_BASE;

/** The exact feed URLs under a base folder URL. */
export function feedEndpoints(base = FEED_BASE) {
  const root = base.endsWith("/") ? base : `${base}/`;
  return {
    // The read-only, server-owned t3plus.json (profiles and bot marker). Each
    // URL is an exact-path host permission, so the extension can read these
    // files and nothing else on the host. Fetched by the background worker,
    // because a plain file share sends no CORS headers.
    config: [`${root}t3plus.json`],
    // t3plus-bots.json: the latest message of each bot thread (server/publish_bot_feed.py).
    bots: `${root}t3plus-bots.json`,
    // t3plus-home.json: pools, activity and usage for the home widgets (server/publish_home.py).
    home: `${root}t3plus-home.json`,
  };
}

const endpoints = feedEndpoints();
export const CONFIG_ENDPOINTS = Object.freeze(endpoints.config);
export const BOT_FEED_ENDPOINT = endpoints.bots;
export const HOME_FEED_ENDPOINT = endpoints.home;

/** Every URL the background worker may fetch. */
export const FETCH_ENDPOINTS = Object.freeze([...CONFIG_ENDPOINTS, BOT_FEED_ENDPOINT, HOME_FEED_ENDPOINT]);

/** Host permissions for the manifest: exactly the fetchable URLs. */
export const CONFIG_HOST_PERMISSIONS = Object.freeze([...FETCH_ENDPOINTS]);

/** Host permissions for a given feed base (the build uses the configured one). */
export function hostPermissionsFor(base) {
  const e = feedEndpoints(base);
  return [...e.config, e.bots, e.home];
}
