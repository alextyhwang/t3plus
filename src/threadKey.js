// T3 names a thread "<environmentId>:<threadId>" in its sidebar rows and
// "/<environmentId>/<threadId>" in its routes. Thread ids may contain ":".

export const THREAD_KEY = /^[^:\s]+:\S+$/;

/** First path segments that are T3 app routes, not "/<environmentId>/<threadId>". */
const NON_THREAD_ROUTE_SEGMENTS = Object.freeze(["settings", "draft", "new", "pull-requests", "api", "oauth"]);

export const environmentFromKey = (key) => {
  const i = String(key).indexOf(":");
  return i < 0 ? null : String(key).slice(0, i);
};

export const threadIdFromKey = (key) => {
  const i = String(key).indexOf(":");
  return i < 0 ? String(key) : String(key).slice(i + 1);
};

export function threadKeyFromPath(pathname) {
  const parts = String(pathname ?? "").split("/").filter(Boolean);
  if (parts.length !== 2 || NON_THREAD_ROUTE_SEGMENTS.includes(parts[0])) return null;
  try {
    const [environmentId, threadId] = parts.map(decodeURIComponent);
    return environmentId && threadId ? `${environmentId}:${threadId}` : null;
  } catch {
    return null;
  }
}

export const threadPath = (key) => `/${encodeURIComponent(environmentFromKey(key))}/${encodeURIComponent(threadIdFromKey(key))}`;
