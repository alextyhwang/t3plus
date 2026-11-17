import { CONFIG_LIMITS } from "./config.js";
import { TASKS_API_ENDPOINT, TASKS_BOARD_ENDPOINT, TASKS_PAGE_ENDPOINT, TASKS_SESSION_ENDPOINT } from "./hosts.js";
import { RemoteFeedError, clean, loadFailureMessage } from "./remoteFeed.js";

const MAX_TEXT = 240;
const VALID_BUCKETS = ["today", "upcoming", "waiting"];
const VALID_CATEGORIES = ["schoolwork", "job", "personal"];
const CATEGORY_LABELS = { schoolwork: "Schoolwork", job: "Job work", personal: "Personal" };
const threadLink = (entry) => typeof entry?.thread_id === "string" && /^[A-Za-z0-9:._-]{1,500}$/.test(entry.thread_id) && entry.thread_url === `t3-thread://v1/${entry.thread_id}` ? entry.thread_url : null;

const TASK_ID = "[A-Za-z0-9._~-]{1,200}";
/** Task API routes t3+ calls, relative to TASKS_API_ENDPOINT. The worker sends the task cookie to these only. */
const TASK_ROUTES = Object.freeze({ GET: [/^\/board$/, /^\/session$/], POST: [new RegExp(`^/${TASK_ID}/(?:edit|run)$`)] });

export function isTaskRoute(url, method, api = TASKS_API_ENDPOINT) {
  try {
    const parsed = new URL(url), base = new URL(api);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.origin !== base.origin || !parsed.pathname.startsWith(`${base.pathname}/`)) return false;
    return (TASK_ROUTES[method] ?? []).some(route => route.test(parsed.pathname.slice(base.pathname.length)));
  } catch {
    return false;
  }
}

export class TasksRequestError extends RemoteFeedError {}

function boardLoadMessage(response) {
  if (Number(response?.status) === 401) return "Sign in to see your tasks.";
  return loadFailureMessage(response, {
    service: "task service",
    notFound: "Task board unavailable (HTTP 404). The task portal or its board API route is unavailable.",
    unreachable: "Check the portal and refresh.",
    subject: "your tasks",
    detailMax: 180,
  });
}

function normalizeTask(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id.trim() || typeof raw.title !== "string" || !raw.title.trim()) return null;
  const status = ["completed", "dismissed", "waiting", "open"].includes(raw.status) ? raw.status : "open";
  const priority = Number(raw.priority);
  const category = VALID_CATEGORIES.includes(raw.category) ? raw.category : null;
  const actions = Array.isArray(raw.actions) ? raw.actions.filter((action) => action && typeof action.kind === "string" && typeof action.label === "string").slice(0, 8).map((action) => ({ kind: action.kind.slice(0, 80), label: clean(action.label, 80), state: action.state === "queued" || action.state === "running" ? action.state : "idle" })) : [];
  const activity = Array.isArray(raw.activity) ? raw.activity.slice(0, 5).map((entry) => ({
    threadId: typeof entry?.thread_id === "string" ? entry.thread_id.slice(0, 500) : null,
    threadUrl: threadLink(entry),
    state: typeof entry?.state === "string" ? entry.state.slice(0, 40) : "",
  })) : [];
  // Extract before display truncation: a shortened URL is not a destination.
  const sources = [];
  const metadata = (value, max) => {
    const text = typeof value === "string" ? value.slice(0, 8192) : "";
    const sourceLabel = text.match(/^([^:]{1,40}):\s*https?:\/\//i)?.[1]?.trim();
    const remaining = text.replace(/https?:\/\/[^\s<>"']+/gi, candidate => {
      const href = candidate;
      try {
        const url = new URL(href);
        if (href.length <= 2048 && !url.username && !url.password && sources.length < 4 && !sources.some(source => source.href === url.href)) {
          sources.push({ href: url.href, label: sourceLabel || url.hostname.replace(/^www\./, "") });
        }
      } catch { /* Invalid links stay non-interactive. */ }
      return "";
    });
    return sourceLabel && remaining.trim() === `${sourceLabel}:` ? "" : clean(remaining.replace(/\s*[·:–-]\s*$/, ""), max);
  };
  const deadlineLabel = metadata(raw.deadline_label, 80);
  const waitingReason = metadata(raw.waiting_reason, 120);
  const agentHint = metadata(raw.agent_hint, 120);
  return {
    id: raw.id.trim().slice(0, 160),
    title: clean(raw.title, MAX_TEXT),
    status,
    deadlineLabel,
    overdue: raw.overdue === true,
    priority: Number.isFinite(priority) ? Math.max(0, Math.min(9, priority)) : null,
    waitingReason,
    agentHint,
    sources,
    category,
    categoryLabel: CATEGORY_LABELS[category] ?? "Needs category",
    revision: Number.isInteger(raw.revision) && raw.revision >= 0 ? raw.revision : null,
    actions,
    activity,
    threadUrl: activity.find((entry) => entry.threadUrl)?.threadUrl ?? "",
  };
}

/** Normalize the board shape used by the personal tasks UI. */
export function parseTasksBoardText(text) {
  if (typeof text !== "string" || !text.trim() || text.length > CONFIG_LIMITS.maxChars) return null;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !VALID_BUCKETS.every((key) => Array.isArray(raw[key]))) return null;
  const buckets = Object.fromEntries(VALID_BUCKETS.map((key) => [key, []]));
  const seen = new Set();
  for (const key of VALID_BUCKETS) {
    if (!Array.isArray(raw[key])) continue;
    for (const entry of raw[key]) {
      const task = normalizeTask(entry);
      if (!task || seen.has(task.id) || task.status === "completed" || task.status === "dismissed") continue;
      seen.add(task.id);
      buckets[key].push(task);
    }
  }
  return { ...buckets, tasks: VALID_BUCKETS.flatMap((key) => buckets[key]) };
}

export function createTasksFeed({ requestRemote, endpoint = TASKS_BOARD_ENDPOINT, page = TASKS_PAGE_ENDPOINT, signIn } = {}) {
  let csrf = null;
  const decode = (response, fallback = "Task request failed.") => {
    if (!response?.ok) {
      const status = Number(response?.status) || 0;
      let message = fallback;
      try { const parsed = JSON.parse(response?.text || ""); if (typeof parsed.error === "string") message = parsed.error; } catch { /* preserve generic error */ }
      throw new TasksRequestError(status === 401 ? "Sign in to see your tasks." : message, status);
    }
    try { return JSON.parse(response.text || "{}"); } catch { throw new TasksRequestError("The task service returned invalid JSON.", response.status); }
  };
  const request = async (url, method = "GET", body) => {
    let response;
    try {
      if (method !== "GET" && !csrf) {
        const session = decode(await requestRemote({ url: TASKS_SESSION_ENDPOINT, method: "GET" }), "Could not read task session.");
        csrf = session.authenticated && typeof session.csrf === "string" ? session.csrf : null;
        if (!csrf) throw new TasksRequestError("Sign in to change tasks.", 401);
      }
      response = await requestRemote({ url, method, ...(body === undefined ? {} : { body }), ...(method === "GET" ? {} : { csrf }) });
    } catch (error) {
      if (error instanceof TasksRequestError) throw error;
      throw new TasksRequestError("Connection lost. Refresh to reconcile before retrying.");
    }
    if ([401, 403].includes(response?.status)) csrf = null;
    if (response?.status === 0) throw new TasksRequestError("Connection lost. Refresh to reconcile before retrying.");
    return decode(response);
  };
  const idPath = (id, suffix = "") => `${TASKS_API_ENDPOINT}/${encodeURIComponent(id)}${suffix}`;
  return {
    page,
    signIn: typeof signIn === "function" ? async () => { csrf = null; return signIn(); } : undefined,
    async load() {
      let response;
      try {
        response = await requestRemote({ url: endpoint, method: "GET" });
      } catch (error) {
        throw new TasksRequestError(error instanceof Error ? error.message : "Could not reach the task service.");
      }
      if (!response?.ok) {
        const status = Number(response?.status) || 0;
        if (status === 401) csrf = null;
        throw new TasksRequestError(boardLoadMessage(response), status);
      }
      const board = parseTasksBoardText(response.text);
      if (!board) throw new TasksRequestError("The task board returned an invalid response.");
      return board;
    },
    async completeTask(task) {
      const value = await request(idPath(task.id, "/edit"), "POST", { revision: task.revision, action: "complete" });
      return normalizeTask(value.task ?? value);
    },
    async runTask(task, kind) {
      const value = await request(idPath(task.id, "/run"), "POST", { revision: task.revision, kind });
      return value;
    },
    async updateCategory(task, category) {
      if (!VALID_CATEGORIES.includes(category)) throw new TasksRequestError("Choose a valid task category.", 400);
      const value = await request(idPath(task.id, "/edit"), "POST", { revision: task.revision, changes: { category } });
      return normalizeTask(value.task ?? value);
    },
  };
}

export { CATEGORY_LABELS, VALID_CATEGORIES };

