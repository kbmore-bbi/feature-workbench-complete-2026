#!/usr/bin/env python3
"""Upload a local file to a Snowflake internal stage."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

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
    parser.add_argument("--stage", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--dest-filename", required=True)
    args = parser.parse_args()

    source = Path(args.source).resolve()
    if not source.exists():
        raise FileNotFoundError(source)

    put_sql = (
        f"PUT 'file://{source}' @{args.stage}/{args.dest_filename} "
        "AUTO_COMPRESS=FALSE OVERWRITE=TRUE"
    )

    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(put_sql)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
