CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_PUBLISH_SEMANTIC_ASSET(
    "SEMANTIC_ASSET_JSON_STR" VARCHAR
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python', 'pyyaml')
HANDLER = 'publish'
EXECUTE AS OWNER
AS
$$
import copy
import hashlib
import json
import re
import uuid
from datetime import datetime, timezone

import yaml


REGISTRY_NAMESPACE = "FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA"


def _ident(value):
    return '"' + str(value or '').replace('"', '""') + '"'


def _literal(value):
    return "'" + str(value or '').replace("'", "''") + "'"


def _row_dict(row):
    return row.as_dict(recursive=True) if hasattr(row, "as_dict") else dict(row)


def _active_asset(session, database, schema, table):
    rows = session.sql(f"""
        SELECT VIEW_ID, PHYSICAL_VIEW_NAME, SEMANTIC_VIEW
        FROM {REGISTRY_NAMESPACE}.SEM_TABLE_VIEWS
        WHERE DATABASE_NAME = {_literal(database)}
          AND SCHEMA_NAME = {_literal(schema)}
          AND TABLE_NAME = {_literal(table)}
          AND STATUS = 'ACTIVE'
        ORDER BY GENERATED_AT DESC
        LIMIT 1
    """).collect()
    return _row_dict(rows[0]) if rows else None


def _physical_columns(session, database, schema, table):
    rows = session.sql(f"""
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, ORDINAL_POSITION
        FROM {_ident(database)}.INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = {_literal(schema)}
          AND TABLE_NAME = {_literal(table)}
        ORDER BY ORDINAL_POSITION
    """).collect()
    return [_row_dict(row) for row in rows]


def _description(attribute):
    return str(
        attribute.get("description")
        or attribute.get("summary")
        or attribute.get("business_meaning")
        or f"{attribute.get('name', 'Column')} from the source table."
    ).strip()


def _is_primary_key(attribute):
    if str(attribute.get("semantic_role") or "").lower() == "primary_key":
        return True
    for constraint in attribute.get("constraints") or []:
        if isinstance(constraint, str) and constraint.upper() in {"PRIMARY_KEY", "PRIMARY KEY"}:
            return True
        if isinstance(constraint, dict) and str(constraint.get("type") or "").upper() in {"PRIMARY_KEY", "PRIMARY KEY"}:
            return True
    return False


def _validate_relationship_candidates(session, asset, columns):
    semantic_model = asset.get("semantic_model") or {}
    relationships = semantic_model.get("relationships") or {}
    if not isinstance(relationships, dict):
        return ["semantic_model.relationships must be an object"]
    local_types = {str(column["COLUMN_NAME"]).upper(): str(column["DATA_TYPE"]).upper() for column in columns}
    errors = []
    database = str(asset.get("database") or "").upper()
    owner_schema = str(asset.get("schema") or "").upper()
    for direction in ("outgoing", "incoming"):
        candidates = relationships.get(direction) or []
        if not isinstance(candidates, list):
            errors.append(f"relationships.{direction} must be an array")
            continue
        for index, candidate in enumerate(candidates):
            candidate_error_count = len(errors)
            if not isinstance(candidate, dict):
                errors.append(f"relationships.{direction}[{index}] must be an object")
                continue
            related_schema = str(candidate.get("schema") or owner_schema).upper()
            related_table = str(candidate.get("table") or "").upper()
            related_database = str(candidate.get("database") or database).upper()
            mappings = candidate.get("column_mappings") or []
            if not related_table or not isinstance(mappings, list) or not mappings:
                errors.append(f"relationships.{direction}[{index}] requires table and column_mappings")
                continue
            related_columns = _physical_columns(session, related_database, related_schema, related_table)
            related_types = {
                str(column["COLUMN_NAME"]).upper(): str(column["DATA_TYPE"]).upper()
                for column in related_columns
            }
            if not related_types:
                errors.append(f"related table {related_database}.{related_schema}.{related_table} was not found")
                continue
            for mapping in mappings:
                if not isinstance(mapping, dict):
                    continue
                fk_column = str(mapping.get("fk_column") or "").upper()
                pk_column = str(mapping.get("pk_column") or "").upper()
                local_column = fk_column if direction == "outgoing" else pk_column
                related_column = pk_column if direction == "outgoing" else fk_column
                if local_column not in local_types:
                    errors.append(f"relationship local column {local_column} was not found")
                if related_column not in related_types:
                    errors.append(f"relationship related column {related_column} was not found")
                if (
                    local_column in local_types
                    and related_column in related_types
                    and local_types[local_column].split("(", 1)[0] != related_types[related_column].split("(", 1)[0]
                ):
                    errors.append(
                        f"relationship columns {local_column} and {related_column} have incompatible types"
                    )
            candidate["validation"] = {
                "status": "VALID" if len(errors) == candidate_error_count else "INVALID",
                "validated_at": datetime.now(timezone.utc).isoformat(),
            }
    return errors


def _build_yaml(asset, columns, physical_name):
    database = asset["database"]
    schema = asset["schema"]
    table = asset["table"]
    semantic_model = asset.get("semantic_model") or {}
    attributes = asset.get("attribute_semantic_model") or []
    by_name = {
        str(attribute.get("name") or "").upper(): attribute
        for attribute in attributes
        if isinstance(attribute, dict) and attribute.get("name")
    }

    dimensions = []
    time_dimensions = []
    facts = []
    metrics = []
    primary_keys = []
    for column in columns:
        name = str(column["COLUMN_NAME"]).upper()
        attribute = by_name[name]
        role = str(attribute.get("semantic_role") or "attribute").lower()
        entity = {
            "name": name,
            "description": _description(attribute),
            "expr": name,
            "data_type": str(column["DATA_TYPE"]),
        }
        synonyms = attribute.get("synonyms") or []
        if isinstance(synonyms, list) and synonyms:
            entity["synonyms"] = [str(value) for value in synonyms if str(value).strip()]
        value_profile = attribute.get("value_profile") or {}
        sample_values = value_profile.get("sample_values") if isinstance(value_profile, dict) else None
        if isinstance(sample_values, list) and sample_values:
            entity["sample_values"] = sample_values[:20]
        if _is_primary_key(attribute):
            entity["unique"] = True
            primary_keys.append(name)
        if role in {"metric", "measure", "fact"}:
            facts.append(entity)
            aggregation = str(attribute.get("default_aggregation") or "none").lower()
            aggregation_sql = {
                "sum": f"SUM({name})",
                "avg": f"AVG({name})",
                "count": f"COUNT({name})",
                "count_distinct": f"COUNT(DISTINCT {name})",
                "max": f"MAX({name})",
                "min": f"MIN({name})",
                "latest": f"MAX({name})",
            }.get(aggregation)
            if aggregation_sql:
                metrics.append({
                    "name": f"{aggregation}_{name}".lower(),
                    "description": f"{aggregation.replace('_', ' ')} aggregation for {_description(attribute)}",
                    "expr": aggregation_sql,
                })
        elif role in {"time_dimension", "timestamp", "date"} or any(
            token in str(column["DATA_TYPE"]).upper() for token in ("DATE", "TIME")
        ):
            time_dimensions.append(entity)
        else:
            dimensions.append(entity)

    logical_name = re.sub(r"[^A-Za-z0-9_]", "_", f"{schema}_{table}").lower()
    yaml_table = {
        "name": logical_name,
        "description": str(
            semantic_model.get("description")
            or semantic_model.get("domain_summary")
            or f"Semantic definition for {database}.{schema}.{table}."
        ),
        "base_table": {"database": database, "schema": schema, "table": table},
        "dimensions": dimensions,
    }
    if primary_keys:
        yaml_table["primary_key"] = {"columns": primary_keys}
    if time_dimensions:
        yaml_table["time_dimensions"] = time_dimensions
    if facts:
        yaml_table["facts"] = facts
    if metrics:
        yaml_table["metrics"] = metrics
    filters = semantic_model.get("filters")
    if isinstance(filters, list) and filters:
        yaml_table["filters"] = copy.deepcopy(filters)

    specification = {
        "name": physical_name,
        "description": str(
            semantic_model.get("domain_summary")
            or semantic_model.get("description")
            or f"Semantic view for {database}.{schema}.{table}."
        ),
        "tables": [yaml_table],
    }
    for key in ("verified_queries", "metrics", "module_custom_instructions", "custom_instructions"):
        value = semantic_model.get(key)
        if value:
            specification[key] = copy.deepcopy(value)
    return yaml.safe_dump(specification, sort_keys=False, allow_unicode=False)


def publish(session, semantic_asset_json_str):
    try:
        asset = json.loads(semantic_asset_json_str)
    except Exception:
        return {"status": "ERROR", "code": "INVALID_JSON", "message": "Semantic asset must be valid JSON."}
    if not isinstance(asset, dict):
        return {"status": "ERROR", "code": "INVALID_PAYLOAD", "message": "Semantic asset must be a JSON object."}

    scope = str(asset.get("scope") or "").upper()
    database = str(asset.get("database") or "").upper()
    schema = str(asset.get("schema") or "").upper()
    table = str(asset.get("table") or "").upper()
    if scope != "TABLE" or not all((database, schema, table)):
        return {"status": "ERROR", "code": "INVALID_FQN", "message": "TABLE scope, database, schema, and table are required."}
    if not isinstance(asset.get("semantic_model"), dict):
        return {"status": "ERROR", "code": "INVALID_SEMANTIC_MODEL", "message": "semantic_model must be an object."}
    attributes = asset.get("attribute_semantic_model")
    if not isinstance(attributes, list) or not attributes:
        return {"status": "ERROR", "code": "INVALID_ATTRIBUTES", "message": "attribute_semantic_model must be a non-empty array."}

    columns = _physical_columns(session, database, schema, table)
    if not columns:
        return {"status": "ERROR", "code": "TABLE_NOT_FOUND", "message": f"Table {database}.{schema}.{table} was not found."}
    physical_names = {str(column["COLUMN_NAME"]).upper() for column in columns}
    attribute_names = [str(item.get("name") or "").upper() for item in attributes if isinstance(item, dict)]
    if len(attribute_names) != len(set(attribute_names)):
        return {"status": "ERROR", "code": "DUPLICATE_ATTRIBUTES", "message": "Semantic attributes must be unique."}
    missing = sorted(physical_names - set(attribute_names))
    unknown = sorted(set(attribute_names) - physical_names)
    if missing or unknown:
        return {
            "status": "ERROR",
            "code": "COLUMN_MISMATCH",
            "message": "Semantic attributes must exactly match the physical table columns.",
            "missing_columns": missing,
            "unknown_columns": unknown,
        }
    relationship_errors = _validate_relationship_candidates(session, asset, columns)
    if relationship_errors:
        return {
            "status": "ERROR",
            "code": "INVALID_RELATIONSHIPS",
            "message": "Semantic relationship candidates failed validation.",
            "details": relationship_errors,
        }

    active = _active_asset(session, database, schema, table)
    publication = copy.deepcopy(asset.get("publication") or {})
    expected_view_id = str(publication.get("expected_view_id") or "").strip()
    active_view_id = str((active or {}).get("VIEW_ID") or "").strip()
    if expected_view_id and expected_view_id != active_view_id:
        return {
            "status": "ERROR",
            "code": "VERSION_CONFLICT",
            "message": "The semantic asset changed after it was read.",
            "expected_view_id": expected_view_id,
            "active_view_id": active_view_id or None,
        }

    fqn = f"{database}.{schema}.{table}"
    suffix = hashlib.sha256(fqn.encode("utf-8")).hexdigest()[:8].upper()
    readable = re.sub(r"[^A-Z0-9_]", "_", f"{schema}_{table}")[:180]
    physical_name = f"SV_TABLE_{readable}_{suffix}"
    yaml_spec = _build_yaml(asset, columns, physical_name)
    yaml_hash = hashlib.sha256(yaml_spec.encode("utf-8")).hexdigest()
    dollar_delimiter = chr(36) * 2
    yaml_sql = yaml_spec.replace(dollar_delimiter, "$ $")

    request_id = str(publication.get("request_id") or uuid.uuid4())
    producer_agent = str(publication.get("producer_agent") or "AGT_SEMANTIC_MODEL_V2")
    change_reason = str(publication.get("change_reason") or "Scheduled semantic baseline publication")
    full_view_name = f"{REGISTRY_NAMESPACE}.{physical_name}"
    publication.update({
        "physical_view_name": full_view_name,
        "yaml_hash": yaml_hash,
        "semantic_view_yaml": yaml_spec,
        "producer_agent": producer_agent,
        "request_id": request_id,
        "parent_view_id": active_view_id or None,
        "change_reason": change_reason,
        "published_at": datetime.now(timezone.utc).isoformat(),
    })
    asset["publication"] = publication
    model = copy.deepcopy(asset["semantic_model"])
    # Keep the full v2 column model in the canonical table record. Downstream
    # bundle composition must never fall back to re-inferring rich semantics.
    model["attributes"] = copy.deepcopy(attributes)
    model["relationship_candidates"] = copy.deepcopy(model.get("relationships") or {})
    model["source_asset"] = copy.deepcopy(asset)
    model["semantic_view"] = {
        "name": full_view_name,
        "yaml": yaml_spec,
        "yaml_hash": yaml_hash,
        "producer_agent": producer_agent,
        "request_id": request_id,
        "published_at": publication["published_at"],
    }
    asset["semantic_model"] = model
    return {
        "status": "PREPARED",
        "code": "SEMANTIC_ASSET_PREPARED",
        "fqn": fqn,
        "active_view_id": active_view_id or None,
        "physical_view_name": full_view_name,
        "semantic_view_yaml": yaml_spec,
        "yaml_hash": yaml_hash,
        "producer_agent": producer_agent,
        "request_id": request_id,
        "change_reason": change_reason,
        "semantic_asset": asset,
    }
$$;


CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_GET_SEMANTIC_ASSET(
    "DB_NAME" VARCHAR,
    "SCHEMA_NAME" VARCHAR,
    "TABLE_NAME" VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
    result VARIANT;
BEGIN
    SELECT OBJECT_CONSTRUCT(
        'status', 'OK',
        'code', 'FOUND',
        'view_id', VIEW_ID,
        'database', DATABASE_NAME,
        'schema', SCHEMA_NAME,
        'table', TABLE_NAME,
        'version', VERSION,
        'physical_view_name', PHYSICAL_VIEW_NAME,
        'yaml_hash', YAML_HASH,
        'producer_agent', PRODUCER_AGENT,
        'request_id', REQUEST_ID,
        'parent_view_id', PARENT_VIEW_ID,
        'change_reason', CHANGE_REASON,
        'semantic_asset', SEMANTIC_VIEW
    ) INTO :result
    FROM FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_TABLE_VIEWS
    WHERE DATABASE_NAME = UPPER(:DB_NAME)
      AND SCHEMA_NAME = UPPER(:SCHEMA_NAME)
      AND TABLE_NAME = UPPER(:TABLE_NAME)
      AND STATUS = 'ACTIVE'
    ORDER BY GENERATED_AT DESC
    LIMIT 1;

    IF (result IS NULL) THEN
        RETURN OBJECT_CONSTRUCT(
            'status', 'ERROR',
            'code', 'SEMANTIC_ASSET_NOT_FOUND',
            'message', 'No active semantic asset exists for ' || UPPER(DB_NAME) || '.' || UPPER(SCHEMA_NAME) || '.' || UPPER(TABLE_NAME)
        );
    END IF;
    RETURN result;
END;
$$;


CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_LINK_PHYSICAL_SEMANTIC_VIEW(
    "DB_NAME" VARCHAR,
    "SCHEMA_NAME" VARCHAR,
    "TABLE_NAME" VARCHAR,
    "EXPECTED_VIEW_ID" VARCHAR,
    "PHYSICAL_VIEW_NAME" VARCHAR,
    "SEMANTIC_VIEW_YAML" VARCHAR,
    "YAML_HASH" VARCHAR,
    "PRODUCER_AGENT" VARCHAR,
    "REQUEST_ID" VARCHAR,
    "CHANGE_REASON" VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
    active_view_id VARCHAR;
    pending_parent_view_id VARCHAR;
    pending_asset VARIANT;
    pending_ddl_hash VARCHAR;
    publication VARIANT;
    view_metadata VARIANT;
BEGIN
    SELECT PARENT_VIEW_ID, SEMANTIC_VIEW, COLUMN_SET_HASH
      INTO :pending_parent_view_id, :pending_asset, :pending_ddl_hash
    FROM FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_TABLE_VIEWS
    WHERE VIEW_ID = :EXPECTED_VIEW_ID
      AND DATABASE_NAME = UPPER(:DB_NAME)
      AND SCHEMA_NAME = UPPER(:SCHEMA_NAME)
      AND TABLE_NAME = UPPER(:TABLE_NAME)
      AND STATUS = 'PENDING';

    IF (pending_asset IS NULL) THEN
        RETURN OBJECT_CONSTRUCT(
            'status', 'ERROR',
            'code', 'PENDING_ASSET_NOT_FOUND',
            'expected_view_id', EXPECTED_VIEW_ID
        );
    END IF;

    SELECT VIEW_ID INTO :active_view_id
    FROM FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_TABLE_VIEWS
    WHERE DATABASE_NAME = UPPER(:DB_NAME)
      AND SCHEMA_NAME = UPPER(:SCHEMA_NAME)
      AND TABLE_NAME = UPPER(:TABLE_NAME)
      AND STATUS = 'ACTIVE'
    ORDER BY GENERATED_AT DESC
    LIMIT 1;

    IF (COALESCE(active_view_id, '') != COALESCE(pending_parent_view_id, '')) THEN
        RETURN OBJECT_CONSTRUCT(
            'status', 'ERROR',
            'code', 'VERSION_CONFLICT',
            'expected_parent_view_id', pending_parent_view_id,
            'active_view_id', active_view_id
        );
    END IF;

    publication := OBJECT_CONSTRUCT(
        'physical_view_name', PHYSICAL_VIEW_NAME,
        'semantic_view_yaml', SEMANTIC_VIEW_YAML,
        'yaml_hash', YAML_HASH,
        'producer_agent', PRODUCER_AGENT,
        'request_id', REQUEST_ID,
        'change_reason', CHANGE_REASON,
        'published_at', CURRENT_TIMESTAMP()::VARCHAR
    );
    view_metadata := OBJECT_CONSTRUCT(
        'name', PHYSICAL_VIEW_NAME,
        'yaml', SEMANTIC_VIEW_YAML,
        'yaml_hash', YAML_HASH,
        'producer_agent', PRODUCER_AGENT,
        'request_id', REQUEST_ID,
        'published_at', CURRENT_TIMESTAMP()::VARCHAR
    );

    BEGIN TRANSACTION;

    UPDATE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_TABLE_VIEWS
    SET STATUS = 'SUPERSEDED', UPDATED_AT = CURRENT_TIMESTAMP()
    WHERE DATABASE_NAME = UPPER(:DB_NAME)
      AND SCHEMA_NAME = UPPER(:SCHEMA_NAME)
      AND TABLE_NAME = UPPER(:TABLE_NAME)
      AND STATUS = 'ACTIVE';

    UPDATE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_COLUMN_VIEWS
    SET STATUS = 'SUPERSEDED', UPDATED_AT = CURRENT_TIMESTAMP()
    WHERE DATABASE_NAME = UPPER(:DB_NAME)
      AND SCHEMA_NAME = UPPER(:SCHEMA_NAME)
      AND TABLE_NAME = UPPER(:TABLE_NAME)
      AND STATUS = 'ACTIVE';

    UPDATE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_TABLE_VIEWS
    SET PHYSICAL_VIEW_NAME = :PHYSICAL_VIEW_NAME,
        YAML_HASH = :YAML_HASH,
        PRODUCER_AGENT = :PRODUCER_AGENT,
        REQUEST_ID = :REQUEST_ID,
        CHANGE_REASON = :CHANGE_REASON,
        STATUS = 'ACTIVE',
        SEMANTIC_VIEW = OBJECT_INSERT(
            OBJECT_INSERT(SEMANTIC_VIEW, 'publication', :publication, TRUE),
            'semantic_model',
            OBJECT_INSERT(SEMANTIC_VIEW:semantic_model, 'semantic_view', :view_metadata, TRUE),
            TRUE
        ),
        UPDATED_AT = CURRENT_TIMESTAMP()
    WHERE VIEW_ID = :EXPECTED_VIEW_ID
      AND STATUS = 'PENDING';

    UPDATE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_COLUMN_VIEWS
    SET STATUS = 'ACTIVE', UPDATED_AT = CURRENT_TIMESTAMP()
    WHERE TABLE_VIEW_ID = :EXPECTED_VIEW_ID
      AND STATUS = 'PENDING';

    MERGE INTO FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_MODELS tgt
    USING (
        SELECT
            'TABLE' AS SCOPE,
            UPPER(:DB_NAME) AS DB_NAME,
            UPPER(:SCHEMA_NAME) AS SCHEMA_NAME,
            UPPER(:TABLE_NAME) AS TABLE_NAME,
            '' AS ATTRIBUTE_NAME,
            OBJECT_INSERT(:pending_asset:semantic_model, 'semantic_view', :view_metadata, TRUE) AS SEMANTIC_MODEL,
            :pending_ddl_hash AS DDL_HASH,
            CURRENT_TIMESTAMP() AS NOW_TS
    ) src
    ON tgt.SCOPE = src.SCOPE
       AND tgt.DB_NAME = src.DB_NAME
       AND tgt.SCHEMA_NAME = src.SCHEMA_NAME
       AND tgt.TABLE_NAME = src.TABLE_NAME
       AND tgt.ATTRIBUTE_NAME = src.ATTRIBUTE_NAME
    WHEN MATCHED THEN UPDATE SET
        tgt.SEMANTIC_MODEL = src.SEMANTIC_MODEL,
        tgt.DDL_HASH = src.DDL_HASH,
        tgt.UPDATED_AT = src.NOW_TS
    WHEN NOT MATCHED THEN INSERT (
        SCOPE, DB_NAME, SCHEMA_NAME, TABLE_NAME, ATTRIBUTE_NAME,
        SEMANTIC_MODEL, DDL_HASH, GENERATED_AT, UPDATED_AT
    ) VALUES (
        src.SCOPE, src.DB_NAME, src.SCHEMA_NAME, src.TABLE_NAME, src.ATTRIBUTE_NAME,
        src.SEMANTIC_MODEL, src.DDL_HASH, src.NOW_TS, src.NOW_TS
    );

    DELETE FROM FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_MODELS
    WHERE SCOPE = 'ATTRIBUTE'
      AND DB_NAME = UPPER(:DB_NAME)
      AND SCHEMA_NAME = UPPER(:SCHEMA_NAME)
      AND TABLE_NAME = UPPER(:TABLE_NAME);

    INSERT INTO FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_MODELS (
        SCOPE, DB_NAME, SCHEMA_NAME, TABLE_NAME, ATTRIBUTE_NAME,
        SEMANTIC_MODEL, DDL_HASH, GENERATED_AT, UPDATED_AT
    )
    SELECT
        'ATTRIBUTE', UPPER(:DB_NAME), UPPER(:SCHEMA_NAME), UPPER(:TABLE_NAME),
        UPPER(f.value:name::VARCHAR), f.value, :pending_ddl_hash,
        CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
    FROM TABLE(FLATTEN(input => :pending_asset, path => 'attribute_semantic_model')) f;

    COMMIT;

    RETURN OBJECT_CONSTRUCT(
        'status', 'OK',
        'code', 'PHYSICAL_VIEW_LINKED',
        'view_id', EXPECTED_VIEW_ID,
        'parent_view_id', active_view_id,
        'physical_view_name', PHYSICAL_VIEW_NAME,
        'yaml_hash', YAML_HASH
    );
EXCEPTION
    WHEN OTHER THEN
        ROLLBACK;
        RETURN OBJECT_CONSTRUCT(
            'status', 'ERROR',
            'code', 'PUBLICATION_COMMIT_FAILED',
            'message', SQLERRM
        );
END;
$$;


CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_PATCH_SEMANTIC_ASSET(
    "PATCH_JSON_STR" VARCHAR,
    "EXPECTED_VIEW_ID" VARCHAR
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'patch_asset'
EXECUTE AS OWNER
AS
$$
import copy
import json


REGISTRY_NAMESPACE = "FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA"


def _literal(value):
    return "'" + str(value or '').replace("'", "''") + "'"


def _merge(base, patch):
    result = copy.deepcopy(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def patch_asset(session, patch_json_str, expected_view_id):
    try:
        patch = json.loads(patch_json_str)
    except Exception:
        return {"status": "ERROR", "code": "INVALID_JSON", "message": "Patch must be valid JSON."}
    if not isinstance(patch, dict):
        return {"status": "ERROR", "code": "INVALID_PATCH", "message": "Patch must be an object."}
    publication = patch.get("publication") or {}
    missing_metadata = [
        key for key in ("producer_agent", "request_id", "change_reason")
        if not str(publication.get(key) or "").strip()
    ]
    if missing_metadata:
        return {"status": "ERROR", "code": "MISSING_PROVENANCE", "message": "Agent patches require producer_agent, request_id, and change_reason.", "missing": missing_metadata}
    database = str(patch.get("database") or "").upper()
    schema = str(patch.get("schema") or "").upper()
    table = str(patch.get("table") or "").upper()
    if not all((database, schema, table, expected_view_id)):
        return {"status": "ERROR", "code": "INVALID_PATCH", "message": "database, schema, table, and expected_view_id are required."}
    rows = session.sql(f"""
        SELECT VIEW_ID, SEMANTIC_VIEW
        FROM {REGISTRY_NAMESPACE}.SEM_TABLE_VIEWS
        WHERE DATABASE_NAME = {_literal(database)}
          AND SCHEMA_NAME = {_literal(schema)}
          AND TABLE_NAME = {_literal(table)}
          AND STATUS = 'ACTIVE'
        ORDER BY GENERATED_AT DESC
        LIMIT 1
    """).collect()
    if not rows:
        return {"status": "ERROR", "code": "SEMANTIC_ASSET_NOT_FOUND", "message": "No active semantic asset exists."}
    row = rows[0].as_dict(recursive=True)
    if str(row.get("VIEW_ID") or "") != str(expected_view_id):
        return {"status": "ERROR", "code": "VERSION_CONFLICT", "message": "The semantic asset changed after it was read.", "active_view_id": row.get("VIEW_ID")}
    current = row.get("SEMANTIC_VIEW")
    if isinstance(current, str):
        current = json.loads(current)
    candidate = _merge(current or {}, patch)
    candidate["scope"] = "TABLE"
    candidate["database"] = database
    candidate["schema"] = schema
    candidate["table"] = table
    candidate.setdefault("publication", {})["expected_view_id"] = str(expected_view_id)
    serialized = json.dumps(candidate, separators=(",", ":")).replace(chr(36) * 2, "$ $")
    delimiter = chr(36) * 2
    result_rows = session.sql(
        f"CALL {REGISTRY_NAMESPACE}.SP_PUBLISH_SEMANTIC_ASSET("
        f"{delimiter}{serialized}{delimiter})"
    ).collect()
    result = result_rows[0].as_dict(recursive=True) if result_rows else {}
    prepared = next(iter(result.values()), result) if isinstance(result, dict) else result
    if isinstance(prepared, str):
        prepared = json.loads(prepared)
    if not isinstance(prepared, dict) or prepared.get("status") != "PREPARED":
        return prepared
    prepared_asset = json.dumps(prepared["semantic_asset"], separators=(",", ":")).replace(delimiter, "$ $")
    save_rows = session.sql(
        f"CALL {REGISTRY_NAMESPACE}.SP_SAVE_SEMANTIC_VIEW("
        f"{delimiter}{prepared_asset}{delimiter})"
    ).collect()
    save_result = save_rows[0].as_dict(recursive=True) if save_rows else {}
    save_result = next(iter(save_result.values()), save_result) if isinstance(save_result, dict) else save_result
    if isinstance(save_result, str):
        save_result = json.loads(save_result)
    if not isinstance(save_result, dict) or save_result.get("status") != "OK":
        return save_result
    prepared["pending_view_id"] = save_result.get("table_view_id")
    prepared["pending_version"] = save_result.get("version")
    prepared["publication_status"] = "PENDING"
    return prepared
$$;
