from __future__ import annotations

from app.guardrails.adapters.base import PIIDetector, PIIMatch


class PresidioPIIDetector(PIIDetector):
    def __init__(self) -> None:
        from presidio_analyzer import AnalyzerEngine  # type: ignore

        self._engine = AnalyzerEngine()

    def detect(self, text: str) -> list[PIIMatch]:
        results = self._engine.analyze(text=text, language="en")
        return [
            PIIMatch(
                entity_type=result.entity_type,
                start=result.start,
                end=result.end,
                text=text[result.start : result.end],
            )
            for result in results
        ]
