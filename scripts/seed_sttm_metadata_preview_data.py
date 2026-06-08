#!/usr/bin/env python3
"""Seed minimal STTM metadata rows so SQL preview validation has real sample data."""

from __future__ import annotations

import os

import snowflake.connector


DB = "FFP_HDP_CRM_MIG_DB_DEV"
SCHEMA = "SCH_STTM_METADATA"
PROJECT_NAME = "STTM Preview Demo"
PROJECT_DESCRIPTION = "Seeded demo project for local SQL preview validation."
ADMIN_USER_ID = "1"


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


def q(name: str) -> str:
    return f"{DB}.{SCHEMA}.{name}"


def fetch_one(cursor, sql: str, params=None):
    cursor.execute(sql, params or ())
    return cursor.fetchone()


def main() -> int:
    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                MERGE INTO {q('TBL_PROJECTS')} AS target
                USING (
                  SELECT %s AS PROJECT_NAME, %s AS DESCRIPTION, %s AS CREATED_BY
                ) AS source
                ON target.PROJECT_NAME = source.PROJECT_NAME
                WHEN MATCHED THEN UPDATE SET
                  DESCRIPTION = source.DESCRIPTION,
                  STATUS = 'ACTIVE',
                  CREATED_BY = source.CREATED_BY,
                  LAST_MODIFIED_DATETIME = CURRENT_TIMESTAMP()
                WHEN NOT MATCHED THEN INSERT (
                  PROJECT_NAME, DESCRIPTION, STATUS, CREATED_BY
                ) VALUES (
                  source.PROJECT_NAME, source.DESCRIPTION, 'ACTIVE', source.CREATED_BY
                )
                """,
                (PROJECT_NAME, PROJECT_DESCRIPTION, ADMIN_USER_ID),
            )

            project_row = fetch_one(
                cursor,
                f"SELECT PROJECT_ID FROM {q('TBL_PROJECTS')} WHERE PROJECT_NAME = %s",
                (PROJECT_NAME,),
            )
            if not project_row:
                raise RuntimeError("Unable to locate seeded project row.")
            project_id = int(project_row[0])

            cursor.execute(
                f"DELETE FROM {q('TBL_STTM_ATTRIBUTES')} WHERE STTM_ID IN (SELECT STTM_ID FROM {q('TBL_STTM')} WHERE PROJECT_ID = %s)",
                (project_id,),
            )
            cursor.execute(
                f"DELETE FROM {q('TBL_STTM_SOURCES')} WHERE STTM_ID IN (SELECT STTM_ID FROM {q('TBL_STTM')} WHERE PROJECT_ID = %s)",
                (project_id,),
            )
            cursor.execute(f"DELETE FROM {q('TBL_STTM')} WHERE PROJECT_ID = %s", (project_id,))

            cursor.execute(
                f"""
                INSERT INTO {q('TBL_STTM')} (
                  PROJECT_ID,
                  CURRENT_VERSION,
                  HAS_UNPUBLISHED_DRAFT,
                  STATUS,
                  LAST_MODIFIED_BY
                )
                SELECT %s, COLUMN1, FALSE, COLUMN2, %s
                FROM VALUES
                  (1, 'IN_PROGRESS'),
                  (2, 'DRAFT')
                """,
                (project_id, ADMIN_USER_ID),
            )

            cursor.execute(
                f"""
                SELECT STTM_ID
                FROM {q('TBL_STTM')}
                WHERE PROJECT_ID = %s
                ORDER BY STTM_ID
                """,
                (project_id,),
            )
            sttm_ids = [int(row[0]) for row in cursor.fetchall()]
            if len(sttm_ids) < 2:
                raise RuntimeError("Unable to seed STTM rows.")

            source_ids_by_sttm: dict[int, list[int]] = {}
            for sttm_id in sttm_ids:
                cursor.execute(
                    f"""
                    INSERT INTO {q('TBL_STTM_SOURCES')} (
                      STTM_ID,
                      SOURCE_NAME,
                      DATABASE_NAME,
                      SCHEMA_NAME,
                      TABLE_NAME,
                      DESCRIPTION,
                      LAST_MODIFIED_BY
                    )
                    SELECT %s, COLUMN1, COLUMN2, COLUMN3, COLUMN4, COLUMN5, %s
                    FROM VALUES
                      ('sttm_header', '{DB}', '{SCHEMA}', 'TBL_STTM', 'Header-level STTM metadata'),
                      ('sttm_attribute', '{DB}', '{SCHEMA}', 'TBL_STTM_ATTRIBUTES', 'Attribute-level STTM metadata')
                    """,
                    (sttm_id, ADMIN_USER_ID),
                )
                cursor.execute(
                    f"""
                    SELECT SOURCE_ID
                    FROM {q('TBL_STTM_SOURCES')}
                    WHERE STTM_ID = %s
                    ORDER BY SOURCE_ID
                    """,
                    (sttm_id,),
                )
                source_ids_by_sttm[sttm_id] = [int(row[0]) for row in cursor.fetchall()]

            attribute_rows = [
                ("STTM_ID", "RAW", "STTM_ID", "NUMBER", "Identifier for the STTM record"),
                ("PROJECT_ID", "RAW", "PROJECT_ID", "NUMBER", "Project owning the STTM"),
                ("CURRENT_VERSION", "RAW", "CURRENT_VERSION", "NUMBER", "Current published version"),
                ("HAS_UNPUBLISHED_DRAFT", "RAW", "HAS_UNPUBLISHED_DRAFT", "BOOLEAN", "Whether there is an unpublished draft"),
                ("STATUS", "RAW", "STATUS", "VARCHAR", "Lifecycle status of the STTM"),
                ("LAST_MODIFIED_BY", "RAW", "LAST_MODIFIED_BY", "NUMBER", "User who last changed the STTM"),
                ("CREATED_DATETIME", "RAW", "CREATED_DATETIME", "TIMESTAMP_NTZ", "Creation timestamp"),
                ("LAST_MODIFIED_DATETIME", "RAW", "LAST_MODIFIED_DATETIME", "TIMESTAMP_NTZ", "Last update timestamp"),
            ]

            for sttm_id in sttm_ids:
                source_id = source_ids_by_sttm[sttm_id][0]
                cursor.executemany(
                    f"""
                    INSERT INTO {q('TBL_STTM_ATTRIBUTES')} (
                      STTM_ID,
                      SOURCE_ID,
                      ATTRIBUTE_NAME,
                      ATTRIBUTE_TYPE,
                      SOURCE_COLUMN,
                      DATA_TYPE,
                      DESCRIPTION,
                      IS_NULLABLE,
                      LAST_MODIFIED_BY
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE, %s)
                    """,
                    [
                        (
                            sttm_id,
                            source_id,
                            attribute_name,
                            attribute_type,
                            source_column,
                            data_type,
                            description,
                            ADMIN_USER_ID,
                        )
                        for attribute_name, attribute_type, source_column, data_type, description in attribute_rows
                    ],
                )

            connection.commit()
            print(f"Seeded preview metadata for project {project_id} with STTM rows: {', '.join(map(str, sttm_ids))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
