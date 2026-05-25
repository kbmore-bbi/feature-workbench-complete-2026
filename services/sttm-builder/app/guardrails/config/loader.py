from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.core.config import Settings
from app.guardrails.config.schema import (
    AuditConfig,
    GuardrailsConfig,
    OutputConfig,
    PersonaPolicyConfig,
    RedactionConfig,
    SnowflakeGuardrailsConfig,
)


def _default_personas() -> dict[str, PersonaPolicyConfig]:
    shared_ops = [
        "workbench.info",
        "sttm.auto_map",
        "sttm.chat",
        "sttm.transform",
        "semantic_model.generate",
        "semantic_model.get",
        "semantic_model.job_status",
    ]
    return {
        "VIEWER": PersonaPolicyConfig(
            allowed_operations=shared_ops,
            allow_sample_rows=False,
            allow_raw_pii=False,
        ),
        "PUBLISHER": PersonaPolicyConfig(
            allowed_operations=shared_ops,
            allow_sample_rows=False,
            allow_raw_pii=False,
        ),
        "ADMIN": PersonaPolicyConfig(
            allowed_operations=shared_ops,
            allow_sample_rows=True,
            allow_raw_pii=False,
        ),
    }


def build_default_config(settings: Settings | None = None) -> GuardrailsConfig:
    return GuardrailsConfig(
        client_id="bbi-mig-ai-workbench",
        enabled=True if settings is None else settings.guardrails_enabled,
        snowflake=SnowflakeGuardrailsConfig(
            account_level_guardrails=True,
            masking_policy_tag="sensitivity",
            row_access_enabled=True,
        ),
        personas=_default_personas(),
        redaction=RedactionConfig(
            engine="presidio" if settings and settings.guardrails_presidio_enabled else "internal"
        ),
        output=OutputConfig(reject_if_contains_raw_pii=settings.guardrails_reject_raw_pii if settings else False),
        audit=AuditConfig(backend="logger", async_enabled=True),
    )


def _load_yaml(path: Path) -> dict[str, Any]:
    try:
        import yaml  # type: ignore
    except ImportError as exc:
        raise RuntimeError("YAML config loading requires PyYAML to be installed.") from exc

    loaded = yaml.safe_load(path.read_text())
    if not isinstance(loaded, dict):
        raise ValueError(f"Expected a mapping in {path}")
    return loaded


def load_config(
    source: str | Path | dict[str, Any] | GuardrailsConfig | None = None,
    *,
    settings: Settings | None = None,
) -> GuardrailsConfig:
    if source is None:
        return build_default_config(settings)

    if isinstance(source, GuardrailsConfig):
        return source

    if isinstance(source, dict):
        return GuardrailsConfig.model_validate(source)

    path = Path(source)
    suffix = path.suffix.lower()
    if suffix == ".json":
        payload = json.loads(path.read_text())
    elif suffix in {".yaml", ".yml"}:
        payload = _load_yaml(path)
    else:
        raise ValueError(f"Unsupported guardrails config format: {path.suffix}")

    return GuardrailsConfig.model_validate(payload)
