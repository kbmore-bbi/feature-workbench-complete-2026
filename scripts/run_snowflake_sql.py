#!/usr/bin/env python3
"""Execute SQL against Snowflake using environment-provided credentials."""

from __future__ import annotations

import argparse
import os
import sys

import snowflake.connector


def connect():
    return snowflake.connector.connect(
        account=os.environ["SNOWFLAKE_ACCOUNT"],
        user=os.environ["SNOWFLAKE_USER"],
        password=os.environ["SNOWFLAKE_PASSWORD"],
        warehouse=os.environ["SNOWFLAKE_WAREHOUSE"],
        database=os.environ["SNOWFLAKE_DATABASE"],
        schema=os.environ["SNOWFLAKE_SCHEMA"],
        role=os.environ["SNOWFLAKE_ROLE"],
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", required=True)
    parser.add_argument("--format", choices=["plain", "tsv"], default="plain")
    args = parser.parse_args()

    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(args.query)
            if cursor.description is None:
                return 0

            rows = cursor.fetchall()
            if args.format == "tsv":
                for row in rows:
                    print("\t".join("" if value is None else str(value) for value in row))
            else:
                for row in rows:
                    print(" | ".join("" if value is None else str(value) for value in row))

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover
        print(str(exc), file=sys.stderr)
        raise

