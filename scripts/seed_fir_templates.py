#!/usr/bin/env python3
"""Seed FIR templates into Snowflake.

This script populates TBL_WORKBENCH_FIR_TEMPLATES with detailed inference
extraction templates for each feedback type.

Usage:
    python seed_fir_templates.py --env-file .env.local [--force]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from uuid import uuid4

from snowflake.snowpark import Session


def load_env_file(env_path: Path) -> dict[str, str]:
    """Load environment variables from a file."""
    values: dict[str, str] = {}
    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def create_session(env: dict[str, str]) -> Session:
    """Create Snowflake session from environment."""
    return Session.builder.configs({
        "account": env["SNOWFLAKE_ACCOUNT"],
        "user": env["SNOWFLAKE_USER"],
        "password": env["SNOWFLAKE_PASSWORD"],
        "role": env["SNOWFLAKE_ROLE"],
        "warehouse": env["SNOWFLAKE_WAREHOUSE"],
        "database": env["SNOWFLAKE_DATABASE"],
        "schema": env["SNOWFLAKE_SCHEMA"],
    }).create()


# Template definitions
TEMPLATES = [
    {
        "template_id": "TPL_CHAT_FEEDBACK",
        "template_type": "chat_feedback",
        "source_event_type": "conversation.feedback",
        "entity_type": "conversation_turn",
        "name": "Chat Feedback Learning",
        "description": "Extract learnings from user feedback on AI chat responses",
        "extraction_schema": {
            "version": "1.0",
            "context_requirements": {
                "project_id": "required",
                "conversation_id": "required",
                "surface": "required"
            },
            "required_fields": [
                {"name": "feedback_id", "source": "event.feedback_id"},
                {"name": "target_request_id", "source": "event.target_request_id"},
                {"name": "category", "source": "event.category"},
                {"name": "rating", "source": "event.rating", "type": "number"},
                {"name": "comment", "source": "event.comment", "nullable": True},
                {"name": "option_selected", "source": "event.option_selected", "nullable": True},
                {"name": "surface", "source": "context.surface"},
                {"name": "project_id", "source": "context.project_id"},
                {"name": "sttm_id", "source": "context.sttm_id", "nullable": True}
            ],
            "derived_fields": [
                {
                    "name": "sentiment",
                    "expression": "case when rating >= 4 then 'positive' when rating <= 2 then 'negative' else 'neutral' end"
                },
                {
                    "name": "feedback_type",
                    "expression": "case when option_selected is not None then 'structured' else 'freeform' end"
                }
            ],
            "llm_extraction": {
                "enabled": True,
                "fields": [
                    {
                        "name": "correction_type",
                        "prompt": "Based on the user's comment '{comment}' and selected option '{option_selected}', classify the correction type: 'factual_error', 'missing_context', 'wrong_recommendation', 'unclear_explanation', 'routing_issue', 'none'",
                        "fallback": "none",
                        "max_tokens": 30
                    },
                    {
                        "name": "domain_area",
                        "prompt": "What domain area does this feedback relate to? Options: 'mapping_logic', 'transformation_rules', 'data_types', 'relationships', 'business_meaning', 'sql_generation', 'general'",
                        "fallback": "general",
                        "max_tokens": 30
                    },
                    {
                        "name": "actionable_insight",
                        "prompt": "Summarize in one sentence what the AI should do differently next time based on this feedback",
                        "max_tokens": 100
                    }
                ]
            },
            "inference_output": {
                "inference_type": "chat_feedback_learning",
                "summary_template": "User {sentiment} feedback on {surface}: {actionable_insight}",
                "confidence_formula": "0.5 + (0.3 if rating in [1,5] else 0.1) + (0.2 if comment else 0)",
                "entity_type": "conversation_turn",
                "entity_ids": ["project_id", "conversation_id", "target_request_id"],
                "tags": ["feedback:{sentiment}", "surface:{surface}", "correction:{correction_type}"]
            }
        },
        "recommendation_rules": [
            {
                "condition": "correction_type == 'wrong_recommendation' and surface == 'MAPPING'",
                "action": "create_semantic_learning",
                "params": {"learning_type": "mapping_correction", "confidence_boost": -0.1}
            },
            {
                "condition": "correction_type == 'routing_issue'",
                "action": "update_routing_hints",
                "params": {"adjust_intent_route": True}
            },
            {
                "condition": "sentiment == 'positive' and rating >= 4",
                "action": "reinforce_pattern",
                "params": {"boost_confidence": 0.05}
            }
        ],
        "prompt_guidance": "Focus on extracting actionable learnings that can improve future AI responses.",
        "version": "1.0"
    },
    {
        "template_id": "TPL_MAPPING_ACCEPTANCE",
        "template_type": "mapping_acceptance",
        "source_event_type": "mapping.accept",
        "entity_type": "mapping_row",
        "name": "Mapping Acceptance Learning",
        "description": "Extract learnings when user accepts an AI-suggested mapping",
        "extraction_schema": {
            "version": "1.0",
            "context_requirements": {
                "project_id": "required",
                "sttm_id": "required",
                "target_table": "required"
            },
            "required_fields": [
                {"name": "mapping_row_id", "source": "event.mapping_row_id"},
                {"name": "target_column", "source": "event.target_column"},
                {"name": "target_data_type", "source": "event.target_data_type"},
                {"name": "target_description", "source": "event.target_description", "nullable": True},
                {"name": "source_columns", "source": "event.source_columns", "type": "array"},
                {"name": "source_tables", "source": "context.source_tables", "type": "array"},
                {"name": "confidence_score", "source": "event.confidence_score", "type": "number"},
                {"name": "confidence_reason", "source": "event.confidence_reason"},
                {"name": "preprocessing_rule", "source": "event.preprocessing_rule"},
                {"name": "preprocessing_rule_type", "source": "event.preprocessing_rule_type"},
                {"name": "preprocessing_nl_rule", "source": "event.preprocessing_nl_rule", "nullable": True},
                {"name": "project_id", "source": "context.project_id"},
                {"name": "sttm_id", "source": "context.sttm_id"},
                {"name": "target_table", "source": "context.target_table"},
                {"name": "was_auto_mapped", "source": "event.was_auto_mapped", "type": "boolean", "default": True}
            ],
            "derived_fields": [
                {
                    "name": "pattern_key",
                    "expression": "hash(target_column + ':' + str(source_columns))"
                },
                {
                    "name": "table_pair_key",
                    "expression": "hash(str(source_tables) + '->' + target_table)"
                },
                {
                    "name": "confidence_bucket",
                    "expression": "case when confidence_score >= 0.9 then 'HIGH' when confidence_score >= 0.7 then 'MEDIUM' else 'LOW' end"
                },
                {
                    "name": "is_multi_source",
                    "expression": "len(source_columns) > 1"
                },
                {
                    "name": "rule_complexity",
                    "expression": "case when preprocessing_rule_type == 'Direct' then 'simple' when preprocessing_rule_type in ['CAST', 'TRIM', 'UPPER', 'LOWER'] then 'basic_transform' else 'complex' end"
                }
            ],
            "llm_extraction": {
                "enabled": True,
                "fields": [
                    {
                        "name": "business_rationale",
                        "prompt": "Why does {source_columns} map to {target_column} ({target_description})? Consider: naming similarity, data type compatibility, business meaning alignment. Provide a one-sentence business explanation.",
                        "max_tokens": 100
                    },
                    {
                        "name": "domain_pattern",
                        "prompt": "What general mapping pattern does this represent? Examples: 'customer_id_to_customer_key', 'timestamp_normalization', 'code_lookup', 'direct_attribute_copy', 'calculated_field'. Return the pattern name only.",
                        "max_tokens": 30
                    },
                    {
                        "name": "reusability_assessment",
                        "prompt": "How reusable is this mapping pattern for similar tables? Options: 'highly_reusable', 'table_specific', 'column_specific'",
                        "max_tokens": 20
                    }
                ]
            },
            "cross_reference_queries": [
                {
                    "name": "similar_project_mappings",
                    "query": "SELECT project_id, sttm_id, target_column, source_columns, confidence_score FROM TBL_STTM_ATTRIBUTES WHERE target_column ILIKE '%{target_column}%' AND project_id != '{project_id}' LIMIT 5",
                    "purpose": "Find similar mappings in other projects"
                }
            ],
            "inference_output": {
                "inference_type": "mapping_acceptance_learning",
                "summary_template": "Accepted mapping: {source_columns} -> {target_column} ({confidence_bucket} confidence). Pattern: {domain_pattern}. Rationale: {business_rationale}",
                "confidence_formula": "min(1.0, confidence_score + 0.1)",
                "entity_type": "mapping_row",
                "entity_ids": ["project_id", "sttm_id", "mapping_row_id"],
                "tags": ["mapping_pattern:{domain_pattern}", "rule_type:{preprocessing_rule_type}", "reusability:{reusability_assessment}"]
            }
        },
        "recommendation_rules": [
            {
                "condition": "reusability_assessment == 'highly_reusable'",
                "action": "create_global_semantic_learning",
                "params": {"learning_type": "reusable_mapping_pattern", "scope": "global", "priority": "high"}
            },
            {
                "condition": "confidence_score >= 0.9",
                "action": "boost_similar_patterns",
                "params": {"pattern_key": "{pattern_key}", "boost_amount": 0.1}
            },
            {
                "condition": "is_multi_source == True",
                "action": "create_semantic_learning",
                "params": {"learning_type": "multi_source_mapping", "detail": "Multi-source pattern for {target_column}"}
            },
            {
                "condition": "similar_project_mappings_count > 0",
                "action": "link_cross_project_learning",
                "params": {"learning_type": "cross_project_pattern"}
            }
        ],
        "prompt_guidance": "Focus on understanding why this mapping works and how it can be reused.",
        "version": "1.0"
    },
    {
        "template_id": "TPL_MAPPING_EDIT",
        "template_type": "mapping_edit",
        "source_event_type": "mapping.edit",
        "entity_type": "mapping_row",
        "name": "Mapping Edit Learning",
        "description": "Extract learnings when user modifies an existing or AI-suggested mapping",
        "extraction_schema": {
            "version": "1.0",
            "context_requirements": {
                "project_id": "required",
                "sttm_id": "required",
                "before_state": "required",
                "after_state": "required"
            },
            "required_fields": [
                {"name": "mapping_row_id", "source": "event.mapping_row_id"},
                {"name": "target_column", "source": "event.target_column"},
                {"name": "project_id", "source": "context.project_id"},
                {"name": "sttm_id", "source": "context.sttm_id"},
                {"name": "before_source_columns", "source": "event.before_state.source_columns", "type": "array"},
                {"name": "after_source_columns", "source": "event.after_state.source_columns", "type": "array"},
                {"name": "before_preprocessing_rule", "source": "event.before_state.preprocessing_rule"},
                {"name": "after_preprocessing_rule", "source": "event.after_state.preprocessing_rule"},
                {"name": "before_confidence", "source": "event.before_state.confidence_score", "type": "number"},
                {"name": "was_ai_suggested", "source": "event.before_state.was_ai_suggested", "type": "boolean", "default": False}
            ],
            "derived_fields": [
                {
                    "name": "change_type",
                    "expression": "case when str(before_source_columns) != str(after_source_columns) then 'source_change' when before_preprocessing_rule != after_preprocessing_rule then 'rule_change' else 'other' end"
                },
                {
                    "name": "was_correction",
                    "expression": "was_ai_suggested == True and change_type in ['source_change', 'rule_change']"
                },
                {
                    "name": "correction_severity",
                    "expression": "case when change_type == 'source_change' then 'major' when change_type == 'rule_change' then 'moderate' else 'minor' end"
                }
            ],
            "llm_extraction": {
                "enabled": True,
                "condition": "was_correction == True",
                "fields": [
                    {
                        "name": "edit_reason",
                        "prompt": "The user changed the mapping for {target_column} from {before_source_columns} to {after_source_columns}, and changed the rule from '{before_preprocessing_rule}' to '{after_preprocessing_rule}'. Why might the user have made this correction? Provide a brief business-logic explanation.",
                        "max_tokens": 150
                    },
                    {
                        "name": "error_category",
                        "prompt": "What type of AI error led to this correction? Options: 'wrong_source_table', 'wrong_source_column', 'missing_transformation', 'incorrect_transformation', 'naming_confusion', 'semantic_mismatch', 'data_type_issue', 'unknown'",
                        "max_tokens": 30
                    },
                    {
                        "name": "prevention_hint",
                        "prompt": "How could the AI avoid this error in the future? Provide a brief actionable hint.",
                        "max_tokens": 100
                    }
                ]
            },
            "cross_reference_queries": [
                {
                    "name": "similar_corrections_in_project",
                    "query": "SELECT * FROM TBL_WORKBENCH_INFERENCES WHERE inference_type = 'mapping_edit_learning' AND attributes:project_id = '{project_id}' AND attributes:error_category = '{error_category}' ORDER BY created_at DESC LIMIT 5",
                    "purpose": "Find similar corrections in this project"
                }
            ],
            "inference_output": {
                "inference_type": "mapping_edit_learning",
                "summary_template": "Mapping correction ({correction_severity}): {target_column} changed from {before_source_columns} to {after_source_columns}. Error type: {error_category}. Prevention: {prevention_hint}",
                "confidence_formula": "0.8 if was_correction else 0.5",
                "entity_type": "mapping_row",
                "entity_ids": ["project_id", "sttm_id", "mapping_row_id"],
                "tags": ["correction:{change_type}", "error:{error_category}", "severity:{correction_severity}"]
            }
        },
        "recommendation_rules": [
            {
                "condition": "was_correction == True and similar_corrections_in_project_count >= 2",
                "action": "create_project_specific_learning",
                "params": {"learning_type": "recurring_correction_pattern", "priority": "high"}
            },
            {
                "condition": "error_category == 'naming_confusion' or error_category == 'semantic_mismatch'",
                "action": "update_semantic_learning",
                "params": {
                    "learning_type": "column_disambiguation",
                    "columns": ["{target_column}"],
                    "correct_source": "{after_source_columns}",
                    "incorrect_source": "{before_source_columns}"
                }
            },
            {
                "condition": "correction_severity == 'major'",
                "action": "penalize_pattern",
                "params": {"pattern_key": "hash({target_column}:{before_source_columns})", "penalty_amount": 0.15}
            }
        ],
        "prompt_guidance": "Focus on understanding why the AI made this error and how to prevent it.",
        "version": "1.0"
    },
    {
        "template_id": "TPL_MAPPING_SAVE",
        "template_type": "mapping_save",
        "source_event_type": "sttm.save",
        "entity_type": "sttm_version",
        "name": "STTM Save Learning",
        "description": "Extract learnings when user saves an STTM draft with mappings",
        "extraction_schema": {
            "version": "1.0",
            "context_requirements": {
                "project_id": "required",
                "sttm_id": "required",
                "mapping_rows": "required"
            },
            "required_fields": [
                {"name": "project_id", "source": "context.project_id"},
                {"name": "project_name", "source": "context.project_name"},
                {"name": "sttm_id", "source": "context.sttm_id"},
                {"name": "sttm_name", "source": "context.sttm_name"},
                {"name": "version", "source": "event.version", "type": "number"},
                {"name": "target_table", "source": "context.target_table"},
                {"name": "source_tables", "source": "context.source_tables", "type": "array"},
                {"name": "mapping_rows", "source": "event.mapping_rows", "type": "array"},
                {"name": "validation_status", "source": "event.validation_status", "default": "not_validated"},
                {"name": "total_mappings", "source": "event.total_mappings", "type": "number"}
            ],
            "derived_fields": [
                {
                    "name": "table_pair_signature",
                    "expression": "hash(str(source_tables) + '->' + target_table)"
                }
            ],
            "llm_extraction": {
                "enabled": True,
                "fields": [
                    {
                        "name": "mapping_intent_summary",
                        "prompt": "Based on these mappings from {source_tables} to {target_table}, summarize the business purpose of this STTM in one sentence.",
                        "max_tokens": 100
                    },
                    {
                        "name": "complexity_assessment",
                        "prompt": "Rate the complexity of this STTM: 'simple' (mostly direct mappings), 'moderate' (some transformations), 'complex' (multiple sources, complex rules).",
                        "max_tokens": 20
                    },
                    {
                        "name": "domain_classification",
                        "prompt": "What business domain does this STTM belong to? Options: 'customer_data', 'financial', 'inventory', 'sales', 'hr', 'product', 'transaction', 'reference_data', 'other'",
                        "max_tokens": 30
                    }
                ]
            },
            "cross_reference_queries": [
                {
                    "name": "similar_sttms_in_project",
                    "query": "SELECT sttm_id, sttm_name, target_table FROM TBL_STTM WHERE project_id = '{project_id}' AND sttm_id != '{sttm_id}' LIMIT 5",
                    "purpose": "Find related STTMs in the same project"
                }
            ],
            "inference_output": {
                "inference_type": "sttm_save_learning",
                "summary_template": "STTM '{sttm_name}' saved (v{version}): {total_mappings} mappings. Domain: {domain_classification}. Complexity: {complexity_assessment}. Purpose: {mapping_intent_summary}",
                "confidence_formula": "0.6",
                "entity_type": "sttm_version",
                "entity_ids": ["project_id", "sttm_id", "version"],
                "tags": ["domain:{domain_classification}", "complexity:{complexity_assessment}", "table_pair:{table_pair_signature}"]
            }
        },
        "recommendation_rules": [
            {
                "condition": "similar_sttms_in_project_count > 0",
                "action": "suggest_pattern_reuse",
                "params": {"recommendation_type": "pattern_consolidation"}
            }
        ],
        "prompt_guidance": "Extract high-level learnings about the STTM purpose and patterns.",
        "version": "1.0"
    },
    {
        "template_id": "TPL_STTM_PUBLISH",
        "template_type": "sttm_publish",
        "source_event_type": "sttm.publish",
        "entity_type": "sttm_version",
        "name": "STTM Publish Learning",
        "description": "Extract high-confidence learnings when user publishes a validated STTM",
        "extraction_schema": {
            "version": "1.0",
            "context_requirements": {
                "project_id": "required",
                "sttm_id": "required",
                "validation_passed": "required"
            },
            "required_fields": [
                {"name": "project_id", "source": "context.project_id"},
                {"name": "project_name", "source": "context.project_name"},
                {"name": "sttm_id", "source": "context.sttm_id"},
                {"name": "sttm_name", "source": "context.sttm_name"},
                {"name": "version", "source": "event.version", "type": "number"},
                {"name": "target_table", "source": "context.target_table"},
                {"name": "source_tables", "source": "context.source_tables", "type": "array"},
                {"name": "mapping_rows", "source": "event.mapping_rows", "type": "array"},
                {"name": "generated_sql", "source": "event.generated_sql"},
                {"name": "dbt_model", "source": "event.dbt_model", "nullable": True},
                {"name": "published_by", "source": "event.published_by"}
            ],
            "derived_fields": [
                {
                    "name": "mapping_count",
                    "expression": "len(mapping_rows)"
                },
                {
                    "name": "table_pair_signature",
                    "expression": "hash(str(source_tables) + '->' + target_table)"
                },
                {
                    "name": "has_dbt_conversion",
                    "expression": "dbt_model is not None"
                }
            ],
            "llm_extraction": {
                "enabled": True,
                "fields": [
                    {
                        "name": "business_purpose",
                        "prompt": "This STTM '{sttm_name}' maps {source_tables} to {target_table}. Describe the business purpose in 2-3 sentences.",
                        "max_tokens": 200
                    },
                    {
                        "name": "key_transformations",
                        "prompt": "List the 3 most important transformations in this STTM.",
                        "max_tokens": 200
                    }
                ]
            },
            "inference_output": {
                "inference_type": "sttm_publish_learning",
                "summary_template": "Published STTM '{sttm_name}' v{version}: {mapping_count} validated mappings. Purpose: {business_purpose}. Key transformations: {key_transformations}",
                "confidence_formula": "0.95",
                "entity_type": "sttm_version",
                "entity_ids": ["project_id", "sttm_id", "version"],
                "tags": ["published", "validated", "table_pair:{table_pair_signature}"],
                "priority": "high"
            }
        },
        "recommendation_rules": [
            {
                "condition": "always",
                "action": "create_global_semantic_learning",
                "params": {"learning_type": "published_sttm_pattern", "scope": "global", "confidence": 0.95}
            },
            {
                "condition": "has_dbt_conversion == True",
                "action": "index_dbt_pattern",
                "params": {"dbt_model": "{dbt_model}", "source_tables": "{source_tables}", "target_table": "{target_table}"}
            }
        ],
        "prompt_guidance": "This is high-confidence learning from validated published work.",
        "version": "1.0"
    },
    {
        "template_id": "TPL_HISTORICAL_SQL",
        "template_type": "historical_sql",
        "source_event_type": "knowledge.import",
        "entity_type": "sql_asset",
        "name": "Historical SQL Import Learning",
        "description": "Extract learnings from imported historical SQL/mapping documents",
        "extraction_schema": {
            "version": "1.0",
            "context_requirements": {
                "source_label": "required"
            },
            "required_fields": [
                {"name": "sql_asset_id", "source": "event.sql_asset_id"},
                {"name": "title", "source": "event.title"},
                {"name": "sql_text", "source": "event.sql_text"},
                {"name": "sql_kind", "source": "event.sql_kind", "default": "historical_mapping"},
                {"name": "description", "source": "event.description", "nullable": True},
                {"name": "source_label", "source": "event.source_label"},
                {"name": "project_id", "source": "context.project_id", "nullable": True}
            ],
            "derived_fields": [
                {
                    "name": "sql_hash",
                    "expression": "hash(sql_text)"
                },
                {
                    "name": "has_joins",
                    "expression": "'JOIN' in sql_text.upper()"
                },
                {
                    "name": "has_transformations",
                    "expression": "'CAST' in sql_text.upper() or 'CASE' in sql_text.upper()"
                }
            ],
            "llm_extraction": {
                "enabled": True,
                "fields": [
                    {
                        "name": "business_purpose",
                        "prompt": "Analyze this SQL and describe its business purpose in one sentence: {sql_text}",
                        "max_tokens": 100
                    },
                    {
                        "name": "domain_classification",
                        "prompt": "What business domain does this SQL belong to? Options: 'customer_data', 'financial', 'inventory', 'sales', 'hr', 'product', 'transaction', 'reference_data', 'other'",
                        "max_tokens": 30
                    }
                ]
            },
            "inference_output": {
                "inference_type": "historical_sql_learning",
                "summary_template": "Imported {sql_kind}: '{title}'. Purpose: {business_purpose}. Domain: {domain_classification}.",
                "confidence_formula": "0.7",
                "entity_type": "sql_asset",
                "entity_ids": ["sql_asset_id"],
                "tags": ["historical", "domain:{domain_classification}", "sql_kind:{sql_kind}"]
            }
        },
        "recommendation_rules": [
            {
                "condition": "has_transformations == True",
                "action": "seed_transformation_learnings",
                "params": {"source": "historical_import", "confidence": 0.7}
            },
            {
                "condition": "project_id is not None",
                "action": "link_cross_project_learning",
                "params": {"project_id": "{project_id}", "asset_type": "historical_reference"}
            }
        ],
        "prompt_guidance": "Extract patterns from historical SQL for seeding initial learnings.",
        "version": "1.0"
    },
    {
        "template_id": "TPL_PROJECT_CONTEXT",
        "template_type": "project_context",
        "source_event_type": "project.context_update",
        "entity_type": "project",
        "name": "Project Context Learning",
        "description": "Maintain project-level context and cross-project learning relationships",
        "extraction_schema": {
            "version": "1.0",
            "context_requirements": {
                "project_id": "required"
            },
            "required_fields": [
                {"name": "project_id", "source": "event.project_id"},
                {"name": "project_name", "source": "event.project_name"},
                {"name": "description", "source": "event.description", "nullable": True},
                {"name": "domain", "source": "event.domain", "nullable": True}
            ],
            "derived_fields": [],
            "llm_extraction": {
                "enabled": False
            },
            "inference_output": {
                "inference_type": "project_context_learning",
                "summary_template": "Project '{project_name}' context updated. Domain: {domain}.",
                "confidence_formula": "0.8",
                "entity_type": "project",
                "entity_ids": ["project_id"],
                "tags": ["project_context", "domain:{domain}"]
            }
        },
        "recommendation_rules": [],
        "prompt_guidance": "Track project-level context for cross-project recommendations.",
        "version": "1.0"
    }
]


def seed_templates(session: Session, env: dict[str, str], force: bool = False) -> None:
    """Seed FIR templates into Snowflake."""
    db = env["SNOWFLAKE_DATABASE"]
    schema = env["SNOWFLAKE_SCHEMA"]
    table_name = f"{db}.{schema}.TBL_WORKBENCH_FIR_TEMPLATES"

    # Check if table exists
    try:
        session.sql(f"DESC TABLE {table_name}").collect()
    except Exception:
        print(f"Table {table_name} does not exist. Please run DDL first.")
        return

    if force:
        print("Force mode: clearing existing templates...")
        session.sql(f"DELETE FROM {table_name}").collect()

    for template in TEMPLATES:
        template_id = template["template_id"]

        # Check if template exists
        existing = session.sql(
            f"SELECT TEMPLATE_ID FROM {table_name} WHERE TEMPLATE_ID = '{template_id}'"
        ).collect()

        if existing and not force:
            print(f"Template {template_id} already exists, skipping...")
            continue

        # Insert or update template
        extraction_schema_json = json.dumps(template["extraction_schema"])
        recommendation_rules_json = json.dumps(template["recommendation_rules"])

        if existing:
            session.sql(f"""
                UPDATE {table_name}
                SET
                    TEMPLATE_TYPE = '{template["template_type"]}',
                    SOURCE_EVENT_TYPE = '{template["source_event_type"]}',
                    ENTITY_TYPE = '{template.get("entity_type") or ""}',
                    NAME = '{template["name"]}',
                    DESCRIPTION = '{template.get("description") or ""}',
                    EXTRACTION_SCHEMA = PARSE_JSON($${extraction_schema_json}$$),
                    PROMPT_GUIDANCE = '{template.get("prompt_guidance") or ""}',
                    RECOMMENDATION_RULES = PARSE_JSON($${recommendation_rules_json}$$),
                    VERSION = '{template["version"]}',
                    STATUS = 'active',
                    UPDATED_AT = CURRENT_TIMESTAMP()
                WHERE TEMPLATE_ID = '{template_id}'
            """).collect()
            print(f"Updated template: {template_id}")
        else:
            session.sql(f"""
                INSERT INTO {table_name} (
                    TEMPLATE_ID, TEMPLATE_TYPE, SOURCE_EVENT_TYPE, ENTITY_TYPE,
                    NAME, DESCRIPTION, EXTRACTION_SCHEMA, PROMPT_GUIDANCE,
                    RECOMMENDATION_RULES, STATUS, VERSION, CREATED_AT, UPDATED_AT
                ) VALUES (
                    '{template_id}',
                    '{template["template_type"]}',
                    '{template["source_event_type"]}',
                    '{template.get("entity_type") or ""}',
                    '{template["name"]}',
                    '{template.get("description") or ""}',
                    PARSE_JSON($${extraction_schema_json}$$),
                    '{template.get("prompt_guidance") or ""}',
                    PARSE_JSON($${recommendation_rules_json}$$),
                    'active',
                    '{template["version"]}',
                    CURRENT_TIMESTAMP(),
                    CURRENT_TIMESTAMP()
                )
            """).collect()
            print(f"Inserted template: {template_id}")

    print(f"\nSeeded {len(TEMPLATES)} FIR templates successfully!")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed FIR templates into Snowflake")
    parser.add_argument(
        "--env-file",
        type=Path,
        default=Path(".env.local"),
        help="Path to environment file",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force overwrite existing templates",
    )
    args = parser.parse_args()

    if not args.env_file.exists():
        print(f"Environment file not found: {args.env_file}")
        return

    env = load_env_file(args.env_file)
    session = create_session(env)

    try:
        seed_templates(session, env, force=args.force)
    finally:
        session.close()


if __name__ == "__main__":
    main()
