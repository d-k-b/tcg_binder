#!/usr/bin/env python3
"""Legacy entry point retained to refuse unattended browser-price scheduling.

Browser pricing is direct-user-action-only. Scheduled and bulk monitor work must
use PricingRestClient.price_product and must never enqueue browser jobs.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys


LABEL = "com.dkb.tcg-browser-market-refresh"
DEFAULT_RUNTIME = Path.home() / ".config/tcg-price-monitor/data/refresh_monitored_markets_runtime.py"
DEFAULT_LOG = Path.home() / ".config/tcg-price-monitor/logs/browser-market-refresh-worker.log"
DEFAULT_PLIST = Path.home() / "Library/LaunchAgents" / f"{LABEL}.plist"


def launch_agent(runtime: Path, log: Path, weekday: int, hour: int, minute: int) -> dict:
    raise RuntimeError("scheduled browser pricing is disabled; use headless Pricing REST for automation")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(__file__).with_name("refresh_monitored_markets.py"))
    parser.add_argument("--runtime", type=Path, default=DEFAULT_RUNTIME)
    parser.add_argument("--plist", type=Path, default=DEFAULT_PLIST)
    parser.add_argument("--weekday", type=int, default=0, help="launchd weekday: 0 Sunday through 6 Saturday")
    parser.add_argument("--hour", type=int, default=3)
    parser.add_argument("--minute", type=int, default=15)
    parser.add_argument("--install", action="store_true", help="bootstrap the user LaunchAgent after writing it")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    parse_args(argv or sys.argv[1:])
    raise SystemExit("scheduled browser pricing is disabled; invoke browser mode directly with --user-initiated")


if __name__ == "__main__":
    raise SystemExit(main())
