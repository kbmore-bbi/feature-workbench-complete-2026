from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class TrustLabel(str, Enum):
    SYSTEM_POLICY = "system_policy"
    GOVERNED_STRUCTURED_DATA = "governed_structured_data"
    USER_INPUT = "user_input"
    RETRIEVED_UNTRUSTED = "retrieved_untrusted"
    TOOL_OUTPUT_UNTRUSTED = "tool_output_untrusted"
    AGENT_OUTPUT_UNTRUSTED = "agent_output_untrusted"
    HUMAN_APPROVED = "human_approved"


class TrustAssertion(BaseModel):
    label: TrustLabel
    source: str
    detail: str | None = None


class TrustBundle(BaseModel):
    assertions: list[TrustAssertion] = Field(default_factory=list)

    def labels(self) -> list[str]:
        return [assertion.label.value for assertion in self.assertions]
