from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class PIIMatch:
    entity_type: str
    start: int
    end: int
    text: str


class PIIDetector(Protocol):
    def detect(self, text: str) -> list[PIIMatch]:
        ...
