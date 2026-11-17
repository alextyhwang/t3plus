import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntimeFetcher } from "../src/remoteConfig.js";
// The shipped setup, not the test fixture (test/support/register.mjs).
import { ASSISTANT_GROUP, FEED_BASE, IMMICH, TASKS_BASE } from "../src/personal.js?shipped";

test("the shipped setup configures nothing, so a fresh build fetches nothing", () => {
  assert.equal(FEED_BASE, "");
  assert.equal(TASKS_BASE, "");
  assert.equal(ASSISTANT_GROUP, null);
  assert.deepEqual([IMMICH.environmentId, IMMICH.projectId, IMMICH.feedEndpoint, IMMICH.imageEndpoint, IMMICH.libraryUrl], ["", "", "", "", ""]);
});

test("an unset feed endpoint never reaches the background worker", async () => {
  const sent = [];
  const fetchRemote = createRuntimeFetcher({ sendMessage: (message) => sent.push(message) });
  const response = await fetchRemote("");
  assert.equal(response.ok, false);
  assert.match(response.error, /FEED_BASE/);
  assert.deepEqual(sent, []);
});
