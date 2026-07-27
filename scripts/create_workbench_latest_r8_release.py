#!/usr/bin/env python3
"""Build and validate the source-only client AVD r8 delta overlay."""

from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RELEASE_DIR = ROOT / "release-packages/20260727-workbench-latest-client-avd-r8"
ZIP_NAME = "bbi-mig-ai-workbench-20260727-workbench-latest-client-avd-r8.zip"

FILES = """
frontend/src/api/routes.ts
frontend/src/features/ai-agent/ai-agent-panel.tsx
frontend/src/features/dashboard/NewMappingDialog.tsx
frontend/src/features/sttm/context/sttm-builder-context.tsx
frontend/src/features/sttm/store/sttm-builder-slice.ts
frontend/src/features/sttm/types/sttm.types.ts
frontend/src/services/conversationService.ts
frontend/src/services/preparedContextService.ts
frontend/src/services/workbenchService.ts
frontend/src/types/api-contract.ts
infra/snowflake/agents/agent_spec_manifest.json
infra/snowflake/agents/agent_spec_source_mapping.yaml
infra/snowflake/agents/agent_spec_sttm_builder.yaml
infra/snowflake/agents/agent_spec_transformation_rule.yaml
infra/snowflake/create-table-ddl.sql
infra/snowflake/env/client.env.example
infra/snowflake/env/dev.env.example
infra/snowflake/fir_system/tables/fir_v2_schema.sql
infra/snowflake/service-specs/automap-worker.yaml.tmpl
infra/snowflake/service-specs/sttm-builder.yaml.tmpl
scripts/deploy_spcs_client_snow.ps1
scripts/deploy_spcs_client_snow.sh
scripts/deploy_spcs_client_snow_safe.ps1
scripts/deploy_spcs_client_snow_single_service.ps1
scripts/render_spcs_spec.py
services/sttm-builder/.env.example
services/sttm-builder/app/api/__init__.py
services/sttm-builder/app/api/deps.py
services/sttm-builder/app/core/agent_execution_context.py
services/sttm-builder/app/core/config.py
services/sttm-builder/app/core/conversation.py
services/sttm-builder/app/core/conversation_continuity.py
services/sttm-builder/app/core/conversation_memory.py
services/sttm-builder/app/core/learning_retrieval.py
services/sttm-builder/app/core/prepared_context.py
services/sttm-builder/app/core/project_service.py
services/sttm-builder/app/core/semantic_context.py
services/sttm-builder/app/core/snowflake_analyst.py
services/sttm-builder/app/core/sttm_builder.py
services/sttm-builder/app/core/target_mapping_patterns.py
services/sttm-builder/app/routers/conversation.py
services/sttm-builder/app/routers/fir_learning.py
services/sttm-builder/app/routers/prepared_context.py
services/sttm-builder/app/routers/sttm_builder.py
services/sttm-builder/app/routers/upload.py
services/sttm-builder/app/schema/conversation.py
services/sttm-builder/app/schema/fir_patterns.py
services/sttm-builder/app/schema/prepared_context.py
services/sttm-builder/app/schema/sttm_builder.py
services/sttm-builder/tests/unit/core/test_prepared_context.py
services/sttm-builder/tests/unit/core/test_stream_text_delta.py
services/sttm-builder/tests/unit/core/test_sttm_payload_contract.py
services/sttm-builder/tests/unit/core/test_target_mapping_patterns.py
services/sttm-builder/tests/unit/guardrails/test_settings.py
""".strip().splitlines()

PACKAGE_DOCS = [
    "release-packages/20260727-workbench-latest-client-avd-r8/README_CLIENT_AVD.md",
    "release-packages/20260727-workbench-latest-client-avd-r8/CLIENT_ENV_DELTA.md",
]

FORBIDDEN_PARTS = {
    ".git",
    ".next",
    "node_modules",
    ".venv",
    "__pycache__",
}
FORBIDDEN_NAMES = {
    ".env",
    ".env.local",
    "client.env",
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    paths = [ROOT / relative for relative in [*FILES, *PACKAGE_DOCS]]
    missing = [str(path.relative_to(ROOT)) for path in paths if not path.is_file()]
    if missing:
        raise SystemExit(f"Missing release files: {missing}")

    for path in paths:
        relative = path.relative_to(ROOT)
        if any(part in FORBIDDEN_PARTS for part in relative.parts):
            raise SystemExit(f"Forbidden release path: {relative}")
        if path.name in FORBIDDEN_NAMES:
            raise SystemExit(f"Forbidden release file: {relative}")

    zip_path = RELEASE_DIR / ZIP_NAME
    with zipfile.ZipFile(
        zip_path,
        "w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as archive:
        for path in paths:
            relative = path.relative_to(ROOT)
            if relative.parts[:2] == ("release-packages", RELEASE_DIR.name):
                archive_name = path.name
            else:
                archive_name = relative.as_posix()
            archive.write(path, archive_name)

    if zip_path.stat().st_size >= 25 * 1024 * 1024:
        raise SystemExit(f"{zip_path.name} exceeds the 25 MB client limit")

    manifest = {
        "release": RELEASE_DIR.name,
        "baseline": "20260724-warehouse-cost-rollover-client-avd-r7",
        "zip": ZIP_NAME,
        "file_count": len(paths),
        "size_bytes": zip_path.stat().st_size,
        "sha256": sha256(zip_path),
        "files": [
            {
                "path": (
                    path.name
                    if path.relative_to(ROOT).parts[:2]
                    == ("release-packages", RELEASE_DIR.name)
                    else path.relative_to(ROOT).as_posix()
                ),
                "size_bytes": path.stat().st_size,
                "sha256": sha256(path),
            }
            for path in paths
        ],
    }
    manifest_path = RELEASE_DIR / "MANIFEST.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (RELEASE_DIR / "MANIFEST.txt").write_text(
        "\n".join(
            [
                f"Release: {manifest['release']}",
                f"Baseline: {manifest['baseline']}",
                f"ZIP: {ZIP_NAME}",
                f"Files: {manifest['file_count']}",
                f"Size: {manifest['size_bytes']} bytes",
                f"SHA-256: {manifest['sha256']}",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    with zipfile.ZipFile(zip_path) as archive:
        bad = archive.testzip()
        if bad:
            raise SystemExit(f"ZIP integrity failure at {bad}")

    print(json.dumps(manifest | {"files": len(paths)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
