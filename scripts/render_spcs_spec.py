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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    template_path = Path(args.template)
    _validate_spcs_oauth_config(template_path)
    template = Template(template_path.read_text(encoding="utf-8"))
    template_values = dict(_OPTIONAL_TEMPLATE_DEFAULTS)
    template_values.update(os.environ)
    rendered = template.safe_substitute(template_values)
    unresolved = sorted(set(re.findall(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}", rendered)))
    if unresolved:
        raise SystemExit(
            "SPCS template contains unresolved environment variables: "
            + ", ".join(unresolved)
        )
    Path(args.output).write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
