#!/usr/bin/env python3
"""Render the SPCS service spec template using environment variables."""

from __future__ import annotations

import argparse
import os
import re
from pathlib import Path
from string import Template
from urllib.parse import urlparse


_OPTIONAL_TEMPLATE_DEFAULTS = {
    # PowerShell removes process environment variables when they are assigned an
    # empty string. Same-origin SPCS deployments intentionally leave this blank,
    # so preserve the empty value during template substitution.
    "CORS_ALLOWED_ORIGINS": "",
    "SNOWFLAKE_PREPARATION_WAREHOUSE": "",
    "SNOWFLAKE_PREPARATION_STATEMENT_TIMEOUT_SECONDS": "300",
    "PERF_DIAGNOSTICS_V1": "true",
    "PREPARED_CONTEXT_CACHE_V2": "true",
    "CONTEXT_SINGLEFLIGHT_V1": "true",
    "FIR_QUERY_PRUNING_V1": "true",
    "TARGET_SCOPED_CACHE_INVALIDATION_V1": "true",
    "RELATIONSHIP_CAPABILITY_CACHE_V1": "true",
    "RELATIONSHIP_PROC_FAST_GUARDS_V1": "true",
    "LOW_CONFIDENCE_JOIN_REVIEW_V1": "true",
    "CONVERSATION_MEMORY_V2": "true",
    "SNOWFLAKE_SESSION_LEASE_POOL_V1": "false",
    "LEARNING_PARALLEL_V1": "false",
    "PREPARE_PARALLEL_V1": "false",
    "AUTOSAVE_SINGLEFLIGHT_V1": "true",
    "AUTOSAVE_POSTSAVE_ASYNC_V1": "false",
    "PREPARATION_WAREHOUSE_ROUTING_V1": "false",
    "DURABLE_STTM_ROUTE_V1": "true",
    "AGENT_STREAM_BATCHING_V1": "true",
}


def _validate_spcs_oauth_config(template_path: Path) -> None:
    if template_path.name not in {"webapp.yaml.tmpl", "sttm-builder.yaml.tmpl"}:
        return
    if os.environ.get("AUTH_MODE", "").strip().lower() != "custom_oauth":
        return

    redirect_uri = os.environ.get("SNOWFLAKE_OAUTH_REDIRECT_URI", "").strip()
    parsed = urlparse(redirect_uri)
    if parsed.scheme != "https" or parsed.hostname in {"localhost", "127.0.0.1", "::1"}:
        raise SystemExit(
            "SNOWFLAKE_OAUTH_REDIRECT_URI for the SPCS webapp must be an HTTPS "
            "public callback URL; localhost and loopback redirects are rejected"
        )
    if os.environ.get("AUTH_SESSION_COOKIE_SECURE", "").strip().lower() != "true":
        raise SystemExit(
            "AUTH_SESSION_COOKIE_SECURE must be true for custom OAuth in SPCS"
        )


def render_template(raw_template: str, environment: dict[str, str]) -> str:
    if environment.get("COCO_SIDECAR_ENABLED", "false").strip().lower() not in {
        "1",
        "true",
        "yes",
    }:
        raw_template = re.sub(
            r"(?ms)^\s*# BEGIN COCO_SIDECAR\n.*?^\s*# END COCO_SIDECAR\n?",
            "",
            raw_template,
        )
    else:
        raw_template = raw_template.replace(
            "    # BEGIN COCO_SIDECAR\n", ""
        ).replace("    # END COCO_SIDECAR\n", "")
    template_values = dict(_OPTIONAL_TEMPLATE_DEFAULTS)
    template_values.update(environment)
    rendered = Template(raw_template).safe_substitute(template_values)
    unresolved = sorted(
        set(re.findall(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}", rendered))
    )
    if unresolved:
        raise SystemExit(
            "SPCS template contains unresolved environment variables: "
            + ", ".join(unresolved)
        )
    return rendered


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    template_path = Path(args.template)
    _validate_spcs_oauth_config(template_path)
    raw_template = template_path.read_text(encoding="utf-8")
    rendered = render_template(raw_template, dict(os.environ))
    Path(args.output).write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
