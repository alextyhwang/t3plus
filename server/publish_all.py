"""Runs the t3+ feed publishers (bots, home, Immich) in one Python process.

The scheduled task calls this every 2 minutes. One interpreter start (no
PowerShell wrapper, no second Python) keeps each run cheap. A failure in one
publisher does not stop the others. The Immich publisher runs only once it is
configured, so an unconfigured host does not fail every run.
"""
import sys
import traceback

import publish_bot_feed
import publish_home
import publish_immich_feed


def main() -> int:
    status = 0
    publishers = [publish_bot_feed, publish_home] + ([publish_immich_feed] if publish_immich_feed.configured() else [])
    for publisher in publishers:
        saved = sys.argv
        sys.argv = [publisher.__file__]  # each parses its own (empty) arguments
        try:
            status |= publisher.main() or 0
        except Exception:
            traceback.print_exc()
            status = 1
        finally:
            sys.argv = saved
    return status


if __name__ == "__main__":
    sys.exit(main())
