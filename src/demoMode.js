import { HOVER_CARD_TITLE } from "./bots.js";
import { T3PLUS, T3_SELECTORS } from "./config.js";
import { createNameBook, fakeCode, fakeCommand, fakeIdentifier, fakeProse, isNeutral, isPlainBranch, projectInitials } from "./demoText.js";

// Screenshot mode: a read-only cover over T3's visible text. Thread titles,
// project names, branches, machine names and message text are swapped for
// believable stand-ins (demoText.js) by rewriting the visible text nodes only.
// T3's data, React state, aria labels and the composer are never touched; each
// swapped node remembers its real text, and turning the mode off puts it back.
// When React updates a node (new message text, a renamed thread), the next
// pass covers the new text. Project letter badges are redrawn with the stand-in
// project's initials through CSS `content` on the <img>, never its src.

const SHOW_TEXT = 4;
const SCHEDULE = /^(daily|weekly|hourly|monthly|every|weekdays|weekends|runs|next|last|paused|at )/i;

export function createDemoMode(doc) {
  const book = createNameBook();
  const memo = new WeakMap(); // text node -> { real, fake }
  const touched = new Set();
  const badges = new Set();
  const badgeCache = new Map(); // img src -> { color } | null
  let active = false;

  function swap(node, make) {
    const value = node.nodeValue ?? "";
    const known = memo.get(node);
    if (known && value === known.fake) return;
    const fake = make(value);
    if (typeof fake !== "string" || fake === value) {
      if (known) memo.delete(node);
      return;
    }
    memo.set(node, { real: value, fake });
    touched.add(node);
    node.nodeValue = fake;
  }

  /** Visible text nodes under `root`, skipping t3+'s own nodes and editable text. */
  function eachText(root, fn) {
    if (!root) return;
    const walker = doc.createTreeWalker(root, SHOW_TEXT);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    for (const n of nodes) {
      const parent = n.parentElement;
      if (!parent || parent.closest(`[${T3PLUS.ownedAttr}], [contenteditable], .sr-only, script, style, textarea`)) continue;
      if (!n.nodeValue?.trim()) continue;
      fn(n, parent);
    }
  }

  const named = (kind) => (value) => {
    const core = value.trim();
    if (!core || isNeutral(core)) return value;
    return value.replace(core, book.fake(kind, core));
  };
  /** A label already seen elsewhere (a project in the sidebar, say) gets the same stand-in. */
  const knownOr = (fallbackKind) => (value) => {
    const core = value.trim();
    const kind = book.kindOf(core) ?? (book.isFake(core) ? null : fallbackKind);
    return kind ? named(kind)(value) : value;
  };

  // ---- Project letter badges ----
  function badgeInfo(src) {
    if (badgeCache.has(src)) return badgeCache.get(src);
    let info = null;
    try {
      if (src.startsWith("data:image/svg+xml;base64,")) {
        const svg = atob(src.slice("data:image/svg+xml;base64,".length));
        if (/<text[\s>]/.test(svg)) info = { color: svg.match(/<rect[^>]*fill="([^"]+)"/)?.[1] ?? "#525252" };
      }
    } catch {
      info = null;
    }
    badgeCache.set(src, info);
    return info;
  }
  function coverBadge(img, project) {
    const info = img?.src ? badgeInfo(img.src) : null;
    if (!info) return;
    const letters = projectInitials(project);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${info.color}"/><text x="32" y="32" dy="0.35em" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, sans-serif" font-size="26" font-weight="600" fill="#ffffff">${letters}</text></svg>`;
    const value = `url("data:image/svg+xml;base64,${btoa(svg)}")`;
    if (img.style.getPropertyValue("--t3plus-demo-badge") !== value) img.style.setProperty("--t3plus-demo-badge", value);
    if (!img.hasAttribute("data-t3plus-demo-badge")) img.setAttribute("data-t3plus-demo-badge", "");
    badges.add(img);
  }

  /** T3's inline letter badges (an <svg> with a <text>): the stand-in's initials. */
  function coverSvgBadge(container, project) {
    if (!container || !project) return;
    for (const text of container.querySelectorAll("svg text")) {
      eachText(text, (n) => swap(n, () => projectInitials(project)));
    }
  }

  // ---- Regions ----
  function sidebar(inner) {
    if (!inner) return;
    for (const row of inner.querySelectorAll("[data-sidebar-row]")) {
      const key = row.getAttribute("data-sidebar-row") ?? "";
      if (key.startsWith("folder:")) {
        let project = "";
        eachText(row, (n) => {
          swap(n, named("project"));
          project ||= n.nodeValue.trim();
        });
        coverBadge(row.querySelector("img"), project);
        continue;
      }
      if (row.getAttribute("role") !== "button") continue;
      // Every row shape (card, slim, folder) shows its title in an aria-hidden [dir] span.
      if (!row.hasAttribute(T3PLUS.botAttr)) eachText(row.querySelector('span[aria-hidden="true"][dir]'), (n) => swap(n, named("title")));
      const body = row.querySelector(":scope > .relative.z-10");
      if (!body) continue;
      const top = body.querySelector(":scope > .h-5");
      const projectEl = top?.querySelector(":scope > .truncate");
      eachText(projectEl, (n) => swap(n, named("project")));
      const project = projectEl?.textContent ?? "";
      coverBadge(top?.querySelector(":scope > img, :scope > span > img"), project);
      coverSvgBadge(top?.firstElementChild, project);
      const meta = body.querySelector(":scope > .mt-0\\.5");
      if (meta) {
        // A leading icon means an environment (machine); otherwise a branch.
        const kind = meta.firstElementChild?.tagName?.toLowerCase() === "svg" ? "machine" : "branch";
        for (const child of meta.children) {
          if (child.getAttribute("aria-hidden") === "true" || child.tagName.toLowerCase() === "svg") continue;
          eachText(child, (n) => swap(n, named(kind)));
        }
      }
    }
  }

  function header() {
    const nav = doc.querySelector('nav[aria-label="Thread breadcrumb"]');
    if (!nav) return;
    const items = [...nav.querySelectorAll("li")].filter((li) => li.getAttribute("aria-hidden") !== "true");
    items.forEach((li, index) => {
      if (li.querySelector("[data-t3plus-bot-breadcrumb]")) return;
      const label = li.querySelector('[data-slot="workspace-breadcrumb-text"]');
      eachText(label ?? li, (n) => swap(n, (v) => (v.trim() === "New thread" ? v : named(index === 0 ? "project" : "title")(v))));
      if (index === 0) {
        coverSvgBadge(li, label?.textContent ?? "");
        coverBadge(li.querySelector("img"), label?.textContent ?? "");
      }
    });
  }

  function hero() {
    for (const el of doc.querySelectorAll(".group\\/draft-hero [data-draft-project-trigger], .group\\/draft-hero .font-medium")) {
      eachText(el, (n) => swap(n, named("project")));
    }
  }

  function popups() {
    for (const popup of doc.querySelectorAll('[data-slot="tooltip-popup"]')) {
      const title = popup.querySelector(HOVER_CARD_TITLE);
      if (!title) continue; // only T3's thread hover card
      if (!title.hasAttribute("data-t3plus-bot-hover")) eachText(title, (n) => swap(n, named("title")));
      eachText(popup, (n) => {
        if (title.contains(n)) return;
        // Known labels keep their stand-in; a lone word with no digits is the machine.
        swap(n, (v) => {
          const core = v.trim();
          if (book.kindOf(core)) return knownOr(null)(v);
          if (isPlainBranch(core)) return v;
          return /^[^\s\d]+$/.test(core) ? named("machine")(v) : v;
        });
      });
    }
  }

  /** T3's run-context control ("Run context: studio-mac, Local checkout"): its label is the machine. */
  function runContexts(root) {
    for (const control of root.querySelectorAll('[data-composer-context-control][aria-label^="Run context"] [data-composer-label], [data-composer-context-control]:not([aria-label]) [data-composer-label]')) {
      eachText(control, (n) => swap(n, named("machine")));
    }
  }

  function details() {
    const card = doc.querySelector(T3_SELECTORS.threadDetailsCard);
    if (!card) return;
    for (const section of card.querySelectorAll("section")) {
      const label = section.getAttribute("aria-label") ?? "";
      if (label === "Workspace") {
        runContexts(section);
      } else if (label === "Automations") {
        eachText(section, (n, parent) => {
          const core = n.nodeValue.trim();
          if (core === "Automations" || SCHEDULE.test(core) || /\d:\d/.test(core) || parent.closest("h2, h3")) return;
          swap(n, named("automation"));
        });
      } else {
        eachText(section, (n) => swap(n, knownOr(null)));
      }
    }
  }

  function composer() {
    for (const area of doc.querySelectorAll('[data-chat-composer-overlay="true"]')) {
      runContexts(area);
      eachText(area, (n) => swap(n, knownOr(null)));
    }
  }

  function timeline() {
    const list = doc.querySelector(T3_SELECTORS.messageList);
    if (!list) return;
    for (const row of list.querySelectorAll("[data-timeline-row-id]")) {
      const kind = row.getAttribute("data-timeline-row-kind") ?? "";
      if (kind === "turn-fold" || kind === "work-toggle") continue;
      const role = row.getAttribute("data-message-role");
      if (role === "user") {
        eachText(row, (n, parent) => swap(n, (v) => (parent.closest("pre") ? fakeCode(v) : parent.closest("code") ? fakeIdentifier(v) : fakeProse(v, "user"))));
        continue;
      }
      eachText(row, (n, parent) => {
        swap(n, (v) => {
          if (parent.closest("pre")) return fakeCode(v);
          if (parent.closest("code")) return fakeIdentifier(v);
          if (parent.closest(".chat-markdown")) return fakeProse(v);
          const core = v.trim();
          if (isNeutral(core)) return v;
          if (parent.closest('[data-v2-item-type="command_execution"]')) return fakeCommand(v);
          // File and folder names (file lists, work rows).
          if (!/\s/.test(core)) return /[./_-]/.test(core) || parent.closest(".font-mono") ? fakeIdentifier(v) : v;
          // Longer text in a work row is the agent's own (a tool summary, a search);
          // short phrases elsewhere are T3's labels ("10 changed files", "Open diff").
          if (kind === "work" && core.split(/\s+/).length > 3) return fakeProse(v);
          return v;
        });
      });
    }
  }

  return {
    book,
    get active() {
      return active;
    },
    /** Covers every region. Cheap when nothing changed: covered nodes are skipped. */
    apply({ sidebarInner = null } = {}) {
      active = true;
      sidebar(sidebarInner);
      header();
      hero();
      popups();
      details();
      composer();
      timeline();
    },
    /** Just the hover cards (called before paint when one opens). */
    applyPopups() {
      if (active) popups();
    },
    /** A stand-in for labels t3+ draws itself (profiles, bots). */
    label(kind, real) {
      return book.fake(kind, real);
    },
    /** Puts every real text and badge back. */
    restore() {
      active = false;
      for (const node of touched) {
        const known = memo.get(node);
        if (known && node.nodeValue === known.fake) node.nodeValue = known.real;
        memo.delete(node);
      }
      touched.clear();
      for (const img of badges) {
        img.removeAttribute("data-t3plus-demo-badge");
        img.style.removeProperty("--t3plus-demo-badge");
        if (img.getAttribute("style") === "") img.removeAttribute("style");
      }
      badges.clear();
    },
    /** Drops references to nodes T3 removed (keeps the sets small on long sessions). */
    prune() {
      for (const node of touched) if (!node.isConnected) touched.delete(node);
      for (const img of badges) if (!img.isConnected) badges.delete(img);
    },
  };
}
