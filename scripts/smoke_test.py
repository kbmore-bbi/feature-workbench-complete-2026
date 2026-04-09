#!/usr/bin/env python3
"""Run a simple HTTP smoke test against a deployed endpoint."""

from __future__ import annotations

import argparse
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--attempts", type=int, default=10)
    parser.add_argument("--delay", type=float, default=5.0)
    args = parser.parse_args()

    request = Request(args.url, headers={"User-Agent": "ai-workbench-smoke-test"})
    last_error: str | None = None

    for _ in range(args.attempts):
        try:
            with urlopen(request, timeout=10) as response:
                if 200 <= response.status < 400:
                    print(f"Smoke test passed: {args.url}")
                    return 0
                last_error = f"Unexpected status: {response.status}"
        except HTTPError as exc:
            last_error = f"HTTP error: {exc.code}"
        except URLError as exc:
            last_error = f"URL error: {exc.reason}"
        time.sleep(args.delay)

    print(last_error or "Smoke test failed", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
