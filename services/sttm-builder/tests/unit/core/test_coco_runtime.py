from __future__ import annotations

from pathlib import Path

from app.coco.runtime import CocoRuntimeSession, _PROHIBITED
from app.core.config import Settings


class _Socket:
    async def send_json(self, _payload):
        return None


def _runtime(tmp_path: Path) -> CocoRuntimeSession:
    knowledge = tmp_path / "knowledge"
    knowledge.mkdir()
    (knowledge / "STTM_WORKBENCH.md").write_text("knowledge", encoding="utf-8")
    settings = Settings(
        COCO_KNOWLEDGE_DIR=str(knowledge),
        COCO_SNOWFLAKE_ACCOUNT="org-account",
        COCO_SNOWFLAKE_WAREHOUSE="WH",
        COCO_SNOWFLAKE_DATABASE="DB",
        COCO_SNOWFLAKE_SCHEMA="SCHEMA",
    )
    return CocoRuntimeSession(
        websocket=_Socket(),  # type: ignore[arg-type]
        settings=settings,
        oauth_token="secret-token",
        snowflake_user="ADMIN_USER",
        snowflake_role="WORKBENCH_ADMIN",
    )


def test_auto_permission_only_reads_inside_restricted_roots(tmp_path: Path) -> None:
    runtime = _runtime(tmp_path)
    knowledge_file = Path(runtime.settings.coco_knowledge_dir) / "STTM_WORKBENCH.md"

    assert runtime._is_auto_allowed("Read", {"file_path": str(knowledge_file)}) is True
    assert runtime._is_auto_allowed("Read", {"file_path": "/etc/passwd"}) is False
    assert runtime._is_auto_allowed("SQLQuery", {"sql": "SELECT CURRENT_USER()"}) is True
    assert runtime._is_auto_allowed("SQLQuery", {"sql": "DROP TABLE PROD.SECRET"}) is False


def test_prohibited_operations_cannot_be_session_approved() -> None:
    assert _PROHIBITED.search("USE ROLE ACCOUNTADMIN")
    assert _PROHIBITED.search("ALTER NETWORK POLICY corp")
    assert _PROHIBITED.search("deploy to PROD")


def test_oauth_token_file_is_mode_0600_and_cleanup_removes_it(tmp_path: Path) -> None:
    runtime = _runtime(tmp_path)
    runtime._prepare_private_home()
    assert runtime._home is not None
    home = runtime._home
    token_path = home / "oauth.token"
    assert token_path.read_text(encoding="utf-8") == "secret-token"
    assert token_path.stat().st_mode & 0o777 == 0o600

    runtime._tmp.cleanup()
    runtime._tmp = None
    assert not home.exists()
