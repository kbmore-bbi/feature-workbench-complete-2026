from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from app.guardrails.contracts.decisions import GovernanceDecision

logger = logging.getLogger("app.guardrails.audit")
_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="guardrails-audit")


class AsyncAuditLogger:
    def emit(self, *, decision: GovernanceDecision, payload: dict[str, Any]) -> None:
        def _write() -> None:
            logger.info(
                "guardrails_audit trace_id=%s request_id=%s operation=%s persona=%s approval_required=%s warnings=%s payload=%s",
                decision.trace_id,
                decision.request_id,
                decision.operation,
                decision.persona,
                decision.approval_required,
                [warning.code for warning in decision.warnings],
                payload,
            )

        _EXECUTOR.submit(_write)
