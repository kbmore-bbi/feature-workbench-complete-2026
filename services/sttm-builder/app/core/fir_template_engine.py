"""FIR Template Engine for template-driven inference extraction.

This module provides the engine for processing FIR events using template-driven
extraction. Templates define what to infer from each feedback type, enabling
flexible and configurable learning from user interactions.

Workflow:
1. Receive event → Load matching template(s)
2. Extract required fields (direct mapping from event)
3. Compute derived fields (expressions evaluated)
4. Execute LLM extraction (hybrid approach - rule-based first, LLM for semantic fields)
5. Execute cross-reference queries (find related learnings)
6. Score confidence
7. Generate inference record
8. Apply recommendation rules
9. Index to RAG if configured
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable
from uuid import uuid4

from snowflake.snowpark import Session

from app.core.config import Settings

logger = logging.getLogger(__name__)


class TemplateType(str, Enum):
    """Types of FIR templates."""
    CHAT_FEEDBACK = "chat_feedback"
    MAPPING_ACCEPTANCE = "mapping_acceptance"
    MAPPING_EDIT = "mapping_edit"
    MAPPING_SAVE = "mapping_save"
    STTM_PUBLISH = "sttm_publish"
    HISTORICAL_SQL = "historical_sql"
    PROJECT_CONTEXT = "project_context"


class RecommendationAction(str, Enum):
    """Types of recommendation actions."""
    CREATE_SEMANTIC_LEARNING = "create_semantic_learning"
    CREATE_GLOBAL_SEMANTIC_LEARNING = "create_global_semantic_learning"
    CREATE_PROJECT_SPECIFIC_LEARNING = "create_project_specific_learning"
    UPDATE_SEMANTIC_LEARNING = "update_semantic_learning"
    UPDATE_ROUTING_HINTS = "update_routing_hints"
    REINFORCE_PATTERN = "reinforce_pattern"
    BOOST_SIMILAR_PATTERNS = "boost_similar_patterns"
    PENALIZE_PATTERN = "penalize_pattern"
    LINK_CROSS_PROJECT_LEARNING = "link_cross_project_learning"
    SUGGEST_PATTERN_REUSE = "suggest_pattern_reuse"
    PROMOTE_TO_REFERENCE = "promote_to_reference"
    SEED_TRANSFORMATION_LEARNINGS = "seed_transformation_learnings"
    SEED_MAPPING_PATTERNS = "seed_mapping_patterns"
    INDEX_DBT_PATTERN = "index_dbt_pattern"


@dataclass
class FIRTemplate:
    """Loaded template from TBL_WORKBENCH_FIR_TEMPLATES."""
    template_id: str
    template_type: str
    source_event_type: str
    entity_type: str | None
    name: str
    description: str | None
    extraction_schema: dict[str, Any]
    prompt_guidance: str | None
    recommendation_rules: list[dict[str, Any]]
    version: str
    status: str = "active"


@dataclass
class ExtractionResult:
    """Result of template extraction."""
    required_fields: dict[str, Any] = field(default_factory=dict)
    derived_fields: dict[str, Any] = field(default_factory=dict)
    llm_fields: dict[str, Any] = field(default_factory=dict)
    cross_references: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    confidence: float = 0.5
    errors: list[str] = field(default_factory=list)


@dataclass
class InferenceRecord:
    """Inference to be stored."""
    inference_id: str
    inference_key: str
    inference_type: str
    summary: str
    confidence: float
    entity_type: str | None
    entity_ids: dict[str, Any]
    attributes: dict[str, Any]
    tags: list[str]
    source: str = "template_engine"
    status: str = "active"


@dataclass
class RecommendationAction:
    """A recommendation action to be executed."""
    action_type: str
    params: dict[str, Any]
    inference_id: str
    template_id: str
    priority: str = "medium"


class FIRTemplateEngine:
    """Engine for processing FIR events using template-driven extraction.

    This engine supports:
    - Template loading and caching from Snowflake
    - Required field extraction from events
    - Derived field computation via expressions
    - LLM-assisted extraction for semantic fields
    - Cross-reference queries for context enrichment
    - Confidence scoring
    - Recommendation rule application
    - RAG document indexing
    """

    def __init__(
        self,
        session: Session,
        llm_client: Any | None = None,
        settings: Settings | None = None,
    ) -> None:
        self._session = session
        self._settings = settings
        self._llm_client = llm_client
        self._template_cache: dict[str, tuple[list[FIRTemplate], float]] = {}
        self._cache_ttl_seconds = 300.0
        if settings:
            self._templates_table = settings.qualify_table_name(
                settings.snowflake_fir_templates_table
            )
        else:
            self._templates_table = "TBL_WORKBENCH_FIR_TEMPLATES"

    def load_templates(self, source_event_type: str) -> list[FIRTemplate]:
        """Load active templates for a source event type.

        Templates are cached for performance with a configurable TTL.

        Args:
            source_event_type: The event type to load templates for (e.g., 'mapping.accept')

        Returns:
            List of active FIRTemplate objects for the event type
        """
        cache_key = f"templates:{source_event_type}"
        now = datetime.now(timezone.utc).timestamp()

        if cache_key in self._template_cache:
            templates, cached_at = self._template_cache[cache_key]
            if now - cached_at < self._cache_ttl_seconds:
                return templates

        try:
            rows = self._session.sql(
                f"""
                SELECT
                    TEMPLATE_ID, TEMPLATE_TYPE, SOURCE_EVENT_TYPE, ENTITY_TYPE,
                    NAME, DESCRIPTION, EXTRACTION_SCHEMA, PROMPT_GUIDANCE,
                    RECOMMENDATION_RULES, VERSION, STATUS
                FROM {self._templates_table}
                WHERE SOURCE_EVENT_TYPE = '{source_event_type}'
                  AND STATUS = 'active'
                ORDER BY VERSION DESC
                """
            ).collect()

            templates = [
                FIRTemplate(
                    template_id=str(row["TEMPLATE_ID"]),
                    template_type=str(row["TEMPLATE_TYPE"]),
                    source_event_type=str(row["SOURCE_EVENT_TYPE"]),
                    entity_type=row["ENTITY_TYPE"],
                    name=str(row["NAME"]),
                    description=row["DESCRIPTION"],
                    extraction_schema=self._parse_json(row["EXTRACTION_SCHEMA"]) or {},
                    prompt_guidance=row["PROMPT_GUIDANCE"],
                    recommendation_rules=self._parse_json(row["RECOMMENDATION_RULES"]) or [],
                    version=str(row["VERSION"] or "1.0"),
                    status=str(row["STATUS"] or "active"),
                )
                for row in rows
            ]

            self._template_cache[cache_key] = (templates, now)
            return templates

        except Exception as exc:
            logger.warning("Failed to load FIR templates for %s: %s", source_event_type, exc)
            return []

    def extract_inference(
        self,
        event: dict[str, Any],
        context: dict[str, Any],
        template: FIRTemplate,
    ) -> ExtractionResult:
        """Extract inference from event using template schema.

        Steps:
        1. Extract required fields (direct mapping)
        2. Compute derived fields (expression evaluation)
        3. Apply LLM extraction if enabled (hybrid - only for semantic fields)
        4. Execute cross-reference queries
        5. Compute confidence score

        Args:
            event: The event data to extract from
            context: Additional context (project_id, session_id, etc.)
            template: The template to use for extraction

        Returns:
            ExtractionResult with all extracted fields
        """
        schema = template.extraction_schema
        errors: list[str] = []

        # 1. Extract required fields
        required = self._extract_required_fields(
            event, context, schema.get("required_fields", [])
        )

        # 2. Compute derived fields
        derived = self._compute_derived_fields(
            required, schema.get("derived_fields", [])
        )

        # 3. LLM extraction (only if enabled and has semantic fields)
        llm_fields: dict[str, Any] = {}
        llm_config = schema.get("llm_extraction", {})
        if llm_config.get("enabled", False) and self._llm_client:
            condition = llm_config.get("condition")
            should_run_llm = True
            if condition:
                should_run_llm = self._evaluate_condition(
                    condition, {**required, **derived}
                )

            if should_run_llm:
                llm_fields = self._apply_llm_extraction(
                    {**required, **derived},
                    llm_config.get("fields", []),
                )

        # 4. Execute cross-reference queries
        cross_refs: dict[str, list[dict[str, Any]]] = {}
        for query_def in schema.get("cross_reference_queries", []):
            query_name = query_def.get("name", "unnamed")
            try:
                query_result = self._execute_cross_reference_query(
                    query_def.get("query", ""),
                    {**required, **derived, **llm_fields},
                )
                cross_refs[query_name] = query_result
            except Exception as exc:
                errors.append(f"Cross-reference query '{query_name}' failed: {str(exc)}")

        # 5. Compute confidence
        confidence_formula = schema.get("inference_output", {}).get(
            "confidence_formula", "0.5"
        )
        confidence = self._evaluate_confidence_formula(
            confidence_formula,
            {**required, **derived, **llm_fields},
        )

        return ExtractionResult(
            required_fields=required,
            derived_fields=derived,
            llm_fields=llm_fields,
            cross_references=cross_refs,
            confidence=confidence,
            errors=errors,
        )

    def generate_inference_record(
        self,
        extraction: ExtractionResult,
        template: FIRTemplate,
    ) -> InferenceRecord:
        """Generate an inference record from extraction results.

        Args:
            extraction: The extraction result
            template: The template used for extraction

        Returns:
            InferenceRecord ready to be persisted
        """
        schema = template.extraction_schema
        output_config = schema.get("inference_output", {})

        # Merge all extracted fields
        all_fields = {
            **extraction.required_fields,
            **extraction.derived_fields,
            **extraction.llm_fields,
        }

        # Add cross-reference counts for template access
        for ref_name, ref_results in extraction.cross_references.items():
            all_fields[f"{ref_name}_count"] = len(ref_results)
            all_fields[ref_name] = ref_results

        # Generate summary from template
        summary_template = output_config.get("summary_template", "{inference_type}")
        summary = self._interpolate_template(summary_template, all_fields)

        # Generate inference key for deduplication
        key_fields = output_config.get(
            "key_fields",
            list(extraction.required_fields.keys())[:3]
        )
        inference_key = self._generate_inference_key(
            template.template_id, all_fields, key_fields
        )

        # Build entity_ids
        entity_id_fields = output_config.get("entity_ids", [])
        entity_ids = {
            field: all_fields.get(field)
            for field in entity_id_fields
            if field in all_fields
        }

        # Build tags
        tag_templates = output_config.get("tags", [])
        tags = [
            self._interpolate_template(tag, all_fields)
            for tag in tag_templates
        ]

        return InferenceRecord(
            inference_id=f"inf_{uuid4().hex[:16]}",
            inference_key=inference_key,
            inference_type=output_config.get("inference_type", template.template_type),
            summary=summary[:1000],  # Truncate to reasonable length
            confidence=extraction.confidence,
            entity_type=output_config.get("entity_type", template.entity_type),
            entity_ids=entity_ids,
            attributes=all_fields,
            tags=tags,
            source="template_engine",
            status="active",
        )

    def apply_recommendation_rules(
        self,
        extraction: ExtractionResult,
        inference: InferenceRecord,
        template: FIRTemplate,
    ) -> list[RecommendationAction]:
        """Apply recommendation rules from template.

        Args:
            extraction: The extraction result
            inference: The generated inference record
            template: The template with recommendation rules

        Returns:
            List of recommendation actions to execute
        """
        all_fields = {
            **extraction.required_fields,
            **extraction.derived_fields,
            **extraction.llm_fields,
        }

        # Add cross-reference data for condition evaluation
        for ref_name, ref_results in extraction.cross_references.items():
            all_fields[f"{ref_name}_count"] = len(ref_results)
            all_fields[ref_name] = ref_results

        actions: list[RecommendationAction] = []
        for rule in template.recommendation_rules:
            condition = rule.get("condition", "always")

            if condition == "always" or self._evaluate_condition(condition, all_fields):
                action = RecommendationAction(
                    action_type=rule.get("action", "unknown"),
                    params=self._interpolate_params(rule.get("params", {}), all_fields),
                    inference_id=inference.inference_id,
                    template_id=template.template_id,
                    priority=rule.get("priority", "medium"),
                )
                actions.append(action)

        return actions

    def build_rag_document(
        self,
        extraction: ExtractionResult,
        inference: InferenceRecord,
        template: FIRTemplate,
    ) -> dict[str, Any] | None:
        """Build a RAG document from the inference if configured.

        Args:
            extraction: The extraction result
            inference: The generated inference record
            template: The template with RAG indexing config

        Returns:
            RAG document dict or None if indexing not enabled
        """
        schema = template.extraction_schema
        rag_config = schema.get("rag_indexing", {})

        if not rag_config.get("enabled", False):
            return None

        all_fields = {
            **extraction.required_fields,
            **extraction.derived_fields,
            **extraction.llm_fields,
        }

        doc_id = f"rag_{inference.inference_id}"
        doc_type = rag_config.get("doc_type", template.template_type)
        doc_folder = rag_config.get("doc_folder", "inferences")
        title = self._interpolate_template(
            rag_config.get("title_template", inference.summary),
            all_fields
        )
        search_text = self._interpolate_template(
            rag_config.get("search_text_template", inference.summary),
            all_fields
        )

        attributes: dict[str, Any] = {}
        for attr_name, attr_template in rag_config.get("attributes", {}).items():
            attributes[attr_name] = self._interpolate_template(attr_template, all_fields)

        return {
            "doc_id": doc_id,
            "doc_folder": doc_folder,
            "doc_type": doc_type,
            "entity_id": inference.inference_id,
            "title": title[:500],
            "search_text": search_text[:4000],
            "attributes": attributes,
            "inference_id": inference.inference_id,
        }

    def process_event(
        self,
        source_event_type: str,
        event: dict[str, Any],
        context: dict[str, Any],
    ) -> tuple[list[InferenceRecord], list[RecommendationAction], list[dict[str, Any]]]:
        """Process an event through all matching templates.

        This is the main entry point for processing FIR events.

        Args:
            source_event_type: The event type (e.g., 'mapping.accept')
            event: The event data
            context: Additional context

        Returns:
            Tuple of (inferences, recommendation_actions, rag_documents)
        """
        templates = self.load_templates(source_event_type)
        if not templates:
            logger.debug("No templates found for event type: %s", source_event_type)
            return [], [], []

        inferences: list[InferenceRecord] = []
        actions: list[RecommendationAction] = []
        rag_docs: list[dict[str, Any]] = []

        for template in templates:
            try:
                extraction = self.extract_inference(event, context, template)
                if extraction.errors:
                    logger.warning(
                        "Extraction errors for template %s: %s",
                        template.template_id,
                        extraction.errors
                    )

                inference = self.generate_inference_record(extraction, template)
                inferences.append(inference)

                template_actions = self.apply_recommendation_rules(
                    extraction, inference, template
                )
                actions.extend(template_actions)

                rag_doc = self.build_rag_document(extraction, inference, template)
                if rag_doc:
                    rag_docs.append(rag_doc)

            except Exception as exc:
                logger.error(
                    "Failed to process template %s for event type %s: %s",
                    template.template_id,
                    source_event_type,
                    exc,
                )

        return inferences, actions, rag_docs

    # --- Helper Methods ---

    def _parse_json(self, value: Any) -> Any:
        """Parse JSON from string or return value if already parsed."""
        if value is None:
            return None
        if isinstance(value, (dict, list)):
            return value
        if isinstance(value, str):
            try:
                return json.loads(value)
            except Exception:
                return None
        return None

    def _extract_required_fields(
        self,
        event: dict[str, Any],
        context: dict[str, Any],
        field_defs: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Extract required fields from event and context."""
        result: dict[str, Any] = {}
        for field_def in field_defs:
            name = field_def.get("name", "")
            if not name:
                continue

            source = field_def.get("source", name)
            default = field_def.get("default")
            nullable = field_def.get("nullable", False)

            # Parse source path (e.g., "event.mapping_row_id" or "context.project_id")
            value = self._resolve_path(source, {"event": event, "context": context})

            if value is None and default is not None:
                value = default
            elif value is None and not nullable:
                value = ""

            result[name] = value

        return result

    def _compute_derived_fields(
        self,
        base_fields: dict[str, Any],
        derived_defs: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Compute derived fields from expressions."""
        result: dict[str, Any] = {}
        for derived_def in derived_defs:
            name = derived_def.get("name", "")
            expression = derived_def.get("expression", "")
            if not name or not expression:
                continue

            try:
                value = self._evaluate_expression(expression, {**base_fields, **result})
                result[name] = value
            except Exception as exc:
                logger.debug("Failed to evaluate derived field %s: %s", name, exc)
                result[name] = None

        return result

    def _apply_llm_extraction(
        self,
        fields: dict[str, Any],
        llm_field_defs: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Apply LLM extraction for semantic fields."""
        if not self._llm_client:
            return {}

        result: dict[str, Any] = {}
        for field_def in llm_field_defs:
            name = field_def.get("name", "")
            prompt_template = field_def.get("prompt", "")
            if not name or not prompt_template:
                continue

            max_tokens = field_def.get("max_tokens", 100)
            fallback = field_def.get("fallback")
            output_format = field_def.get("output_format", "text")

            # Interpolate prompt
            prompt = self._interpolate_template(prompt_template, fields)

            try:
                # Call LLM (using Cortex Complete or similar)
                response = self._llm_client.complete(
                    prompt=prompt,
                    max_tokens=max_tokens,
                )

                value = str(response).strip()

                # Parse JSON if expected
                if output_format == "json":
                    try:
                        value = json.loads(value)
                    except Exception:
                        pass

                result[name] = value

            except Exception as exc:
                logger.debug("LLM extraction failed for field %s: %s", name, exc)
                if fallback is not None:
                    result[name] = fallback
                else:
                    result[name] = None

        return result

    def _execute_cross_reference_query(
        self,
        query_template: str,
        fields: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Execute a cross-reference query."""
        if not query_template:
            return []

        query = self._interpolate_template(query_template, fields)

        # Basic SQL injection prevention
        if any(kw in query.upper() for kw in ["DROP", "DELETE", "UPDATE", "INSERT", "ALTER", "TRUNCATE"]):
            logger.warning("Blocked potentially dangerous query: %s", query[:100])
            return []

        try:
            rows = self._session.sql(query).collect()
            return [dict(row.as_dict()) for row in rows]
        except Exception as exc:
            logger.debug("Cross-reference query failed: %s", exc)
            return []

    def _evaluate_condition(self, condition: str, fields: dict[str, Any]) -> bool:
        """Evaluate a condition expression safely."""
        if condition == "always":
            return True
        if condition == "never":
            return False

        try:
            # Simple condition evaluation with restricted builtins
            safe_builtins = {
                "len": len,
                "str": str,
                "int": int,
                "float": float,
                "bool": bool,
                "True": True,
                "False": False,
                "None": None,
                "and": lambda a, b: a and b,
                "or": lambda a, b: a or b,
                "not": lambda a: not a,
            }
            return bool(eval(condition, {"__builtins__": safe_builtins}, fields))
        except Exception:
            return False

    def _evaluate_confidence_formula(
        self,
        formula: str,
        fields: dict[str, Any],
    ) -> float:
        """Evaluate confidence formula safely."""
        try:
            safe_builtins = {
                "min": min,
                "max": max,
                "len": len,
                "float": float,
                "int": int,
                "True": True,
                "False": False,
                "None": None,
            }
            result = eval(formula, {"__builtins__": safe_builtins}, fields)
            return max(0.0, min(1.0, float(result)))
        except Exception:
            return 0.5

    def _evaluate_expression(
        self,
        expression: str,
        fields: dict[str, Any],
    ) -> Any:
        """Evaluate a derived field expression."""
        # Handle common patterns
        if expression.startswith("len("):
            match = re.match(r"len\((\w+)\)", expression)
            if match:
                field_name = match.group(1)
                value = fields.get(field_name, [])
                return len(value) if hasattr(value, "__len__") else 0

        if expression.startswith("hash("):
            inner = expression[5:-1]  # Remove "hash(" and ")"
            inner_value = self._interpolate_template(inner, fields)
            return hashlib.sha256(str(inner_value).encode()).hexdigest()[:16]

        # Simple case expression
        if expression.startswith("case when"):
            # Basic case-when parsing (simplified)
            return self._evaluate_case_expression(expression, fields)

        # Try direct evaluation
        try:
            safe_builtins = {
                "len": len,
                "str": str,
                "int": int,
                "float": float,
                "bool": bool,
                "True": True,
                "False": False,
                "None": None,
            }
            return eval(expression, {"__builtins__": safe_builtins}, fields)
        except Exception:
            return None

    def _evaluate_case_expression(
        self,
        expression: str,
        fields: dict[str, Any],
    ) -> Any:
        """Evaluate a simple case-when expression."""
        # Very basic case-when parsing
        # Format: case when condition then value when condition2 then value2 else default end
        parts = expression.lower().replace("case ", "").replace(" end", "").split(" when ")
        default_value = None

        for part in parts:
            if " else " in part:
                conditions, default_value = part.rsplit(" else ", 1)
                part = conditions

            if " then " in part:
                condition, value = part.split(" then ", 1)
                if self._evaluate_condition(condition.strip(), fields):
                    return value.strip().strip("'\"")

        return default_value.strip().strip("'\"") if default_value else None

    def _interpolate_template(
        self,
        template: str,
        fields: dict[str, Any],
    ) -> str:
        """Interpolate {field} placeholders in template."""
        if not template:
            return ""

        result = template
        for key, value in fields.items():
            placeholder = "{" + key + "}"
            if placeholder in result:
                str_value = str(value) if value is not None else ""
                result = result.replace(placeholder, str_value)

        return result

    def _interpolate_params(
        self,
        params: dict[str, Any],
        fields: dict[str, Any],
    ) -> dict[str, Any]:
        """Interpolate parameters, handling nested structures."""
        result: dict[str, Any] = {}
        for key, value in params.items():
            if isinstance(value, str):
                result[key] = self._interpolate_template(value, fields)
            elif isinstance(value, list):
                result[key] = [
                    self._interpolate_template(str(item), fields) if isinstance(item, str) else item
                    for item in value
                ]
            elif isinstance(value, dict):
                result[key] = self._interpolate_params(value, fields)
            else:
                result[key] = value
        return result

    def _generate_inference_key(
        self,
        template_id: str,
        fields: dict[str, Any],
        key_fields: list[str],
    ) -> str:
        """Generate a unique key for inference deduplication."""
        key_values = [template_id] + [str(fields.get(f, "")) for f in key_fields]
        return hashlib.sha256("|".join(key_values).encode()).hexdigest()[:32]

    def _resolve_path(self, path: str, root: dict[str, Any]) -> Any:
        """Resolve a dotted path like 'event.context.project_id'."""
        parts = path.split(".")
        current: Any = root
        for part in parts:
            if isinstance(current, dict) and part in current:
                current = current[part]
            elif hasattr(current, part):
                current = getattr(current, part)
            else:
                return None
        return current

    def invalidate_cache(self, source_event_type: str | None = None) -> None:
        """Invalidate template cache.

        Args:
            source_event_type: If provided, only invalidate cache for this event type.
                             If None, invalidate entire cache.
        """
        if source_event_type:
            cache_key = f"templates:{source_event_type}"
            self._template_cache.pop(cache_key, None)
        else:
            self._template_cache.clear()
