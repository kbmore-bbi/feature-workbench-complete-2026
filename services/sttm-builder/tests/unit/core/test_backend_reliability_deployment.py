import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]


def test_semantic_version_uses_insert_select_for_json_binds() -> None:
    sql = (
        ROOT
        / "infra/snowflake/fir_system/procedures/sp-fir-create-semantic-version.sql"
    ).read_text()
    insert = sql[sql.index("INSERT INTO __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_VIEW_VERSIONS") :]
    assert ") SELECT" in insert
    assert ") VALUES" not in insert
    assert "PARSE_JSON(?)" in insert


def test_safe_powershell_renderer_exports_every_service_placeholder() -> None:
    script = (ROOT / "scripts/deploy_spcs_client_snow_safe.ps1").read_text()
    exported = set(re.findall(r"\$env:([A-Z][A-Z0-9_]*)\s*=", script))
    for relative in (
        "infra/snowflake/service-specs/webapp.yaml.tmpl",
        "infra/snowflake/service-specs/automap-worker.yaml.tmpl",
    ):
        template = (ROOT / relative).read_text()
        placeholders = set(re.findall(r"\$\{([A-Z][A-Z0-9_]*)\}", template))
        assert placeholders <= exported, sorted(placeholders - exported)


def test_low_confidence_review_is_off_in_backend_defaults() -> None:
    config = (ROOT / "services/sttm-builder/app/core/config.py").read_text()
    match = re.search(
        r"low_confidence_join_review_v1: bool = Field\(\s*default=(True|False)",
        config,
    )
    assert match and match.group(1) == "False"
