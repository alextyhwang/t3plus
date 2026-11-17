// Your setup. Every endpoint and integration t3+ uses is derived from this file
// (src/hosts.js). With the values below left empty, t3+ fetches nothing and the
// optional integrations stay off. See docs/setup.md.
//
// After you set an HTTPS base, add its origin to "host_permissions" in
// manifest.json (for example "https://files.example.com/*").
// test/manifest.test.js checks that every configured endpoint is covered.

/** The T3 web client the content script runs on. */
export const T3_ORIGIN = "https://app.t3.codes";

/**
 * Folder of the read-only JSON feeds written by server/publish_all.py
 * (t3plus.json, t3plus-bots.json, t3plus-home.json), ending in "/".
 * Example: "https://files.example.com/t3plus/". Empty: no feeds.
 */
export const FEED_BASE = "";

/** Base URL of a compatible task API (docs/setup.md), ending in "/". Empty: no Tasks or Calendar. */
export const TASKS_BASE = "";

/**
 * Optional Assistant group (docs/setup.md): a router bot's thread heads a group
 * at the top of the sidebar, and the active threads of its project sit under it,
 * except threads whose title starts with one of skipTitlePrefixes.
 * Example:
 *   Object.freeze({ botThreadId: "<thread id>", projectId: "<project id>", skipTitlePrefixes: Object.freeze([]) })
 */
export const ASSISTANT_GROUP = null;

/**
 * Optional Immich photos in one project's new-thread details. The API key stays
 * on the server (server/publish_immich_feed.py). Empty ids and endpoints: off.
 */
export const IMMICH = Object.freeze({
  environmentId: "",
  projectId: "",
  feedEndpoint: "",
  imageEndpoint: "",
  libraryUrl: "",
  maxPhotos: 4,
});
