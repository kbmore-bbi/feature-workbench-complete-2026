from __future__ import annotations

import copy
import hashlib
import json
import uuid
from typing import Any

from app.core.config import Settings
from app.core.conversation_memory import ConversationMemoryService
from app.core.derived_source import DerivedSourceService
from app.core.project_service import ProjectService
from app.schema.derived_source import DerivedSourceDefinition
from app.schema.project import STTMAutosaveRequest
from app.schema.recommendation_actions import (
    ApplicableRecommendation,
    RecommendationApplyResponse,
    RecommendationPreviewResponse,
    RecommendationUndoResponse,
    WorkspaceDiffOperation,
)


class RecommendationActionError(ValueError):
    pass


class RecommendationNotFoundError(RecommendationActionError):
    pass


class RecommendationStaleError(RecommendationActionError):
    pass


class RecommendationBlockedError(RecommendationActionError):
    pass


class RecommendationPermissionError(RecommendationActionError):
    pass


def ensure_recommendation_apply_permission(permissions: Any) -> None:
    if not bool(getattr(permissions, "can_edit", False)):
        raise RecommendationPermissionError(
            "Recommendation apply permission is required."
        )


_ACTION_ALIASES = {
    "add_source_table": "add_source_table",
    "select_table": "add_source_table",
    "select_source_column": "select_source_column",
    "apply_direct_mapping": "apply_direct_mapping",
    "bind_value": "bind_value",
    "apply_transformation": "apply_transformation",
    "add_relationship": "add_relationship",
    "preview_join": "add_relationship",
    "upsert_derived_source": "upsert_derived_source",
    "draft_derived_source": "upsert_derived_source",
    "open_source_preparation": "open_source_preparation",
    "apply_sql_repair": "apply_sql_repair",
}
_STRUCTURAL_ACTIONS = {
    "add_relationship",
    "upsert_derived_source",
    "apply_sql_repair",
}


def _json_value(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (TypeError, json.JSONDecodeError):
            return default
    return value


def _quote(value: Any) -> str:
    return "'" + str(value or "").replace("'", "''") + "'"


def _canonical_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    value = copy.deepcopy(snapshot)
    for key in (
        "context_hash",
        "snapshot_id",
        "created_at",
        "updated_at",
        "last_saved_at",
    ):
        value.pop(key, None)
    return value


def workspace_hash(snapshot: dict[str, Any]) -> str:
    declared = str(snapshot.get("context_hash") or "").strip()
    if declared:
        return declared
    raw = json.dumps(
        _canonical_snapshot(snapshot),
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _computed_workspace_hash(snapshot: dict[str, Any]) -> str:
    raw = json.dumps(
        _canonical_snapshot(snapshot),
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _diff(before: Any, after: Any, path: str = "") -> list[WorkspaceDiffOperation]:
    if before == after:
        return []
    if isinstance(before, dict) and isinstance(after, dict):
        operations: list[WorkspaceDiffOperation] = []
        for key in sorted(set(before) | set(after)):
            child_path = f"{path}/{str(key).replace('~', '~0').replace('/', '~1')}"
            if key not in before:
                operations.append(
                    WorkspaceDiffOperation(
                        op="add", path=child_path, after=after[key]
                    )
                )
            elif key not in after:
                operations.append(
                    WorkspaceDiffOperation(
                        op="remove", path=child_path, before=before[key]
                    )
                )
            else:
                operations.extend(_diff(before[key], after[key], child_path))
        return operations
    return [
        WorkspaceDiffOperation(
            op="replace", path=path or "/", before=before, after=after
        )
    ]


def _table_ref(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        return copy.deepcopy(value)
    fqn = str(value or "").strip()
    if not fqn:
        return None
    parts = [part.strip('"') for part in fqn.split(".") if part]
    if len(parts) < 3:
        return None
    return {
        "database": parts[-3],
        "schema": parts[-2],
        "table": parts[-1],
        "qualified_name": ".".join(parts[-3:]),
    }


def _target_column(payload: dict[str, Any]) -> str:
    target = payload.get("target_entity")
    if isinstance(target, dict):
        value = target.get("target_column") or target.get("column")
        if value:
            return str(value)
    return str(
        payload.get("target_column")
        or payload.get("target_attribute")
        or payload.get("column")
        or ""
    )


def _find_mapping_row(
    snapshot: dict[str, Any], target_column: str
) -> dict[str, Any] | None:
    target = target_column.strip().upper()
    for row in snapshot.get("mapping_rows") or []:
        if not isinstance(row, dict):
            continue
        value = str(
            row.get("target_column")
            or row.get("target_attribute")
            or row.get("targetColumn")
            or ""
        ).strip().upper()
        if value == target:
            return row
    return None


def _selected_source_names(snapshot: dict[str, Any]) -> set[str]:
    names: set[str] = set()
    for table in snapshot.get("source_tables") or []:
        if not isinstance(table, dict):
            continue
        value = str(
            table.get("qualified_name")
            or ".".join(
                str(table.get(key) or "")
                for key in ("database", "schema", "table")
            )
        ).strip(".")
        if value:
            names.add(value.upper())
    return names


def _source_table_for_column(column: str) -> str:
    parts = [part.strip('"') for part in str(column).split(".") if part]
    return ".".join(parts[:-1]).upper() if len(parts) > 1 else ""


class RecommendationActionService:
    def __init__(
        self,
        *,
        session: Any,
        settings: Settings,
        project_service: ProjectService,
        memory_service: ConversationMemoryService,
        derived_source_service: DerivedSourceService | None = None,
    ) -> None:
        self._session = session
        self._settings = settings
        self._projects = project_service
        self._memory = memory_service
        self._derived_sources = derived_source_service
        self._recommendations_table = settings.qualify_metadata_object_name(
            "TBL_FIR_AGENT_RECOMMENDATIONS"
        )
        self._history_table = settings.qualify_metadata_object_name(
            "TBL_FIR_RECOMMENDATION_ACTION_HISTORY"
        )

    def _load_recommendation(
        self, recommendation_id: str, *, actor_id: str
    ) -> dict[str, Any]:
        rows = self._session.sql(
            f"""
            SELECT *
            FROM {self._recommendations_table}
            WHERE AGENT_RECOMMENDATION_ID = {_quote(recommendation_id)}
              AND STATUS = 'active'
              AND (COALESCE(USER_ID, '') = '' OR USER_ID = {_quote(actor_id)})
            LIMIT 1
            """
        ).collect()
        if not rows:
            raise RecommendationNotFoundError("Recommendation not found.")
        raw = rows[0].as_dict() if hasattr(rows[0], "as_dict") else dict(rows[0])
        return {str(key).lower(): value for key, value in raw.items()}

    @staticmethod
    def _select_action(
        recommendation: dict[str, Any], action_id: str | None
    ) -> tuple[str | None, dict[str, Any], bool, list[str]]:
        contracts = _json_value(recommendation.get("action_contract"), [])
        if isinstance(contracts, dict):
            contracts = [contracts]
        contracts = [item for item in contracts if isinstance(item, dict)]
        contract = None
        if action_id:
            contract = next(
                (
                    item
                    for item in contracts
                    if str(item.get("id") or "") == action_id
                ),
                None,
            )
        if contract is None:
            contract = next(
                (
                    item
                    for item in contracts
                    if str(item.get("action") or "") in _ACTION_ALIASES
                ),
                None,
            )
        agent_payload = _json_value(recommendation.get("agent_payload"), {})
        agent_payload = agent_payload if isinstance(agent_payload, dict) else {}
        action_name = str((contract or {}).get("action") or "")
        if not action_name:
            recommendation_type = str(
                recommendation.get("recommendation_type") or ""
            ).lower()
            action_name = {
                "table_suggestion": "add_source_table",
                "column_mapping_hint": "apply_direct_mapping",
                "relationship_hint": "add_relationship",
                "derived_source_suggestion": "upsert_derived_source",
                "transformation_pattern": "apply_transformation",
                "preprocessing_rule": "apply_transformation",
                "correction_warning": "apply_sql_repair",
            }.get(recommendation_type, "")
        action_kind = _ACTION_ALIASES.get(action_name)
        contract_payload = (contract or {}).get("payload")
        contract_payload = (
            contract_payload if isinstance(contract_payload, dict) else {}
        )
        action_payload = {
            **agent_payload,
            **contract_payload,
        }
        nested_payload = action_payload.get("action_payload")
        if isinstance(nested_payload, dict):
            action_payload = {**action_payload, **nested_payload}
        blocked: list[str] = []
        if not action_kind:
            blocked.append(
                "This recommendation has no supported workspace action."
            )
        requires_confirmation = bool(
            (contract or {}).get("requires_confirmation")
            or action_kind in _STRUCTURAL_ACTIONS
        )
        return action_kind, action_payload, requires_confirmation, blocked

    def describe(
        self,
        recommendation_id: str,
        *,
        actor_id: str,
        action_id: str | None = None,
        expected_workspace_hash: str | None = None,
    ) -> ApplicableRecommendation:
        rec = self._load_recommendation(recommendation_id, actor_id=actor_id)
        return self.describe_record(
            rec,
            recommendation_id=recommendation_id,
            action_id=action_id,
            expected_workspace_hash=expected_workspace_hash,
        )

    def describe_record(
        self,
        rec: dict[str, Any],
        *,
        recommendation_id: str | None = None,
        action_id: str | None = None,
        expected_workspace_hash: str | None = None,
    ) -> ApplicableRecommendation:
        rec = {str(key).lower(): value for key, value in rec.items()}
        recommendation_id = str(
            recommendation_id
            or rec.get("recommendation_id")
            or rec.get("agent_recommendation_id")
            or ""
        )
        kind, payload, confirmation, blocked = self._select_action(rec, action_id)
        if kind == "upsert_derived_source":
            derived = payload.get("derived_source")
            if isinstance(derived, dict):
                derived = dict(derived)
                derived.setdefault(
                    "derived_source_id",
                    f"derived_fir_{hashlib.sha256(recommendation_id.encode()).hexdigest()[:16]}",
                )
                payload["derived_source"] = derived
                try:
                    DerivedSourceDefinition.model_validate(derived)
                except Exception as exc:
                    blocked.append(
                        f"The derived-source draft is incomplete: {exc}"
                    )
        target = payload.get("target_entity")
        if not isinstance(target, dict):
            target = {
                key: payload[key]
                for key in ("target_table", "target_column")
                if payload.get(key) is not None
            }
        candidate_sources = payload.get("candidate_sources") or []
        if not isinstance(candidate_sources, list):
            candidate_sources = []
        missing = payload.get("missing_dependencies") or []
        if not isinstance(missing, list):
            missing = [str(missing)]
        if kind == "open_source_preparation":
            blocked.append(
                "Source preparation must be completed before this recommendation can mutate the workspace."
            )
        validation_plan = payload.get("validation_plan") or [
            "Recompile the mapping SQL.",
            "Run relationship, type, grain, and duplication validation.",
        ]
        if not isinstance(validation_plan, list):
            validation_plan = [str(validation_plan)]
        title = str(
            payload.get("title")
            or payload.get("subject")
            or rec.get("display_message")
            or rec.get("recommendation_category")
            or "FIR recommendation"
        )
        return ApplicableRecommendation(
            recommendation_id=recommendation_id,
            recommendation_version=int(rec.get("content_version") or 1),
            workflow_stage=str(
                rec.get("checkpoint") or rec.get("trigger_type") or ""
            )
            or None,
            target_entity=target,
            title=title,
            business_rationale=str(
                payload.get("business_rationale")
                or payload.get("rationale")
                or rec.get("evidence_summary")
                or ""
            )
            or None,
            confidence=(
                float(rec["confidence"])
                if rec.get("confidence") is not None
                else None
            ),
            compatibility_tier=(
                int(payload["compatibility_tier"])
                if payload.get("compatibility_tier") is not None
                else None
            ),
            candidate_sources=[
                item if isinstance(item, dict) else {"source": str(item)}
                for item in candidate_sources
            ],
            missing_dependencies=[str(value) for value in missing],
            evidence_summary=str(rec.get("evidence_summary") or "") or None,
            action_kind=kind,
            action_payload=payload,
            preconditions=[
                value
                for value in payload.get("preconditions") or []
                if isinstance(value, dict)
            ],
            expected_workspace_hash=expected_workspace_hash,
            requires_confirmation=confirmation,
            can_apply=bool(kind and not blocked),
            blocked_reasons=blocked,
            validation_plan=[str(value) for value in validation_plan],
        )

    @staticmethod
    def _mutate(
        snapshot: dict[str, Any],
        recommendation: ApplicableRecommendation,
    ) -> tuple[dict[str, Any], list[str]]:
        result = copy.deepcopy(snapshot)
        payload = recommendation.action_payload
        kind = recommendation.action_kind
        blocked: list[str] = []
        if not kind:
            return result, ["Unsupported recommendation action."]

        if kind == "add_source_table":
            table = _table_ref(
                payload.get("source_table")
                or payload.get("table")
                or payload.get("table_fqn")
            )
            if table is None:
                blocked.append("The recommendation does not identify a source table.")
            else:
                tables = result.setdefault("source_tables", [])
                existing = {
                    str(
                        item.get("qualified_name")
                        or ".".join(
                            str(item.get(key) or "")
                            for key in ("database", "schema", "table")
                        )
                    ).upper()
                    for item in tables
                    if isinstance(item, dict)
                }
                if str(table.get("qualified_name") or "").upper() not in existing:
                    tables.append(table)

        elif kind in {
            "select_source_column",
            "apply_direct_mapping",
            "bind_value",
            "apply_transformation",
        }:
            target_column = _target_column(payload)
            row = _find_mapping_row(result, target_column)
            if row is None:
                blocked.append(
                    f"Target mapping row {target_column or '<missing>'} does not exist."
                )
            elif kind == "bind_value":
                if "value" not in payload and "constant_value" not in payload:
                    blocked.append("The recommendation does not provide a Value binding.")
                else:
                    value = payload.get("value", payload.get("constant_value"))
                    row.update(
                        {
                            "mapping_mode": "constant",
                            "constant_value": value,
                            "source_column": None,
                            "source_columns": [],
                            "status": "MAPPED",
                        }
                    )
            else:
                sources = (
                    payload.get("source_columns")
                    or payload.get("candidate_source_columns")
                    or [payload.get("source_column")]
                )
                if not isinstance(sources, list):
                    sources = [sources]
                sources = [str(value) for value in sources if value]
                if not sources:
                    blocked.append(
                        "The recommendation does not identify a current source column."
                    )
                else:
                    row.update(
                        {
                            "mapping_mode": "source",
                            "source_column": ", ".join(sources),
                            "source_columns": sources,
                            "constant_value": None,
                            "status": "MAPPED",
                        }
                    )
                    if kind == "apply_transformation":
                        expression = str(
                            payload.get("expression")
                            or payload.get("transformation")
                            or ""
                        )
                        if not expression:
                            blocked.append(
                                "The recommendation does not provide a transformation."
                            )
                        else:
                            row["expression"] = expression
                            row["rule"] = str(
                                payload.get("rule") or "Custom"
                            )
                    row["used_recommendation_ids"] = sorted(
                        {
                            *(
                                row.get("used_recommendation_ids")
                                if isinstance(
                                    row.get("used_recommendation_ids"), list
                                )
                                else []
                            ),
                            recommendation.recommendation_id,
                        }
                    )

        elif kind == "add_relationship":
            relationship = payload.get("relationship") or payload.get("join")
            if not isinstance(relationship, dict):
                blocked.append(
                    "The recommendation does not provide a complete relationship."
                )
            else:
                relationships = result.setdefault("relationships", [])
                identity = json.dumps(
                    relationship, sort_keys=True, separators=(",", ":"), default=str
                )
                if all(
                    json.dumps(
                        item, sort_keys=True, separators=(",", ":"), default=str
                    )
                    != identity
                    for item in relationships
                    if isinstance(item, dict)
                ):
                    relationships.append(copy.deepcopy(relationship))

        elif kind == "upsert_derived_source":
            derived = payload.get("derived_source")
            if not isinstance(derived, dict):
                blocked.append(
                    "The recommendation does not provide a derived-source draft."
                )
            else:
                derived_sources = result.setdefault("derived_sources", [])
                derived_id = str(
                    derived.get("id") or derived.get("derived_source_id") or ""
                )
                existing = next(
                    (
                        item
                        for item in derived_sources
                        if isinstance(item, dict)
                        and derived_id
                        and str(
                            item.get("id") or item.get("derived_source_id") or ""
                        )
                        == derived_id
                    ),
                    None,
                )
                if existing is None:
                    derived_sources.append(copy.deepcopy(derived))
                else:
                    existing.update(copy.deepcopy(derived))

        elif kind == "apply_sql_repair":
            sql = str(
                payload.get("sql")
                or payload.get("mapping_sql")
                or payload.get("repaired_sql")
                or ""
            ).strip()
            if not sql:
                blocked.append("The recommendation does not provide repaired SQL.")
            else:
                result["mapping_sql"] = sql
                result["raw_mapping_sql"] = sql

        elif kind == "open_source_preparation":
            blocked.append(
                "Source preparation is advisory and cannot be applied as a workspace mutation."
            )

        return result, blocked

    @staticmethod
    def _precondition_blocks(
        snapshot: dict[str, Any],
        recommendation: ApplicableRecommendation,
    ) -> list[str]:
        payload = recommendation.action_payload
        blocked: list[str] = []
        for flag, message in (
            (
                "types_compatible",
                "The recommended source and target types are incompatible.",
            ),
            (
                "grain_compatible",
                "The recommended source grain is incompatible with the target.",
            ),
            (
                "relationship_path_compatible",
                "The required relationship path is not available.",
            ),
            (
                "derived_outputs_available",
                "A required derived output is not available.",
            ),
        ):
            if payload.get(flag) is False:
                blocked.append(message)
        if recommendation.action_kind in {
            "select_source_column",
            "apply_direct_mapping",
            "apply_transformation",
        }:
            sources = (
                payload.get("source_columns")
                or payload.get("candidate_source_columns")
                or [payload.get("source_column")]
            )
            if not isinstance(sources, list):
                sources = [sources]
            selected = _selected_source_names(snapshot)
            for source in (str(value) for value in sources if value):
                source_table = _source_table_for_column(source)
                if (
                    source_table
                    and selected
                    and not any(
                        source_table == table
                        or source_table.endswith(f".{table}")
                        or table.endswith(f".{source_table}")
                        for table in selected
                    )
                ):
                    blocked.append(
                        f"Source column {source} is not in the selected source set."
                    )
        return blocked

    def preview(
        self,
        recommendation_id: str,
        *,
        actor_id: str,
        sttm_id: str,
        workspace_snapshot: dict[str, Any],
        expected_workspace_hash: str,
        action_id: str | None = None,
    ) -> RecommendationPreviewResponse:
        actual_hash = workspace_hash(workspace_snapshot)
        if actual_hash != expected_workspace_hash:
            raise RecommendationStaleError(
                "The supplied workspace does not match expected_workspace_hash."
            )
        latest = self._projects._latest_snapshot(sttm_id)
        if latest is None:
            raise RecommendationNotFoundError(f"STTM {sttm_id} was not found.")
        if workspace_hash(latest) != expected_workspace_hash:
            raise RecommendationStaleError(
                "The workspace changed after this recommendation was generated."
            )
        rec = self._load_recommendation(
            recommendation_id, actor_id=actor_id
        )
        sttm = self._projects.get_sttm_record(sttm_id)
        if sttm is None:
            raise RecommendationNotFoundError(f"STTM {sttm_id} was not found.")
        if rec.get("sttm_id") and str(rec["sttm_id"]) != sttm_id:
            raise RecommendationNotFoundError(
                "Recommendation is not scoped to this mapping."
            )
        if rec.get("project_id") and str(rec["project_id"]) != str(
            sttm.project_id
        ):
            raise RecommendationNotFoundError(
                "Recommendation is not scoped to this project."
            )
        recommendation = self.describe_record(
            rec,
            recommendation_id=recommendation_id,
            action_id=action_id,
            expected_workspace_hash=expected_workspace_hash,
        )
        after, mutation_blocks = self._mutate(
            workspace_snapshot, recommendation
        )
        blocked = [
            *recommendation.blocked_reasons,
            *self._precondition_blocks(workspace_snapshot, recommendation),
            *mutation_blocks,
        ]
        after_hash = _computed_workspace_hash(after)
        after["context_hash"] = after_hash
        operations = _diff(
            _canonical_snapshot(workspace_snapshot),
            _canonical_snapshot(after),
        )
        if not operations and not blocked:
            blocked.append("The recommendation is already reflected in the workspace.")
        return RecommendationPreviewResponse(
            recommendation=recommendation.model_copy(
                update={
                    "can_apply": not blocked,
                    "blocked_reasons": blocked,
                }
            ),
            before_workspace_hash=expected_workspace_hash,
            after_workspace_hash=after_hash,
            workspace_diff=operations,
            validation_impact=recommendation.validation_plan,
            can_apply=not blocked,
            blocked_reasons=blocked,
        )

    def _existing_action(
        self, idempotency_key: str
    ) -> dict[str, Any] | None:
        rows = self._session.sql(
            f"""
            SELECT *
            FROM {self._history_table}
            WHERE IDEMPOTENCY_KEY = {_quote(idempotency_key)}
            LIMIT 1
            """
        ).collect()
        if not rows:
            return None
        row = rows[0].as_dict() if hasattr(rows[0], "as_dict") else dict(rows[0])
        return {str(key).lower(): value for key, value in row.items()}

    def apply(
        self,
        recommendation_id: str,
        *,
        actor_id: str,
        sttm_id: str,
        workspace_snapshot: dict[str, Any],
        expected_workspace_hash: str,
        idempotency_key: str,
        action_id: str | None = None,
        confirmed: bool = False,
    ) -> RecommendationApplyResponse:
        existing = self._existing_action(idempotency_key)
        if existing:
            if str(existing.get("recommendation_id")) != recommendation_id:
                raise RecommendationBlockedError(
                    "The idempotency key is already used for another recommendation."
                )
            result = _json_value(existing.get("result"), {})
            return RecommendationApplyResponse.model_validate(
                {
                    **result,
                    "status": "already_applied",
                    "action_history_id": existing.get("action_history_id"),
                }
            )
        preview = self.preview(
            recommendation_id,
            actor_id=actor_id,
            sttm_id=sttm_id,
            workspace_snapshot=workspace_snapshot,
            expected_workspace_hash=expected_workspace_hash,
            action_id=action_id,
        )
        if not preview.can_apply:
            raise RecommendationBlockedError("; ".join(preview.blocked_reasons))
        if preview.recommendation.requires_confirmation and not confirmed:
            raise RecommendationBlockedError(
                "This structural recommendation requires confirmation."
            )
        if (
            preview.recommendation.action_kind == "upsert_derived_source"
            and self._derived_sources is not None
        ):
            derived_payload = preview.recommendation.action_payload.get(
                "derived_source"
            )
            if not isinstance(derived_payload, dict):
                raise RecommendationBlockedError(
                    "The recommendation does not provide a derived-source draft."
                )
            try:
                self._derived_sources.save_source(
                    DerivedSourceDefinition.model_validate(derived_payload)
                )
            except Exception as exc:
                raise RecommendationBlockedError(
                    f"The derived source could not be validated and saved: {exc}"
                ) from exc
        after, blocked = self._mutate(
            workspace_snapshot, preview.recommendation
        )
        if blocked:
            raise RecommendationBlockedError("; ".join(blocked))
        after["context_hash"] = preview.after_workspace_hash
        sttm = self._projects.get_sttm_record(sttm_id)
        if sttm is None:  # pragma: no cover - preview already verified it
            raise RecommendationNotFoundError(f"STTM {sttm_id} was not found.")
        # Applying changes workspace state, but it is not accepted learning
        # until compilation/validation or explicit feedback succeeds.
        action_name = "recommendation.applied"
        saved = self._projects.autosave_sttm(
            sttm_id,
            STTMAutosaveRequest(
                workspace_snapshot=after,
                action=action_name,
            ),
            user_id=actor_id,
        )
        self._memory.record_fir_recommendation_outcome(
            recommendation_id=recommendation_id,
            outcome_type="applied",
            context_key=str(after.get("context_key") or ""),
            snapshot_id=saved.snapshot_id,
            request_id=idempotency_key,
            artifact_id=None,
            user_id=actor_id,
            payload={
                "action_kind": preview.recommendation.action_kind,
                "before_workspace_hash": expected_workspace_hash,
                "after_workspace_hash": preview.after_workspace_hash,
            },
        )
        history_id = f"recact_{uuid.uuid4().hex}"
        response = RecommendationApplyResponse(
            **preview.model_dump(mode="python"),
            status="applied",
            action_history_id=history_id,
            snapshot_id=saved.snapshot_id,
        )
        self._session.sql(
            f"""
            MERGE INTO {self._history_table} target
            USING (
                SELECT
                    {_quote(history_id)} AS ACTION_HISTORY_ID,
                    {_quote(recommendation_id)} AS RECOMMENDATION_ID,
                    {_quote(idempotency_key)} AS IDEMPOTENCY_KEY
            ) source
            ON target.IDEMPOTENCY_KEY = source.IDEMPOTENCY_KEY
            WHEN NOT MATCHED THEN INSERT (
                ACTION_HISTORY_ID, RECOMMENDATION_ID, RECOMMENDATION_VERSION,
                PROJECT_ID, STTM_ID, ACTOR_ID, IDEMPOTENCY_KEY, ACTION_KIND,
                STATUS, EXPECTED_WORKSPACE_HASH, BEFORE_WORKSPACE_HASH,
                AFTER_WORKSPACE_HASH, WORKSPACE_DIFF, BEFORE_SNAPSHOT,
                AFTER_SNAPSHOT, RESULT, CREATED_AT, UPDATED_AT
            ) VALUES (
                source.ACTION_HISTORY_ID, source.RECOMMENDATION_ID,
                {preview.recommendation.recommendation_version},
                {_quote(sttm.project_id)}, {_quote(sttm_id)}, {_quote(actor_id)},
                source.IDEMPOTENCY_KEY,
                {_quote(preview.recommendation.action_kind)}, 'applied',
                {_quote(expected_workspace_hash)}, {_quote(expected_workspace_hash)},
                {_quote(preview.after_workspace_hash)},
                PARSE_JSON({_quote(json.dumps([item.model_dump(mode='json') for item in preview.workspace_diff], default=str))}),
                PARSE_JSON({_quote(json.dumps(workspace_snapshot, default=str))}),
                PARSE_JSON({_quote(json.dumps(after, default=str))}),
                PARSE_JSON({_quote(json.dumps(response.model_dump(mode='json'), default=str))}),
                CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
            )
            """
        ).collect()
        return response

    def undo(
        self,
        *,
        recommendation_id: str,
        actor_id: str,
        sttm_id: str,
        action_history_id: str,
        expected_workspace_hash: str,
        idempotency_key: str,
    ) -> RecommendationUndoResponse:
        existing_undo = self._existing_action(idempotency_key)
        if existing_undo:
            if str(existing_undo.get("recommendation_id") or "") != recommendation_id:
                raise RecommendationBlockedError(
                    "The idempotency key is already used for another recommendation."
                )
            result = _json_value(existing_undo.get("result"), {})
            return RecommendationUndoResponse.model_validate(
                {**result, "status": "already_undone"}
            )
        rows = self._session.sql(
            f"""
            SELECT *
            FROM {self._history_table}
            WHERE ACTION_HISTORY_ID = {_quote(action_history_id)}
              AND STTM_ID = {_quote(sttm_id)}
              AND ACTOR_ID = {_quote(actor_id)}
            LIMIT 1
            """
        ).collect()
        if not rows:
            raise RecommendationNotFoundError("Recommendation action was not found.")
        raw = rows[0].as_dict() if hasattr(rows[0], "as_dict") else dict(rows[0])
        history = {str(key).lower(): value for key, value in raw.items()}
        if str(history.get("recommendation_id") or "") != recommendation_id:
            raise RecommendationNotFoundError(
                "Recommendation action was not found for this recommendation."
            )
        if str(history.get("status")) == "undone":
            return RecommendationUndoResponse(
                status="already_undone",
                action_history_id=action_history_id,
                workspace_hash=str(history.get("before_workspace_hash") or ""),
            )
        latest = self._projects._latest_snapshot(sttm_id)
        if latest is None or workspace_hash(latest) != expected_workspace_hash:
            raise RecommendationStaleError(
                "Undo was rejected because the workspace changed after apply."
            )
        if str(history.get("after_workspace_hash") or "") != expected_workspace_hash:
            raise RecommendationStaleError(
                "Undo is only safe against the exact applied workspace version."
            )
        before = _json_value(history.get("before_snapshot"), {})
        if not isinstance(before, dict):
            raise RecommendationBlockedError(
                "The prior workspace snapshot is unavailable."
            )
        before_hash = str(history.get("before_workspace_hash") or "")
        before["context_hash"] = before_hash
        saved = self._projects.autosave_sttm(
            sttm_id,
            STTMAutosaveRequest(
                workspace_snapshot=before,
                action="mapping.edited",
            ),
            user_id=actor_id,
        )
        response = RecommendationUndoResponse(
            status="undone",
            action_history_id=action_history_id,
            workspace_hash=before_hash,
            snapshot_id=saved.snapshot_id,
        )
        self._session.sql(
            f"""
            UPDATE {self._history_table}
            SET STATUS = 'undone',
                UNDONE_AT = CURRENT_TIMESTAMP(),
                UPDATED_AT = CURRENT_TIMESTAMP(),
                RESULT = OBJECT_INSERT(
                    COALESCE(RESULT, OBJECT_CONSTRUCT()),
                    'undo',
                    PARSE_JSON({_quote(json.dumps(response.model_dump(mode='json')))}),
                    TRUE
                )
            WHERE ACTION_HISTORY_ID = {_quote(action_history_id)}
            """
        ).collect()
        undo_history_id = f"recundo_{uuid.uuid4().hex}"
        self._session.sql(
            f"""
            MERGE INTO {self._history_table} target
            USING (
                SELECT
                    {_quote(undo_history_id)} AS ACTION_HISTORY_ID,
                    {_quote(idempotency_key)} AS IDEMPOTENCY_KEY
            ) source
            ON target.IDEMPOTENCY_KEY = source.IDEMPOTENCY_KEY
            WHEN NOT MATCHED THEN INSERT (
                ACTION_HISTORY_ID, RECOMMENDATION_ID, RECOMMENDATION_VERSION,
                PROJECT_ID, STTM_ID, ACTOR_ID, IDEMPOTENCY_KEY, ACTION_KIND,
                STATUS, EXPECTED_WORKSPACE_HASH, BEFORE_WORKSPACE_HASH,
                AFTER_WORKSPACE_HASH, WORKSPACE_DIFF, BEFORE_SNAPSHOT,
                AFTER_SNAPSHOT, RESULT, CREATED_AT, UPDATED_AT
            ) VALUES (
                source.ACTION_HISTORY_ID,
                {_quote(history.get('recommendation_id'))},
                {int(history.get('recommendation_version') or 1)},
                {_quote(history.get('project_id'))}, {_quote(sttm_id)},
                {_quote(actor_id)}, source.IDEMPOTENCY_KEY, 'undo',
                'undone', {_quote(expected_workspace_hash)},
                {_quote(expected_workspace_hash)}, {_quote(before_hash)},
                PARSE_JSON('[]'),
                PARSE_JSON({_quote(json.dumps(latest, default=str))}),
                PARSE_JSON({_quote(json.dumps(before, default=str))}),
                PARSE_JSON({_quote(json.dumps(response.model_dump(mode='json')))}),
                CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
            )
            """
        ).collect()
        self._memory.record_fir_recommendation_outcome(
            recommendation_id=str(history.get("recommendation_id") or ""),
            outcome_type="corrected",
            context_key=str(before.get("context_key") or ""),
            snapshot_id=saved.snapshot_id,
            request_id=idempotency_key,
            artifact_id=None,
            user_id=actor_id,
            payload={
                "action": "undo",
                "action_history_id": action_history_id,
                "restored_workspace_hash": before_hash,
            },
        )
        return response

    def record_feedback(
        self,
        recommendation_id: str,
        *,
        actor_id: str,
        outcome: str,
        idempotency_key: str,
        sttm_id: str | None = None,
        context_key: str | None = None,
        snapshot_id: str | None = None,
        reason: str | None = None,
        correction: dict[str, Any] | None = None,
    ) -> str:
        recommendation = self._load_recommendation(
            recommendation_id, actor_id=actor_id
        )
        if (
            sttm_id
            and recommendation.get("sttm_id")
            and str(recommendation["sttm_id"]) != sttm_id
        ):
            raise RecommendationNotFoundError(
                "Recommendation is not scoped to this mapping."
            )
        if outcome == "corrected" and not correction:
            raise RecommendationBlockedError(
                "correction is required for corrected feedback."
            )
        payload = {
            "sttm_id": sttm_id,
            "reason": reason,
            "correction": correction,
            "learning_source": "explicit_recommendation_feedback",
        }
        return self._memory.record_fir_recommendation_outcome(
            recommendation_id=recommendation_id,
            outcome_type=outcome,
            context_key=context_key,
            snapshot_id=snapshot_id,
            request_id=idempotency_key,
            artifact_id=None,
            user_id=actor_id,
            payload=payload,
        )
