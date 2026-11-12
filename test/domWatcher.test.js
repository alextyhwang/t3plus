import assert from "node:assert/strict";
import { test } from "node:test";
import { createDomWatcher } from "../src/domWatcher.js";
import { createDom, settle } from "./helpers.js";

test("mutations only inside the message list do not schedule a check; anything else does", async () => {
  const dom = createDom("/", `<div class="messages-timeline-scroll"><div id="msg"></div></div><nav id="sidebar"></nav>`);
  const doc = dom.window.document;
  let checks = 0;
  const list = doc.querySelector(".messages-timeline-scroll");
  const watcher = createDomWatcher({
    win: dom.window,
    doc,
    check: () => (checks += 1),
    throttleMs: 0,
    isNoise: (node) => list !== node && list.contains(node),
  });
  watcher.start();
  assert.equal(checks, 1, "first run");

  doc.getElementById("msg").append(doc.createTextNode("streamed token"));
  await settle();
  await settle();
  assert.equal(checks, 1, "streaming text is ignored");

  doc.getElementById("sidebar").append(doc.createElement("li"));
  await settle();
  await settle();
  assert.equal(checks, 2, "a sidebar change is checked");
  watcher.stop();
});
