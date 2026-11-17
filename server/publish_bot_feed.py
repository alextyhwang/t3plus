"""Publishes t3plus-bots.json: bot state, next scheduled updates and the
active threads of each bot's project.

Reads T3's statev2.sqlite READ-ONLY (never writes it) and writes one small
JSON file into the feed folder, next to t3plus.json (see feedconfig.py). The
t3+ extension fetches it to show workload or the next update under each bot's name and,
for the Assistant group, to count sub-threads and to draw rows T3 is not
showing (threads in a collapsed shelf). install_feed_task.ps1 runs it every
2 minutes, through publish_all.py.

    bots:    { "<threadId>": { text: "", role: "assistant", at: null, model, effort, computer,
                               projectId, status, pinned, settled, snoozed,
                               children, updatedAt, nextRunAt? } }
    threads: { "<threadId>": { title, projectId, status, pinned, children,
                               updatedAt } }
             top-level threads of the bots' projects that T3 lists as active
             (not settled, snoozed or archived), newest first

    python publish_bot_feed.py [--db PATH] [--out PATH] [--once-print]
"""
import argparse
import json
import os
import re
import socket
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone

import feedconfig

USERDATA = str(feedconfig.USERDATA)
DEFAULT_DB = os.path.join(USERDATA, "statev2.sqlite")
DEFAULT_OUT = str(feedconfig.FEED_DIR / "t3plus-bots.json")
MARKER = "[[t3plus:bot:v1]]"
MAX_BOTS = 48
MAX_PROJECT_THREADS = 100


def model_label(model: str) -> str:
    """claude-opus-5-5 -> Opus 5.5, gpt-6.1-sol -> GPT-6.1 Sol; anything else unchanged."""
    m = re.fullmatch(r"claude-([a-z]+)-(\d+)-(\d+)(?:-.*)?", model or "")
    if m:
        return f"{m.group(1).capitalize()} {m.group(2)}.{m.group(3)}"
    m = re.fullmatch(r"gpt-([\d.]+)(?:-(.+))?", model or "")
    if m:
        return f"GPT-{m.group(1)}" + (f" {m.group(2).replace('-', ' ').title()}" if m.group(2) else "")
    return (model or "")[:32]


def computer_label() -> str:
    name = os.environ.get("T3PLUS_COMPUTER") or socket.gethostname() or ""
    return name[:1].upper() + name[1:32]


def is_bot_title(title: str) -> bool:
    words = (title or "").split()
    return bool(words) and (words[0] == MARKER or words[-1] == MARKER)


def is_listed(payload: dict) -> bool:
    """T3's isListedThreadLineage: subagents and side chats have no sidebar row."""
    lineage = payload.get("lineage") or {}
    return lineage.get("relationshipToParent") != "subagent" and lineage.get("sideChat") is not True


def is_snoozed(payload: dict, now: str) -> bool:
    until = payload.get("snoozedUntil")
    return isinstance(until, str) and until > now


def thread_status(conn, thread_id: str) -> str:
    """Roughly what T3's row shows: attention (a question or approval waits),
    working (a run is going), failed (the last run failed), else idle."""
    pending = conn.execute(
        "SELECT 1 FROM orchestration_v2_projection_runtime_requests WHERE thread_id = ? AND status = 'pending' LIMIT 1",
        (thread_id,),
    ).fetchone()
    if pending:
        return "attention"
    run = conn.execute(
        "SELECT status FROM orchestration_v2_projection_runs WHERE thread_id = ? ORDER BY ordinal DESC LIMIT 1",
        (thread_id,),
    ).fetchone()
    if run and run[0] in ("running", "starting", "preparing"):
        return "working"
    if run and run[0] == "failed":
        return "failed"
    return "idle"


def child_counts(conn) -> dict:
    """Sub-threads (subagents and side chats, which have no sidebar row) per parent thread id."""
    counts = {}
    rows = conn.execute(
        "SELECT json_extract(payload_json, '$.lineage.parentThreadId'), payload_json FROM orchestration_v2_projection_threads "
        "WHERE deleted_at IS NULL AND archived_at IS NULL AND json_extract(payload_json, '$.lineage.parentThreadId') IS NOT NULL"
    ).fetchall()
    for parent, payload in rows:
        try:
            listed = is_listed(json.loads(payload))
        except (ValueError, TypeError):
            continue
        if not listed:
            counts[parent] = counts.get(parent, 0) + 1
    return counts


def shell(conn, thread_id: str, payload: dict, children: dict) -> dict:
    return {
        "projectId": str(payload.get("projectId") or "")[:80],
        "status": thread_status(conn, thread_id),
        "pinned": payload.get("pinnedAt") is not None,
        "children": children.get(thread_id, 0),
        "updatedAt": str(payload.get("updatedAt") or "")[:40] or None,
    }


def project_threads(conn, projects: set, skip: dict, children: dict, now: str) -> dict:
    """Active top-level threads of the given projects, newest first."""
    listed = {}
    for project_id in sorted(projects):
        rows = conn.execute(
            "SELECT thread_id, title, payload_json FROM orchestration_v2_projection_threads "
            "WHERE project_id = ? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC",
            (project_id,),
        ).fetchall()
        kept = 0
        for thread_id, title, thread_payload in rows:
            if kept >= MAX_PROJECT_THREADS:
                break
            if thread_id in skip:
                continue
            try:
                payload = json.loads(thread_payload)
            except (ValueError, TypeError):
                continue
            if not is_listed(payload) or payload.get("settledOverride") == "settled" or is_snoozed(payload, now):
                continue
            listed[thread_id] = {"title": str(title or "")[:200], **shell(conn, thread_id, payload, children)}
            kept += 1
    return listed


def next_updates(conn) -> dict:
    """Earliest enabled scheduled task per bot thread, without prompts or titles."""
    try:
        return dict(conn.execute(
            "SELECT thread_id, MIN(next_run_at) FROM scheduled_tasks "
            "WHERE enabled = 1 AND thread_id IS NOT NULL AND next_run_at IS NOT NULL GROUP BY thread_id"
        ))
    except sqlite3.OperationalError:
        # Older database snapshots may not have the scheduler table yet.
        return {}


def collect(db_path: str) -> tuple[dict, dict]:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
    now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    try:
        threads = conn.execute(
            "SELECT thread_id, title, payload_json FROM orchestration_v2_projection_threads "
            "WHERE deleted_at IS NULL AND archived_at IS NULL AND title LIKE ?",
            (f"%{MARKER}%",),
        ).fetchall()
        bots = {}
        projects = set()
        children = child_counts(conn)
        updates = next_updates(conn)
        computer = computer_label()
        for thread_id, title, thread_payload in threads[:MAX_BOTS]:
            if not is_bot_title(title):
                continue
            try:
                payload = json.loads(thread_payload)
            except (ValueError, TypeError):
                payload = {}
            selection = payload.get("modelSelection") or {}
            effort = next((o.get("value") for o in selection.get("options") or [] if o.get("id") == "reasoningEffort"), None)
            meta = {"model": model_label(str(selection.get("model") or "")), "effort": str(effort or "")[:16], "computer": computer}
            state = {
                **shell(conn, thread_id, payload, children),
                "settled": payload.get("settledOverride") == "settled",
                "snoozed": is_snoozed(payload, now),
            }
            if state["projectId"]:
                projects.add(state["projectId"])
            bots[thread_id] = {"text": "", "role": "assistant", "at": None, **meta, **state}
            if thread_id in updates:
                bots[thread_id]["nextRunAt"] = updates[thread_id]
        return bots, project_threads(conn, projects, bots, children, now)
    finally:
        conn.close()


def environment_id() -> str | None:
    try:
        with open(os.path.join(USERDATA, "environment-id"), encoding="utf-8") as f:
            return f.read().strip() or None
    except OSError:
        return None


def write_atomic(path: str, data: dict) -> bool:
    body = json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True)
    try:
        with open(path, encoding="utf-8") as f:
            old = json.loads(f.read())
        if old.get("bots") == data["bots"] and old.get("threads") == data["threads"]:
            return False  # unchanged: keep the file (and its timestamp) as is
    except (OSError, ValueError):
        pass
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".t3plus-bots-", suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(body)
    os.replace(tmp, path)
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DEFAULT_DB)
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--once-print", action="store_true", help="print the feed instead of writing it")
    args = parser.parse_args()
    bots, threads = collect(args.db)
    data = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "environmentId": environment_id(),
        "bots": bots,
        "threads": threads,
    }
    if args.once_print:
        print(json.dumps(data, ensure_ascii=False, indent=1))
        return 0
    write_atomic(args.out, data)
    return 0


if __name__ == "__main__":
    sys.exit(main())
