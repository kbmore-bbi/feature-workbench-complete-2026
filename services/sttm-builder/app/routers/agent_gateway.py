from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.deps import (
    get_auto_mapping_proxy_client,
    get_agent_snowflake_client,
    get_datahub_adapter,
    get_semantic_model_service,
    get_snowflake_agent_client,
    get_snowflake_analyst_client,
    get_snowflake_client,
)
from app.auth.dependencies import get_current_principal
from app.core.config import get_settings
from app.core.derived_source import DerivedSourceService
from app.core.signal_bus import get_signal_bus, Signal
from app.core.semantic_context import SemanticContextService
from app.core.sttm_builder import STTMBuilderService
from app.core.table_selection import TableSelectionService
from app.guardrails.contracts.decisions import GovernanceDecision
from app.schema.sttm_builder import normalize_sttm_builder_invoke_body

router = APIRouter(prefix="/workbench/agent", tags=["Workbench Agent Gateway"])
logger = logging.getLogger(__name__)

_STREAM_DONE = object()


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _frame(
    message_type: str,
    *,
    session_id: str,
    request_id: str,
    context_hash: str = "",
    data: dict[str, Any] | None = None,
    error: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "contract_version": "1.0",
        "type": message_type,
        "session_id": session_id,
        "request_id": request_id,
        "event_id": str(uuid4()),
        "timestamp": _now_iso(),
        "context_hash": context_hash,
        "data": data,
        "error": error,
    }


def _parse_sse_chunk(chunk: str) -> tuple[str, dict[str, Any]]:
    event_name = "message"
    data_parts: list[str] = []
    for line in chunk.splitlines():
        if not line.strip():
            continue
        if line.startswith("event:"):
            event_name = line[6:].strip()
            continue
        if line.startswith("data:"):
            data_parts.append(line[5:].lstrip())
    raw = "\n".join(data_parts).strip()
    if not raw:
        return event_name, {}
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        payload = {"text": raw}
    return event_name, payload if isinstance(payload, dict) else {"value": payload}


def _next_stream_item(iterator: Iterator[str]) -> str | object:
    try:
        return next(iterator)
    except StopIteration:
        return _STREAM_DONE


def _build_gateway_services(
    websocket: WebSocket,
) -> tuple[STTMBuilderService, Any, list[Iterator[Any]]]:
    """Create the heavy Snowflake-backed services only after the socket is accepted."""
    settings = get_settings()
    principal = get_current_principal(websocket)  # type: ignore[arg-type]
    websocket.state.current_principal = principal

    control_generator = get_snowflake_client(websocket, settings)  # type: ignore[arg-type]
    client = next(control_generator)
    agent_generator = get_agent_snowflake_client(websocket, settings)  # type: ignore[arg-type]
    agent_session_client = next(agent_generator)
    agent_client = get_snowflake_agent_client(websocket, agent_session_client, settings)  # type: ignore[arg-type]
    analyst_client = get_snowflake_analyst_client(websocket, agent_session_client, settings)  # type: ignore[arg-type]
    semantic_model_service = get_semantic_model_service(settings)
    datahub_adapter = get_datahub_adapter(settings)
    table_selection_service = TableSelectionService(client, settings)
    derived_source_service = DerivedSourceService(client.session, settings)
    semantic_context_service = SemanticContextService(
        session=client.session,
        settings=settings,
        semantic_model_service=semantic_model_service,
        table_selection_service=table_selection_service,
        derived_source_service=derived_source_service,
        datahub_adapter=datahub_adapter,
    )
    service = STTMBuilderService(
        agent_client,
        analyst_client=analyst_client,
        settings=settings,
        session=client.session,
        semantic_model_service=semantic_model_service,
        semantic_context_service=semantic_context_service,
        query_session=agent_session_client.session,
    )
    return (
        service,
        get_auto_mapping_proxy_client(settings),
        [control_generator, agent_generator],
    )


def _governance_decision_for(envelope: Any) -> GovernanceDecision:
    guardrails_meta = dict(envelope.meta.get("guardrails") or {})
    return GovernanceDecision(
        trace_id=str(envelope.context.trace_id or guardrails_meta.get("trace_id") or uuid4()),
        request_id=envelope.request_id,
        operation=envelope.operation.value,
        persona=guardrails_meta.get("persona"),
        redaction_count=int(guardrails_meta.get("redaction_count") or 0),
        detected_pii=list(guardrails_meta.get("detected_pii") or []),
    )


async def _handle_signal_response(websocket: WebSocket, session_id: str, data: dict) -> None:
    """Record user's response to a FIR notification as explicit feedback.

    This re-enters the FIR pipeline so the agent can learn from user choices.
    """
    option_id = data.get("option_id", "")
    recommendation_id = data.get("recommendation_id", "")
    signal_id = data.get("signal_id", "")

    if not recommendation_id:
        logger.warning("signal_response missing recommendation_id, session=%s", session_id)
        return

    client_generator: Iterator[Any] | None = None
    try:
        settings = get_settings()
        client_generator = get_snowflake_client(websocket, settings)  # type: ignore[arg-type]
        client = next(client_generator)
        session = client.session

        feedback_payload = json.dumps({
            "response_type": "notification_response",
            "option_id": option_id,
            "recommendation_id": recommendation_id,
            "signal_id": signal_id,
            "session_id": session_id,
        })

        session.sql("""
            INSERT INTO TBL_WORKBENCH_FEEDBACK (
                FEEDBACK_ID, FEEDBACK_TYPE, SESSION_ID,
                ENTITY_TYPE, ENTITY_ID, FEEDBACK_PAYLOAD,
                CREATED_AT
            )
            SELECT
                ?,
                'notification_response',
                ?,
                'recommendation',
                ?,
                PARSE_JSON(?),
                CURRENT_TIMESTAMP()
        """, [
            str(uuid4()),
            session_id,
            recommendation_id,
            feedback_payload,
        ]).collect()

        logger.info(
            "Recorded signal_response: session=%s recommendation=%s option=%s",
            session_id, recommendation_id, option_id,
        )
    except Exception as exc:
        logger.error("Failed to record signal_response: %s", exc)
    finally:
        if client_generator is not None:
            client_generator.close()  # type: ignore[attr-defined]


@router.websocket("/ws")
async def websocket_gateway(websocket: WebSocket) -> None:
    """CoCo-like WebSocket gateway for normal STTM assistant traffic.

    The route accepts immediately, emits a status frame, and only then opens the
    Snowflake-backed service stack. That keeps the browser out of the 10-20s
    silent wait pattern while preserving the existing typed STTM service path.

    Also subscribes to the signal bus for real-time FIR signal delivery.
    """
    await websocket.accept()
    session_id = str(uuid4())
    client_generators: list[Iterator[Any]] = []
    signal_bus = get_signal_bus()

    async def signal_callback(signal: Signal) -> None:
        """Callback to deliver signals via WebSocket."""
        try:
            await websocket.send_json(
                _frame(
                    "assistant.signal",
                    session_id=session_id,
                    request_id=signal.signal_id,
                    data=signal.to_dict(),
                )
            )
        except Exception as exc:
            logger.warning("Failed to send signal via WebSocket: %s", exc)

    try:
        await signal_bus.subscribe(session_id, signal_callback)
        await websocket.send_json(
            _frame(
                "session.ready",
                session_id=session_id,
                request_id=str(uuid4()),
                data={"gateway": "workbench_agent", "transport": "websocket", "signals_enabled": True},
            )
        )
        async for raw_message in websocket.iter_text():
            request_id = str(uuid4())
            context_hash = ""
            try:
                frame = json.loads(raw_message)
                request_id = str(frame.get("request_id") or request_id)
                context_hash = str(frame.get("context_hash") or "")
                data = frame.get("data") if isinstance(frame, dict) else {}

                # Handle signal_response — user responded to a FIR notification
                frame_type = frame.get("type") if isinstance(frame, dict) else None
                if frame_type == "signal_response":
                    await _handle_signal_response(websocket, session_id, data or {})
                    continue

                envelope_payload = (data or {}).get("envelope") or (data or {}).get("request") or data
                if not isinstance(envelope_payload, dict):
                    raise ValueError("Workbench agent gateway requires data.envelope")
                normalized = normalize_sttm_builder_invoke_body(envelope_payload)
                if not normalized.request_id:
                    normalized = normalized.model_copy(update={"request_id": request_id})
                request_id = normalized.request_id

                await websocket.send_json(
                    _frame(
                        "assistant.status",
                        session_id=session_id,
                        request_id=request_id,
                        context_hash=context_hash,
                        data={
                            "phase": "gateway_received",
                            "message": "Workbench Agent Gateway received the current workspace snapshot.",
                        },
                    )
                )

                service, auto_mapping_proxy, client_generators = await asyncio.to_thread(
                    _build_gateway_services,
                    websocket,
                )
                decision = _governance_decision_for(normalized)
                if auto_mapping_proxy.should_delegate(normalized):
                    stream = auto_mapping_proxy.invoke_stream(
                        websocket,  # type: ignore[arg-type]
                        normalized,
                        prepare_request=service.prepare_auto_map_request,
                    )
                else:
                    stream = service.invoke_stream(normalized, governance_decision=decision)

                while True:
                    item = await asyncio.to_thread(_next_stream_item, stream)
                    if item is _STREAM_DONE:
                        break
                    event_name, payload = _parse_sse_chunk(str(item))
                    if event_name == "status":
                        await websocket.send_json(
                            _frame(
                                "assistant.status",
                                session_id=session_id,
                                request_id=request_id,
                                context_hash=context_hash,
                                data=payload,
                            )
                        )
                    elif event_name == "delta":
                        await websocket.send_json(
                            _frame(
                                "assistant.delta",
                                session_id=session_id,
                                request_id=request_id,
                                context_hash=context_hash,
                                data=payload,
                            )
                        )
                    elif event_name == "suggestions":
                        await websocket.send_json(
                            _frame(
                                "assistant.suggestions",
                                session_id=session_id,
                                request_id=request_id,
                                context_hash=context_hash,
                                data=payload,
                            )
                        )
                    elif event_name == "final":
                        await websocket.send_json(
                            _frame(
                                "assistant.final",
                                session_id=session_id,
                                request_id=request_id,
                                context_hash=context_hash,
                                data=payload,
                            )
                        )
                    elif event_name == "error":
                        await websocket.send_json(
                            _frame(
                                "assistant.error",
                                session_id=session_id,
                                request_id=request_id,
                                context_hash=context_hash,
                                error=payload.get("error") if isinstance(payload.get("error"), dict) else payload,
                            )
                        )
                    else:
                        await websocket.send_json(
                            _frame(
                                "tool.completed",
                                session_id=session_id,
                                request_id=request_id,
                                context_hash=context_hash,
                                data={"event": event_name, "payload": payload},
                            )
                        )
                for generator in client_generators:
                    generator.close()  # type: ignore[attr-defined]
                client_generators = []
            except Exception as exc:
                for generator in client_generators:
                    try:
                        generator.close()  # type: ignore[attr-defined]
                    except Exception:
                        logger.debug(
                            "Failed to close Workbench Agent Gateway Snowflake client",
                            exc_info=True,
                        )
                client_generators = []
                logger.exception("Workbench Agent Gateway turn failed")
                await websocket.send_json(
                    _frame(
                        "assistant.error",
                        session_id=session_id,
                        request_id=request_id,
                        context_hash=context_hash,
                        error={
                            "type": "about:blank",
                            "title": "Workbench Agent Gateway request failed",
                            "status": 502,
                            "detail": str(exc) or "The gateway could not complete the request.",
                            "code": "WORKBENCH_AGENT_GATEWAY_ERROR",
                        },
                    )
                )
    except WebSocketDisconnect:
        return
    finally:
        await signal_bus.unsubscribe(session_id, signal_callback)
        for generator in client_generators:
            try:
                generator.close()  # type: ignore[attr-defined]
            except Exception:
                logger.debug("Failed to close Workbench Agent Gateway Snowflake client", exc_info=True)
