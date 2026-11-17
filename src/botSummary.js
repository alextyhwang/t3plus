import { requestKind } from "./bots.js";
import { environmentFromKey, threadIdFromKey } from "./threadKey.js";

/** One readable line, with attention first and the open count as the quiet fallback. */
export function workloadSummary({ approvals = 0, questions = 0, attention = 0, failed = 0, working = 0, open = 0 } = {}) {
  const needsYou = [
    approvals && `${approvals} approval${approvals === 1 ? "" : "s"} waiting`,
    questions && `${questions} question${questions === 1 ? "" : "s"} to answer`,
    attention && `${attention} need${attention === 1 ? "s" : ""} you`,
    failed && `${failed} failed thread${failed === 1 ? "" : "s"}`,
  ].filter(Boolean);
  if (needsYou.length) return { text: needsYou.join(" · "), status: approvals || questions || attention ? "attention" : "failed" };
  if (working) return { text: `${working} thread${working === 1 ? "" : "s"} running · ${open} open`, status: "working" };
  if (open) return { text: `${open} open thread${open === 1 ? "" : "s"}`, status: "open" };
  return { text: "All caught up", status: "idle" };
}

/** What a bot says about its own work while it runs or fails. */
const ACTIVE_TEXT = {
  failed: "Last run failed",
  working: "Working on your request",
  waiting: "Waiting for work to finish",
};

/**
 * The Assistant group's line: its threads' workload (`counts`, as for
 * workloadSummary) plus the Assistant's own row status, which counts as one
 * more request and, when nothing else is going on, says what the Assistant is doing.
 */
export function groupWorkloadSummary(counts, status, thread) {
  const totals = { ...counts };
  if (status === "attention") {
    const kind = requestKind(thread);
    totals[kind === "approval" ? "approvals" : kind === "question" ? "questions" : "attention"] += 1;
  } else if (status === "failed") totals.failed += 1;
  const summary = workloadSummary(totals);
  if (summary.status === "idle" && (status === "working" || status === "waiting")) return { text: ACTIVE_TEXT[status], status: "working" };
  return summary;
}

/** Calendar time in the viewer's locale, including the day when it is not today. */
function nextUpdateText(value, now) {
  const next = new Date(value);
  if (!Number.isFinite(next.getTime())) return "";
  if (next <= now) return "Update due now";
  const time = next.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = next.toDateString() === now.toDateString() ? "today"
    : next.toDateString() === tomorrow.toDateString() ? "tomorrow"
      : next.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(next.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
  return `Next update ${day} at ${time}`;
}

/** A bot's own status wins over its next scheduled update. Never use message text. */
export function botSummaryText(feed, key, bot = null, now = new Date()) {
  const sameEnvironment = !feed?.environmentId || environmentFromKey(key) === feed.environmentId;
  const entry = sameEnvironment ? feed?.entries.get(threadIdFromKey(key)) : null;
  const status = bot?.status ?? entry?.status;
  const kind = requestKind(bot?.thread);
  if (status === "attention") return kind === "approval" ? "1 approval waiting" : kind === "question" ? "1 question to answer" : "Needs your attention";
  if (ACTIVE_TEXT[status]) return ACTIVE_TEXT[status];
  if (entry?.nextRunAt) return nextUpdateText(entry.nextRunAt, now);
  return status ? "All caught up" : "Status unavailable";
}
