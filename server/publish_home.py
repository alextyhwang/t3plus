"""Publishes t3plus-home.json: data for the t3+ home widgets on T3's new-thread page.

Everything comes from T3 itself, read-only, without changing T3's server:
  * T3's own API, through a short-lived read-only session issued by the
    official `t3 auth session issue` CLI and revoked right after:
      - subscribeServerConfig {usageLimitSources}: live Claude limits and the
        Codex Gateway account windows (the accounts the Codex CLI uses);
      - server.getUsageSummary: daily cost/tokens per provider.
  * statev2.sqlite opened read-only: runs and new threads per day per project,
    and scheduled automations (title, next/last run, status only; never
    prompts or webhook secrets).
Limit snapshots are appended to a small local history so the pool chart can
show the recorded trend. Output goes to the feed folder next to t3plus.json
(see feedconfig.py). It needs Python 3.10+ with `websockets`:

    python publish_home.py [--print]
"""
import argparse
import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import feedconfig

ROOT = feedconfig.T3_HOME
USERDATA = feedconfig.USERDATA
DB = USERDATA / "statev2.sqlite"
OUT = feedconfig.FEED_DIR / "t3plus-home.json"
HISTORY = USERDATA / "t3plus" / "limits-history.json"
# Daily token totals change slowly: the activity source is asked at most every 30 minutes.
ACTIVITY_CACHE = USERDATA / "t3plus" / "ai-activity-cache.json"
ACTIVITY_MAX_AGE = 1800
CLI = feedconfig.T3_CLI
BASE = "http://127.0.0.1:3773"
TIME_ZONE = feedconfig.TIME_ZONE
ACTIVITY_DAYS = 26 * 7
SPEND_DAYS = 62
HISTORY_DAYS = 8
NO_WINDOW = 0x08000000
# Optional: a loopback service whose read-only GETs (/history, /overview) serve
# the recorded weekly usage of every Codex account. Without it the Codex pool
# shows T3's current limits only.
LIMITS_API = feedconfig.LIMITS_API
SERIES_DAYS = 7
SERIES_STEP = 1800  # one point per 30 minutes
# Optional: a JSON source of aggregate AI tokens per day (all providers),
# {"days": [{"date", "totalTokens", "providers": {name: {"tokens"}}}]}.
# Without it the Activity card counts T3 runs per day.
AI_ACTIVITY = feedconfig.ACTIVITY_URL


def local_day(iso):
    """'2026-11-11T15:33:56.138Z' -> local 'YYYY-MM-DD' (machine time zone)."""
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone().strftime("%Y-%m-%d")
    except ValueError:
        return None


# ---------------------------------------------------------------- T3 API

def issue_session():
    args = [CLI, "auth", "session", "issue", "--base-dir", str(ROOT), "--ttl", "5m", "--label", "t3plus home feed",
            "--json", "--scope", "orchestration:read", "--scope", "diagnostics:read"]
    r = subprocess.run(args, capture_output=True, text=True, timeout=30, creationflags=NO_WINDOW)
    if r.returncode:
        raise RuntimeError("t3 auth session issue failed")
    return json.loads(r.stdout)


def revoke_session(session):
    subprocess.run([CLI, "auth", "session", "revoke", "--base-dir", str(ROOT), session["sessionId"]],
                   capture_output=True, timeout=30, creationflags=NO_WINDOW)


def protocol_version():
    import urllib.request
    with urllib.request.urlopen(BASE + "/.well-known/t3/environment", timeout=10) as r:
        return json.load(r).get("orchestrationProtocolVersion", 1)


def read_t3(token):
    """Returns (usage summary, providers with usageLimits, usage limit sources)."""
    from websockets.sync.client import connect
    proto = protocol_version()
    summary_id, config_id = str(uuid.uuid4()), str(uuid.uuid4())
    today = datetime.now().astimezone()
    since = (today - timedelta(days=SPEND_DAYS)).strftime("%Y-%m-%d")
    summary, providers, sources = None, None, None
    with connect(f"ws://127.0.0.1:3773/ws?orchestrationProtocol={proto}", additional_headers={"Authorization": "Bearer " + token},
                 max_size=64 * 1024 * 1024, open_timeout=10, close_timeout=3) as ws:
        ws.send(json.dumps({"_tag": "Request", "id": summary_id, "tag": "server.getUsageSummary", "headers": [],
                            "payload": {"sinceDay": since, "untilDay": today.strftime("%Y-%m-%d"), "timeZone": TIME_ZONE, "awaitRefresh": False}}))
        ws.send(json.dumps({"_tag": "Request", "id": config_id, "tag": "subscribeServerConfig", "headers": [],
                            "payload": {"usageLimitSources": True}}))
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline and (summary is None or sources is None):
            frame = json.loads(ws.recv(timeout=max(1, deadline - time.monotonic())))
            tag = frame.get("_tag")
            if tag == "Ping":
                ws.send('{"_tag":"Pong"}')
            elif tag == "Exit" and str(frame.get("requestId")) == summary_id:
                exit_value = frame.get("exit", {})
                summary = exit_value.get("value") if exit_value.get("_tag") == "Success" else {}
            elif tag == "Chunk" and str(frame.get("requestId")) == config_id:
                ws.send(json.dumps({"_tag": "Ack", "requestId": frame["requestId"]}))
                for item in frame.get("values", []):
                    payload = item.get("payload") or item.get("config") or {}
                    if item.get("type") == "usageLimitSourcesUpdated":
                        sources = payload.get("sources") or []
                    elif item.get("type") == "snapshot":
                        providers = (payload.get("config") or {}).get("providers") or payload.get("providers") or []
    return summary or {}, providers or [], sources or []


# ---------------------------------------------------------------- shaping

def clean_window(w):
    used = w.get("usedPercent")
    if not isinstance(used, (int, float)):
        return None
    return {
        "label": str(w.get("label") or "")[:40],
        "kind": str(w.get("kind") or "")[:24],
        "durationMins": w.get("windowDurationMins") if isinstance(w.get("windowDurationMins"), (int, float)) else None,
        "usedPercent": max(0, min(100, round(float(used), 1))),
        "resetsAt": w.get("resetsAt") if isinstance(w.get("resetsAt"), str) else None,
    }


def safe_label(text, fallback):
    text = str(text or "").strip()
    if not text or "@" in text:  # never publish an email address
        return fallback
    return text[:32]


def limits(providers, sources):
    claude = []
    for p in providers:
        driver = p.get("driver") or p.get("provider") or ""
        if driver != "claudeAgent" or not p.get("usageLimits"):
            continue
        windows = [w for w in map(clean_window, p["usageLimits"].get("windows") or []) if w]
        if not windows:
            continue
        name = p.get("displayName") or p.get("label") or p.get("instanceId")
        plan = str((p.get("auth") or {}).get("type") or "")[:40]  # "Claude Pro" / "Claude Max"
        claude.append({"id": p.get("instanceId"), "label": safe_label(name, "Claude"), "plan": plan, "windows": windows,
                       "checkedAt": p["usageLimits"].get("checkedAt")})
    codex = None
    for s in sources:
        if s.get("id") != "codex_gateway":
            continue
        accounts = []
        for i, a in enumerate(s.get("accounts") or []):
            windows = [w for w in map(clean_window, (a.get("usageLimits") or {}).get("windows") or []) if w]
            accounts.append({"label": safe_label(a.get("email"), f"Account {i + 1}"), "plan": str(a.get("plan") or "")[:40], "windows": windows})
        codex = {"label": safe_label(s.get("label"), "Codex"), "checkedAt": s.get("checkedAt"), "accounts": accounts}
    return {"claude": claude, "codex": codex}


def plan_weight(plan):
    """Pro is 10x Plus (the scale T3 and the Limits page use)."""
    return 10 if "pro" in (plan or "").lower() else 1


def claude_weight(plan):
    """Claude Max ($100) is 5x Claude Pro ($20). T3 reports both Max tiers as "Claude Max";
    this account is the $100 one."""
    return 5 if "max" in (plan or "").lower() else 1


def codex_pool(codex):
    """Pool left this week and this 5-hour window, in 'Plus weeks' percent (Pro counts 10x)."""
    if not codex:
        return None
    cap = week_left = five_left = five_cap = 0.0
    for a in codex["accounts"]:
        weight = plan_weight(a["plan"]) * 100
        weekly = next((w for w in a["windows"] if (w["durationMins"] or 0) >= 1440), None)
        five = next((w for w in a["windows"] if 0 < (w["durationMins"] or 0) < 1440), None)
        cap += weight
        week_left += weight * (1 - (weekly["usedPercent"] if weekly else 0) / 100)
        if five:
            five_cap += weight
            five_left += weight * (1 - five["usedPercent"] / 100)
    return {"weekLeft": round(week_left), "weekCap": round(cap), "fiveLeft": round(five_left), "fiveCap": round(five_cap)}


def spend(summary):
    by_day = defaultdict(lambda: defaultdict(lambda: [0.0, 0]))
    for b in summary.get("buckets") or []:
        day, provider = b.get("day"), b.get("provider")
        if not day or not provider:
            continue
        cell = by_day[day][provider]
        cell[0] += float(b.get("costUsd") or 0)
        cell[1] += int(sum((b.get("totals") or {}).values()))
    return {day: {p: [round(v[0], 4), v[1]] for p, v in provs.items()} for day, provs in sorted(by_day.items())}


def database(env_id):
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10)
    try:
        projects = []
        index = {}
        for pid, title, root in conn.execute(
                "SELECT project_id, title, workspace_root FROM projection_projects WHERE deleted_at IS NULL"):
            index[pid] = len(projects)
            projects.append({"title": str(title or "")[:60], "root": str(root or "")[:260]})
        since = (datetime.now(timezone.utc) - timedelta(days=ACTIVITY_DAYS + 1)).strftime("%Y-%m-%dT%H:%M:%S")
        cells = defaultdict(lambda: [0, 0])  # (day, projectIndex) -> [threads, runs]
        thread_project = {}
        for tid, pid, created in conn.execute(
                "SELECT thread_id, project_id, created_at FROM orchestration_v2_projection_threads WHERE deleted_at IS NULL"):
            thread_project[tid] = pid
            if created and created >= since and pid in index:
                day = local_day(created)
                if day:
                    cells[(day, index[pid])][0] += 1
        for tid, requested in conn.execute(
                "SELECT thread_id, requested_at FROM orchestration_v2_projection_runs WHERE requested_at >= ?", (since,)):
            pid = thread_project.get(tid)
            day = local_day(requested)
            if pid in index and day:
                cells[(day, index[pid])][1] += 1
        days = defaultdict(list)
        for (day, pi), (threads, runs) in sorted(cells.items()):
            days[day].append([pi, threads, runs])
        automations = []
        for title, enabled, pid, thread_id, next_run, last_run, status, runs in conn.execute(
                "SELECT title, enabled, project_id, thread_id, next_run_at, last_run_at, last_run_status, run_count "
                "FROM scheduled_tasks WHERE enabled = 1 ORDER BY next_run_at IS NULL, next_run_at LIMIT 60"):
            automations.append({
                "title": str(title or "")[:80],
                "project": index.get(pid),
                "threadKey": f"{env_id}:{thread_id}" if env_id and thread_id else None,
                "nextRunAt": next_run, "lastRunAt": last_run,
                "lastStatus": str(status or "")[:20], "runCount": int(runs or 0),
            })
        return projects, dict(days), automations
    finally:
        conn.close()


def limits_api(path):
    import urllib.parse
    import urllib.request
    if not LIMITS_API:
        raise RuntimeError("no limits service configured")
    request = urllib.request.Request(LIMITS_API + path, headers={"Host": urllib.parse.urlsplit(LIMITS_API).netloc})
    with urllib.request.urlopen(request, timeout=10) as r:
        return json.load(r)


def codex_series():
    """The recorded Codex pool (what is left of every account's week, in Plus weeks) for the
    last SERIES_DAYS, from the optional limits service's history. No identities
    leave this function: account names only map to plan weights."""
    try:
        history, overview = limits_api("/history"), limits_api("/overview")
    except Exception:
        return None
    weights = {a.get("name"): plan_weight(a.get("plan")) * 100 for a in overview.get("accounts") or [] if a.get("name")}
    names = history.get("names") or []
    cutoff = time.time() - SERIES_DAYS * 86400
    last_week = [None] * len(names)
    last_five = [None] * len(names)
    points, bucket = [], None
    for sample in history.get("samples") or []:
        t = sample.get("t")
        if not isinstance(t, int):
            continue
        for i, v in enumerate(sample.get("weekly") or []):
            if v is not None and i < len(names):
                last_week[i] = v
        for i, v in enumerate(sample.get("five_hour") or []):
            if v is not None and i < len(names):
                last_five[i] = v
        if t < cutoff:
            continue
        cap = left = five_cap = five_left = 0.0
        for i, name in enumerate(names):
            w = weights.get(name)
            if w is None:  # an account that is gone (removed or disabled)
                continue
            cap += w
            left += w * (1 - (last_week[i] or 0) / 100)
            if last_five[i] is not None:
                five_cap += w
                five_left += w * (1 - last_five[i] / 100)
        b = t // SERIES_STEP
        point = [t, round(left), round(cap), round(five_left), round(five_cap)]
        if b == bucket:
            points[-1] = point
        else:
            points.append(point)
            bucket = b
    return points


def claude_series(history, claude):
    """The recorded Claude pool (weekly windows; Pro 100%, Max 500%) from this script's own samples."""
    weights = {c["id"]: claude_weight(c.get("plan")) * 100 for c in claude}
    points = []
    for h in history:
        used = h.get("claudeWeekUsed")
        if not used:
            continue
        t = int(datetime.fromisoformat(h["t"]).timestamp())
        cap = sum(weights.get(k, 100) for k in used)
        left = sum(weights.get(k, 100) * (1 - v / 100) for k, v in used.items())
        points.append([t, round(left), cap])
    return points


def ai_activity():
    """{day: [total tokens, {provider: tokens}]}, from a local copy younger than
    ACTIVITY_MAX_AGE, else from the site (the old copy is kept if that fails)."""
    try:
        cached = json.loads(ACTIVITY_CACHE.read_text(encoding="utf-8"))
        fresh = time.time() - ACTIVITY_CACHE.stat().st_mtime < ACTIVITY_MAX_AGE
    except (OSError, ValueError):
        cached, fresh = None, False
    if fresh and cached:
        return cached
    live = fetch_ai_activity()
    if live:
        ACTIVITY_CACHE.parent.mkdir(parents=True, exist_ok=True)
        ACTIVITY_CACHE.write_text(json.dumps(live), encoding="utf-8")
        return live
    return cached


def fetch_ai_activity():
    """{day: [total tokens, {provider: tokens}]} from the optional activity source."""
    import urllib.request
    if not AI_ACTIVITY:
        return None
    try:
        request = urllib.request.Request(AI_ACTIVITY, headers={"User-Agent": "t3plus-home-feed"})
        with urllib.request.urlopen(request, timeout=20) as r:
            data = json.load(r)
    except Exception:
        return None
    out = {}
    for d in data.get("days") or []:
        day, tokens = d.get("date"), d.get("totalTokens")
        try:
            total = int(tokens)
        except (TypeError, ValueError):
            continue
        providers = {}
        for name, value in (d.get("providers") or {}).items():
            try:
                n = int((value or {}).get("tokens") or 0)
            except (TypeError, ValueError, AttributeError):
                n = 0
            if n > 0:
                providers[str(name)[:24]] = n
        out[str(day)[:10]] = [total, providers]
    return out


def update_history(pool, claude, now_iso):
    try:
        history = json.loads(HISTORY.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        history = []
    cutoff = (datetime.now(timezone.utc) - timedelta(days=HISTORY_DAYS)).isoformat()
    entry = {"t": now_iso}
    if pool:
        entry.update(pool)
    for c in claude:
        weekly = next((w for w in c["windows"] if (w["durationMins"] or 0) >= 1440), None)
        if weekly:
            entry.setdefault("claudeWeekUsed", {})[c["id"]] = weekly["usedPercent"]
    history = [h for h in history if h.get("t", "") >= cutoff] + [entry]
    HISTORY.parent.mkdir(parents=True, exist_ok=True)
    HISTORY.write_text(json.dumps(history), encoding="utf-8")
    # At most one point per 10 minutes in the published copy keeps it small.
    thinned, last = [], None
    for h in history:
        t = datetime.fromisoformat(h["t"])
        if last is None or (t - last).total_seconds() >= 600 or h is history[-1]:
            thinned.append(h)
            last = t
    return thinned


def write_atomic(path, data):
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".t3plus-home-", suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--print", action="store_true")
    args = parser.parse_args()
    try:
        env_id = (USERDATA / "environment-id").read_text(encoding="utf-8").strip()
    except OSError:
        env_id = None
    projects, activity, automations = database(env_id)
    session = issue_session()
    try:
        summary, providers, sources = read_t3(session["token"])
    finally:
        revoke_session(session)
    lim = limits(providers, sources)
    pool = codex_pool(lim["codex"])
    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
    history = update_history(pool, lim["claude"], now_iso)
    data = {
        "version": 1,
        "generatedAt": now_iso.replace("+00:00", "Z"),
        "timeZone": TIME_ZONE,
        "projects": projects,
        "activity": activity,
        "spend": spend(summary),
        "limits": {**lim, "pool": pool},
        "limitHistory": history,
        "codexSeries": codex_series(),
        "claudeSeries": claude_series(history, lim["claude"]),
        "aiActivity": ai_activity(),
        "automations": automations,
    }
    if args.print:
        print(json.dumps(data, ensure_ascii=False)[:4000])
        return 0
    write_atomic(OUT, data)
    return 0


if __name__ == "__main__":
    sys.exit(main())
