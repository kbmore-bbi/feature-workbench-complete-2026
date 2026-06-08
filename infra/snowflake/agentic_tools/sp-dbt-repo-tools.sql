-- ============================================================
-- DBT CONVERSION AGENT — STORED PROCEDURES (AGENT TOOLS)
-- These procedures read from the DBT_REPO Git repository object.
-- Create or refresh the DBT_REPO repository separately before using
-- AGT_DBT_CONVERSION end to end.
-- ============================================================

USE DATABASE FFP_HDP_CRM_MIG_DB_DEV;
USE SCHEMA SCH_STTM_METADATA;

DROP PROCEDURE IF EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_DBT_LIST_DOMAIN_MODELS(VARCHAR);
DROP PROCEDURE IF EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_DBT_LIST_DOMAIN_MODELS(VARCHAR, VARCHAR);
DROP PROCEDURE IF EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_DBT_LIST_DOMAIN_MODELS(VARCHAR, VARCHAR, VARCHAR);

DROP PROCEDURE IF EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_DBT_GET_FILE(VARCHAR);
DROP PROCEDURE IF EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_DBT_GET_FILE(VARCHAR, VARCHAR);

DROP PROCEDURE IF EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_DBT_LIST_MACROS();
DROP PROCEDURE IF EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_DBT_LIST_MACROS(VARCHAR);

DROP PROCEDURE IF EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_DBT_GET_SOURCES_YAML();
DROP PROCEDURE IF EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_DBT_GET_SOURCES_YAML(VARCHAR);

DROP PROCEDURE IF EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_DBT_GET_PROJECT_CONFIG();
DROP PROCEDURE IF EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_DBT_GET_PROJECT_CONFIG(VARCHAR);

CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_DBT_LIST_DOMAIN_MODELS(
    DOMAIN_NAME VARCHAR,
    LAYER       VARCHAR,
    BRANCH      VARCHAR
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'run'
EXECUTE AS OWNER
AS
$$
def run(session, domain_name, layer, branch):
    try:
        if layer and layer.strip() and layer.lower() != "none":
            path_prefix = f"branches/main/models/{domain_name}/{layer}/"
        else:
            path_prefix = f"branches/main/models/{domain_name}/"

        rows = session.sql(
            f"LS @FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.DBT_REPO/{path_prefix} PATTERN='.*[.]sql'"
        ).collect()

        files = []
        for row in rows:
            raw_name = row["name"]
            if "branches/main/" in raw_name:
                file_path = raw_name.split("branches/main/", 1)[1]
            else:
                file_path = raw_name
            file_name = file_path.split("/")[-1]
            files.append({"file_path": file_path, "file_name": file_name})

        return {
            "status": "OK",
            "code": "SUCCESS",
            "domain_name": domain_name,
            "layer": layer or "",
            "branch": branch,
            "files": files,
            "count": len(files)
        }
    except Exception as e:
        return {
            "status": "ERROR",
            "code": "UNEXPECTED_ERROR",
            "message": str(e)
        }
$$;

CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_DBT_GET_FILE(
    FILE_PATH VARCHAR,
    BRANCH    VARCHAR
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'run'
EXECUTE AS OWNER
AS
$$
from snowflake.snowpark.files import SnowflakeFile

def run(session, file_path, branch):
    try:
        stage_path = f"@FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.DBT_REPO/branches/main/{file_path}"
        with SnowflakeFile.open(stage_path, "r", require_scoped_url=False) as handle:
            content = handle.read()

        return {
            "status": "OK",
            "code": "SUCCESS",
            "file_path": file_path,
            "branch": branch,
            "content": content
        }
    except FileNotFoundError:
        return {
            "status": "ERROR",
            "code": "FILE_NOT_FOUND",
            "message": f"File not found or empty: {file_path}. Ensure DBT_REPO is fetched and path is correct."
        }
    except Exception as e:
        return {
            "status": "ERROR",
            "code": "FILE_READ_ERROR",
            "message": str(e)
        }
$$;

CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_DBT_LIST_MACROS(
    BRANCH VARCHAR
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'run'
EXECUTE AS OWNER
AS
$$
def run(session, branch):
    try:
        rows = session.sql(
            "LS @FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.DBT_REPO/branches/main/macros/ PATTERN='.*[.]sql'"
        ).collect()

        macros = []
        for row in rows:
            raw_name = row["name"]
            if "branches/main/" in raw_name:
                file_path = raw_name.split("branches/main/", 1)[1]
            else:
                file_path = raw_name
            file_name = file_path.split("/")[-1]
            macros.append({
                "file_path": file_path,
                "macro_name": file_name.replace(".sql", "")
            })

        return {
            "status": "OK",
            "code": "SUCCESS",
            "branch": branch,
            "macros": macros,
            "count": len(macros)
        }
    except Exception as e:
        return {
            "status": "ERROR",
            "code": "UNEXPECTED_ERROR",
            "message": str(e)
        }
$$;

CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_DBT_GET_SOURCES_YAML(
    BRANCH VARCHAR
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'run'
EXECUTE AS OWNER
AS
$$
from snowflake.snowpark.files import SnowflakeFile

def run(session, branch):
    try:
        stage_path = "@FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.DBT_REPO/branches/main/models/_sources.yml"
        with SnowflakeFile.open(stage_path, "r", require_scoped_url=False) as handle:
            content = handle.read()

        return {
            "status": "OK",
            "code": "SUCCESS",
            "file_path": "models/_sources.yml",
            "branch": branch,
            "content": content
        }
    except FileNotFoundError:
        return {
            "status": "ERROR",
            "code": "FILE_NOT_FOUND",
            "message": "File not found or empty: models/_sources.yml. Ensure DBT_REPO is fetched."
        }
    except Exception as e:
        return {
            "status": "ERROR",
            "code": "FILE_READ_ERROR",
            "message": str(e)
        }
$$;

CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_DBT_GET_PROJECT_CONFIG(
    BRANCH VARCHAR
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'run'
EXECUTE AS OWNER
AS
$$
from snowflake.snowpark.files import SnowflakeFile

def run(session, branch):
    try:
        stage_path = "@FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.DBT_REPO/branches/main/dbt_project.yml"
        with SnowflakeFile.open(stage_path, "r", require_scoped_url=False) as handle:
            content = handle.read()

        return {
            "status": "OK",
            "code": "SUCCESS",
            "file_path": "dbt_project.yml",
            "branch": branch,
            "content": content
        }
    except FileNotFoundError:
        return {
            "status": "ERROR",
            "code": "FILE_NOT_FOUND",
            "message": "File not found or empty: dbt_project.yml. Ensure DBT_REPO is fetched."
        }
    except Exception as e:
        return {
            "status": "ERROR",
            "code": "FILE_READ_ERROR",
            "message": str(e)
        }
$$;
