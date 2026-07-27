from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import tempfile
from contextlib import suppress
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import WebSocket

from app.coco.protocol import (
    CocoClientFrame,
    CocoServerFrame,
    PermissionDecision,
    PlanReview,
    QuestionAnswer,
)
from app.core.config import Settings
from app.schema.workspace_context import WorkbenchContextSnapshotV1

logger = logging.getLogger(__name__)

_SAFE_TOOLS = {"Read", "Glob", "Grep", "LS", "WebSearch", "WebFetch"}
_SAFE_MCP_SUFFIXES = {
    "get_workspace_snapshot",
    "read_product_knowledge",
    "inspect_service_health",
    "get_semantic_bundle",
}
_MUTATING_SQL = re.compile(
    r"\b(ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|MERGE|TRUNCATE|GRANT|REVOKE|CALL|PUT|REMOVE)\b",
    re.IGNORECASE,
)
_PROHIBITED = re.compile(
    r"\b(ACCOUNTADMIN|SECURITYADMIN|ORGADMIN|PRODUCTION|\bPROD\b|NETWORK\s+POLICY|AUTHENTICATION\s+POLICY)\b",
    re.IGNORECASE,
)


def _resource(tool_input: dict[str, Any]) -> str:
    for key in ("resource", "path", "file_path", "command", "sql", "query", "action"):
        value = tool_input.get(key)
        if value:
            return str(value)
    return json.dumps(tool_input, sort_keys=True, default=str)[:1000]


def _risk(tool_name: str, tool_input: dict[str, Any]) -> tuple[str, bool]:
    resource = _resource(tool_input)
    if tool_name in {"Edit", "Write", "NotebookEdit"}:
        return "medium", True
    if tool_name == "Bash" or _MUTATING_SQL.search(resource):
        return "high", False
    if tool_name.startswith("mcp__"):
        return "medium", True
    return "low", True


class CocoRuntimeSession:
    def __init__(
        self,
        *,
        websocket: WebSocket,
        settings: Settings,
        oauth_token: str,
        snowflake_user: str,
        snowflake_role: str,
    ) -> None:
        self.websocket = websocket
        self.settings = settings
        self.oauth_token = oauth_token
        self.snowflake_user = snowflake_user
        self.snowflake_role = snowflake_role
        self.session_id = str(uuid4())
        self.context_hash = ""
        self.context: dict[str, Any] = {}
        self._client: Any = None
        self._turn_task: asyncio.Task[None] | None = None
        self._pending: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self._session_approvals: set[tuple[str, str]] = set()
        self._send_lock = asyncio.Lock()
        self._tmp: tempfile.TemporaryDirectory[str] | None = None
        self._home: Path | None = None
        self._output_schema: dict[str, Any] | None = None

    async def emit(
        self,
        message_type: str,
        *,
        request_id: str,
        data: dict[str, Any] | None = None,
        error: dict[str, Any] | None = None,
    ) -> None:
        frame = CocoServerFrame(
            type=message_type,
            session_id=self.session_id,
            request_id=request_id,
            context_hash=self.context_hash,
            data=data,
            error=error,
        )
        async with self._send_lock:
            await self.websocket.send_json(frame.model_dump(mode="json"))

    async def start(self, frame: CocoClientFrame) -> None:
        if self._client is not None:
            raise ValueError("CoCo session is already started")
        snapshot = WorkbenchContextSnapshotV1.model_validate(
            frame.data.get("workspace_context") or {}
        )
        self.context = snapshot.model_dump(mode="json")
        self.context_hash = frame.context_hash or str(self.context.get("context_hash") or "")
        candidate_schema = frame.data.get("output_schema")
        self._output_schema = candidate_schema if isinstance(candidate_schema, dict) else None
        self._prepare_private_home()
        self._client = await self._create_sdk_client()
        await self.emit(
            "session.ready",
            request_id=frame.request_id,
            data={
                "persona": "ADMIN",
                "snowflake_user": self.snowflake_user,
                "snowflake_role": self.snowflake_role,
                "permission_mode": "plan",
                "context_hash": self.context_hash,
            },
        )

    def _prepare_private_home(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(prefix="workbench-coco-")
        self._home = Path(self._tmp.name)
        os.chmod(self._home, 0o700)
        snowflake_dir = self._home / ".snowflake"
        snowflake_dir.mkdir(mode=0o700)
        token_path = self._home / "oauth.token"
        token_path.write_text(self.oauth_token, encoding="utf-8")
        os.chmod(token_path, 0o600)
        context_path = self._home / "workspace-context.json"
        context_path.write_text(json.dumps(self.context, default=str), encoding="utf-8")
        os.chmod(context_path, 0o600)
        connection = (
            "[workbench_oauth]\n"
            f"account = {json.dumps(self.settings.coco_snowflake_account)}\n"
            f"user = {json.dumps(self.snowflake_user)}\n"
            'authenticator = "oauth"\n'
            f"token_file_path = {json.dumps(str(token_path))}\n"
            f"role = {json.dumps(self.snowflake_role)}\n"
            f"warehouse = {json.dumps(self.settings.coco_snowflake_warehouse)}\n"
            f"database = {json.dumps(self.settings.coco_snowflake_database)}\n"
            f"schema = {json.dumps(self.settings.coco_snowflake_schema)}\n"
        )
        connections_path = snowflake_dir / "connections.toml"
        connections_path.write_text(connection, encoding="utf-8")
        os.chmod(connections_path, 0o600)

    async def _create_sdk_client(self) -> Any:
        try:
            from cortex_code_agent_sdk import CortexCodeAgentOptions, CortexCodeSDKClient
        except ImportError as exc:  # pragma: no cover - deployment dependency
            raise RuntimeError("Cortex Code Agent SDK is not installed") from exc
        assert self._home is not None
        knowledge_dir = Path(self.settings.coco_knowledge_dir)
        prompt = (knowledge_dir / "STTM_WORKBENCH.md").read_text(encoding="utf-8")
        env = {
            "HOME": str(self._home),
            "COCO_CONTEXT_FILE": str(self._home / "workspace-context.json"),
            "COCO_TOKEN_FILE": str(self._home / "oauth.token"),
            "COCO_WORKBENCH_API_URL": self.settings.coco_workbench_api_url,
            "COCO_REQUEST_USER": self.snowflake_user,
            "COCO_REQUEST_ROLE": self.snowflake_role,
            "COCO_KNOWLEDGE_DIR": str(knowledge_dir),
        }
        options = CortexCodeAgentOptions(
            cwd=knowledge_dir,
            connection="workbench_oauth",
            permission_mode="plan",
            can_use_tool=self._can_use_tool,
            include_partial_messages=True,
            cli_path=self.settings.coco_cli_path,
            system_prompt={"type": "preset", "append": prompt},
            mcp_servers={
                "workbench": {
                    "command": str(Path(os.sys.executable)),
                    "args": ["-m", "app.coco.mcp_server"],
                    "env": env,
                }
            },
            env=env,
            output_format=(
                {"type": "json_schema", "schema": self._output_schema}
                if self._output_schema
                else None
            ),
        )
        client = CortexCodeSDKClient(options)
        await client.connect()
        return client

    async def handle(self, frame: CocoClientFrame) -> None:
        if frame.type == "session.start":
            await self.start(frame)
            return
        if frame.type == "heartbeat":
            await self.emit("session.ready", request_id=frame.request_id, data={"heartbeat": True})
            return
        if frame.type == "session.cancel":
            await self.cancel(request_id=frame.request_id)
            return
        if frame.type == "permission.decide":
            decision = PermissionDecision.model_validate(frame.data)
            self._resolve_pending(decision.permission_id, decision.model_dump())
            return
        if frame.type == "question.answer":
            answer = QuestionAnswer.model_validate(frame.data)
            self._resolve_pending(answer.permission_id, answer.model_dump())
            return
        if frame.type == "plan.review":
            review = PlanReview.model_validate(frame.data)
            self._resolve_pending(review.permission_id, review.model_dump())
            return
        if frame.type == "message.send":
            if self._client is None:
                raise ValueError("Send session.start before message.send")
            if self._turn_task and not self._turn_task.done():
                raise ValueError("A CoCo turn is already running")
            prompt = str(frame.data.get("message") or "").strip()
            if not prompt:
                raise ValueError("message.send requires data.message")
            latest_snapshot = frame.data.get("workspace_context")
            if isinstance(latest_snapshot, dict):
                validated = WorkbenchContextSnapshotV1.model_validate(latest_snapshot)
                self.context = validated.model_dump(mode="json")
                self.context_hash = frame.context_hash or validated.context_hash
                if self._home is not None:
                    context_path = self._home / "workspace-context.json"
                    context_path.write_text(json.dumps(self.context, default=str), encoding="utf-8")
                    os.chmod(context_path, 0o600)
            self._turn_task = asyncio.create_task(self._run_turn(prompt, frame.request_id))

    async def _run_turn(self, prompt: str, request_id: str) -> None:
        try:
            await self.emit(
                "assistant.status",
                request_id=request_id,
                data={"phase": "running", "message": "CoCo is working with the current workspace context."},
            )
            context_json = json.dumps(self.context, separators=(",", ":"), default=str)
            await self._client.query(
                f"Current WorkbenchContextSnapshotV1 (hash={self.context_hash}):\n"
                f"{context_json}\n\nUser request:\n{prompt}"
            )
            async for message in self._client.receive_response():
                await self._emit_sdk_message(message, request_id)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("CoCo turn failed session_id=%s request_id=%s", self.session_id, request_id)
            await self.emit(
                "assistant.error",
                request_id=request_id,
                error={
                    "type": "about:blank",
                    "title": "CoCo request failed",
                    "status": 502,
                    "detail": "The deep-agent request could not be completed.",
                    "code": "COCO_REQUEST_FAILED",
                },
            )

    async def _emit_sdk_message(self, message: Any, request_id: str) -> None:
        class_name = type(message).__name__
        if class_name == "StreamEvent":
            event = getattr(message, "event", {}) or {}
            delta = event.get("delta", {})
            if event.get("type") == "content_block_delta" and delta.get("type") == "text_delta":
                await self.emit(
                    "assistant.delta",
                    request_id=request_id,
                    data={"text": str(delta.get("text") or "")},
                )
            return
        if class_name == "AssistantMessage":
            for block in getattr(message, "content", []) or []:
                if getattr(block, "type", "") == "tool_use":
                    await self.emit(
                        "tool.started",
                        request_id=request_id,
                        data={
                            "tool_use_id": getattr(block, "id", None),
                            "tool": getattr(block, "name", "unknown"),
                        },
                    )
            return
        if class_name == "UserMessage":
            result = getattr(message, "tool_use_result", None)
            if result is not None:
                await self.emit("tool.completed", request_id=request_id, data={"result": result})
            return
        if class_name == "ResultMessage":
            is_error = bool(getattr(message, "is_error", False))
            if is_error:
                await self.emit(
                    "assistant.error",
                    request_id=request_id,
                    error={
                        "type": "about:blank",
                        "title": "CoCo returned an error",
                        "status": 502,
                        "detail": str(getattr(message, "result", None) or "CoCo could not finish the request."),
                        "code": "COCO_RESULT_ERROR",
                    },
                )
            else:
                await self.emit(
                    "assistant.final",
                    request_id=request_id,
                    data={
                        "message": getattr(message, "result", None),
                        "structured_output": getattr(message, "structured_output", None),
                        "duration_ms": getattr(message, "duration_ms", None),
                        "turns": getattr(message, "num_turns", None),
                    },
                )

    async def _can_use_tool(self, tool_name: str, tool_input: dict[str, Any], context: Any) -> Any:
        from cortex_code_agent_sdk import PermissionResultAllow, PermissionResultDeny

        if tool_name == "AskUserQuestion":
            result = await self._request_decision(
                "question.requested",
                tool_name,
                tool_input,
                tool_use_id=str(getattr(context, "tool_use_id", "")),
            )
            if result.get("answers"):
                return PermissionResultAllow(
                    updated_input={"questions": tool_input.get("questions", []), "answers": result["answers"]}
                )
            return PermissionResultDeny(message="User cancelled the question")

        if tool_name == "ExitPlanMode":
            result = await self._request_decision(
                "plan.approval_requested",
                tool_name,
                tool_input,
                tool_use_id=str(getattr(context, "tool_use_id", "")),
            )
            if result.get("decision") == "approve":
                return PermissionResultAllow(updated_input={"message": result.get("feedback", "")})
            return PermissionResultDeny(message=result.get("feedback") or "Plan was not approved")

        resource = _resource(tool_input)
        if _PROHIBITED.search(resource):
            return PermissionResultDeny(
                message="This account/security/production operation is outside the CoCo allowlist."
            )
        if self._is_auto_allowed(tool_name, tool_input):
            return PermissionResultAllow()
        normalized = self._normalize_resource(resource)
        if (tool_name, normalized) in self._session_approvals:
            return PermissionResultAllow()

        result = await self._request_decision(
            "permission.requested",
            tool_name,
            tool_input,
            tool_use_id=str(getattr(context, "tool_use_id", "")),
        )
        decision = result.get("decision")
        logger.info(
            "coco.permission_decision session_id=%s tool=%s resource_hash=%s decision=%s",
            self.session_id,
            tool_name,
            normalized,
            decision,
        )
        if decision in {"allow_once", "allow_session"}:
            if decision == "allow_session":
                self._session_approvals.add((tool_name, normalized))
            return PermissionResultAllow()
        return PermissionResultDeny(
            message=result.get("feedback") or "User denied this action",
            interrupt=decision == "cancel",
        )

    def _is_auto_allowed(self, tool_name: str, tool_input: dict[str, Any]) -> bool:
        if tool_name in {"Read", "Glob", "Grep", "LS"}:
            resource = _resource(tool_input)
            if not resource:
                return False
            candidate = Path(resource).expanduser()
            if not candidate.is_absolute():
                candidate = Path(self.settings.coco_knowledge_dir) / candidate
            with suppress(OSError):
                resolved = candidate.resolve()
                allowed_roots = [Path(self.settings.coco_knowledge_dir).resolve()]
                if self._home is not None:
                    allowed_roots.append(self._home.resolve())
                return any(resolved == root or root in resolved.parents for root in allowed_roots)
            return False
        if tool_name in _SAFE_TOOLS:
            return True
        if tool_name.startswith("mcp__workbench__"):
            return any(tool_name.endswith(suffix) for suffix in _SAFE_MCP_SUFFIXES)
        resource = _resource(tool_input)
        if "sql" in tool_name.lower() or "query" in tool_name.lower():
            return not _MUTATING_SQL.search(resource)
        return False

    async def _request_decision(
        self,
        event_type: str,
        tool_name: str,
        tool_input: dict[str, Any],
        *,
        tool_use_id: str,
    ) -> dict[str, Any]:
        permission_id = str(uuid4())
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending[permission_id] = future
        risk, reversible = _risk(tool_name, tool_input)
        resource = _resource(tool_input)
        data: dict[str, Any] = {
            "permission_id": permission_id,
            "tool_use_id": tool_use_id,
            "tool": tool_name,
            "input": tool_input,
            "resource": resource,
            "reason": str(tool_input.get("reason") or tool_input.get("description") or "CoCo requested this tool."),
            "expected_effect": str(tool_input.get("action") or "Execute the requested tool action."),
            "risk": risk,
            "reversible": reversible,
        }
        if event_type == "question.requested":
            data["questions"] = tool_input.get("questions", [])
        if event_type == "plan.approval_requested":
            data["plan"] = tool_input.get("plan", "")
            data["question"] = tool_input.get("question")
        await self.emit(event_type, request_id=tool_use_id or permission_id, data=data)
        try:
            return await asyncio.wait_for(future, timeout=self.settings.coco_permission_timeout_seconds)
        except TimeoutError:
            return {"decision": "deny", "feedback": "Permission request timed out"}
        finally:
            self._pending.pop(permission_id, None)

    @staticmethod
    def _normalize_resource(resource: str) -> str:
        return hashlib.sha256(resource.strip().encode("utf-8")).hexdigest()

    def _resolve_pending(self, permission_id: str, value: dict[str, Any]) -> None:
        future = self._pending.get(permission_id)
        if future and not future.done():
            future.set_result(value)

    async def cancel(self, *, request_id: str) -> None:
        if self._turn_task and not self._turn_task.done():
            with suppress(Exception):
                await self._client.interrupt()
            self._turn_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._turn_task
        for future in self._pending.values():
            if not future.done():
                future.set_result({"decision": "cancel", "feedback": "Session cancelled"})
        await self.emit("assistant.status", request_id=request_id, data={"phase": "cancelled"})

    async def close(self) -> None:
        if self._turn_task and not self._turn_task.done():
            self._turn_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._turn_task
        for future in self._pending.values():
            if not future.done():
                future.set_result({"decision": "deny", "feedback": "Session disconnected"})
        if self._client is not None:
            with suppress(Exception):
                await self._client.disconnect()
        self.oauth_token = ""
        if self._tmp is not None:
            self._tmp.cleanup()
            self._tmp = None
