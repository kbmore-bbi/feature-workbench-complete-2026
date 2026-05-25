from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SnowflakeGuardrailsConfig(BaseModel):
    account_level_guardrails: bool = True
    masking_policy_tag: str = "sensitivity"
    row_access_enabled: bool = True


class PersonaPolicyConfig(BaseModel):
    allowed_operations: list[str] = Field(default_factory=list)
    allow_sample_rows: bool = False
    allow_raw_pii: bool = False


class RedactionConfig(BaseModel):
    engine: Literal["internal", "presidio"] = "internal"
    pii_types: list[str] = Field(
        default_factory=lambda: ["EMAIL", "PHONE", "SSN", "CREDIT_CARD"]
    )
    on_detection: Literal["mask", "tokenize", "suppress", "warn"] = "mask"


class OutputConfig(BaseModel):
    require_human_approval_for: list[str] = Field(
        default_factory=lambda: ["mapping", "derived_source", "low_confidence"]
    )
    reject_if_contains_raw_pii: bool = False
    reject_sql_patterns: list[str] = Field(
        default_factory=lambda: [
            "DROP",
            "DELETE",
            "INSERT",
            "UPDATE",
            "CREATE",
            "ALTER",
            "TRUNCATE",
            "MERGE",
            "COPY",
            "PUT",
            "REMOVE",
        ]
    )


class AuditConfig(BaseModel):
    backend: Literal["logger", "snowflake"] = "logger"
    async_enabled: bool = True


class GuardrailsConfig(BaseModel):
    client_id: str
    enabled: bool = True
    snowflake: SnowflakeGuardrailsConfig = Field(default_factory=SnowflakeGuardrailsConfig)
    personas: dict[str, PersonaPolicyConfig] = Field(default_factory=dict)
    redaction: RedactionConfig = Field(default_factory=RedactionConfig)
    output: OutputConfig = Field(default_factory=OutputConfig)
    audit: AuditConfig = Field(default_factory=AuditConfig)
