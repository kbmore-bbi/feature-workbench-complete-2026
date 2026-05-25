from __future__ import annotations

import re
from typing import Any

from app.guardrails.adapters.base import PIIDetector, PIIMatch
from app.guardrails.adapters.presidio import PresidioPIIDetector
from app.guardrails.config.schema import RedactionConfig


_EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
_PHONE_RE = re.compile(r"\b(?:\+?\d[\d .()-]{7,}\d)\b")
_SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_CARD_RE = re.compile(r"\b(?:\d[ -]*?){13,16}\b")
_IDENTIFIER_KEYS = {
    "database",
    "schema",
    "table",
    "attribute",
    "target_attribute",
    "left_column",
    "right_column",
    "thread_id",
    "request_id",
    "operation",
    "intent",
    "agent",
    "scope",
    "semantic_view_name",
    "semantic_bundle_id",
    "semantic_bundle_label",
}


class InternalPIIDetector(PIIDetector):
    def detect(self, text: str) -> list[PIIMatch]:
        matches: list[PIIMatch] = []
        for entity_type, pattern in (
            ("EMAIL", _EMAIL_RE),
            ("PHONE", _PHONE_RE),
            ("SSN", _SSN_RE),
            ("CREDIT_CARD", _CARD_RE),
        ):
            for match in pattern.finditer(text):
                matches.append(
                    PIIMatch(
                        entity_type=entity_type,
                        start=match.start(),
                        end=match.end(),
                        text=match.group(0),
                    )
                )
        return matches


def build_detector(config: RedactionConfig) -> PIIDetector:
    if config.engine == "presidio":
        try:
            return PresidioPIIDetector()
        except Exception:
            return InternalPIIDetector()
    return InternalPIIDetector()


class RedactionResult:
    def __init__(self, value: Any, redaction_count: int, detected_pii: list[str]) -> None:
        self.value = value
        self.redaction_count = redaction_count
        self.detected_pii = detected_pii


class Redactor:
    def __init__(self, config: RedactionConfig) -> None:
        self._config = config
        self._detector = build_detector(config)

    def redact_text(self, text: str) -> RedactionResult:
        matches = self._detector.detect(text)
        filtered = [match for match in matches if match.entity_type in self._config.pii_types]
        if not filtered:
            return RedactionResult(text, 0, [])

        redacted = text
        for match in sorted(filtered, key=lambda item: item.start, reverse=True):
            replacement = self._replacement(match.entity_type)
            redacted = redacted[: match.start] + replacement + redacted[match.end :]

        return RedactionResult(redacted, len(filtered), sorted({item.entity_type for item in filtered}))

    def redact_value(self, value: Any, *, path: tuple[str, ...] = ()) -> RedactionResult:
        key = path[-1] if path else ""
        if isinstance(value, str):
            if key in _IDENTIFIER_KEYS:
                return RedactionResult(value, 0, [])
            return self.redact_text(value)

        if isinstance(value, list):
            items = []
            count = 0
            pii: list[str] = []
            for index, item in enumerate(value):
                result = self.redact_value(item, path=(*path, str(index)))
                items.append(result.value)
                count += result.redaction_count
                pii.extend(result.detected_pii)
            return RedactionResult(items, count, sorted(set(pii)))

        if isinstance(value, dict):
            sanitized: dict[str, Any] = {}
            count = 0
            pii: list[str] = []
            for item_key, item_value in value.items():
                result = self.redact_value(item_value, path=(*path, str(item_key)))
                sanitized[item_key] = result.value
                count += result.redaction_count
                pii.extend(result.detected_pii)
            return RedactionResult(sanitized, count, sorted(set(pii)))

        return RedactionResult(value, 0, [])

    @staticmethod
    def _replacement(entity_type: str) -> str:
        return f"[REDACTED_{entity_type}]"
