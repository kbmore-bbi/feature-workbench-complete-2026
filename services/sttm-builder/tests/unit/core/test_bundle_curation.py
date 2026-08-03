from __future__ import annotations

import pytest

from app.core.bundle_curation import (
    BundleCurationError,
    BundleCurationService,
    BundleCurationStaleError,
)
from app.schema.bundle_curation import (
    BundleCurationPromotionRequest,
    BundleCurationRecord,
)


def _service(record: BundleCurationRecord) -> BundleCurationService:
    service = BundleCurationService.__new__(BundleCurationService)
    service.get = lambda _version_id: record  # type: ignore[method-assign]
    return service


def _record() -> BundleCurationRecord:
    return BundleCurationRecord(
        bundle_version_id="bundlever_1",
        semantic_bundle_id="bundle_1",
        base_bundle_hash="bundle_hash_1",
        workspace_context_hash="workspace_hash_1",
        validation_summary={
            "unresolved_count": 0,
            "target_binding": {"target_table": "CURATED.CRM.HOUSEHOLD"},
        },
        recommendations=[
            {
                "AGENT_RECOMMENDATION_ID": "validated_1",
                "STATUS": "draft",
                "VALIDATION_STATUS": "validated",
            },
            {
                "AGENT_RECOMMENDATION_ID": "unsupported_1",
                "STATUS": "active",
                "VALIDATION_STATUS": "semantic_missing",
            },
        ],
    )


def test_bundle_version_identity_is_stable_and_mapping_scoped() -> None:
    first = BundleCurationService.document_version_id(
        asset_id="asset_1",
        project_id="project_1",
        context_key="context_1",
        target_table="CURATED.CRM.HOUSEHOLD",
    )
    same = BundleCurationService.document_version_id(
        asset_id="asset_1",
        project_id="project_1",
        context_key="context_1",
        target_table="CURATED.CRM.HOUSEHOLD",
    )
    other_target = BundleCurationService.document_version_id(
        asset_id="asset_1",
        project_id="project_1",
        context_key="context_1",
        target_table="CURATED.CRM.CONTACT",
    )

    assert first == same
    assert first != other_target


def test_approve_all_only_includes_validated_active_recommendations() -> None:
    preview = _service(_record()).preview(
        "bundlever_1",
        BundleCurationPromotionRequest(
            expected_workspace_hash="workspace_hash_1",
            expected_bundle_hash="bundle_hash_1",
            approve_all_validated=True,
        ),
    )

    assert preview.can_promote is True
    assert preview.eligible_recommendation_ids == ["validated_1"]
    assert preview.blocked_recommendations[0]["recommendation_id"] == "unsupported_1"


def test_bulk_promotion_requires_explicit_approve_all() -> None:
    with pytest.raises(BundleCurationError, match="Approve all"):
        _service(_record()).preview(
            "bundlever_1",
            BundleCurationPromotionRequest(
                expected_workspace_hash="workspace_hash_1",
                expected_bundle_hash="bundle_hash_1",
            ),
        )


def test_stale_workspace_hash_blocks_bundle_promotion() -> None:
    with pytest.raises(BundleCurationStaleError, match="workspace changed"):
        _service(_record()).preview(
            "bundlever_1",
            BundleCurationPromotionRequest(
                expected_workspace_hash="stale_hash",
                expected_bundle_hash="bundle_hash_1",
                approve_all_validated=True,
            ),
        )
