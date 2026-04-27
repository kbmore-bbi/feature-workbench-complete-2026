import logging
import os
import socket
import traceback
from pathlib import Path

from fastapi import APIRouter, Request

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/debug", tags=["debug"])

_SERVICE_TOKEN_PATH = "/snowflake/session/token"
_SPCS_TOKEN_PATH = "/snowflake/session/spcs_token"
_SENSITIVE_HEADERS = {"authorization", "sf-context-current-user-token"}


def _read_service_token() -> tuple[str | None, str | None]:
    try:
        raw = Path(_SERVICE_TOKEN_PATH).read_text().strip()
        return (raw if raw else None), (None if raw else "file is empty")
    except OSError as e:
        return None, str(e)


def _try_connect(config: dict, label: str, sql: str = "SELECT CURRENT_USER() AS u, CURRENT_ROLE() AS r, CURRENT_ACCOUNT() AS a, CURRENT_WAREHOUSE() AS w") -> dict:
    result: dict = {"label": label, "config_keys": list(config.keys())}
    token = config.get("token", "")
    if token:
        result["token_length"] = len(token)
    try:
        from snowflake.snowpark import Session
        session = Session.builder.configs(config).create()
        rows = session.sql(sql).collect()
        row = rows[0]
        result["success"] = True
        result["current_user"] = row["U"]
        result["current_role"] = row["R"]
        result["current_account"] = row["A"]
        result["current_warehouse"] = row["W"]
        session.close()
    except Exception as e:
        result["success"] = False
        result["error"] = str(e)
        result["traceback"] = traceback.format_exc().splitlines()[-5:]
    return result


def _try_connect_raw(config: dict, label: str) -> dict:
    """Use snowflake-connector-python directly (not Snowpark) for a lower-level test."""
    result: dict = {"label": label, "via": "raw_connector"}
    token = config.get("token", "")
    if token:
        result["token_length"] = len(token)
    try:
        import snowflake.connector
        conn = snowflake.connector.connect(**config)
        cur = conn.cursor()
        cur.execute("SELECT CURRENT_USER(), CURRENT_ROLE(), CURRENT_ACCOUNT(), CURRENT_WAREHOUSE()")
        row = cur.fetchone()
        result["success"] = True
        result["current_user"] = row[0]
        result["current_role"] = row[1]
        result["current_account"] = row[2]
        result["current_warehouse"] = row[3]
        conn.close()
    except Exception as e:
        result["success"] = False
        result["error"] = str(e)
        result["traceback"] = traceback.format_exc().splitlines()[-5:]
    return result


def _dns_check(host: str) -> dict:
    try:
        addr = socket.gethostbyname(host)
        return {"resolvable": True, "ip": addr}
    except Exception as e:
        return {"resolvable": False, "error": str(e)}


@router.get("/headers")
async def inspect_headers(request: Request) -> dict:
    result = {}
    for name, value in request.headers.items():
        if name.lower() in _SENSITIVE_HEADERS:
            result[name] = f"{value[:8]}...{value[-4:]}" if len(value) > 12 else "***"
        else:
            result[name] = value
    return {
        "headers": result,
        "user_token_present": "sf-context-current-user-token" in request.headers,
        "ingress_user_present": "sf-context-current-user" in request.headers,
    }


@router.get("/diagnostics")
async def diagnostics(request: Request) -> dict:
    token_path = Path(_SERVICE_TOKEN_PATH)
    if token_path.exists():
        try:
            raw = token_path.read_text().strip()
            token_info: dict = {
                "present": True,
                "length": len(raw),
                "prefix": raw[:12] + "..." if len(raw) > 12 else "***too short***",
            }
        except OSError as e:
            token_info = {"present": True, "readable": False, "error": str(e)}
    else:
        token_info = {"present": False}

    headers_sanitised = {}
    for name, value in request.headers.items():
        if name.lower() in _SENSITIVE_HEADERS:
            headers_sanitised[name] = f"{value[:8]}...{value[-4:]}" if len(value) > 12 else "***"
        else:
            headers_sanitised[name] = value

    return {
        "service_token": token_info,
        "env": {
            "SNOWFLAKE_ACCOUNT": os.environ.get("SNOWFLAKE_ACCOUNT", "<not set>"),
            "SNOWFLAKE_HOST": os.environ.get("SNOWFLAKE_HOST", "<not set>"),
            "SNOWFLAKE_STTM_BUILDER_AGENT": os.environ.get("SNOWFLAKE_STTM_BUILDER_AGENT", "<not set>"),
        },
        "spcs_user_token_present": "sf-context-current-user-token" in request.headers,
        "headers": headers_sanitised,
    }


@router.get("/session")
async def full_session_test(request: Request) -> dict:
    """
    Exhaustive raw Snowflake connection test — no DI, no shared client.
    Tries every combination of account format, token, role, warehouse, and connector.
    """
    account_env = os.environ.get("SNOWFLAKE_ACCOUNT", "")
    host_env = os.environ.get("SNOWFLAKE_HOST", "")

    # Derive hyphen-only account from host (strips .snowflakecomputing.com)
    account_from_host = host_env.replace(".snowflakecomputing.com", "") if host_env else ""

    svc_token, svc_err = _read_service_token()
    user_token = request.headers.get("sf-context-current-user-token", "").strip()
    combined_token = f"{svc_token}.{user_token}" if svc_token and user_token else None

    dns = _dns_check(host_env) if host_env else {"error": "SNOWFLAKE_HOST not set"}

    # Known-good warehouse and role from grants
    known_warehouse = "COMPUTE_WH"
    known_role = "FOCUS_DEVELOPER"

    # Read the spcs_token (different from session/token)
    spcs_token_raw, spcs_token_err = None, None
    try:
        spcs_token_raw = Path(_SPCS_TOKEN_PATH).read_text().strip() or None
    except OSError as e:
        spcs_token_err = str(e)

    attempts: list[dict] = []

    if not svc_token:
        attempts.append({"label": "ALL_SKIPPED", "error": f"Cannot read service token: {svc_err}"})
        return {"dns": dns, "connection_attempts": attempts, "any_success": False}

    # ── spcs_token attempts (most likely fix) ─────────────────────────────────
    if spcs_token_raw:
        attempts.append(_try_connect(
            {"host": host_env, "account": account_env, "authenticator": "oauth", "token": spcs_token_raw},
            "spcs_token_account_env",
        ))
        attempts.append(_try_connect(
            {"host": host_env, "account": account_from_host, "authenticator": "oauth", "token": spcs_token_raw},
            "spcs_token_account_host",
        ))
        attempts.append(_try_connect(
            {"host": host_env, "account": account_env, "authenticator": "oauth", "token": spcs_token_raw,
             "role": known_role, "warehouse": known_warehouse},
            "spcs_token_role_wh",
        ))
        # combined: spcs_token.user_token
        if user_token:
            spcs_combined = f"{spcs_token_raw}.{user_token}"
            attempts.append(_try_connect(
                {"host": host_env, "account": account_env, "authenticator": "oauth", "token": spcs_combined},
                "spcs_combined_account_env",
            ))
        attempts.append(_try_connect_raw(
            {"host": host_env, "account": account_env, "authenticator": "oauth",
             "token_file_path": _SPCS_TOKEN_PATH},
            "spcs_token_file_path",
        ))
    else:
        attempts.append({"label": "spcs_token_*", "skipped": True, "error": spcs_token_err})

    base_svc   = {"host": host_env, "authenticator": "oauth", "token": svc_token}
    base_combo = {"host": host_env, "authenticator": "oauth", "token": combined_token} if combined_token else None

    def with_account(base: dict, acct: str) -> dict:
        return {**base, "account": acct}

    def with_role_wh(base: dict) -> dict:
        return {**base, "role": known_role, "warehouse": known_warehouse}

    # ── Service token, account as env var ────────────────────────────────────
    attempts.append(_try_connect(with_account(base_svc, account_env), "svc_account_env"))

    # ── Service token, account derived from host (hyphen form) ────────────────
    if account_from_host and account_from_host != account_env:
        attempts.append(_try_connect(with_account(base_svc, account_from_host), "svc_account_from_host"))

    # ── Service token + role + warehouse (account env) ────────────────────────
    attempts.append(_try_connect(with_role_wh(with_account(base_svc, account_env)), "svc_role_wh_account_env"))

    # ── Service token + role + warehouse (account from host) ──────────────────
    if account_from_host and account_from_host != account_env:
        attempts.append(_try_connect(with_role_wh(with_account(base_svc, account_from_host)), "svc_role_wh_account_host"))

    # ── Raw connector: service token, account env ─────────────────────────────
    attempts.append(_try_connect_raw(
        {"host": host_env, "account": account_env, "authenticator": "oauth", "token": svc_token},
        "raw_svc_account_env",
    ))

    # ── Raw connector: service token, account from host ───────────────────────
    if account_from_host and account_from_host != account_env:
        attempts.append(_try_connect_raw(
            {"host": host_env, "account": account_from_host, "authenticator": "oauth", "token": svc_token},
            "raw_svc_account_host",
        ))

    # ── Combined caller's-rights token ────────────────────────────────────────
    if base_combo:
        attempts.append(_try_connect(with_account(base_combo, account_env), "combined_account_env"))
        if account_from_host and account_from_host != account_env:
            attempts.append(_try_connect(with_account(base_combo, account_from_host), "combined_account_host"))
        attempts.append(_try_connect(with_role_wh(with_account(base_combo, account_env)), "combined_role_wh"))
    else:
        attempts.append({"label": "combined_*", "skipped": True, "reason": "no user token in request"})

    # ── token_file_path: let the connector refresh the token itself ───────────
    attempts.append(_try_connect_raw(
        {
            "host": host_env,
            "account": account_env,
            "authenticator": "oauth",
            "token_file_path": _SERVICE_TOKEN_PATH,
        },
        "token_file_path_account_env",
    ))
    if account_from_host and account_from_host != account_env:
        attempts.append(_try_connect_raw(
            {
                "host": host_env,
                "account": account_from_host,
                "authenticator": "oauth",
                "token_file_path": _SERVICE_TOKEN_PATH,
            },
            "token_file_path_account_host",
        ))

    # ── User token directly as plain OAuth (bypass SPCS token entirely) ──────
    if user_token:
        attempts.append(_try_connect_raw(
            {"host": host_env, "account": account_env, "authenticator": "oauth", "token": user_token},
            "user_token_direct_oauth_env",
        ))
        if account_from_host and account_from_host != account_env:
            attempts.append(_try_connect_raw(
                {"host": host_env, "account": account_from_host, "authenticator": "oauth", "token": user_token},
                "user_token_direct_oauth_host",
            ))
    else:
        attempts.append({"label": "user_token_direct_oauth", "skipped": True, "reason": "no user token in headers"})

    # ── Username/password fallback ────────────────────────────────────────────
    sf_user = os.environ.get("SNOWFLAKE_USER", "")
    sf_pass = os.environ.get("SNOWFLAKE_PASSWORD", "")
    if sf_user and sf_pass:
        attempts.append(_try_connect_raw(
            {"host": host_env, "account": account_env, "user": sf_user, "password": sf_pass},
            "upw_account_env",
        ))
    else:
        attempts.append({"label": "upw_fallback", "skipped": True, "reason": "SNOWFLAKE_USER/SNOWFLAKE_PASSWORD not set"})

    any_success = any(a.get("success") for a in attempts)
    first_success = next((a for a in attempts if a.get("success")), None)

    # ── REST API smoke-test (bypasses Python connector entirely) ─────────────
    rest_test: dict = {}
    try:
        import urllib.request
        import ssl
        import json as _json
        url = f"https://{host_env}/api/v2/statements"
        payload = _json.dumps({
            "statement": "SELECT CURRENT_USER(), CURRENT_ACCOUNT()",
            "timeout": 10,
            "database": "FFP_HDP_CRM_MIG_DB_DEV",
            "schema": "SCH_STTM_METADATA",
            "warehouse": "COMPUTE_WH",
            "role": "FOCUS_DEVELOPER",
        }).encode()
        req = urllib.request.Request(url, data=payload, method="POST", headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {svc_token}",
            "X-Snowflake-Authorization-Token-Type": "OAUTH",
        })
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
            body = _json.loads(resp.read())
            rest_test = {"status": resp.status, "success": True, "body_keys": list(body.keys())}
    except Exception as e:
        rest_test = {"success": False, "error": str(e), "type": type(e).__name__}

    # ── REST API with combined token ──────────────────────────────────────────
    rest_combined: dict = {}
    if combined_token:
        try:
            import urllib.request, ssl, json as _json
            url = f"https://{host_env}/api/v2/statements"
            payload = _json.dumps({
                "statement": "SELECT CURRENT_USER(), CURRENT_ACCOUNT()",
                "timeout": 10,
                "warehouse": "COMPUTE_WH",
                "role": "FOCUS_DEVELOPER",
            }).encode()
            req = urllib.request.Request(url, data=payload, method="POST", headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": f"Bearer {combined_token}",
                "X-Snowflake-Authorization-Token-Type": "OAUTH",
            })
            ctx = ssl.create_default_context()
            with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
                body = _json.loads(resp.read())
                rest_combined = {"status": resp.status, "success": True, "body_keys": list(body.keys())}
        except Exception as e:
            rest_combined = {"success": False, "error": str(e), "type": type(e).__name__}

    # ── Scan /snowflake/ for anything useful ──────────────────────────────────
    snowflake_dir: dict = {}
    try:
        p = Path("/snowflake")
        if p.exists():
            snowflake_dir = {
                str(f.relative_to(p)): {"size": f.stat().st_size, "is_dir": f.is_dir()}
                for f in sorted(p.rglob("*"))
                if not f.is_dir() or any(f.iterdir())
            }
        else:
            snowflake_dir = {"error": "/snowflake does not exist"}
    except Exception as e:
        snowflake_dir = {"error": str(e)}

    # ── REST API test with spcs_token ─────────────────────────────────────────
    rest_spcs: dict = {}
    if spcs_token_raw:
        try:
            import urllib.request as _ur, ssl as _ssl, json as _json
            url = f"https://{host_env}/api/v2/statements"
            payload = _json.dumps({
                "statement": "SELECT CURRENT_USER(), CURRENT_ACCOUNT()",
                "timeout": 10, "warehouse": known_warehouse, "role": known_role,
            }).encode()
            req = _ur.Request(url, data=payload, method="POST", headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": f"Bearer {spcs_token_raw}",
                "X-Snowflake-Authorization-Token-Type": "OAUTH",
            })
            ctx = _ssl.create_default_context()
            with _ur.urlopen(req, context=ctx, timeout=10) as resp:
                body = _json.loads(resp.read())
                rest_spcs = {"status": resp.status, "success": True, "body_keys": list(body.keys())}
        except Exception as e:
            rest_spcs = {"success": False, "error": str(e), "type": type(e).__name__}

    return {
        "env": {
            "SNOWFLAKE_ACCOUNT": account_env or "<not set>",
            "SNOWFLAKE_HOST": host_env or "<not set>",
            "account_from_host": account_from_host or "<derived empty>",
            "account_mismatch": account_env != account_from_host,
        },
        "dns": dns,
        "tokens": {
            "session_token": {"length": len(svc_token), "prefix": svc_token[:12] + "..."},
            "spcs_token": {
                "length": len(spcs_token_raw) if spcs_token_raw else 0,
                "prefix": spcs_token_raw[:12] + "..." if spcs_token_raw else None,
                "error": spcs_token_err,
            },
            "user_token_present": bool(user_token),
            "combined_length": len(combined_token) if combined_token else 0,
        },
        "spcs_ingress_user": request.headers.get("sf-context-current-user", "<not present>"),
        "any_success": any_success,
        "first_success": first_success,
        "connection_attempts": attempts,
        "rest_api_session_token": rest_test,
        "rest_api_combined_token": rest_combined,
        "rest_api_spcs_token": rest_spcs,
        "snowflake_dir": snowflake_dir,
    }
