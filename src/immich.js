import { CONFIG_LIMITS } from "./config.js";
import { IMMICH } from "./personal.js";
import { RemoteFeedError, clean, loadFailureMessage } from "./remoteFeed.js";

// t3plus-immich.json (server/publish_immich_feed.py) carries asset ids, capture
// dates and the service status only. Every URL is built here from IMMICH.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES = ["online", "degraded", "offline", "stale"];
const trimSlash = (url) => url.replace(/\/$/, "");

const thumbnailUrl = (id, imageEndpoint = IMMICH.imageEndpoint) => `${trimSlash(imageEndpoint)}/${id}/thumbnail`;
const photoUrl = (id, libraryUrl = IMMICH.libraryUrl) => `${trimSlash(libraryUrl)}/${id}`;

/** The only image URLs the worker fetches: thumbnailUrl's shape exactly, nothing appended. */
export function isImmichThumbnail(url, imageEndpoint = IMMICH.imageEndpoint) {
  try {
    const parsed = new URL(url), base = new URL(imageEndpoint);
    const prefix = trimSlash(base.pathname) + "/";
    if (parsed.origin !== base.origin || parsed.username || parsed.password || parsed.search || parsed.hash || !parsed.pathname.startsWith(prefix)) return false;
    return new RegExp(`^${UUID.source.slice(1, -1)}/thumbnail$`, "i").test(parsed.pathname.slice(prefix.length));
  } catch {
    return false;
  }
}

export const IMMICH_IMAGE_TYPES = /^image\/(?:jpeg|png|webp|avif)$/;
export const IMMICH_IMAGE_MAX_BYTES = 2_000_000;

class ImmichRequestError extends RemoteFeedError {}

const validDate = (value) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

function normalizedPhoto(raw, imageEndpoint, libraryUrl) {
  const id = typeof raw?.id === "string" && UUID.test(raw.id) ? raw.id : null;
  if (!id) return null;
  // The capture time; the publisher falls back to upload time for imports without one.
  const date = validDate(raw.fileCreatedAt);
  return { id, date, dateMs: date ? Date.parse(date) : 0, thumbnailUrl: thumbnailUrl(id, imageEndpoint), link: photoUrl(id, libraryUrl) };
}

function normalizeStatus(value) {
  const requested = clean(value?.state, 32).toLowerCase();
  const state = STATES.includes(requested) ? requested : "degraded";
  const serviceStartedAt = validDate(value?.serviceStartedAt);
  const hostStartedAt = validDate(value?.hostStartedAt);
  const uptimeSeconds = typeof value?.uptimeSeconds === "number" ? value.uptimeSeconds : NaN;
  const uptimeSource = value?.uptimeSource === "service" || value?.uptimeSource === "host" ? value.uptimeSource : serviceStartedAt ? "service" : hostStartedAt ? "host" : null;
  return { state, checkedAt: validDate(value?.observedAt), detail: clean(value?.detail, 120), version: clean(value?.version, 40), uptimeSeconds: Number.isFinite(uptimeSeconds) && uptimeSeconds >= 0 ? Math.min(3155760000, uptimeSeconds) : null, serviceStartedAt, hostStartedAt, uptimeSource };
}

export function parseImmichFeedText(text, { imageEndpoint = IMMICH.imageEndpoint, libraryUrl = IMMICH.libraryUrl, maxPhotos = IMMICH.maxPhotos, now = Date.now, staleAfterMs = 10 * 60 * 1000 } = {}) {
  if (typeof text !== "string" || text.length === 0 || text.length > CONFIG_LIMITS.maxChars) return null;
  let raw;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const photos = (Array.isArray(raw.photos) ? raw.photos : []).slice(0, 100).map((entry) => normalizedPhoto(entry, imageEndpoint, libraryUrl)).filter(Boolean).sort((a, b) => b.dateMs - a.dateMs).slice(0, Math.max(1, maxPhotos));
  const generatedAt = validDate(raw.generatedAt);
  const status = normalizeStatus(raw.status);
  const age = generatedAt ? now() - Date.parse(generatedAt) : Infinity;
  const statusAge = status.checkedAt ? now() - Date.parse(status.checkedAt) : Infinity;
  if ((age > staleAfterMs || statusAge > staleAfterMs || age < -60_000) && status.state !== "offline") status.state = "stale";
  return { version: Number(raw.version) || 1, generatedAt, photos, status, libraryUrl };
}

export function createImmichFeed({ fetchRemote, endpoint = IMMICH.feedEndpoint, imageEndpoint = IMMICH.imageEndpoint, libraryUrl = IMMICH.libraryUrl, maxPhotos = IMMICH.maxPhotos, requestImage } = {}) {
  return {
    endpoint,
    imageEndpoint,
    libraryUrl,
    async load() {
      if (typeof fetchRemote !== "function" || !endpoint) throw new ImmichRequestError("Immich is not configured.");
      let response;
      try { response = await fetchRemote(endpoint); } catch (error) { throw new ImmichRequestError(error instanceof Error ? `Could not reach the photo service: ${clean(error.message, 120)}` : "Could not reach the photo service."); }
      if (!response?.ok) {
        throw new ImmichRequestError(response?.status === 401 || response?.status === 403 ? "Photo service access is unavailable." : loadFailureMessage(response, {
          service: "photo service",
          notFound: "Photo feed unavailable (HTTP 404). The private Immich publisher is not reachable.",
          unreachable: "Check the private feed and refresh.",
          subject: "recent photos",
          detailMax: 120,
        }), Number(response?.status) || 0);
      }
      const feed = parseImmichFeedText(response.text, { imageEndpoint, libraryUrl, maxPhotos });
      if (!feed) throw new ImmichRequestError("The photo service returned an invalid response.");
      return feed;
    },
    async image(url) {
      if (typeof requestImage !== "function") throw new ImmichRequestError("Photo previews are unavailable.");
      const response = await requestImage(url);
      if (!response?.ok || typeof response.base64 !== "string" || response.base64.length > Math.ceil(IMMICH_IMAGE_MAX_BYTES / 3) * 4 || !IMMICH_IMAGE_TYPES.test(response.mimeType)) throw new ImmichRequestError("Photo preview unavailable.", Number(response?.status) || 0);
      try { return new Blob([Uint8Array.from(atob(response.base64), (char) => char.charCodeAt(0))], { type: response.mimeType }); }
      catch { throw new ImmichRequestError("Photo preview unavailable."); }
    },
  };
}

export function formatImmichUptime(status, now = Date.now) {
  let seconds = status?.uptimeSeconds;
  if (!(Number.isFinite(seconds) && seconds >= 0)) {
    const started = status?.uptimeSource === "host" ? status.hostStartedAt : status?.serviceStartedAt;
    if (started) seconds = Math.max(0, (now() - Date.parse(started)) / 1000);
  }
  if (!Number.isFinite(seconds)) return "Uptime unavailable";
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  const measured = days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  return `${measured} ${status?.uptimeSource === "host" ? "host uptime" : "uptime"}`;
}

