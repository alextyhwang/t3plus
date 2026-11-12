import { SIDEBAR_ROW_PREFIX, T3_SELECTORS, T3PLUS } from "./config.js";

// Reads T3's sidebar through its stable row hooks and applies t3+ visibility.
// t3+ never moves, re-creates or re-parents T3's rows. It only toggles the
// `hidden` attribute (which T3's own keyboard tree already skips) plus
// t3+-owned data attributes, and inserts its own profile bar.

/**
 * The thread sidebar: the sidebar-inner that holds thread rows or project
 * folders. Null on pages where the sidebar shows something else (or nothing),
 * so the profile bar never lands in an unrelated panel.
 */
export function findSidebarInner(doc) {
  for (const inner of doc.querySelectorAll(T3_SELECTORS.sidebarInner)) {
    if (inner.querySelector(`${T3_SELECTORS.threadItem}, ${T3_SELECTORS.projectFolderItem}`)) return inner;
  }
  return null;
}

/**
 * Where the profile bar goes: directly above the scroll area root that holds
 * the sidebar content, i.e. right under T3's fixed header (search, new thread).
 * T3 may render the header and the list straight in sidebar-inner or inside a
 * wrapper, so climb from the content only while it is the first child (the
 * scroll area's own wrappers) and stop at the first node with a row before it.
 * @returns {{ parent: Element, before: Element } | null}
 */
export function findProfileBarSlot(inner) {
  const content = inner?.querySelector(T3_SELECTORS.sidebarContent);
  if (!content) return null;
  const isBar = (el) => el?.id === T3PLUS.profileBarId;
  const previous = (el) => {
    let prev = el.previousElementSibling;
    while (isBar(prev)) prev = prev.previousElementSibling;
    return prev;
  };
  let node = content;
  while (node.parentElement && node.parentElement !== inner && !previous(node)) node = node.parentElement;
  return inner.contains(node.parentElement) ? { parent: node.parentElement, before: node } : null;
}

/**
 * T3's logo row: the outermost wrapper of the "T3 Code home" link that holds
 * no other part of the sidebar (search row, list). Found by containment, not
 * position, so a wrapper or the profile strip around it cannot widen it to the
 * whole sidebar or make it miss.
 */
export function findLogoRow(inner) {
  const link = inner?.querySelector(T3_SELECTORS.homeLink);
  if (!link) return null;
  const other = `${T3_SELECTORS.sidebarGroup}, ${T3_SELECTORS.sidebarContent}, #${T3PLUS.profileBarId}`;
  let node = link;
  while (node.parentElement && node.parentElement !== inner && !node.parentElement.querySelector(other)) node = node.parentElement;
  return node.parentElement ? node : null;
}

/**
 * Snapshot of the sidebar's rows.
 * threads: [{ key, li, row, parent, folderKey, title, titleEl, ariaLabel, current }]
 * folders: Map<logicalProjectKey, { li, row }>
 * shelves: Map<"shelf:x", li>
 */
export function scanSidebar(inner) {
  const threads = [];
  const folders = new Map();
  const shelves = new Map();
  if (!inner) return { threads, folders, shelves, folderMode: false };

  for (const row of inner.querySelectorAll(T3_SELECTORS.sidebarRow)) {
    const id = row.getAttribute("data-sidebar-row") ?? "";
    const li = row.closest("li");
    // T3's list motion fades removed rows out as inert, aria-hidden clones; skip them.
    if (li && li.hasAttribute("inert") && li.getAttribute("aria-hidden") === "true") continue;
    if (id.startsWith(SIDEBAR_ROW_PREFIX.folder)) {
      if (li) folders.set(id.slice(SIDEBAR_ROW_PREFIX.folder.length), { li, row });
      continue;
    }
    if (id.startsWith(SIDEBAR_ROW_PREFIX.shelf)) {
      if (li) shelves.set(id, li);
      continue;
    }
    const item = row.closest(T3_SELECTORS.threadItem);
    if (!item || item.getAttribute("data-thread-item") !== id) continue;
    const parent = row.getAttribute("data-sidebar-parent");
    const titleInfo = readRowTitle(row);
    const ariaParts = (row.getAttribute("aria-label") ?? "").split(", ");
    const projectKey = row.getAttribute("data-project-key") ?? row.getAttribute("data-project") ?? (ariaParts.length > 1 ? ariaParts.at(-1) : null);
    threads.push({
      key: id,
      li: item,
      row,
      parent,
      folderKey: parent?.startsWith(SIDEBAR_ROW_PREFIX.folder) ? parent.slice(SIDEBAR_ROW_PREFIX.folder.length) : null,
      projectKey,
      title: titleInfo.title,
      titleEl: titleInfo.titleEl,
      ariaLabel: row.getAttribute("aria-label") ?? "",
      current: row.getAttribute("aria-current") === "page",
    });
  }
  return { threads, folders, shelves, folderMode: folders.size > 0 };
}

/**
 * T3 renders the title twice: an sr-only copy (exact text) and an aria-hidden
 * visible span with a dir attribute. Returns both (visible one may be null
 * while the row is being renamed).
 */
export function readRowTitle(row) {
  const srOnly = row.querySelector(".sr-only:not([role])");
  const title = srOnly?.textContent ?? "";
  let titleEl = null;
  if (title) {
    for (const span of row.querySelectorAll('span[aria-hidden="true"]')) {
      if (span.childElementCount === 0 && span.textContent === title) {
        titleEl = span;
        break;
      }
    }
  }
  return { title, titleEl };
}

/** True when `thread` belongs to `profile` by project folder or explicit thread key. */
export function isThreadInProfile(thread, profile) {
  if (!profile) return true;
  if (profile.threads.includes(thread.key)) return true;
  const project = thread.folderKey ?? thread.projectKey;
  if (profile.includeAll) {
    return !projectMatchesAny(project, profile.excludeProjects);
  }
  return projectMatchesAny(project, profile.projects);
}

function projectAliases(value) {
  if (typeof value !== "string") return [];
  const normalized = value.trim().replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
  if (!normalized) return [];
  return [normalized, normalized.split("/").at(-1)];
}

function projectMatchesAny(value, candidates) {
  const aliases = projectAliases(value);
  return candidates.some((candidate) => projectAliases(candidate).some((alias) => aliases.includes(alias)));
}

/** True when a project (folder key, label or workspace root) belongs to `profile`; null profile = All. */
export function profileIncludesProject(profile, project) {
  if (!profile) return true;
  return profile.includeAll ? !projectMatchesAny(project, profile.excludeProjects) : projectMatchesAny(project, profile.projects);
}

function profileIncludesFolder(profile, key) {
  if (!profile) return true;
  return profile.includeAll ? !projectMatchesAny(key, profile.excludeProjects) : projectMatchesAny(key, profile.projects);
}

/**
 * Decides visibility for a profile. Pure: takes a scan, returns sets.
 * - "All" (profile null) hides nothing.
 * - Project-grouped sidebar: folders listed in profile.projects show with their threads.
 * - Flat sidebar / rows outside folders: thread-level fallback via profile.threads.
 * - The open thread always stays visible (deep links), flagged as outside.
 * - Bot rows stay visible unless the profile sets showBots: false.
 * - A shelf header whose rows are all hidden is hidden too.
 * @returns {{ hidden: Set<Element>, outside: Element | null, visibleThreads: number }}
 */
export function computeProfileVisibility(scan, profile, { routeThreadKey = null, botKeys = new Set() } = {}) {
  const hidden = new Set();
  let outside = null;
  if (!profile) return { hidden, outside, visibleThreads: scan.threads.length };

  const visibleFolders = new Set();
  const childCounts = new Map();
  let visibleThreads = 0;
  for (const thread of scan.threads) {
    const isRoute = thread.key === routeThreadKey || thread.current;
    const member = isThreadInProfile(thread, profile) || (profile.showBots && botKeys.has(thread.key));
    const visible = member || isRoute;
    if (isRoute && !member) outside = thread.row;
    if (thread.parent) {
      const counts = childCounts.get(thread.parent) ?? { total: 0, visible: 0 };
      counts.total += 1;
      if (visible) counts.visible += 1;
      childCounts.set(thread.parent, counts);
    }
    if (visible) {
      visibleThreads += 1;
      if (thread.folderKey !== null) visibleFolders.add(thread.folderKey);
    } else {
      hidden.add(thread.li);
    }
  }
  for (const [key, folder] of scan.folders) {
    if (!profileIncludesFolder(profile, key) && !visibleFolders.has(key)) hidden.add(folder.li);
  }
  for (const [id, li] of scan.shelves) {
    const counts = childCounts.get(id);
    if (counts && counts.total > 0 && counts.visible === 0) hidden.add(li);
  }
  return { hidden, outside, visibleThreads };
}

/** Applies a visibility result. Touches only elements whose state changes. */
export function applyProfileVisibility(inner, { hidden, outside }) {
  if (!inner) return;
  for (const el of inner.querySelectorAll(`[${T3PLUS.filteredAttr}]`)) {
    if (hidden.has(el)) continue;
    el.removeAttribute(T3PLUS.filteredAttr);
    el.removeAttribute("hidden");
  }
  for (const el of hidden) {
    if (el.hasAttribute(T3PLUS.filteredAttr)) continue;
    el.setAttribute(T3PLUS.filteredAttr, "");
    el.setAttribute("hidden", "");
  }
  for (const el of inner.querySelectorAll(`[${T3PLUS.outsideAttr}]`)) {
    if (el !== outside) el.removeAttribute(T3PLUS.outsideAttr);
  }
  if (outside && !outside.hasAttribute(T3PLUS.outsideAttr)) outside.setAttribute(T3PLUS.outsideAttr, "");
}

/** Removes every t3+ visibility change (profile "All", feature off, or stop). */
export function clearProfileVisibility(root) {
  applyProfileVisibility(root, { hidden: new Set(), outside: null });
}
