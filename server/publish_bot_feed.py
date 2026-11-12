"""Publishes t3plus-bots.json: the latest message of every t3+ bot thread.

Reads T3's statev2.sqlite READ-ONLY (never writes it) and writes one small
JSON file into the feed folder, next to t3plus.json (see feedconfig.py). The
t3+ extension fetches it to show a one-line preview under each bot's name.
install_feed_task.ps1 runs it every 2 minutes.

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
MAX_TEXT = 280
MAX_BOTS = 48


def plain(text: str) -> str:
    """Markdown to one plain line: drop code fences, links, emphasis and headings."""
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"(\*\*|__|\*|_|~~)(?=\S)(.+?)(?<=\S)\1", r"\2", text)
    text = re.sub(r"^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)", "", text, flags=re.M)
    text = re.sub(r"\s+", " ", text).strip()
    return text[: MAX_TEXT - 1] + "…" if len(text) > MAX_TEXT else text


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


def collect(db_path: str) -> dict:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
    try:
        threads = conn.execute(
            "SELECT thread_id, title, payload_json FROM orchestration_v2_projection_threads "
            "WHERE deleted_at IS NULL AND archived_at IS NULL AND title LIKE ?",
            (f"%{MARKER}%",),
        ).fetchall()
        bots = {}
        computer = computer_label()
        for thread_id, title, thread_payload in threads[:MAX_BOTS]:
            if not is_bot_title(title):
                continue
            try:
                selection = json.loads(thread_payload).get("modelSelection") or {}
            except (ValueError, TypeError):
                selection = {}
            effort = next((o.get("value") for o in selection.get("options") or [] if o.get("id") == "reasoningEffort"), None)
            meta = {"model": model_label(str(selection.get("model") or "")), "effort": str(effort or "")[:16], "computer": computer}
            bots[thread_id] = {"text": "", "role": "assistant", "at": None, **meta}
            rows = conn.execute(
                "SELECT role, created_at, payload_json FROM orchestration_v2_projection_messages "
                "WHERE thread_id = ? AND role IN ('assistant', 'user') ORDER BY created_at DESC LIMIT 6",
                (thread_id,),
            ).fetchall()
            for role, created_at, payload in rows:
                try:
                    text = plain(str(json.loads(payload).get("text") or ""))
                except (ValueError, TypeError):
                    text = ""
                if text:
                    bots[thread_id].update({"text": text, "role": role, "at": created_at})
                    break
        return bots
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
        if old.get("bots") == data["bots"]:
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
    data = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "environmentId": environment_id(),
        "bots": collect(args.db),
    }
    if args.once_print:
        print(json.dumps(data, ensure_ascii=False, indent=1))
        return 0
    write_atomic(args.out, data)
    return 0


if __name__ == "__main__":
    sys.exit(main())
