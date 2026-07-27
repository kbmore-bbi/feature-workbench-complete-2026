#!/usr/bin/env python3
"""Create the split, source-only client AVD release package."""

from __future__ import annotations

import argparse
import hashlib
import json
import stat
import zipfile
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RELEASE_ROOT = ROOT / "release-packages"

EXCLUDED_PARTS = {
    ".git",
    ".next",
    "node_modules",
    ".venv",
    ".client-tools-venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "coverage",
    "dist",
    "build",
}
EXCLUDED_NAMES = {
    ".DS_Store",
    ".env",
    ".env.local",
    ".env.development.local",
    ".env.production.local",
    ".env.test.local",
    "client.env",
    "next-env.d.ts",
    "tsconfig.tsbuildinfo",
}
EXCLUDED_PREFIXES = (
    ".next-",
)
SENSITIVE_DOC_SUFFIXES = {".xlsx", ".xls", ".csv", ".sql"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--timestamp",
        default=datetime.now().strftime("%Y%m%d-%H%M"),
        help="Release timestamp used in directory and zip names.",
    )
    return parser.parse_args()


def should_include(path: Path, *, include_sensitive_docs: bool = False) -> bool:
    relative = path.relative_to(ROOT)
    if any(part in EXCLUDED_PARTS for part in relative.parts):
        return False
    if any(
        part.startswith(prefix)
        for part in relative.parts
        for prefix in EXCLUDED_PREFIXES
    ):
        return False
    if path.name in EXCLUDED_NAMES:
        return False
    if any(path.name.startswith(prefix) for prefix in EXCLUDED_PREFIXES):
        return False
    if path.is_symlink() or not path.is_file():
        return False
    if (
        relative.parts
        and relative.parts[0] == "docs"
        and path.suffix.lower() in SENSITIVE_DOC_SUFFIXES
        and not include_sensitive_docs
    ):
        return False
    return True


def collect(paths: list[Path]) -> list[Path]:
    result: list[Path] = []
    for candidate in paths:
        if candidate.is_file():
            if should_include(candidate):
                result.append(candidate)
            continue
        if not candidate.exists():
            continue
        result.extend(
            path
            for path in candidate.rglob("*")
            if should_include(path)
        )
    return sorted(set(result), key=lambda item: item.relative_to(ROOT).as_posix())


def write_zip(output: Path, files: list[Path]) -> None:
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in files:
            archive.write(path, path.relative_to(ROOT).as_posix())


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def setup_script(timestamp: str) -> str:
    return f"""# BBI AI Migration Workbench - Client AVD Extract & Setup
param(
    [string]$TargetDir = "C:\\workbench\\bbi-mig-ai-workbench",
    [switch]$SkipExtract,
    [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"
$ReleaseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Timestamp = "{timestamp}"
$Prefix = "bbi-mig-ai-workbench-$Timestamp"

Write-Host "BBI AI Migration Workbench release $Timestamp" -ForegroundColor Cyan
Write-Host "Target: $TargetDir" -ForegroundColor Cyan

if (-not $SkipExtract) {{
    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
    foreach ($part in @(
        "$Prefix-part1-root-scripts-infra-docs.zip",
        "$Prefix-part2-frontend-source.zip",
        "$Prefix-part3-sttm-builder-service.zip"
    )) {{
        $zipPath = Join-Path $ReleaseDir $part
        if (-not (Test-Path $zipPath)) {{ throw "Missing release part: $part" }}
        Expand-Archive -Path $zipPath -DestinationPath $TargetDir -Force
    }}
}}

$frontendDir = Join-Path $TargetDir "frontend"
if (-not $SkipNpmInstall -and (Test-Path $frontendDir)) {{
    Push-Location $frontendDir
    try {{ npm ci }} finally {{ Pop-Location }}
}}

$sttmDir = Join-Path $TargetDir "services\\sttm-builder"
if (Test-Path $sttmDir) {{
    Push-Location $sttmDir
    try {{
        if (-not (Test-Path ".venv")) {{ python -m venv .venv }}
        & .\\.venv\\Scripts\\pip install -e ".[dev]"
    }} finally {{ Pop-Location }}
}}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Green
Write-Host "1. Create infra\\snowflake\\env\\client.env from client.env.example."
Write-Host "2. Create services\\sttm-builder\\.env.local for local execution if needed."
Write-Host "3. Run scripts\\bootstrap_sttm_metadata_infra.ps1 to deploy metadata, FIR, search, tasks, and agents."
Write-Host "4. Verify FIR tasks, then resume them using infra\\snowflake\\fir_system\\tasks\\fir_tasks_resume.sql."
Write-Host "5. Create and publish historical mappings with scripts\\load_client_fir_knowledge.py."
Write-Host "6. Deploy SPCS with scripts\\run_client_spcs_browser_deploy.ps1."
Write-Host "   This deploys the main workbench and the separate AGT_SOURCE_MAPPING auto-mapping worker service."
"""


def main() -> int:
    args = parse_args()
    timestamp = str(args.timestamp)
    output_dir = RELEASE_ROOT / f"{timestamp}-client-avd"
    output_dir.mkdir(parents=True, exist_ok=False)
    prefix = f"bbi-mig-ai-workbench-{timestamp}"

    groups = [
        (
            "part1-root-scripts-infra-docs",
            collect(
                [
                    ROOT / "scripts",
                    ROOT / "infra",
                    ROOT / "nginx",
                    ROOT / "docs",
                    ROOT / "README.md",
                    ROOT / "package-lock.json",
                    ROOT / "start-ai-workbench-dev.sh",
                    ROOT / "deploy_bbi_workbench_v2.sh",
                ]
            ),
        ),
        (
            "part2-frontend-source",
            collect([ROOT / "frontend"]),
        ),
        (
            "part3-sttm-builder-service",
            collect([ROOT / "services" / "sttm-builder"]),
        ),
    ]

    manifest: list[dict[str, object]] = []
    for part, files in groups:
        filename = f"{prefix}-{part}.zip"
        path = output_dir / filename
        write_zip(path, files)
        size_mb = round(path.stat().st_size / (1024 * 1024), 2)
        manifest.append(
            {
                "file": filename,
                "part": part,
                "files": len(files),
                "size_mb": size_mb,
                "sha256": sha256(path),
                "under_25mb": size_mb < 25,
            }
        )
        if path.stat().st_size >= 25 * 1024 * 1024:
            raise RuntimeError(
                f"{filename} is {size_mb} MB; every GitHub upload part must remain below 25 MB."
            )

    complete_filename = f"{prefix}-complete-source.zip"
    complete_path = output_dir / complete_filename
    complete_files = sorted(
        {path for _, files in groups for path in files},
        key=lambda item: item.relative_to(ROOT).as_posix(),
    )
    write_zip(complete_path, complete_files)
    complete_size_mb = round(complete_path.stat().st_size / (1024 * 1024), 2)
    if complete_path.stat().st_size >= 25 * 1024 * 1024:
        raise RuntimeError(
            f"{complete_filename} is {complete_size_mb} MB; the complete GitHub upload "
            "must remain below 25 MB."
        )
    manifest.append(
        {
            "file": complete_filename,
            "part": "complete-source",
            "files": len(complete_files),
            "size_mb": complete_size_mb,
            "sha256": sha256(complete_path),
            "under_25mb": True,
        }
    )

    (output_dir / "MANIFEST.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    (output_dir / "MANIFEST.txt").write_text(
        "\n".join(
            f"{item['file']}\t{item['files']} files\t{item['size_mb']} MB\tsha256={item['sha256']}"
            for item in manifest
        )
        + "\n",
        encoding="utf-8",
    )
    setup_path = output_dir / "extract-and-setup.ps1"
    setup_path.write_text(setup_script(timestamp), encoding="utf-8")
    setup_path.chmod(setup_path.stat().st_mode | stat.S_IRUSR | stat.S_IWUSR)

    print(output_dir)
    for item in manifest:
        print(
            f"{item['file']}: {item['files']} files, "
            f"{item['size_mb']} MB, sha256={item['sha256']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
