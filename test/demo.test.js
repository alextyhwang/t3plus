import assert from "node:assert/strict";
import { test } from "node:test";
import { STORAGE_KEYS, T3PLUS } from "../src/config.js";
import { createNameBook, fakeCode, fakeProse, isNeutral, projectInitials } from "../src/demoText.js";
import { BOT_TITLE, createApp, createDom, createFakeChromeStorage, settle, sidebarHtml } from "./helpers.js";

test("stand-ins are stable, distinct per real name, and keep generic values", () => {
  const book = createNameBook();
  const a = book.fake("project", "acme-internal");
  assert.equal(book.fake("project", "acme-internal"), a, "same real name, same stand-in");
  assert.notEqual(book.fake("project", "side-project"), a, "two projects never share one");
  assert.equal(book.kindOf("acme-internal"), "project");
  assert.ok(book.isFake(a));
  assert.equal(book.fake("branch", "main"), "main");
  assert.match(book.fake("branch", "me/secret-thing"), /^[a-z]+\/[a-z0-9-]+$/);
  assert.equal(projectInitials("atlas-api"), "AA");
  assert.equal(projectInitials("orbit"), "O");
  assert.ok(isNeutral("3:35 AM") && isNeutral("+1,028") && isNeutral("2d") && !isNeutral("hello"));
});

test("message text is replaced by agent prose of about the same length; code keeps its keywords", () => {
  const real = "I checked my bank account and the Chase statement from Tuesday; it's fine.";
  const fake = fakeProse(` ${real} `);
  assert.ok(fake.startsWith(" ") && fake.endsWith(" "), "whitespace kept");
  assert.ok(!fake.includes("Chase") && Math.abs(fake.trim().length - real.length) < 20);
  assert.equal(fakeProse(real), fake.trim(), "deterministic");
  assert.equal(fakeCode("const"), "const");
  assert.equal(fakeCode(" = "), " = ");
  assert.notEqual(fakeCode("myPrivateVar"), "myPrivateVar");
  assert.equal(fakeCode("line one\n  line two").split("\n")[1].startsWith("  "), true, "indent kept");
});

const TIMELINE = `
  <nav aria-label="Thread breadcrumb"><ol>
    <li><button><span data-slot="workspace-breadcrumb-text">notes</span></button></li>
    <li aria-hidden="true"><span data-slot="workspace-breadcrumb-text">/</span></li>
    <li aria-current="page"><h2><span data-slot="workspace-breadcrumb-text">Weekly notes</span></h2></li>
  </ol></nav>
  <div class="messages-timeline-scroll">
    <div data-timeline-row-id="m1" data-timeline-row-kind="message" data-message-role="user"><p id="user">Book my dentist at 3pm please</p></div>
    <div data-timeline-row-id="m2" data-timeline-row-kind="message" data-message-role="assistant">
      <div class="chat-markdown"><p id="prose">Done, I booked Dr. Smith for Friday.</p><p>Edited <code id="code">my-private.md</code></p></div>
    </div>
    <div data-timeline-row-id="f1" data-timeline-row-kind="turn-fold"><span id="fold">Worked for 10m 33s</span></div>
  </div>
  <div data-chat-composer-overlay="true"><div contenteditable="true" id="editor">my draft</div></div>`;

// Folder layout rows get a project name in their top line like card rows.
const cardRow = (key, title, project, branch) => `
  <li data-thread-item="${key}"><div role="button" data-sidebar-row="${key}" aria-label="${title}, ${project}">
    <span class="sr-only">${title}</span>
    <div class="relative z-10">
      <div class="flex h-5"><img class="size-4" src="data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#059669"/><text>NO</text></svg>').toString("base64")}"><span class="truncate">${project}</span><span class="group/sidebar-status-slot">2d</span></div>
      <div class="mt-1 flex"><span aria-hidden="true" dir="ltr">${title}</span></div>
      <div class="mt-0.5 flex"><span class="flex"><span class="truncate">${branch}</span></span></div>
    </div>
  </div></li>`;

test("screenshot mode covers sidebar, breadcrumb and messages, and restores every real text", async () => {
  const storage = createFakeChromeStorage();
  await storage.area.set({ [STORAGE_KEYS.settings]: { demo: { enabled: true } } });
  const html = sidebarHtml().replace("</ul>", `${cardRow("env1:x1", "Pay rent to landlord", "notes", "me/rent")}</ul>`);
  const dom = createDom("/env1/x1", html + TIMELINE);
  const doc = dom.window.document;
  const { app } = createApp(dom, storage);
  await app.start();
  app.watcher.flush();
  assert.ok(doc.documentElement.hasAttribute(T3PLUS.demoAttr));

  const row = doc.querySelector('[data-sidebar-row="env1:x1"]');
  const title = row.querySelector("[dir]").textContent;
  const project = row.querySelector(".truncate").textContent;
  assert.notEqual(title, "Pay rent to landlord");
  assert.notEqual(project, "notes");
  assert.notEqual(row.querySelector(".mt-0\\.5 .truncate").textContent, "me/rent");
  assert.equal(row.querySelector(".sr-only").textContent, "Pay rent to landlord", "hidden title untouched (scans stay real)");
  assert.equal(row.querySelector("img").getAttribute("data-t3plus-demo-badge"), "");
  assert.equal(doc.querySelectorAll('[data-slot="workspace-breadcrumb-text"]')[0].textContent, project, "breadcrumb project matches the row");
  assert.notEqual(doc.getElementById("user").textContent, "Book my dentist at 3pm please");
  assert.ok(!doc.getElementById("prose").textContent.includes("Smith"));
  assert.notEqual(doc.getElementById("code").textContent, "my-private.md");
  assert.equal(doc.getElementById("fold").textContent, "Worked for 10m 33s", "T3's own labels stay");
  assert.equal(doc.getElementById("editor").textContent, "my draft", "the composer is never touched");
  // The bot row keeps working: still recognized, and its name is a stand-in.
  const bot = doc.querySelector('[data-sidebar-row="env1:bot1"]');
  assert.ok(bot.hasAttribute(T3PLUS.botAttr));
  assert.match(bot.getAttribute("aria-description"), /^t3\+ bot: /);
  assert.ok(!bot.getAttribute("aria-description").includes("Orchestrator"), "bot name is a stand-in");
  assert.ok(BOT_TITLE.includes("Orchestrator"));

  // T3 re-renders a message: the new text is covered on the next pass.
  doc.getElementById("prose").firstChild.nodeValue = "New private reply from Dr. Smith.";
  app.watcher.flush();
  assert.ok(!doc.getElementById("prose").textContent.includes("Smith"));

  // Off: every real text and badge comes back.
  app.actions.setDemo(false);
  await settle();
  app.watcher.flush();
  assert.ok(!doc.documentElement.hasAttribute(T3PLUS.demoAttr));
  assert.equal(row.querySelector("[dir]").textContent, "Pay rent to landlord");
  assert.equal(row.querySelector(".truncate").textContent, "notes");
  assert.equal(doc.getElementById("user").textContent, "Book my dentist at 3pm please");
  assert.equal(doc.getElementById("prose").textContent, "New private reply from Dr. Smith.");
  assert.equal(doc.getElementById("code").textContent, "my-private.md");
  assert.ok(!row.querySelector("img").hasAttribute("data-t3plus-demo-badge"));
  app.stop();
});
