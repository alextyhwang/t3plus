import { T3PLUS, T3_SELECTORS as S } from "./config.js";
import { createBuilder, setText } from "./dom.js";

const GAP = 12;
const BAR_HEIGHT = 36;
// Expanded mode sits high in the chat column between T3's sidebar and any
// right-side thread details. The cap keeps the conversation and composer
// visible below it instead of covering the whole canvas.
const EXPANDED_MAX_HEIGHT = 420;
const VARS = ["x", "y", "width", "height", "controls-width"].map((name) => `--t3plus-preview-${name}`);
const intersects = (a, b) => a.left < b.right && a.right > b.left;

/** Viewport coordinates in, viewport coordinates out. The bar sits just above
 * the returned browser frame. No change to the remote browser's viewport. */
export function floatingPreviewLayout({ bounds, conversation, viewport, composer, findBar, details, mode, aspect = 16 / 10, scaleX = 1, scaleY = 1 }) {
  let left = Math.max(bounds.left, conversation.left, viewport.left) + GAP * scaleX;
  // T3's thread-details card floats over the conversation rather than reducing
  // its width. Expanded mode reserves that card; compact mode docks below it.
  const detailsLeft = details?.width > 0 && details.height > 0 && details.bottom > Math.max(bounds.top, conversation.top, viewport.top) && details.top < Math.min(bounds.bottom, conversation.bottom, viewport.bottom) ? details.left : Infinity;
  let right = Math.min(bounds.right, conversation.right, viewport.right, detailsLeft) - GAP * scaleX;
  let top = Math.max(bounds.top, conversation.top, viewport.top) + GAP * scaleY;
  let bottom = Math.min(bounds.bottom, conversation.bottom, viewport.bottom) - GAP * scaleY;
  if (mode === "compact" && Number.isFinite(detailsLeft)) {
    const dockRight = Math.min(bounds.right - GAP * scaleX, conversation.right - GAP * scaleX, viewport.right - GAP * scaleX, details.right);
    const dockLeft = Math.max(left, dockRight - Math.min(400 * scaleX, details.width));
    const dockTop = Math.max(top, details.bottom + GAP * scaleY, findBar?.height > 0 && intersects(findBar, { left: dockLeft, right: dockRight }) ? findBar.bottom + GAP * scaleY : top);
    const dockBottom = composer?.height > 0 && composer.bottom > dockTop && intersects(composer, { left: dockLeft, right: dockRight }) ? Math.min(bottom, composer.top - GAP * scaleY) : bottom;
    // If the details card or keyboard leaves no useful page below it, retain
    // the compact position beside the card until space returns.
    if (dockRight - dockLeft >= 180 * scaleX && dockBottom - dockTop >= (BAR_HEIGHT + 64) * scaleY) {
      left = dockLeft;
      right = dockRight;
      top = dockTop;
      bottom = dockBottom;
    }
  }
  if (findBar?.height > 0 && intersects(findBar, { left, right })) top = Math.max(top, findBar.bottom + GAP * scaleY);
  if (composer?.height > 0 && composer.bottom > top && intersects(composer, { left, right })) {
    bottom = Math.min(bottom, composer.top - GAP * scaleY);
  }
  const availableWidth = right - left;
  const availableHeight = bottom - top - BAR_HEIGHT * scaleY;
  // There is no safe room for controls. Leave T3's own layout in charge.
  if (availableWidth < 180 * scaleX || availableHeight < scaleY) return null;
  const width = mode === "expanded" ? availableWidth : Math.min(400 * scaleX, availableWidth);
  const height = mode === "expanded"
    ? Math.min(availableHeight, EXPANDED_MAX_HEIGHT * scaleY)
    : Math.min(availableHeight, width / Math.max(0.1, aspect * scaleX / scaleY));
  return { x: right - width, y: top + BAR_HEIGHT * scaleY, width, height };
}

/** Decorates T3's existing mini player without moving, cloning or remounting
 * its browser surface. Native controls still execute T3's own actions. */
export function createFloatingPreview({ win, doc }) {
  const h = createBuilder(doc);
  const records = new Map();
  const modes = new Map(); // bounded, tab-local presentation choices; never session data
  const focusTimers = new Set();
  let running = false;
  let animationFrame = null;

  const identity = (frame) => `${win.location.pathname}\n${frame.getAttribute(S.previewSourceAttr)}`;
  const modeOf = (record) => modes.get(record.key) ?? "compact";
  function remember(record, mode) {
    modes.delete(record.key);
    modes.set(record.key, mode);
    if (modes.size > 32) modes.delete(modes.keys().next().value);
  }
  function schedule() {
    if (!running || animationFrame !== null) return;
    animationFrame = win.requestAnimationFrame(() => {
      animationFrame = null;
      sync();
    });
  }
  function clearLayout(record) {
    record.frame.removeAttribute(T3PLUS.floatingAttr);
    record.frame.removeAttribute("data-t3plus-preview-narrow");
    record.frame.removeAttribute("data-t3plus-preview-squeezed");
    for (const name of VARS) record.frame.style.removeProperty(name);
  }
  function release(record) {
    record.resize?.disconnect();
    record.mutations.disconnect();
    record.frame.removeEventListener("pointerdown", record.onPointer, true);
    record.frame.removeEventListener("keydown", record.onKey, true);
    record.frame.removeEventListener("click", record.onClick, true);
    record.toolbar.remove();
    record.drag.removeAttribute(T3PLUS.previewDragAttr);
    record.controls.removeAttribute(T3PLUS.previewControlsAttr);
    clearLayout(record);
    records.delete(record.frame);
  }
  function attach(frame) {
    const close = frame.querySelector(S.previewClose);
    const controls = close?.parentElement;
    const drag = controls?.parentElement;
    const column = frame.closest(S.chatColumn);
    const canvas = frame.closest(S.chatCanvas);
    // Fail open if the upstream structure changes. Never hide native controls
    // or disable gestures unless we can expose the complete native control row.
    if (!close || drag?.parentElement !== frame || !column || !canvas) return null;
    // Remove decoration left by an invalidated extension copy, not T3's DOM.
    for (const old of frame.querySelectorAll(`[${T3PLUS.previewToolbarAttr}]`)) old.remove();
    const toggle = h("button", { type: "button", class: "t3plus-preview-mode" });
    const toolbar = h("div", { [T3PLUS.previewToolbarAttr]: "", [T3PLUS.ownedAttr]: "", role: "group", "aria-label": "Browser preview presentation" }, [
      h("span", { class: "t3plus-preview-caption", text: "Browser" }), toggle,
    ]);
    const record = { frame, close, controls, drag, column, canvas, toggle, toolbar, key: identity(frame), observed: [] };
    const isControl = (target) => toolbar.contains(target) || controls.contains(target);
    record.onPointer = (event) => {
      if (!frame.hasAttribute(T3PLUS.floatingAttr)) return;
      if (event.target.closest?.(S.previewResize) || (drag.contains(event.target) && !event.target.closest?.("button, a, input, select, textarea"))) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    record.onKey = (event) => {
      // Page typing, including T3's Shift+Escape escape hatch, stays native.
      if (!frame.hasAttribute(T3PLUS.floatingAttr) || !isControl(event.target) || event.key !== "Escape" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (modeOf(record) === "expanded") {
        remember(record, "compact");
        sync();
        toggle.focus({ preventScroll: true });
      } else close.click();
    };
    record.onClick = (event) => {
      if (!close.contains(event.target) || !frame.contains(doc.activeElement)) return;
      const path = win.location.pathname;
      const timer = win.setTimeout(() => {
        focusTimers.delete(timer);
        if (!running || win.location.pathname !== path || frame.isConnected) return;
        if (doc.activeElement === doc.body || frame.contains(doc.activeElement)) {
          column.querySelector(S.composerEditor)?.focus({ preventScroll: true });
        }
      }, 0);
      focusTimers.add(timer);
    };
    toggle.addEventListener("click", () => {
      remember(record, modeOf(record) === "compact" ? "expanded" : "compact");
      sync();
    });
    frame.addEventListener("pointerdown", record.onPointer, true);
    frame.addEventListener("keydown", record.onKey, true);
    frame.addEventListener("click", record.onClick, true);
    record.resize = win.ResizeObserver ? new win.ResizeObserver(schedule) : null;
    record.mutations = new win.MutationObserver(schedule);
    frame.prepend(toolbar);
    records.set(frame, record);
    return record;
  }
  function update(record) {
    const { frame, column, canvas, controls, drag, toolbar, toggle } = record;
    const conversation = canvas.querySelector(S.conversationArea);
    const composer = canvas.querySelector(S.composerStack) ?? canvas.querySelector(S.composerSurface) ?? canvas.querySelector(S.composerOverlay);
    const findBar = canvas.querySelector(S.threadFindBar);
    const details = column.querySelector(S.previewThreadDetails);
    // Only geometry-bearing nodes: no attribute observer on streaming chat text.
    const observed = [frame, frame.parentElement, canvas, column, conversation, composer, findBar, details, controls, ...doc.querySelectorAll(S.sidebarGap)].filter(Boolean);
    if (observed.length !== record.observed.length || observed.some((node, index) => record.observed[index] !== node)) {
      record.resize?.disconnect();
      record.mutations.disconnect();
      for (const node of observed) {
        record.resize?.observe(node);
        record.mutations.observe(node, { attributes: true, attributeFilter: ["style", "class", "hidden", "inert", S.chatColumnMaximizedAwayAttr, S.previewSourceAttr] });
      }
      record.observed = observed;
    }
    const viewport = win.visualViewport;
    const viewportRect = {
      left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
      right: (viewport?.offsetLeft ?? 0) + (viewport?.width ?? win.innerWidth),
      bottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? win.innerHeight),
    };
    const bounds = frame.parentElement.getBoundingClientRect();
    const scaleX = frame.parentElement.clientWidth > 0 && bounds.width > 0 ? bounds.width / frame.parentElement.clientWidth : 1;
    const scaleY = frame.parentElement.clientHeight > 0 && bounds.height > 0 ? bounds.height / frame.parentElement.clientHeight : 1;
    const nativeWidth = Number.parseFloat(frame.style.width);
    const nativeHeight = Number.parseFloat(frame.style.height);
    const layout = conversation && !column.matches(S.chatColumnHidden) && floatingPreviewLayout({
      bounds, conversation: conversation.getBoundingClientRect(), viewport: viewportRect,
      composer: composer?.getBoundingClientRect(), findBar: findBar?.getBoundingClientRect(),
      details: details?.getBoundingClientRect(),
      mode: modeOf(record), aspect: nativeWidth > 0 && nativeHeight > 0 ? nativeWidth / nativeHeight : undefined, scaleX, scaleY,
    });
    if (!layout) {
      clearLayout(record);
      drag.removeAttribute(T3PLUS.previewDragAttr);
      controls.removeAttribute(T3PLUS.previewControlsAttr);
      return;
    }
    const mode = modeOf(record);
    const label = mode === "compact" ? "Expand browser preview into chat column" : "Compact browser preview";
    setText(toggle, mode === "compact" ? "Expand" : "Compact");
    if (toggle.getAttribute("aria-label") !== label) {
      toggle.setAttribute("aria-label", label);
      toggle.setAttribute("title", `${label} (Escape from controls to compact or close)`);
      toggle.setAttribute("aria-pressed", String(mode === "expanded"));
    }
    if (frame.getAttribute(T3PLUS.floatingAttr) !== mode) frame.setAttribute(T3PLUS.floatingAttr, mode);
    if (!drag.hasAttribute(T3PLUS.previewDragAttr)) drag.setAttribute(T3PLUS.previewDragAttr, "");
    if (!controls.hasAttribute(T3PLUS.previewControlsAttr)) controls.setAttribute(T3PLUS.previewControlsAttr, "");
    // Convert viewport measurements to the unchanged absolute containing block,
    // including CSS scaling. Never overwrite T3's inline frame coordinates.
    const controlsWidth = Math.max(controls.getBoundingClientRect().width / scaleX, controls.querySelectorAll("button").length * 28 + 8);
    const values = [(layout.x - bounds.left) / scaleX, (layout.y - bounds.top) / scaleY, layout.width / scaleX, layout.height / scaleY, controlsWidth];
    VARS.forEach((name, index) => {
      const value = `${Math.round(values[index] * 100) / 100}px`;
      if (frame.style.getPropertyValue(name) !== value) frame.style.setProperty(name, value);
    });
    frame.toggleAttribute("data-t3plus-preview-narrow", layout.width / scaleX < 320);
    frame.toggleAttribute("data-t3plus-preview-squeezed", layout.height / scaleY < 64);
    if (!toolbar.isConnected) frame.prepend(toolbar);
  }
  function sync() {
    if (!running) return;
    // Native browser compositing is outside the extension's CSS/input control.
    const frames = new Set([...doc.querySelectorAll(S.floatingBrowser)].filter((frame) => !frame.querySelector(S.nativeBrowserSurface)));
    for (const record of records.values()) {
      if (!frames.has(record.frame) || record.key !== identity(record.frame) || record.close.parentElement !== record.controls || record.controls.parentElement !== record.drag || record.drag.parentElement !== record.frame || record.frame.closest(S.chatColumn) !== record.column || record.frame.closest(S.chatCanvas) !== record.canvas) release(record);
    }
    for (const frame of frames) {
      const record = records.get(frame) ?? attach(frame);
      if (record) update(record);
    }
  }
  return {
    start() {
      if (running) return;
      running = true;
      win.addEventListener("resize", schedule, { passive: true });
      win.addEventListener("scroll", schedule, { passive: true, capture: true });
      win.visualViewport?.addEventListener("resize", schedule);
      win.visualViewport?.addEventListener("scroll", schedule);
      sync();
    },
    sync,
    stop() {
      running = false;
      win.removeEventListener("resize", schedule);
      win.removeEventListener("scroll", schedule, true);
      win.visualViewport?.removeEventListener("resize", schedule);
      win.visualViewport?.removeEventListener("scroll", schedule);
      if (animationFrame !== null) win.cancelAnimationFrame(animationFrame);
      animationFrame = null;
      for (const timer of focusTimers) win.clearTimeout(timer);
      focusTimers.clear();
      for (const record of records.values()) release(record);
      modes.clear();
    },
  };
}
