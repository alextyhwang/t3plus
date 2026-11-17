"""Publish a bounded, read-only Immich summary for the private t3+ widget.

The API key is read only by this server-side publisher. The feed carries asset
ids, capture dates and the service status; the extension builds every
thumbnail and library URL itself (src/immich.js, from src/personal.js IMMICH).
It never receives the key or a query-string key. Configure immichUrl and
immichApiKey in untracked ``server/config.local.json`` or their environment
variables; without them this publisher is off (publish_all.py skips it).
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone

import feedconfig

OUT = feedconfig.FEED_DIR / "t3plus-immich.json"
MAX_PHOTOS = 4
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)


def _url(value):
    value = str(value or "").strip().rstrip("/")
    return value if value.startswith("https://") and "?" not in value and "#" not in value else ""


def _request(url, key, method="GET", payload=None, timeout=15):
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(url, data=data, method=method, headers={"Accept": "application/json", "Content-Type": "application/json", "x-api-key": key})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.status, response.read()


def _date(asset):
    for name in ("fileCreatedAt", "localDateTime", "createdAt", "uploadedAt"):
        if isinstance(asset.get(name), str) and asset[name].strip():
            return asset[name][:80]
    return None


def _status(url, key):
    result = {"state": "online", "observedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}
    if not url:
        return result
    try:
        _, body = _request(url, key, timeout=8)
        value = json.loads(body)
        if isinstance(value, dict):
            for field in ("state", "detail", "version", "uptimeSeconds", "uptimeSource", "serviceStartedAt", "hostStartedAt", "observedAt"):
                if field in value:
                    result[field] = value[field]
    except Exception:
        result.update({"state": "degraded", "detail": "Status metrics unavailable"})
    return result


def _settings():
    return _url(feedconfig.IMMICH_URL), str(feedconfig.IMMICH_API_KEY or "").strip()


def configured():
    """True when both immichUrl and immichApiKey are set."""
    return all(_settings())


def publish():
    api, key = _settings()
    if not api or not key:
        return False
    generated = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        _, version_body = _request(f"{api}/api/server/version", key)
        version = json.loads(version_body)
        _, body = _request(f"{api}/api/search/metadata", key, "POST", {"page": 1, "size": MAX_PHOTOS, "order": "desc", "withExif": False, "withDeleted": False, "visibility": "timeline"}, 20)
        result = json.loads(body)
        assets = ((result.get("assets") or {}).get("items") or []) if isinstance(result, dict) else []
        photos = []
        for asset in assets[:MAX_PHOTOS]:
            asset_id = asset.get("id") if isinstance(asset, dict) else None
            if not isinstance(asset_id, str) or not UUID.fullmatch(asset_id):
                continue
            photos.append({"id": asset_id, "fileCreatedAt": _date(asset)})
        status = _status(_url(feedconfig.IMMICH_STATUS_URL), key)
        if isinstance(version, dict) and version.get("version"):
            status["version"] = str(version["version"])[:40]
        payload = {"version": 1, "generatedAt": generated, "photos": photos, "status": status}
    except (OSError, ValueError, urllib.error.URLError):
        payload = {"version": 1, "generatedAt": generated, "photos": [], "status": {"state": "offline", "observedAt": generated, "detail": "Immich unavailable"}}
    feedconfig.FEED_DIR.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".t3plus-immich-", suffix=".json", dir=feedconfig.FEED_DIR)
    try:
        with open(fd, "w", encoding="utf-8") as output:
            json.dump(payload, output, separators=(",", ":"))
            output.write("\n")
        pathlib.Path(name).replace(OUT)
    finally:
        pathlib.Path(name).unlink(missing_ok=True)
    return True


def main():
    if not publish():
        print("publish_immich_feed: off (set immichUrl and immichApiKey in server/config.local.json)", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
