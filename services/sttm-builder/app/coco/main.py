from __future__ import annotations

import logging
import asyncio
import shutil
import subprocess
import sys
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.coco.protocol import CocoClientFrame
from app.coco.runtime import CocoRuntimeSession
from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()
app = FastAPI(title="Workbench CoCo Deep Agent", docs_url=None)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/coco/diagnostics")
def diagnostics() -> dict[str, object]:
    sdk_import_error: str | None = None
    sdk_import_status = "ok"
    try:
        import cortex_code_agent_sdk  # noqa: F401
    except Exception as exc:  # pragma: no cover - runtime diagnostic
        sdk_import_status = "failed"
        sdk_import_error = str(exc)

    cli_path = settings.coco_cli_path or shutil.which("cortex") or ""
    cli_version: str | None = None
    cli_error: str | None = None
    if cli_path:
        try:
            completed = subprocess.run(
                [cli_path, "--version"],
                check=False,
                capture_output=True,
                text=True,
                timeout=5,
            )
            cli_version = (completed.stdout or completed.stderr or "").strip() or None
            if completed.returncode != 0:
                cli_error = f"exit_code={completed.returncode}"
        except Exception as exc:  # pragma: no cover - runtime diagnostic
            cli_error = str(exc)

    knowledge_dir = Path(settings.coco_knowledge_dir)
    loop = asyncio.get_event_loop_policy().new_event_loop()
    try:
        loop_class = f"{loop.__class__.__module__}.{loop.__class__.__name__}"
    finally:
        loop.close()

    return {
        "status": "ok" if sdk_import_status == "ok" and not cli_error else "degraded",
        "sdk_import_status": sdk_import_status,
        "sdk_import_error": sdk_import_error,
        "cli_path": cli_path or None,
        "cli_version": cli_version,
        "cli_error": cli_error,
        "python_version": sys.version,
        "event_loop_class": loop_class,
        "knowledge_dir": str(knowledge_dir),
        "knowledge_dir_readable": knowledge_dir.exists() and knowledge_dir.is_dir(),
        "uvicorn_loop_env": __import__("os").environ.get("UVICORN_LOOP"),
    }


@app.websocket("/api/v1/coco/ws")
async def coco_websocket(websocket: WebSocket) -> None:
    # CoCo is available to ALL authenticated users
    # Snowflake RBAC enforces what operations they can perform
    # No persona check needed - if they have a valid OAuth token, they can use CoCo
    token = websocket.headers.get("X-CoCo-OAuth-Token", "").strip()
    if not token:
        await websocket.close(code=4401, reason="OAuth token required")
        return
    user = websocket.headers.get("X-CoCo-Snowflake-User", "").strip()
    role = websocket.headers.get("X-CoCo-Snowflake-Role", "").strip()
    await websocket.accept()
    runtime = CocoRuntimeSession(
        websocket=websocket,
        settings=settings,
        oauth_token=token,
        snowflake_user=user,
        snowflake_role=role,
    )
    try:
        while True:
            payload = await websocket.receive_json()
            try:
                frame = CocoClientFrame.model_validate(payload)
                await runtime.handle(frame)
            except (ValidationError, ValueError) as exc:
                await runtime.emit(
                    "assistant.error",
                    request_id=str(payload.get("request_id") or "invalid-frame"),
                    error={
                        "type": "about:blank",
                        "title": "Invalid CoCo protocol frame",
                        "status": 400,
                        "detail": str(exc),
                        "code": "COCO_PROTOCOL_ERROR",
                    },
                )
            except Exception:
                logger.exception("CoCo runtime frame handling failed")
                await runtime.emit(
                    "assistant.error",
                    request_id=str(payload.get("request_id") or "coco-runtime-error"),
                    error={
                        "type": "about:blank",
                        "title": "CoCo session failed",
                        "status": 502,
                        "detail": "The CoCo deep-agent runtime could not start or handle the request.",
                        "code": "COCO_SESSION_START_FAILED",
                    },
                )
    except WebSocketDisconnect:
        pass
    finally:
        await runtime.close()
