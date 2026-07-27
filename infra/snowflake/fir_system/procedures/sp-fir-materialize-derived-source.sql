CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_MATERIALIZE_DERIVED_SOURCE(
    "DERIVED_SOURCE_ID" VARCHAR
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'materialize'
EXECUTE AS OWNER
AS
$$
import json
import re


def _json(value, default):
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value) if value else default
    except Exception:
        return default


def _quote_identifier(value):
    return '"' + str(value).replace('"', '""') + '"'


def _mask_non_executable_sql(sql_text):
    """Mask literals, quoted identifiers, and comments before token checks.

    The read-only query has already been parsed and executed by the API before
    it reaches this procedure.  This second guard must inspect executable SQL
    only: business-language comments may legitimately contain semicolons or
    words such as CREATE/UPDATE, and string literals may contain the same.
    """
    token_pattern = re.compile(
        r"--[^\r\n]*|/\*.*?\*/|'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"",
        flags=re.DOTALL,
    )
    return token_pattern.sub(lambda match: ' ' * len(match.group(0)), sql_text)


def _column_names(preview_columns):
    names = []
    seen = {}
    for index, item in enumerate(_json(preview_columns, []), start=1):
        if isinstance(item, dict):
            raw_name = item.get('name') or item.get('column_name') or item.get('COLUMN_NAME')
        else:
            raw_name = item
        base_name = str(raw_name or f'COLUMN_{index}')
        key = base_name.upper()
        count = seen.get(key, 0) + 1
        seen[key] = count
        names.append(base_name if count == 1 else f'{base_name}_{count}')
    return names


def _materialize_one(session, derived_source_id):
    rows = session.sql(
        "SELECT SQL_TEXT, PREVIEW_COLUMNS FROM __STTM_METADATA_NAMESPACE__.TBL_DERIVED_SOURCES "
        "WHERE DERIVED_SOURCE_ID = ? AND IS_ACTIVE = TRUE",
        [derived_source_id],
    ).collect()
    if not rows:
        return {'status': 'not_found', 'derived_source_id': derived_source_id}

    sql_text = str(rows[0]['SQL_TEXT'] or '').strip().rstrip(';').strip()
    if not re.match(r'^(SELECT|WITH)\b', sql_text, flags=re.IGNORECASE):
        return {'status': 'rejected', 'reason': 'Only SELECT or CTE queries may be materialized.'}
    executable_sql = _mask_non_executable_sql(sql_text)
    if ';' in executable_sql or re.search(
        r'\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|COPY|CALL|GRANT|REVOKE)\b',
        executable_sql,
        flags=re.IGNORECASE,
    ):
        return {'status': 'rejected', 'reason': 'Unsafe SQL token detected.'}

    suffix = re.sub(r'[^A-Za-z0-9_]', '_', str(derived_source_id).upper())[:180]
    view_name = f'__STTM_METADATA_NAMESPACE__.DSV_FIR_{suffix}'
    columns = _column_names(rows[0]['PREVIEW_COLUMNS'])
    column_clause = f" ({', '.join(_quote_identifier(name) for name in columns)})" if columns else ''
    try:
        session.sql(
            f'CREATE OR REPLACE SECURE VIEW {view_name}{column_clause} COPY GRANTS AS {sql_text}'
        ).collect()
    except Exception as exc:
        return {
            'status': 'failed',
            'derived_source_id': derived_source_id,
            'reason': str(exc),
        }
    session.sql(
        "UPDATE __STTM_METADATA_NAMESPACE__.TBL_DERIVED_SOURCES "
        "SET PHYSICAL_VIEW_NAME = ?, UPDATED_AT = CURRENT_TIMESTAMP() "
        "WHERE DERIVED_SOURCE_ID = ?",
        [view_name, derived_source_id],
    ).collect()
    return {'status': 'success', 'derived_source_id': derived_source_id, 'physical_view_name': view_name}


def materialize(session, derived_source_id):
    requested_id = str(derived_source_id or '').strip()
    if requested_id not in ('', '*'):
        return _materialize_one(session, requested_id)

    rows = session.sql(
        "SELECT DERIVED_SOURCE_ID FROM __STTM_METADATA_NAMESPACE__.TBL_DERIVED_SOURCES "
        "WHERE IS_ACTIVE = TRUE AND NULLIF(TRIM(PHYSICAL_VIEW_NAME), '') IS NULL "
        "ORDER BY CREATED_AT"
    ).collect()
    results = [
        _materialize_one(session, str(row['DERIVED_SOURCE_ID']))
        for row in rows
    ]
    return {
        'status': 'success',
        'mode': 'backfill',
        'requested': len(results),
        'materialized': sum(1 for result in results if result.get('status') == 'success'),
        'results': results,
    }
$$;
