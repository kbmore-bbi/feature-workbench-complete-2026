#!/usr/bin/env python3
"""Render the SPCS service spec template using environment variables."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from string import Template


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    template = Template(Path(args.template).read_text(encoding="utf-8"))
    rendered = template.safe_substitute(os.environ)
    Path(args.output).write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

