import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { T3PLUS, T3_SELECTORS as S } from "../src/config.js";
import { createFloatingPreview, floatingPreviewLayout } from "../src/floatingPreview.js";
import { createApp, createDom, settle } from "./helpers.js";

// ThreadPreviewMiniPlayer.tsx / ChatCanvas.tsx @ 9ef259e5: native pill,
// stream and resize handles are siblings, inside an absolute canvas overlay.
export const FLOATING_PREVIEW_HTML = `
  <main data-chat-column>
    <header data-chat-header>Thread</header>
    <div data-chat-canvas>
      <div data-thread-find-bar hidden></div>
      <div data-workspace-area="conversation"><div class="messages-timeline-scroll">Messages</div></div>
      <div data-chat-composer-overlay="true"><div data-chat-composer-stack="true">
        <div data-chat-composer-surface="true"><div data-testid="composer-editor" contenteditable="true" tabindex="0">Draft</div></div>
      </div></div>
      <div id="player-overlay" style="position:absolute;inset:0;pointer-events:none">
        <section aria-label="Floating browser preview" data-preview-mini-player="browser:tab-1"
          style="position:absolute;left:30px;top:40px;width:320px;height:200px;border-radius:16px;pointer-events:none">
          <div id="drag" class="cursor-grab" style="position:absolute;right:8px;top:8px;width:12px;height:12px;pointer-events:auto">
            <div role="status" aria-label="Recording preview">Recording</div>
            <div id="controls" style="position:absolute;right:0;top:0;opacity:0;pointer-events:none">
              <button type="button" aria-label="Open preview in right panel">Panel</button>
              <button type="button" aria-label="Pop preview into separate window">Pop out</button>
              <button type="button" aria-label="Close floating preview">Close</button>
            </div>
          </div>
          <div id="stream" data-server-browser-surface="tab-1" style="position:absolute;inset:0;z-index:48;pointer-events:auto">
            <canvas></canvas><textarea aria-label="Browser page"></textarea>
          </div>
          <div data-preview-mini-player-resize="east"></div>
          <div data-preview-mini-player-resize="southwest"></div>
        </section>
      </div>
    </div>
  </main>`;

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const px = (frame, name) => Number.parseFloat(frame.style.getPropertyValue(`--t3plus-preview-${name}`));
const input = (win, target, type, init = {}) => {
  const event = type === "keydown" ? new win.KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }) : new win.MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

function fixture(t) {
  const dom = createDom("/env1/thread1", FLOATING_PREVIEW_HTML);
  const win = dom.window;
  const doc = win.document;
  const frame = doc.querySelector(S.floatingBrowser);
  const geometry = {
    canvas: rect(260, 56, 1020, 744), conversation: rect(260, 56, 1020, 744),
    composer: rect(320, 650, 900, 138), find: rect(0, 0, 0, 0),
  };
  for (const [selector, key] of [[S.chatCanvas, "canvas"], ["#player-overlay", "canvas"], [S.conversationArea, "conversation"], [S.composerStack, "composer"], [S.threadFindBar, "find"]]) {
    doc.querySelector(selector).getBoundingClientRect = () => geometry[key];
  }
  Object.defineProperty(win, "innerWidth", { value: 1280, configurable: true });
  Object.defineProperty(win, "innerHeight", { value: 800, configurable: true });
  const resizes = [];
  win.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.nodes = new Set(); resizes.push(this); }
    observe(node) { this.nodes.add(node); }
    disconnect() { this.nodes.clear(); }
  };
  const raf = new Map();
  let rafId = 0;
  win.requestAnimationFrame = (fn) => { raf.set(++rafId, fn); return rafId; };
  win.cancelAnimationFrame = (id) => raf.delete(id);
  const flush = () => { const pending = [...raf.values()]; raf.clear(); pending.forEach((fn) => fn()); };
  const preview = createFloatingPreview({ win, doc });
  t.after(() => { preview.stop(); dom.window.close(); });
  return { dom, win, doc, frame, geometry, preview, resizes, raf, flush };
}

test("layout anchors compact top-right and expands only above the composer, respecting find and visual viewport", () => {
  const base = { bounds: rect(260, 56, 1020, 744), conversation: rect(260, 56, 1020, 744), viewport: rect(0, 0, 1280, 800), composer: rect(320, 650, 900, 138) };
  assert.deepEqual(floatingPreviewLayout({ ...base, mode: "compact" }), { x: 868, y: 104, width: 400, height: 250 });
  assert.deepEqual(floatingPreviewLayout({ ...base, mode: "expanded" }), { x: 272, y: 104, width: 996, height: 420 });
  const details = rect(1000, 68, 268, 430);
  assert.deepEqual(floatingPreviewLayout({ ...base, details, mode: "expanded" }), { x: 272, y: 104, width: 716, height: 420 });
  assert.deepEqual(floatingPreviewLayout({ ...base, details, mode: "compact" }), { x: 1000, y: 546, width: 268, height: 92 });
  assert.deepEqual(floatingPreviewLayout({ ...base, details, composer: rect(320, 650, 600, 138), mode: "compact" }), { x: 1000, y: 546, width: 268, height: 167.5 });
  assert.deepEqual(floatingPreviewLayout({ ...base, details: rect(1000, 68, 268, 600), mode: "compact" }), { x: 588, y: 104, width: 400, height: 250 }, "tall details leave compact safely beside the card");
  assert.deepEqual(floatingPreviewLayout({ ...base, details: rect(1000, 68, 0, 0), mode: "expanded" }), { x: 272, y: 104, width: 996, height: 420 });
  const phone = floatingPreviewLayout({ ...base, bounds: rect(0, 50, 390, 750), conversation: rect(0, 50, 390, 750), viewport: rect(0, 100, 390, 460), composer: rect(12, 400, 366, 150), findBar: rect(0, 100, 390, 40), mode: "expanded" });
  assert.deepEqual(phone, { x: 12, y: 188, width: 366, height: 200 });
  assert.equal(floatingPreviewLayout({ ...base, viewport: rect(0, 0, 390, 100), mode: "expanded" }), null, "no unsafe controls when too narrow/short");
});

test("overlay thread details reserve width and track resizing without remounting the browser", (t) => {
  const { preview, doc, frame, resizes, flush } = fixture(t);
  const details = doc.createElement("section");
  details.setAttribute("data-workspace-area", "details");
  details.setAttribute("aria-label", "Thread details");
  let bounds = rect(1000, 68, 268, 430);
  details.getBoundingClientRect = () => bounds;
  doc.querySelector(S.chatColumn).append(details);
  const stream = doc.querySelector("#stream");
  preview.start();
  assert.equal(260 + px(frame, "x"), 1000);
  assert.equal(56 + px(frame, "y"), 546);
  assert.equal(px(frame, "width"), 268);
  frame.querySelector(".t3plus-preview-mode").click();
  assert.equal(px(frame, "width"), 716);
  bounds = rect(900, 68, 368, 430);
  resizes[0].callback();
  flush();
  assert.equal(px(frame, "width"), 616);
  frame.querySelector(".t3plus-preview-mode").click();
  assert.equal(260 + px(frame, "x"), 900);
  assert.equal(px(frame, "width"), 368);
  details.remove();
  preview.sync();
  assert.equal(px(frame, "width"), 400);
  frame.querySelector(".t3plus-preview-mode").click();
  assert.equal(px(frame, "width"), 996);
  assert.equal(doc.querySelector("#stream"), stream);
});

test("mode switches preserve the mounted stream, focus, native controls and T3's inline geometry", (t) => {
  const { preview, frame, doc, win } = fixture(t);
  const stream = doc.querySelector("#stream");
  const page = stream.querySelector("textarea");
  page.value = "unsent browser input";
  const native = Array.from(frame.style).map((name) => [name, frame.style.getPropertyValue(name)]);
  let panelClicks = 0;
  const panel = frame.querySelector('button[aria-label="Open preview in right panel"]');
  panel.addEventListener("click", () => panelClicks++);
  preview.start();
  const toggle = frame.querySelector(".t3plus-preview-mode");
  assert.equal(frame.getAttribute(T3PLUS.floatingAttr), "compact");
  assert.equal(frame.firstElementChild, toggle.parentElement, "toolbar leads focus order");
  assert.equal(toggle.textContent, "Expand");
  toggle.focus();
  toggle.click();
  assert.equal(frame.getAttribute(T3PLUS.floatingAttr), "expanded");
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(doc.activeElement, toggle);
  assert.equal(px(frame, "width"), 996);
  assert.equal(56 + px(frame, "y") + px(frame, "height"), 524, "bounded expanded preview stays above the composer");
  assert.equal(doc.querySelector("#stream"), stream);
  assert.equal(page.value, "unsent browser input");
  panel.click();
  assert.equal(panelClicks, 1);
  assert.equal(panel.parentElement.id, "controls");
  input(win, toggle, "keydown", { key: "Escape" });
  assert.equal(frame.getAttribute(T3PLUS.floatingAttr), "compact");
  assert.equal(doc.activeElement, toggle);
  preview.stop();
  assert.deepEqual(Array.from(frame.style).map((name) => [name, frame.style.getPropertyValue(name)]), native, "only owned CSS variables were removed");
  assert.equal(frame.querySelector(`[${T3PLUS.previewToolbarAttr}]`), null);
  assert.equal(doc.querySelector("#drag").hasAttribute(T3PLUS.previewDragAttr), false);
});

test("blocks only frame gestures; browser pointer, wheel, keyboard and native buttons stay interactive", (t) => {
  const { preview, doc, win, frame } = fixture(t);
  const drag = doc.querySelector("#drag");
  const resize = frame.querySelector(S.previewResize);
  const page = doc.querySelector("textarea");
  let moves = 0;
  let pages = 0;
  let buttons = 0;
  drag.addEventListener("pointerdown", () => moves++);
  resize.addEventListener("pointerdown", () => moves++);
  page.addEventListener("pointerdown", () => pages++);
  // Native T3 buttons stop pointerdown before it reaches the drag host.
  for (const button of frame.querySelectorAll("button")) button.addEventListener("pointerdown", (event) => event.stopPropagation());
  frame.querySelector(S.previewClose).addEventListener("pointerdown", () => buttons++);
  preview.start();
  assert.equal(input(win, drag, "pointerdown").defaultPrevented, true);
  assert.equal(input(win, resize, "pointerdown").defaultPrevented, true);
  assert.equal(input(win, page, "pointerdown").defaultPrevented, false);
  assert.equal(input(win, frame.querySelector(S.previewClose), "pointerdown").defaultPrevented, false);
  assert.equal(moves, 0);
  assert.equal(pages, 1);
  assert.equal(buttons, 1);
  for (const type of ["wheel", "click", "contextmenu", "dragstart"]) assert.equal(input(win, page, type).defaultPrevented, false);
  for (const init of [{ key: "Escape" }, { key: "Escape", shiftKey: true }, { key: "a" }, { key: "Tab" }]) assert.equal(input(win, page, "keydown", init).defaultPrevented, false);
  preview.stop();
  input(win, drag, "pointerdown");
  assert.equal(moves, 1, "native gestures restored on stop");
});

test("composer growth, sidebar/right panel resizing, viewport movement and T3 frame updates reflow without polling", async (t) => {
  const { preview, doc, win, frame, geometry, resizes, raf, flush } = fixture(t);
  preview.start();
  frame.querySelector(".t3plus-preview-mode").click();
  geometry.canvas = geometry.conversation = rect(300, 56, 600, 744);
  geometry.composer = rect(320, 460, 560, 330);
  resizes[0].callback();
  resizes[0].callback();
  assert.equal(raf.size, 1, "coalesced to one animation frame");
  flush();
  assert.equal(px(frame, "width"), 576);
  assert.equal(px(frame, "height"), 344);
  assert.equal(px(frame, "x"), 12);
  frame.style.left = "99px";
  frame.style.width = "600px";
  frame.style.height = "300px";
  await settle();
  flush();
  assert.equal(frame.style.left, "99px", "latest native geometry retained for cleanup");
  assert.equal(px(frame, "x"), 12, "native frame updates cannot move fixed presentation");
  const visualViewport = new win.EventTarget();
  Object.assign(visualViewport, { offsetLeft: 0, offsetTop: 100, width: 900, height: 380 });
  Object.defineProperty(win, "visualViewport", { value: visualViewport });
  // Window scroll also covers visual viewport movement on older browsers.
  win.dispatchEvent(new win.Event("scroll"));
  flush();
  assert.equal(px(frame, "y"), 92, "position measured relative to unchanged overlay");
  geometry.composer = rect(320, 180, 560, 290);
  resizes[0].callback();
  flush();
  assert.equal(frame.hasAttribute("data-t3plus-preview-squeezed"), true);
  geometry.composer = rect(320, 460, 560, 330);
  resizes[0].callback();
  flush();
  assert.equal(frame.hasAttribute("data-t3plus-preview-squeezed"), false);
  doc.querySelector(S.chatColumn).setAttribute("inert", "");
  await settle();
  flush();
  assert.equal(frame.hasAttribute(T3PLUS.floatingAttr), false, "maximized right panel keeps ownership");
  doc.querySelector(S.chatColumn).removeAttribute("inert");
  preview.sync();
  assert.equal(frame.getAttribute(T3PLUS.floatingAttr), "expanded");
  preview.stop();
  assert.equal(raf.size, 0);
  assert.equal(resizes.every((observer) => observer.nodes.size === 0), true);
  win.dispatchEvent(new win.Event("resize"));
  assert.equal(raf.size, 0, "listeners removed");
});

test("session modes survive remounts, and do not leak across threads or tabs; incompatible and device players stay native", (t) => {
  const { preview, doc, win, frame } = fixture(t);
  preview.start();
  frame.querySelector(".t3plus-preview-mode").click();
  const parent = frame.parentElement;
  const nativeClone = frame.cloneNode(true);
  frame.remove();
  preview.sync();
  assert.equal(frame.hasAttribute(T3PLUS.floatingAttr), false);
  parent.append(nativeClone);
  preview.sync();
  assert.equal(nativeClone.getAttribute(T3PLUS.floatingAttr), "expanded");
  assert.equal(nativeClone.querySelectorAll(`[${T3PLUS.previewToolbarAttr}]`).length, 1, "stale decoration replaced");
  nativeClone.setAttribute(S.previewSourceAttr, "browser:tab-2");
  preview.sync();
  assert.equal(nativeClone.getAttribute(T3PLUS.floatingAttr), "compact");
  win.history.pushState({}, "", "/env1/thread2");
  preview.sync();
  assert.equal(nativeClone.getAttribute(T3PLUS.floatingAttr), "compact");
  nativeClone.setAttribute(S.previewSourceAttr, "device:host:phone");
  preview.sync();
  assert.equal(nativeClone.hasAttribute(T3PLUS.floatingAttr), false);
  nativeClone.setAttribute(S.previewSourceAttr, "browser:tab-2");
  nativeClone.querySelector(S.previewClose).remove();
  preview.sync();
  assert.equal(nativeClone.hasAttribute(T3PLUS.floatingAttr), false);
  assert.equal(nativeClone.querySelector(`[${T3PLUS.previewToolbarAttr}]`), null);
  assert.equal(doc.querySelectorAll("canvas").length, 1);
});

test("native close runs once and returns focus to the composer; no page Escape interception", async (t) => {
  const { preview, doc, win, frame } = fixture(t);
  let closed = 0;
  frame.querySelector(S.previewClose).addEventListener("click", () => { closed++; frame.remove(); });
  preview.start();
  const toggle = frame.querySelector(".t3plus-preview-mode");
  toggle.focus();
  input(win, toggle, "keydown", { key: "Escape" });
  await settle();
  assert.equal(closed, 1);
  assert.equal(doc.activeElement, doc.querySelector(S.composerEditor));
});

test("native compositor slots stay untouched, including a runtime change from server to native", (t) => {
  const { preview, doc, frame } = fixture(t);
  const slot = doc.createElement("div");
  slot.setAttribute("data-browser-surface-slot", "tab-1");
  frame.append(slot);
  preview.start();
  assert.equal(frame.hasAttribute(T3PLUS.floatingAttr), false);
  assert.equal(frame.querySelector(`[${T3PLUS.previewToolbarAttr}]`), null);
  slot.remove();
  preview.sync();
  assert.equal(frame.getAttribute(T3PLUS.floatingAttr), "compact");
  frame.append(slot);
  preview.sync();
  assert.equal(frame.hasAttribute(T3PLUS.floatingAttr), false);
  assert.equal(frame.querySelector(`[${T3PLUS.previewToolbarAttr}]`), null);
});

test("scaled containing blocks keep the control bar and frame aligned", (t) => {
  const { preview, doc, frame, geometry } = fixture(t);
  const overlay = frame.parentElement;
  Object.defineProperty(overlay, "clientWidth", { value: 510 });
  Object.defineProperty(overlay, "clientHeight", { value: 372 });
  preview.start();
  frame.querySelector(".t3plus-preview-mode").click();
  const viewportTop = geometry.canvas.top + px(frame, "y") * 2;
  const toolbarTop = viewportTop - 36 * 2;
  assert.equal(toolbarTop, geometry.conversation.top + 12 * 2);
  assert.equal(geometry.canvas.top + (px(frame, "y") + px(frame, "height")) * 2, geometry.composer.top - 12 * 2);
  assert.equal(px(frame, "width"), 486);
  assert.equal(doc.querySelector("#stream").parentElement, frame);
});

test("app watcher discovers new players and releases them on extension invalidation", async (t) => {
  const { dom, frame, doc } = fixture(t);
  const parent = frame.parentElement;
  frame.remove();
  let alive = true;
  const { app } = createApp(dom, undefined, { isAlive: () => alive });
  t.after(() => app.stop());
  await app.start();
  parent.append(frame);
  app.watcher.flush();
  assert.equal(frame.getAttribute(T3PLUS.floatingAttr), "compact");
  assert.equal(doc.querySelectorAll(`[${T3PLUS.previewToolbarAttr}]`).length, 1);
  alive = false;
  app.watcher.flush();
  assert.equal(frame.hasAttribute(T3PLUS.floatingAttr), false);
  assert.equal(frame.querySelector(`[${T3PLUS.previewToolbarAttr}]`), null);
});

test("CSS disables only frame handles and exposes controls with theme colors and focus styling", async () => {
  const css = await readFile(new URL("../src/styles/content.css", import.meta.url), "utf8");
  assert.match(css, /\[data-t3plus-floating\] > \[data-preview-mini-player-resize\]\s*\{[^}]*pointer-events:\s*none !important/);
  assert.match(css, /\[data-t3plus-preview-drag\] > \[data-t3plus-preview-controls\]\s*\{[^}]*opacity:\s*1 !important;[^}]*pointer-events:\s*auto !important/);
  assert.match(css, /\.t3plus-preview-mode:focus-visible/);
  assert.match(css, /background:\s*var\(--popover, var\(--background, Canvas\)\)/);
  assert.doesNotMatch(css, /\[data-t3plus-floating\][^{]*\*\s*\{[^}]*pointer-events:\s*none/);
});
