import { T3PLUS } from "./config.js";

// t3+ gets its own entry in T3's Settings sidebar, right after Appearance.
// T3's settings router knows nothing about it, so "opening" t3+ is a view mode:
// <html data-t3plus-settings> hides T3's sections on the current settings page
// and shows the t3+ panel in their place. Any T3 settings link, or leaving the
// page, closes it again. Nothing of T3's is moved or re-rendered.

/** Any T3 settings page. */
export const SETTINGS_ROUTE = /\/settings(\/|$)/;

const NAV_ANCHOR = '[data-settings-section="/settings/appearance"]';
const PAGE = "[data-settings-page-scroll] > div";

// lucide "square-plus", in T3's icon style.
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="4"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>';

/** T3's Appearance nav button, the anchor for the t3+ entry. */
export function findSettingsNavAnchor(doc) {
  return doc.querySelector(NAV_ANCHOR);
}

/** The column that holds the sections of the current settings page. */
export function findSettingsPage(doc) {
  return doc.querySelector(PAGE);
}

/**
 * The owned nav item: an <li> shaped like T3's, holding a button that copies
 * the Appearance button's classes, so hover, focus and the active state come
 * from T3's own stylesheet (data-active="true").
 */
export function createSettingsNavItem(doc, onOpen) {
  const li = doc.createElement("li");
  li.setAttribute(T3PLUS.ownedAttr, "");
  li.setAttribute("role", "presentation");
  li.setAttribute("data-slot", "sidebar-menu-item");
  li.setAttribute("data-sidebar", "menu-item");
  li.className = "group/menu-item relative";
  const button = doc.createElement("button");
  button.type = "button";
  button.setAttribute(T3PLUS.ownedAttr, "");
  button.setAttribute("role", "treeitem");
  button.setAttribute("data-sidebar", "menu-button");
  button.setAttribute("data-slot", "sidebar-menu-button");
  button.setAttribute("data-size", "default");
  button.setAttribute("data-t3plus-settings-nav", "");
  button.setAttribute("tabindex", "-1");
  button.innerHTML = `${ICON}<span class="truncate max-md:sr-only">t3+</span>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onOpen();
  });
  li.appendChild(button);

  return {
    element: li,
    button,
    /** Puts the item right after `anchor`'s <li>. Returns true when the DOM changed. */
    mount(anchor) {
      const anchorItem = anchor.closest("li");
      if (!anchorItem?.parentElement) return false;
      if (button.className !== anchor.className) button.className = anchor.className;
      if (anchorItem.nextElementSibling === li) return false;
      anchorItem.after(li);
      return true;
    },
    setActive(on) {
      const value = on ? "true" : "false";
      if (button.getAttribute("data-active") !== value) {
        button.setAttribute("data-active", value);
        button.setAttribute("aria-selected", value);
        if (on) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      }
    },
  };
}
