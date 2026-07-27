import json
import hashlib
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from typing import Callable, TypeVar

from snowflake.snowpark.functions import col

from app.core.config import Settings
from app.core.exceptions import SnowflakeQueryError
from app.core.snowflake import SnowflakeClient
from app.core.semantic_knowledge_resolver import SemanticKnowledgeResolver
from app.schema.common import TableRef

logger = logging.getLogger(__name__)
from app.schema.table_selection import (
    ColumnItem,
    DatabaseItem,
    RelationshipColumnMapping,
    RelationshipItem,
    SchemaItem,
    TableAttributes,
    TableItem,
)

_T = TypeVar("_T")
_CACHE_TTL_SECONDS = 300.0
_CACHE_LOCK = Lock()
_CACHE: dict[str, tuple[float, object]] = {}
_CACHE_INFLIGHT: dict[str, threading.Event] = {}


def _cached(key: str, loader: Callable[[], _T], *, ttl_seconds: float = _CACHE_TTL_SECONDS) -> _T:
    now = time.monotonic()
    with _CACHE_LOCK:
        cached = _CACHE.get(key)
        if cached and cached[0] > now:
            return cached[1]  # type: ignore[return-value]
        event = _CACHE_INFLIGHT.get(key)
        if event is None:
            event = threading.Event()
            _CACHE_INFLIGHT[key] = event
            owner = True
        else:
            owner = False
    if not owner:
        event.wait(timeout=120)
        with _CACHE_LOCK:
            cached = _CACHE.get(key)
            if cached and cached[0] > time.monotonic():
                return cached[1]  # type: ignore[return-value]
    try:
        value = loader()
        with _CACHE_LOCK:
            _CACHE[key] = (time.monotonic() + ttl_seconds, value)
        return value
    finally:
        if owner:
            with _CACHE_LOCK:
                completed = _CACHE_INFLIGHT.pop(key, None)
                if completed is not None:
                    completed.set()


class TableSelectionService:
    def __init__(self, client: SnowflakeClient, settings: Settings, access_scope: str = "default") -> None:
        self._session = client.session
        self._settings = settings
        self._semantic_knowledge = SemanticKnowledgeResolver(settings)
        effective_scope = access_scope if access_scope != "default" else f"session:{id(client.session)}"
        self._cache_prefix = hashlib.sha256(effective_scope.encode("utf-8")).hexdigest()

    def _cache_key(self, value: str) -> str:
        return f"{self._cache_prefix}:{value}"

    @staticmethod
    def _quote_identifier(identifier: str) -> str:
        return '"' + identifier.replace('"', '""') + '"'

    @staticmethod
    def _quote_literal(value: str) -> str:
        return "'" + value.replace("'", "''") + "'"

    @staticmethod
    def _row_value(row, *names: str):
        values = row.as_dict() if hasattr(row, "as_dict") else dict(row)
        for name in names:
            for candidate in (name, name.upper(), name.lower()):
                if candidate in values:
                    return values[candidate]
        return None

    def list_databases(self) -> list[DatabaseItem]:
        return _cached(self._cache_key("databases"), self._list_databases_uncached)

    def _list_databases_uncached(self) -> list[DatabaseItem]:
        try:
            db_rows = self._session.sql("SHOW TERSE DATABASES").collect()
        except Exception as e:
            raise SnowflakeQueryError(f"Failed to list databases: {e}") from e

        result = []
        for row in db_rows:
            db_name = self._row_value(row, "name", "database_name")
            if not db_name:
                continue
            result.append(
                DatabaseItem(
                    database_name=str(db_name),
                    created=self._row_value(row, "created_on", "created"),
                    schemas=[],
                )
            )
        return sorted(result, key=lambda item: item.database_name)

    def list_schemas(self, db_name: str) -> list[SchemaItem]:
        return _cached(self._cache_key(f"schemas:{db_name.upper()}"), lambda: self._list_schemas_uncached(db_name))

    def _list_schemas_uncached(self, db_name: str) -> list[SchemaItem]:
        try:
            rows = self._session.sql(
                "SHOW TERSE SCHEMAS IN DATABASE "
                f"{self._quote_identifier(db_name)}"
            ).collect()
        except Exception as e:
            raise SnowflakeQueryError(
                f"Failed to list schemas in {db_name!r}: {e}"
            ) from e

        schemas = []
        for row in rows:
            schema_name = self._row_value(row, "name", "schema_name")
            if not schema_name:
                continue
            schemas.append(
                SchemaItem(
                    schema_name=str(schema_name),
                    created=self._row_value(row, "created_on", "created"),
                )
            )
        return sorted(schemas, key=lambda item: item.schema_name)

    def list_tables(self, db_name: str, schema_name: str) -> list[TableItem]:
        return _cached(
            self._cache_key(f"tables:{db_name.upper()}.{schema_name.upper()}"),
            lambda: self._list_tables_uncached(db_name, schema_name),
        )

    def _list_tables_uncached(self, db_name: str, schema_name: str) -> list[TableItem]:
        try:
            table_rows = self._session.sql(
                "SHOW TABLES IN SCHEMA "
                f"{self._quote_identifier(db_name)}.{self._quote_identifier(schema_name)}"
            ).collect()
        except Exception as e:
            raise SnowflakeQueryError(
                f"Failed to list tables in {db_name!r}.{schema_name!r}: {e}"
            ) from e

        result: list[TableItem] = []
        for row in table_rows:
            table_name = self._row_value(row, "name", "table_name")
            if not table_name:
                continue
            name = str(table_name)
            row_count = self._row_value(row, "rows", "row_count")
            result.append(
                TableItem(
                    table_name=name,
                    row_count=int(row_count) if row_count is not None else None,
                    # Schema browsing must stay cheap. Column metadata is
                    # hydrated only after a table is selected, where it can be
                    # requested in one set-based call for the active selection.
                    column_count=0,
                )
            )

        return sorted(result, key=lambda item: item.table_name)

    def list_attributes_for_tables(self, qualified_names: list[str]) -> list[TableAttributes]:
        key = "attributes:" + "|".join(sorted(qn.upper() for qn in qualified_names))
        return _cached(self._cache_key(key), lambda: self._list_attributes_for_tables_uncached(qualified_names))

    def _list_attributes_for_tables_uncached(self, qualified_names: list[str]) -> list[TableAttributes]:
        from app.core.exceptions import AppValidationError

        parsed: list[tuple[str, str, str]] = []
        for qn in qualified_names:
            parts = qn.split(".", 2)
            if len(parts) != 3:
                raise AppValidationError(
                    f"Invalid table reference {qn!r}. Expected format: DATABASE.SCHEMA.TABLE"
                )
            parsed.append((parts[0], parts[1], parts[2]))

        by_database: dict[str, list[tuple[str, str]]] = {}
        for db, schema, table in parsed:
            by_database.setdefault(db, []).append((schema, table))

        columns_by_fqn: dict[str, list[ColumnItem]] = {}
        for database, tables in by_database.items():
            columns_by_fqn.update(self._bulk_columns(database, tables))

        return [
            TableAttributes(
                table=TableRef(database=db, schema=schema, table=table),
                columns=columns_by_fqn.get(f"{db}.{schema}.{table}".upper(), []),
            )
            for db, schema, table in parsed
        ]

    def _bulk_columns(
        self,
        database: str,
        tables: list[tuple[str, str]],
    ) -> dict[str, list[ColumnItem]]:
        """Load columns and key flags with two concurrent set-based queries."""
        if not tables:
            return {}
        pair_predicate = " OR ".join(
            "(UPPER(TABLE_SCHEMA) = "
            f"{self._quote_literal(schema.upper())} AND UPPER(TABLE_NAME) = "
            f"{self._quote_literal(table.upper())})"
            for schema, table in sorted(set(tables))
        )
        information_schema = (
            f"{self._quote_identifier(database)}.INFORMATION_SCHEMA"
        )
        column_query = self._session.sql(
            f"""
            SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE,
                   IS_NULLABLE, ORDINAL_POSITION, COMMENT
            FROM {information_schema}.COLUMNS
            WHERE {pair_predicate}
            ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
            """
        )
        key_query = self._session.sql(
            f"""
            SELECT k.TABLE_SCHEMA, k.TABLE_NAME, k.COLUMN_NAME,
                   c.CONSTRAINT_TYPE
            FROM {information_schema}.KEY_COLUMN_USAGE k
            JOIN {information_schema}.TABLE_CONSTRAINTS c
              ON c.CONSTRAINT_CATALOG = k.CONSTRAINT_CATALOG
             AND c.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
             AND c.CONSTRAINT_NAME = k.CONSTRAINT_NAME
            WHERE {pair_predicate.replace('TABLE_SCHEMA', 'k.TABLE_SCHEMA').replace('TABLE_NAME', 'k.TABLE_NAME')}
            """
        )
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="sttm-metadata") as executor:
            column_future = executor.submit(column_query.collect)
            key_future = executor.submit(key_query.collect)
            try:
                column_rows = column_future.result()
            except Exception as exc:
                raise SnowflakeQueryError(
                    f"Failed to list columns for {len(tables)} tables in {database!r}: {exc}"
                ) from exc
            try:
                key_rows = key_future.result()
            except Exception:
                key_rows = []
                # Key metadata can be restricted independently of column metadata.
                # Columns remain authoritative and usable without key decorations.
                logger.info("Bulk key metadata unavailable for %s", database, exc_info=True)

        key_types: dict[tuple[str, str], set[str]] = {}
        if key_rows:
            for row in key_rows:
                schema = str(self._row_value(row, "TABLE_SCHEMA") or "").upper()
                table = str(self._row_value(row, "TABLE_NAME") or "").upper()
                column = str(self._row_value(row, "COLUMN_NAME") or "").upper()
                constraint_type = str(
                    self._row_value(row, "CONSTRAINT_TYPE") or ""
                ).upper()
                key_types.setdefault((f"{database}.{schema}.{table}".upper(), column), set()).add(
                    constraint_type
                )

        result: dict[str, list[ColumnItem]] = {}
        for row in column_rows:
            schema = str(self._row_value(row, "TABLE_SCHEMA") or "")
            table = str(self._row_value(row, "TABLE_NAME") or "")
            column = str(self._row_value(row, "COLUMN_NAME") or "")
            fqn = f"{database}.{schema}.{table}".upper()
            constraints = key_types.get((fqn, column.upper()), set())
            result.setdefault(fqn, []).append(
                ColumnItem(
                    column_name=column,
                    data_type=str(self._row_value(row, "DATA_TYPE") or ""),
                    is_nullable=str(self._row_value(row, "IS_NULLABLE") or ""),
                    ordinal_position=int(self._row_value(row, "ORDINAL_POSITION") or 0),
                    comment=self._row_value(row, "COMMENT"),
                    is_primary_key="PRIMARY KEY" in constraints,
                    is_foreign_key="FOREIGN KEY" in constraints,
                )
            )
        return result

    def list_relationships_for_tables(self, tables: list[TableRef]) -> list[RelationshipItem]:
        key = "relationships:" + "|".join(sorted(table.qualified_name.upper() for table in tables))
        return _cached(self._cache_key(key), lambda: self._list_relationships_for_tables_uncached(tables))

    def _list_relationships_for_tables_uncached(self, tables: list[TableRef]) -> list[RelationshipItem]:
        selected = {table.qualified_name.upper(): table for table in tables}
        relationships: dict[str, RelationshipItem] = {}
        logger.info("Relationship lookup for %d tables: %s", len(tables), list(selected.keys()))
        try:
            semantic_payloads = self._semantic_knowledge.relationship_payloads(
                self._session,
                tables,
            )
        except Exception:
            logger.warning("Unified semantic relationship resolution failed", exc_info=True)
            semantic_payloads = self._get_relationships_from_semantic_views(tables)

        for table in tables:
            payload = semantic_payloads.get(table.qualified_name.upper())
            logger.info("Semantic view for %s: %s", table.qualified_name, "found" if payload else "not found")
            if payload:
                logger.info("  outgoing=%d incoming=%d", len(payload.get("outgoing", [])), len(payload.get("incoming", [])))
            # The legacy relationship procedure is table-at-a-time. Keep it for
            # compact selections, but never fan it out across a large workspace.
            if not payload and len(tables) <= 3:
                try:
                    payload = self._get_relationship_payload(table)
                except Exception:
                    continue
                if str(payload.get("status", "")).upper() != "OK":
                    continue
            if not payload:
                continue

            # Process both outgoing and incoming relationships
            for direction in ["outgoing", "incoming"]:
                for item in payload.get(direction, []) or []:
                    # For outgoing: table is left, target is right
                    # For incoming: target is left, table is right
                    if direction == "outgoing":
                        left_table = table
                        right_table = TableRef(
                            database=table.database,
                            schema=str(item.get("schema", "")),
                            table=str(item.get("table", "")),
                        )
                        left_col_key, right_col_key = "fk_column", "pk_column"
                    else:
                        right_table = table
                        left_table = TableRef(
                            database=table.database,
                            schema=str(item.get("schema", "")),
                            table=str(item.get("table", "")),
                        )
                        left_col_key, right_col_key = "pk_column", "fk_column"

                    # Only include if both tables are selected
                    if left_table.qualified_name.upper() not in selected:
                        continue
                    if right_table.qualified_name.upper() not in selected:
                        continue

                    conditions = [
                        RelationshipColumnMapping(
                            left_column=str(mapping.get(left_col_key, "")),
                            right_column=str(mapping.get(right_col_key, "")),
                        )
                        for mapping in item.get("column_mappings", []) or []
                        if mapping.get(left_col_key) and mapping.get(right_col_key)
                    ]
                    if not conditions:
                        continue

                    constraint_name = (
                        str(item.get("constraint_name"))
                        if item.get("constraint_name") is not None
                        else None
                    )
                    edge_id = constraint_name or f"{left_table.qualified_name}->{right_table.qualified_name}"

                    # Don't overwrite existing relationships (dedup)
                    if edge_id not in relationships:
                        relationships[edge_id] = RelationshipItem(
                            id=edge_id,
                            left_table=left_table,
                            right_table=right_table,
                            constraint_name=constraint_name,
                            conditions=conditions,
                        )

        return list(relationships.values())

    def _get_relationships_from_semantic_views(
        self,
        tables: list[TableRef],
    ) -> dict[str, dict]:
        """Fetch relationship payloads for a selection in one registry query.

        Extracts FK references from two locations:
        1. SEMANTIC_VIEW:semantic_model:relationships (top-level, if present)
        2. SEMANTIC_VIEW:semantic_model:attributes[].constraints (FK refs in column metadata)
        """
        if not tables:
            return {}
        try:
            sem_table = self._settings.resolved_semantic_views_table
            fqns = ", ".join(
                self._quote_literal(table.qualified_name.upper())
                for table in tables
            )
            rows = self._session.sql(f"""
                SELECT FQN,
                       SEMANTIC_VIEW:semantic_model:relationships AS RELATIONSHIPS,
                       SEMANTIC_VIEW:semantic_model:attributes AS ATTRIBUTES
                FROM {sem_table}
                WHERE UPPER(FQN) IN ({fqns})
                  AND COALESCE(UPPER(STATUS), 'ACTIVE') IN ('ACTIVE', 'PENDING')
                QUALIFY ROW_NUMBER() OVER (
                    PARTITION BY UPPER(FQN)
                    ORDER BY GENERATED_AT DESC
                ) = 1
            """).collect()
        except Exception:
            logger.warning(
                "Bulk semantic relationship lookup failed at %s",
                self._settings.resolved_semantic_views_table,
                exc_info=True,
            )
            return {}

        table_by_fqn = {
            table.qualified_name.upper(): table
            for table in tables
        }
        result: dict[str, dict] = {}
        for row in rows:
            fqn = str(self._row_value(row, "FQN") or "").upper()
            table = table_by_fqn.get(fqn)
            if table is None:
                continue
            raw_rels = self._row_value(row, "RELATIONSHIPS")
            if raw_rels:
                if isinstance(raw_rels, str):
                    try:
                        raw_rels = json.loads(raw_rels)
                    except json.JSONDecodeError:
                        raw_rels = None
                if isinstance(raw_rels, dict) and (raw_rels.get("outgoing") or raw_rels.get("incoming")):
                    confirmed = {
                        direction: [
                            item
                            for item in (raw_rels.get(direction) or [])
                            if isinstance(item, dict)
                            and self._semantic_knowledge._relationship_is_confirmed(
                                item,
                                curated=False,
                            )
                        ]
                        for direction in ("outgoing", "incoming")
                    }
                    if confirmed["outgoing"] or confirmed["incoming"]:
                        result[fqn] = confirmed
                        continue

            # Extract FK relationships from attributes constraints
            raw_attrs = self._row_value(row, "ATTRIBUTES")
            if isinstance(raw_attrs, str):
                try:
                    raw_attrs = json.loads(raw_attrs)
                except json.JSONDecodeError:
                    raw_attrs = None
            if not isinstance(raw_attrs, list):
                continue

            outgoing = []
            for attr in raw_attrs:
                if not isinstance(attr, dict):
                    continue
                col_name = attr.get("name", "")
                for constraint in attr.get("constraints", []):
                    if not isinstance(constraint, dict):
                        continue
                    if constraint.get("type") != "FOREIGN_KEY":
                        continue
                    confidence = (constraint.get("confidence") or "LOW").upper()
                    if confidence != "HIGH":
                        continue
                    refs = constraint.get("references", {})
                    ref_table = refs.get("table", "")
                    ref_col = refs.get("column", "")
                    if not ref_table or not ref_col:
                        continue
                    outgoing.append({
                        "schema": table.schema,
                        "table": ref_table,
                        "constraint_name": f"FK_{col_name}_{ref_table}_{ref_col}",
                        "column_mappings": [
                            {"fk_column": col_name, "pk_column": ref_col}
                        ],
                    })

            if outgoing:
                result[fqn] = {
                    "status": "OK",
                    "outgoing": outgoing,
                    "incoming": [],
                }
        return result

    def _list_columns(self, db_name: str, schema_name: str, table_name: str) -> list[ColumnItem]:
        primary_key_columns = self._primary_key_columns(db_name, schema_name, table_name)
        foreign_key_columns = self._foreign_key_columns(db_name, schema_name, table_name)
        try:
            rows = (
                self._session.table(f"{db_name}.INFORMATION_SCHEMA.COLUMNS")
                .select(
                    "COLUMN_NAME",
                    "DATA_TYPE",
                    "IS_NULLABLE",
                    "ORDINAL_POSITION",
                    "COMMENT",
                )
                .filter(
                    (col("TABLE_SCHEMA") == schema_name.upper())
                    & (col("TABLE_NAME") == table_name.upper())
                )
                .sort("ORDINAL_POSITION")
                .collect()
            )
        except Exception as e:
            raise SnowflakeQueryError(
                f"Failed to list columns in {db_name!r}.{schema_name!r}.{table_name!r}: {e}"
            ) from e
        return [
            ColumnItem(
                column_name=r["COLUMN_NAME"],
                data_type=r["DATA_TYPE"],
                is_nullable=r["IS_NULLABLE"],
                ordinal_position=r["ORDINAL_POSITION"],
                comment=r["COMMENT"],
                is_primary_key=r["COLUMN_NAME"] in primary_key_columns,
                is_foreign_key=r["COLUMN_NAME"] in foreign_key_columns,
            )
            for r in rows
        ]

    def _primary_key_columns(
        self,
        db_name: str,
        schema_name: str,
        table_name: str,
    ) -> set[str]:
        try:
            rows = self._session.sql(
                "SHOW PRIMARY KEYS IN TABLE "
                f"{self._quote_identifier(db_name)}."
                f"{self._quote_identifier(schema_name)}."
                f"{self._quote_identifier(table_name)}"
            ).collect()
        except Exception:
            return set()

        return {
            str(column_name)
            for row in rows
            if (column_name := self._row_value(row, "column_name", "COLUMN_NAME"))
        }

    def _foreign_key_columns(
        self,
        db_name: str,
        schema_name: str,
        table_name: str,
    ) -> set[str]:
        try:
            rows = self._session.sql(
                "SHOW IMPORTED KEYS IN TABLE "
                f"{self._quote_identifier(db_name)}."
                f"{self._quote_identifier(schema_name)}."
                f"{self._quote_identifier(table_name)}"
            ).collect()
        except Exception:
            return set()

        return {
            str(column_name)
            for row in rows
            if (
                column_name := self._row_value(
                    row,
                    "fk_column_name",
                    "FK_COLUMN_NAME",
                    "column_name",
                    "COLUMN_NAME",
                )
            )
        }

    def _get_relationship_payload(self, table: TableRef) -> dict:
        proc_name = self._settings.resolved_relationships_procedure
        if not proc_name:
            raise SnowflakeQueryError(
                "Could not resolve the table relationship procedure. "
                "Set SNOWFLAKE_RELATIONSHIPS_PROCEDURE or provide "
                "SNOWFLAKE_DATABASE/SNOWFLAKE_SCHEMA."
            )

        proc_parts = proc_name.split(".", 2)
        quoted_proc_name = ".".join(
            self._quote_identifier(part) for part in proc_parts if part
        )
        try:
            rows = self._session.sql(
                "CALL "
                f"{quoted_proc_name}("
                f"{self._quote_literal(table.database)}, "
                f"{self._quote_literal(table.schema)}, "
                f"{self._quote_literal(table.table)})"
            ).collect()
        except Exception as e:
            raise SnowflakeQueryError(
                f"Failed to fetch table relationships for {table.qualified_name!r}: {e}"
            ) from e

        if not rows:
            return {}

        raw_result = list(rows[0].as_dict().values())[0]
        if isinstance(raw_result, dict):
            return raw_result
        if isinstance(raw_result, str):
            try:
                return json.loads(raw_result)
            except json.JSONDecodeError:
                return {}
        return raw_result or {}
