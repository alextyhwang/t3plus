"""Runs both t3+ feed publishers in one Python process.

The scheduled task calls this every 2 minutes. One interpreter start (no
PowerShell wrapper, no second Python) keeps each run cheap. A failure in one
publisher does not stop the other.
"""
import sys
import traceback

import publish_bot_feed
import publish_home


def main() -> int:
    status = 0
    for publisher in (publish_bot_feed, publish_home):
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
