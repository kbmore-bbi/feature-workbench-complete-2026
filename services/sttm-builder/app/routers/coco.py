from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from websockets.asyncio.client import connect

from app.auth.dependencies import get_current_principal
from app.auth.models import AppPersona
from app.core.config import get_settings

router = APIRouter(prefix="/coco", tags=["CoCo Deep Agent"])
logger = logging.getLogger(__name__)


@router.get("/status")
async def coco_status(request: Request) -> dict[str, object]:
    """Check CoCo availability - available to all authenticated users."""
    settings = get_settings()
    user_authorized = False

    try:
        principal = get_current_principal(request)
        # CoCo is available to ALL authenticated users
        # They can only do what their Snowflake credentials allow anyway
        user_authorized = principal is not None
    except (HTTPException, Exception) as e:
        # Log but don't fail - user just won't be authorized
        logger.debug("CoCo status check - auth failed: %s", e)
        user_authorized = False

    return {
        "enabled": bool(settings.coco_enabled and settings.coco_service_url),
        "configured": bool(settings.coco_service_url),
        "user_authorized": user_authorized,
        "service_url_set": bool(settings.coco_service_url),
    }


@router.get("/diagnostics")
async def diagnostics(request: Request) -> dict[str, object]:
    settings = get_settings()
    principal = get_current_principal(request)
    if principal.app_persona is not AppPersona.ADMIN:
        raise HTTPException(status_code=403, detail="CoCo diagnostics require the admin persona")
    if not settings.coco_service_url:
        return {"status": "disabled", "detail": "CoCo service URL is not configured"}
    http_url = settings.coco_service_url.replace("ws://", "http://", 1).replace("wss://", "https://", 1)
    if http_url.endswith("/ws"):
        http_url = http_url[:-3] + "/diagnostics"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(http_url)
        response.raise_for_status()
        payload = response.json()
        return {
            "status": payload.get("status", "unknown"),
            "service_url_configured": True,
            "internal": payload,
        }
    except Exception as exc:
        logger.exception("CoCo diagnostics proxy failed")
        return {
            "status": "unreachable",
            "service_url_configured": True,
            "detail": str(exc),
        }


@router.websocket("/ws")
async def websocket_proxy(websocket: WebSocket) -> None:
    settings = get_settings()
    # Accept the browser side before doing Snowflake/session or upstream work.
    # Otherwise a recoverable backend failure is surfaced by Chromium only as
    # ERR_HTTP2_PROTOCOL_ERROR and the UI cannot display the real reason.
    await websocket.accept()

    async def fail(code: str, detail: str, close_code: int) -> None:
        await websocket.send_json(
            {
                "contract_version": "1.0",
                "type": "assistant.error",
                "session_id": "",
                "request_id": str(uuid4()),
                "event_id": str(uuid4()),
                "timestamp": datetime.now(UTC).isoformat(),
                "context_hash": "",
                "data": None,
                "error": {"code": code, "detail": detail},
            }
        )
        await websocket.close(code=close_code, reason=detail[:120])

    try:
        principal = await asyncio.to_thread(get_current_principal, websocket)  # type: ignore[arg-type]
    except HTTPException as exc:
        await fail("COCO_AUTH_REQUIRED", str(exc.detail), 4401)
        return
    # CoCo is available to ALL authenticated users
    # Users can only perform actions that their Snowflake credentials allow
    # The Snowflake RBAC enforces what operations they can do
    if not principal:
        await fail(
            "COCO_AUTH_REQUIRED",
            "Authentication required for CoCo deep-agent mode",
            4401,
        )
        return
    if not settings.coco_service_url:
        await fail("COCO_SERVICE_DISABLED", "CoCo service is disabled", 1013)
        return

    internal_headers = {
        "X-CoCo-OAuth-Token": principal.snowflake_user_token,
        "X-CoCo-Snowflake-User": principal.snowflake_user,
        "X-CoCo-Snowflake-Role": principal.snowflake_role or "",
        "X-CoCo-App-Persona": principal.app_persona.value,
    }
    try:
        async with connect(
            settings.coco_service_url,
            additional_headers=internal_headers,
            open_timeout=15,
            ping_interval=20,
            ping_timeout=20,
            max_size=4 * 1024 * 1024,
        ) as upstream:
            async def browser_to_coco() -> None:
                async for message in websocket.iter_text():
                    await upstream.send(message)

            async def coco_to_browser() -> None:
                async for message in upstream:
                    await websocket.send_text(str(message))

            left = asyncio.create_task(browser_to_coco())
            right = asyncio.create_task(coco_to_browser())
            done, pending = await asyncio.wait(
                {left, right},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            await asyncio.gather(*done, *pending, return_exceptions=True)
    except WebSocketDisconnect:
        return
    except Exception:
        logger.exception("CoCo WebSocket proxy failed for user=%s", principal.snowflake_user)
        if websocket.client_state.name != "DISCONNECTED":
            await fail(
                "COCO_SERVICE_CONNECTION_FAILED",
                "The CoCo deep-agent service could not be reached.",
                1011,
            )
