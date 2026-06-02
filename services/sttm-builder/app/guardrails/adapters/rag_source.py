from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.guardrails.config.schema import GuardrailsConfig


@dataclass(frozen=True)
class RetrievedChunk:
    source_id: str
    source_type: str
    text: str


class SemanticContextRAGSource:
    def __init__(self, config: GuardrailsConfig) -> None:
        self._config = config

    def retrieve(self, context: dict[str, Any]) -> list[RetrievedChunk]:
        source_config = self._config.rag_sources.get("semantic_context")
        if source_config is None or not source_config.enabled:
            return []
        chunks: list[RetrievedChunk] = []
        semantic_context = context.get("semantic_context") or []
        for index, item in enumerate(semantic_context[: source_config.max_chunks]):
            table = ((item or {}).get("table") or {})
            semantic_model = (item or {}).get("semantic_model")
            if not semantic_model:
                continue
            source_id = ".".join(
                [
                    str(table.get("database") or "").strip(),
                    str(table.get("schema") or "").strip(),
                    str(table.get("table") or "").strip(),
                ]
            ).strip(".") or f"semantic_context_{index}"
            chunks.append(
                RetrievedChunk(
                    source_id=source_id,
                    source_type="semantic_context",
                    text=str(semantic_model),
                )
            )
        datahub_context = context.get("datahub_context")
        if datahub_context:
            chunks.append(
                RetrievedChunk(
                    source_id="datahub_context",
                    source_type="datahub_context",
                    text=str(datahub_context),
                )
            )
        return chunks[: source_config.max_chunks]
