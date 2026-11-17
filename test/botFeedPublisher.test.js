import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// server/publish_bot_feed.py against a throwaway SQLite file shaped like T3's
// statev2.sqlite (only the columns it reads). Skipped where Python is missing.
const server = fileURLToPath(new URL("../server/", import.meta.url));
const python = ["python3", "python"].find((cmd) => spawnSync(cmd, ["--version"]).status === 0);

const SCRIPT = String.raw`
import json, os, sqlite3, sys, tempfile
sys.path.insert(0, sys.argv[1])
import publish_bot_feed as feed

path = os.path.join(tempfile.mkdtemp(), "state.sqlite")
db = sqlite3.connect(path)
db.executescript("""
CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT, project_id TEXT, title TEXT, updated_at TEXT,
  archived_at TEXT, deleted_at TEXT, payload_json TEXT);
CREATE TABLE orchestration_v2_projection_runs (thread_id TEXT, ordinal INTEGER, status TEXT);
CREATE TABLE orchestration_v2_projection_runtime_requests (thread_id TEXT, status TEXT);
""")
def thread(tid, project, title, updated, archived=None, **payload):
    lineage = payload.pop("lineage", {"parentThreadId": None, "relationshipToParent": None})
    body = {"projectId": project, "updatedAt": updated, "lineage": lineage, **payload}
    db.execute("INSERT INTO orchestration_v2_projection_threads VALUES (?,?,?,?,?,NULL,?)",
               (tid, project, title, updated, archived, json.dumps(body)))
sub = lambda parent: {"parentThreadId": parent, "relationshipToParent": "subagent"}
thread("bot", "p1", "[[t3plus:bot:v1]] Dispatcher", "2026-11-12T09:00:00Z", pinnedAt="2026-11-01T00:00:00Z")
thread("a", "p1", "Draft release notes", "2026-11-12T10:00:00Z")
thread("b", "p1", "Compare hosting plans", "2026-11-12T08:00:00Z")
thread("settled", "p1", "Archive invoices", "2026-11-12T11:00:00Z", settledOverride="settled")
thread("snoozed", "p1", "Later", "2026-11-12T11:00:00Z", snoozedUntil="2999-01-01T00:00:00Z")
thread("archived", "p1", "Gone", "2026-11-12T11:00:00Z", archived="2026-11-12T11:00:00Z")
thread("fork", "p1", "A fork", "2026-11-12T07:00:00Z", lineage={"parentThreadId": "a", "relationshipToParent": "fork"})
thread("s1", "p1", "/root/one", "2026-11-12T10:00:00Z", lineage=sub("a"))
thread("s2", "p1", "/root/two", "2026-11-12T10:00:00Z", lineage=sub("a"))
thread("s3", "p1", "/root/three", "2026-11-12T10:00:00Z", lineage=sub("bot"))
thread("other", "p2", "Elsewhere", "2026-11-12T10:00:00Z")
db.execute("INSERT INTO orchestration_v2_projection_runs VALUES ('a', 1, 'completed'), ('a', 2, 'running'), ('fork', 1, 'failed')")
db.execute("INSERT INTO orchestration_v2_projection_runtime_requests VALUES ('b', 'pending')")
db.commit()
db.close()
bots, threads = feed.collect(path)
print(json.dumps({"bots": bots, "threads": threads}))
`;

test("publish_bot_feed: bot state and active project threads without access to message bodies", { skip: !python && "no Python" }, () => {
  const run = spawnSync(python, ["-I", "-c", SCRIPT, server], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const { bots, threads } = JSON.parse(run.stdout);
  const bot = bots.bot;
  assert.equal(bot.text, "");
  assert.equal(bot.projectId, "p1");
  assert.equal(bot.pinned, true);
  assert.equal(bot.settled, false);
  assert.equal(bot.children, 1);
  // Active, listed, same project; newest first. Settled, snoozed, archived,
  // subagents, other projects and the bot itself are left out; forks are listed.
  assert.deepEqual(Object.keys(threads), ["a", "b", "fork"]);
  assert.deepEqual(
    { ...threads.a, updatedAt: undefined },
    { title: "Draft release notes", projectId: "p1", status: "working", pinned: false, children: 2, updatedAt: undefined },
  );
  assert.equal(threads.b.status, "attention");
  assert.equal(threads.fork.status, "failed");
});
