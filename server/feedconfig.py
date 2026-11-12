"""Settings shared by the t3+ feed publishers.

Each value comes from an environment variable, else from the untracked
server/config.local.json next to this file, else a default:

    T3_HOME              t3Home       T3's data folder (default ~/.t3)
    T3PLUS_FEED_DIR      feedDir      where the JSON feeds are written
                                      (default <T3_HOME>/userdata/tailnet-files)
    T3_CLI               t3Cli        the `t3` CLI (default: `t3` on PATH)
    T3PLUS_TIME_ZONE     timeZone     IANA zone for daily usage (default UTC)
    T3PLUS_LIMITS_API    limitsApi    optional: a limits-history service for the
                                      Codex pool line (off when unset)
    T3PLUS_ACTIVITY_URL  activityUrl  optional: a tokens-per-day JSON source for
                                      the Activity card (off when unset)
"""
import json
import os
import pathlib
import shutil


def _local():
    try:
        return json.loads(pathlib.Path(__file__).with_name("config.local.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


LOCAL = _local()


def setting(key, env, default=None):
    return os.environ.get(env) or LOCAL.get(key) or default


T3_HOME = pathlib.Path(setting("t3Home", "T3_HOME", pathlib.Path.home() / ".t3"))
USERDATA = T3_HOME / "userdata"
FEED_DIR = pathlib.Path(setting("feedDir", "T3PLUS_FEED_DIR", USERDATA / "tailnet-files"))
T3_CLI = setting("t3Cli", "T3_CLI", shutil.which("t3") or "t3")
TIME_ZONE = setting("timeZone", "T3PLUS_TIME_ZONE", "UTC")
LIMITS_API = setting("limitsApi", "T3PLUS_LIMITS_API")
ACTIVITY_URL = setting("activityUrl", "T3PLUS_ACTIVITY_URL")
