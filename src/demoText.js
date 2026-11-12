// Screenshot mode text: believable stand-ins for thread titles, project names,
// branches, machines, profiles, bots and message text. Pure and deterministic:
// the same real text always gets the same stand-in, so a screenshot is stable
// across re-renders and reloads. Nothing here is random junk: titles are tasks
// people give coding agents, projects are names of ordinary products, and
// message text is cut from paragraphs an agent would write.

const PROJECTS = [
  "atlas-api", "lumen-web", "harbor-ios", "ledger-sync", "orbit-cli", "pulse-analytics", "nimbus-docs",
  "beacon-auth", "cobalt-ui", "fern-billing", "quill-editor", "relay-notify", "summit-dashboard",
  "tide-search", "vela-payments", "juniper-cms", "compass-onboarding", "mosaic-media", "sprout-market",
  "echo-support", "atlas-infra", "lumen-marketing", "harbor-android", "orbit-sdk", "kite-scheduler",
  "maple-crm", "prism-design", "ripple-chat", "slate-notes", "willow-forms",
];

const TITLES = [
  "Add dark mode toggle", "Fix login redirect loop", "Migrate to Postgres 17", "Redesign pricing page",
  "Investigate flaky CI", "Write onboarding emails", "Speed up search indexing", "Add CSV export to reports",
  "Refactor auth middleware", "Upgrade to React 20", "Cache API responses at the edge", "Rate limit webhook retries",
  "Polish empty states", "Fix timezone bug in scheduler", "Add Stripe tax support", "Document the public API",
  "Cut bundle size by 30%", "Add keyboard shortcuts", "Set up preview deploys", "Fix memory leak in worker",
  "Add audit log for admins", "Improve upload error messages", "Localize checkout flow", "Add SSO with Okta",
  "Tune slow dashboard queries", "Retry failed payment syncs", "Ship push notifications", "Clean up old feature flags",
  "Add image uploads to editor", "Draft release notes for 2.4", "Make tables sortable", "Add usage-based billing",
  "Fix flicker on route change", "Write e2e tests for signup", "Add team invites", "Paginate activity feed",
  "Move cron jobs to queues", "Add offline mode to notes", "Fix broken links in docs", "Add two-factor login",
  "Improve Lighthouse score", "Add charts to weekly report", "Debug failing deploy on staging", "Add webhooks for orders",
  "Rename workspace to team", "Add search to settings", "Speed up cold starts", "Archive inactive projects",
  "Add drag and drop to board", "Review dependency upgrades",
];

const BRANCHES = [
  "feat/dark-mode", "fix/login-redirect", "chore/postgres-17", "feat/pricing-redesign", "fix/flaky-ci",
  "perf/search-index", "feat/csv-export", "refactor/auth-middleware", "chore/react-20", "feat/edge-cache",
  "fix/webhook-retries", "feat/empty-states", "fix/scheduler-tz", "feat/stripe-tax", "docs/public-api",
  "perf/bundle-size", "feat/shortcuts", "ci/preview-deploys", "fix/worker-leak", "feat/audit-log",
];

const MACHINES = ["studio-mac", "build-box", "dev-laptop", "workstation", "cloud-dev", "mini-server"];

const PROFILES = ["Studio", "Side projects", "Clients", "Open source", "Research", "Team"];

const BOTS = ["Release Captain", "Triage Bot", "Nightly Builder", "Docs Gardener", "Deploy Watch", "Inbox Zero", "Dependency Bot", "QA Runner"];

const BOT_MESSAGES = [
  "Shipped 3 pull requests overnight; all checks are green.",
  "Triaged 12 new issues and labeled 4 as good first issues.",
  "Nightly build passed in 6m 41s. No new warnings.",
  "Updated 9 docs pages that drifted from the API.",
  "Staging deploy is healthy. Error rate is back under 0.1%.",
  "Archived 14 stale threads and summarized the open ones.",
  "Bumped 5 dependencies; one needs a manual review.",
  "Ran the full e2e suite: 248 passed, 0 failed.",
];

const AUTOMATIONS = ["Nightly dependency check", "Weekly changelog draft", "Morning triage", "Daily backup check", "Release notes digest"];

const PROSE =
  "I traced the failing request to the retry middleware. It replays the original body after the stream has already been read, so the second attempt sends an empty payload. " +
  "I'll buffer the body once, reuse it for every retry, and add a test that covers a timeout followed by a success. " +
  "The change stays inside the HTTP client, so nothing else needs to move. All 214 tests pass locally and the type check is clean. " +
  "Next I updated the settings page so the new toggle follows the system theme by default and remembers an explicit choice. " +
  "The dashboard query was scanning the whole events table; an index on the account and date columns brings it from 1.8 seconds to 40 milliseconds. " +
  "I also split the export into pages of 500 rows, which keeps memory flat even for the largest accounts. " +
  "The flaky test was waiting on a fixed delay instead of the network idle event, so it failed whenever the runner was busy. " +
  "I replaced the delay with an explicit wait and ran it 50 times in a row without a failure. " +
  "For the pricing page I kept the existing components and only changed the layout, spacing and copy, so the design system stays the single source of truth. " +
  "The migration is reversible: it adds the new column, backfills it in batches, and only then switches reads over. " +
  "I left a short note in the pull request that explains the rollout order and what to watch in the logs. " +
  "Summary: three files changed, one new test, no breaking changes, and the preview deploy is ready to review. ";

/** Whole short sentences for short messages, so they never stop mid-phrase. */
const SHORT = [
  "Done.", "Tests pass.", "Looks good to me.", "Found the cause.", "The build is green.", "Opening the pull request now.",
  "Checking the logs first.", "I'll fix that next.", "Running the test suite.", "That change is merged.",
  "Reading the failing test.", "Updated the docs too.", "Pushed the fix to the branch.", "The preview deploy is ready.",
];

const USER_PROSE =
  "Can you add a dark mode toggle to the settings page and make it follow the system theme by default? " +
  "The login redirect sometimes loops after a password reset, can you find out why and fix it? " +
  "Please make the CSV export work for large accounts without timing out. " +
  "Our CI has been flaky this week, can you look at the last few failures and make the tests reliable? " +
  "Let's tidy up the pricing page: clearer plan names, a comparison table, and better mobile spacing. " +
  "Write a short changelog entry for this release and open a pull request when you're done. ";

const CODE_LINES = [
  "const client = createClient({ retries: 3, timeout: 10_000 });",
  "export async function syncInvoices(accountId) {",
  "  const rows = await db.select().from(invoices).where(eq(invoices.accountId, accountId));",
  "  return rows.map(toInvoiceSummary);",
  "}",
  "import { useTheme } from \"@/hooks/use-theme\";",
  "const body = await request.clone().arrayBuffer();",
  "if (!response.ok) throw new HttpError(response.status);",
  "for (const page of paginate(rows, 500)) await writer.write(page);",
  "await expect(page.getByRole(\"button\", { name: \"Save\" })).toBeVisible();",
  "CREATE INDEX events_account_date_idx ON events (account_id, created_at);",
  "npm test -- --run src/http",
  "git checkout -b fix/retry-body",
  "✓ 214 tests passed (3.2s)",
];

const COMMANDS = [
  "npm test", "pnpm lint", "rg -n \"retry\" src/http", "git status", "npx tsc --noEmit", "pytest -q tests/billing",
  "git diff --stat", "ls src/components", "cat package.json", "npm run build", "git log --oneline -5", "pnpm vitest run",
];

const IDENTIFIERS = [
  "retryPolicy", "createClient", "src/http/client.ts", "useTheme", "InvoiceTable", "billing.yml", "README.md",
  "syncInvoices", "exportCsv", "src/pages/pricing.tsx", "AUTH_SECRET", "events_account_date_idx", "theme.css",
  "useSettings", "WebhookQueue", "tests/e2e/signup.spec.ts",
];

const CODE_KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "import", "from", "export", "default", "async", "await", "if", "else",
  "for", "while", "of", "in", "new", "class", "extends", "true", "false", "null", "undefined", "def", "self", "None",
  "True", "False", "try", "catch", "throw", "type", "interface", "public", "private", "static", "void", "fn", "pub",
  "use", "mut", "impl", "struct", "match", "with", "as", "and", "or", "not", "is", "pass", "elif", "lambda", "yield",
]);

/** FNV-1a, 32-bit. */
export function hashText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Text that never needs a stand-in: empty, numbers, times, counts, punctuation. */
export function isNeutral(text) {
  return /^[\s\d:+\-−–—.,%()×x/·•|#@<>=*'"`~!?[\]{}]*(AM|PM|am|pm|[smhdkKMB]|ms)?[\s\d:.,%()]*$/.test(text);
}

const words = (text) => text.split(/(\s+)/);

/** A run of `source` (from a sentence start picked by `seed`) about `length` characters long, cut at a word. */
function excerpt(source, seed, length) {
  const starts = [0];
  for (let i = 0; i < source.length - 1; i += 1) if (source[i] === " " && /[.?!]/.test(source[i - 1] ?? "")) starts.push(i + 1);
  let i = starts[seed % starts.length];
  let out = "";
  const target = Math.max(1, length);
  while (out.length < target) {
    const next = source.indexOf(" ", i);
    const end = next === -1 ? source.length : next + 1;
    out += source.slice(i, end);
    i = end >= source.length ? 0 : end;
  }
  out = out.trimEnd();
  // Prefer ending on a full sentence when one ends near the target length:
  // a little past it (read on to the next full stop), or a little before it.
  if (target >= 40) {
    const rest = source.slice(i) + source;
    const stop = rest.search(/[.?!](\s|$)/);
    const back = Math.max(out.lastIndexOf(". "), out.lastIndexOf("? "), out.lastIndexOf("! "));
    if (/[.?!]$/.test(out)) return out;
    if (back >= target * 0.6) return out.slice(0, back + 1);
    if (stop !== -1 && stop + 1 <= target * 0.8) return `${out} ${rest.slice(0, stop + 1)}`;
    if (back > 0) return out.slice(0, back + 1);
  }
  if (out.length > target + 12) {
    const cut = out.lastIndexOf(" ", target + 4);
    if (cut > target / 2) out = out.slice(0, cut);
  }
  return out;
}

/** Keeps the original's leading/trailing whitespace around a stand-in. */
function framed(original, inner) {
  const lead = original.match(/^\s*/)[0];
  const trail = original.match(/\s*$/)[0];
  return lead + inner + trail;
}

/** Prose of about the original's length (agent or user voice). */
export function fakeProse(original, voice = "agent") {
  const core = original.trim();
  if (!core || isNeutral(core)) return original;
  const source = voice === "user" ? USER_PROSE : PROSE;
  const seed = hashText(core);
  // A short complete message gets whole short sentences of about its length.
  if (voice !== "user" && core.length < 60 && /[.?!]$/.test(core)) {
    let short = "";
    for (let k = 0; short.length < core.length * 0.8; k += 1) short += `${short ? " " : ""}${SHORT[(seed + k * 7) % SHORT.length]}`;
    return framed(original, short);
  }
  let out = excerpt(source, seed, core.length);
  // Match the original's start and end: a fragment that started lowercase or
  // ran on without a full stop reads like one.
  if (/^[a-z]/.test(core)) out = out[0].toLowerCase() + out.slice(1);
  if (!/[.?!:]$/.test(core)) out = out.replace(/[.?!]+$/, "");
  else if (!/[.?!]$/.test(out)) out += ".";
  return framed(original, out);
}

/** An identifier or path standing in for inline code. */
export function fakeIdentifier(original) {
  const core = original.trim();
  if (!core || isNeutral(core) || CODE_KEYWORDS.has(core)) return original;
  if (/\s/.test(core)) return framed(original, fakeCommand(core));
  return framed(original, IDENTIFIERS[hashText(core) % IDENTIFIERS.length]);
}

export function fakeCommand(original) {
  const core = original.trim();
  if (!core || isNeutral(core)) return original;
  return framed(original, COMMANDS[hashText(core) % COMMANDS.length]);
}

/**
 * Code: a multi-line text node is mapped line by line (indent kept); a single
 * highlighted token keeps keywords and punctuation and swaps names and strings.
 */
export function fakeCode(original) {
  if (original.includes("\n")) {
    return original
      .split("\n")
      .map((line) => {
        const body = line.trim();
        if (!body || isNeutral(body)) return line;
        return line.match(/^\s*/)[0] + CODE_LINES[hashText(body) % CODE_LINES.length];
      })
      .join("\n");
  }
  const core = original.trim();
  if (!core || isNeutral(core) || CODE_KEYWORDS.has(core) || /^[^A-Za-z]*$/.test(core)) return original;
  const quote = core.match(/^(["'`])(.*)\1$/);
  if (quote) return framed(original, `${quote[1]}${IDENTIFIERS[hashText(core) % IDENTIFIERS.length]}${quote[1]}`);
  if (/\s/.test(core)) return framed(original, CODE_LINES[hashText(core) % CODE_LINES.length]);
  const name = IDENTIFIERS[hashText(core) % IDENTIFIERS.length].replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return framed(original, name);
}

/** Initials for a project badge, like T3's letter avatars: "atlas-api" -> "AA". */
export function projectInitials(name) {
  const parts = String(name).split(/[\s\-_.\/]+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0][0]).toUpperCase();
}

const POOLS = { project: PROJECTS, title: TITLES, branch: BRANCHES, machine: MACHINES, profile: PROFILES, bot: BOTS, botMessage: BOT_MESSAGES, automation: AUTOMATIONS };

/** Branch names that are generic and safe as they are. */
const PLAIN_BRANCHES = new Set(["main", "master", "dev", "develop", "trunk", "staging", "production"]);
export const isPlainBranch = (name) => PLAIN_BRANCHES.has(String(name ?? "").trim());

/**
 * Stable stand-ins per kind: the first real value seen gets a pool entry by
 * hash, moving on past entries already taken, so two real names never share
 * a stand-in (until a pool runs out, then it reuses).
 */
export function createNameBook() {
  const maps = new Map();
  return {
    fake(kind, real) {
      const key = String(real ?? "").trim();
      if (!key) return real;
      if (kind === "branch" && PLAIN_BRANCHES.has(key)) return real;
      const pool = POOLS[kind];
      if (!pool) return real;
      let map = maps.get(kind);
      if (!map) maps.set(kind, (map = { byReal: new Map(), used: new Set() }));
      const known = map.byReal.get(key);
      if (known) return known;
      let index = hashText(`${kind}:${key}`) % pool.length;
      for (let step = 0; step < pool.length && map.used.has(pool[index]); step += 1) index = (index + 1) % pool.length;
      const value = pool[index];
      map.used.add(value);
      map.byReal.set(key, value);
      return value;
    },
    /** The kind a real label was registered under, if any. */
    kindOf(real) {
      const key = String(real ?? "").trim();
      for (const [kind, map] of maps) if (map.byReal.has(key)) return kind;
      return null;
    },
    /** Whether `text` is a stand-in this book handed out. */
    isFake(text) {
      const key = String(text ?? "").trim();
      for (const map of maps.values()) if (map.used.has(key)) return true;
      return false;
    },
  };
}
