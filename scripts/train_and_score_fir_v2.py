#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from snowflake.ml.feature_store import CreationMode, Entity, FeatureStore, FeatureView
from snowflake.ml.registry import Registry
from snowflake.snowpark import Session


@dataclass
class FirMlConfig:
    account: str
    user: str
    password: str
    role: str
    warehouse: str
    database: str
    schema: str

    @property
    def fq_prefix(self) -> str:
        return f"{self.database}.{self.schema}"

    @property
    def fir_features_table(self) -> str:
        return f"{self.fq_prefix}.TBL_WORKBENCH_FIR_FEATURES"

    @property
    def feedback_table(self) -> str:
        return f"{self.fq_prefix}.TBL_WORKBENCH_FEEDBACK"

    @property
    def assistant_signals_table(self) -> str:
        return f"{self.fq_prefix}.TBL_WORKBENCH_ASSISTANT_SIGNALS"

    @property
    def recommendation_table(self) -> str:
        return f"{self.fq_prefix}.TBL_WORKBENCH_RECOMMENDATIONS"

    @property
    def model_scores_table(self) -> str:
        return f"{self.fq_prefix}.TBL_WORKBENCH_FIR_MODEL_SCORES"

    @property
    def fir_events_table(self) -> str:
        return f"{self.fq_prefix}.TBL_WORKBENCH_FIR_EVENTS"

    @property
    def mapping_intents_table(self) -> str:
        return f"{self.fq_prefix}.TBL_WORKBENCH_MAPPING_INTENTS"

    @property
    def semantic_learnings_table(self) -> str:
        return f"{self.fq_prefix}.TBL_WORKBENCH_SEMANTIC_LEARNINGS"


def load_env_file(env_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def resolve_config(env_path: Path) -> FirMlConfig:
    env = load_env_file(env_path)
    return FirMlConfig(
        account=env["SNOWFLAKE_ACCOUNT"],
        user=env["SNOWFLAKE_USER"],
        password=env["SNOWFLAKE_PASSWORD"],
        role=env["SNOWFLAKE_ROLE"],
        warehouse=env["SNOWFLAKE_WAREHOUSE"],
        database=env["SNOWFLAKE_DATABASE"],
        schema=env["SNOWFLAKE_SCHEMA"],
    )


def create_session(config: FirMlConfig) -> Session:
    return Session.builder.configs(
        {
            "account": config.account,
            "user": config.user,
            "password": config.password,
            "role": config.role,
            "warehouse": config.warehouse,
            "database": config.database,
            "schema": config.schema,
        }
    ).create()


def ensure_model_scores_table(session: Session, config: FirMlConfig) -> None:
    session.sql(
        f"""
        CREATE TABLE IF NOT EXISTS {config.model_scores_table} (
            SCORE_ID STRING,
            MODEL_NAME STRING,
            MODEL_VERSION STRING,
            CONTEXT_KEY STRING,
            ENTITY_TYPE STRING,
            ENTITY_ID STRING,
            PAGE STRING,
            SURFACE STRING,
            FEEDBACK_NEEDED_PROBABILITY FLOAT,
            RECOMMENDATION_HELPFULNESS_PROBABILITY FLOAT,
            RECOMMENDATION_TYPE STRING,
            RECOMMENDATION_PRIORITY FLOAT,
            SCORE_PAYLOAD VARIANT,
            UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
            CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
        )
        """
    ).collect()


def _parse_json(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            return json.loads(raw)
        except Exception:
            return None
    return None


def _extract_context_key(*, attributes: dict[str, Any], entity_ids: list[str]) -> str:
    context_key = str(attributes.get("context_key") or "").strip()
    if context_key:
        return context_key
    if entity_ids:
        return "|".join(sorted(str(item).strip() for item in entity_ids if str(item).strip()))
    return f"legacy_context|{uuid4().hex}"


def bootstrap_feature_rows_from_history(session: Session, config: FirMlConfig) -> int:
    existing_count = int(session.sql(f"SELECT COUNT(*) FROM {config.fir_features_table}").collect()[0][0] or 0)
    if existing_count > 0:
        return existing_count

    signals = session.sql(
        f"""
        SELECT
            SIGNAL_ID,
            SIGNAL_TYPE,
            STATUS,
            TITLE,
            MESSAGE,
            ENTITY_TYPE,
            ENTITY_IDS,
            ATTRIBUTES,
            CONFIDENCE,
            UPDATED_AT
        FROM {config.assistant_signals_table}
        ORDER BY UPDATED_AT DESC
        """
    ).collect()
    if not signals:
        return 0

    feedback_summary_rows = session.sql(
        f"""
        WITH feedback_context AS (
            SELECT
                COALESCE(SELECTION_CONTEXT:context_key::string, ENTITY_ID) AS CONTEXT_KEY,
                COUNT(*) AS FEEDBACK_COUNT,
                SUM(IFF(LOWER(COALESCE(OPTION_SELECTED, '')) IN (
                    'needs correction',
                    'these tables should not be joined directly',
                    'should not be joined',
                    'not now'
                ), 1, 0)) AS CORRECTED_COUNT,
                SUM(IFF(LOWER(COALESCE(OPTION_SELECTED, '')) IN (
                    'looks right',
                    'these tables are definitely related',
                    'same business entity',
                    'these tables are related as shown',
                    'this is a new mapping',
                    'i am updating an existing mapping'
                ), 1, 0)) AS ACCEPTED_COUNT
            FROM {config.feedback_table}
            GROUP BY 1
        )
        SELECT CONTEXT_KEY, FEEDBACK_COUNT, CORRECTED_COUNT, ACCEPTED_COUNT
        FROM feedback_context
        WHERE CONTEXT_KEY IS NOT NULL
        """
    ).collect()
    feedback_by_context = {
        str(row["CONTEXT_KEY"]): {
            "feedback_count": int(row["FEEDBACK_COUNT"] or 0),
            "corrected_count": int(row["CORRECTED_COUNT"] or 0),
            "accepted_count": int(row["ACCEPTED_COUNT"] or 0),
        }
        for row in feedback_summary_rows
    }

    signal_summary_rows = session.sql(
        f"""
        SELECT
            COALESCE(ATTRIBUTES:context_key::string, ARRAY_TO_STRING(ENTITY_IDS, '|')) AS CONTEXT_KEY,
            COUNT(*) AS SIGNAL_COUNT,
            SUM(IFF(STATUS IN ('responded', 'acknowledged'), 1, 0)) AS HELPFUL_SIGNAL_COUNT
        FROM {config.assistant_signals_table}
        GROUP BY 1
        HAVING CONTEXT_KEY IS NOT NULL
        """
    ).collect()
    signal_summary_by_context = {
        str(row["CONTEXT_KEY"]): {
            "signal_count": int(row["SIGNAL_COUNT"] or 0),
            "helpful_signal_count": int(row["HELPFUL_SIGNAL_COUNT"] or 0),
        }
        for row in signal_summary_rows
    }

    intent_contexts = {
        str(row["CONTEXT_KEY"])
        for row in session.sql(
            f"SELECT DISTINCT CONTEXT_KEY FROM {config.mapping_intents_table} WHERE CONTEXT_KEY IS NOT NULL"
        ).collect()
    }

    semantic_learning_rows = session.sql(
        f"""
        SELECT
            ARRAY_TO_STRING(ENTITY_IDS, '|') AS ENTITY_KEY,
            COUNT(*) AS LEARNING_COUNT
        FROM {config.semantic_learnings_table}
        GROUP BY 1
        HAVING ENTITY_KEY IS NOT NULL
        """
    ).collect()
    semantic_learning_by_entity = {
        str(row["ENTITY_KEY"]): int(row["LEARNING_COUNT"] or 0) for row in semantic_learning_rows
    }

    client_note_count = int(
        session.sql(
            f"""
            SELECT
                COALESCE(
                    (SELECT COUNT(*) FROM {config.fq_prefix}.TBL_WORKBENCH_CLIENT_NOTES),
                    0
                ) +
                COALESCE(
                    (SELECT COUNT(*) FROM {config.fq_prefix}.TBL_WORKBENCH_CLIENT_SQL_ASSETS),
                    0
                )
            """
        ).collect()[0][0]
        or 0
    )

    feature_rows: list[dict[str, Any]] = []
    seen_contexts: set[str] = set()
    for row in signals:
        signal = row.as_dict()
        raw_entity_ids = _parse_json(signal.get("ENTITY_IDS"))
        entity_ids = [str(item).strip() for item in (raw_entity_ids or []) if str(item).strip()]
        attributes = _parse_json(signal.get("ATTRIBUTES")) or {}
        context_key = _extract_context_key(attributes=attributes, entity_ids=entity_ids)
        if context_key in seen_contexts:
            continue
        seen_contexts.add(context_key)

        page = str(attributes.get("page") or "builder").strip().lower() or "builder"
        surface = str(attributes.get("surface") or "SOURCE_SELECTION").strip().upper() or "SOURCE_SELECTION"
        action_type = str(attributes.get("action_type") or "").strip().lower()
        current_understanding = str(attributes.get("current_understanding") or "").strip()
        recommendation_class = str(attributes.get("recommendation_class") or "").strip()
        title = str(signal.get("TITLE") or "").strip()
        message = str(signal.get("MESSAGE") or "").strip()
        entity_key = "|".join(sorted(entity_ids))
        feedback_summary = feedback_by_context.get(context_key, {})
        signal_summary = signal_summary_by_context.get(context_key, {})
        positive_feedback_count = int(feedback_summary.get("accepted_count") or 0)
        negative_feedback_count = int(feedback_summary.get("corrected_count") or 0)
        feedback_count = int(feedback_summary.get("feedback_count") or 0)
        signal_count = int(signal_summary.get("signal_count") or 0)
        helpful_signal_count = int(signal_summary.get("helpful_signal_count") or 0)
        has_join_language = any(
            token in f"{title} {message} {current_understanding}".lower()
            for token in ("join", "relationship", "related")
        ) or action_type == "explain_relationship"
        semantic_ready = action_type != "refresh_semantic_context" and recommendation_class != "semantic_gap_needs_feedback"
        features = {
            "context_key": context_key,
            "page": page,
            "surface": surface,
            "selected_table_count": len(entity_ids),
            "selected_pair": entity_ids[:2],
            "target_label": attributes.get("target_table"),
            "relationship_count": 1 if has_join_language else 0,
            "join_exists": has_join_language,
            "join_type": "INNER" if "inner join" in current_understanding.lower() else None,
            "join_confidence": float(signal.get("CONFIDENCE") or 0.0),
            "suspicious_join": "suspicious" in message.lower() or "unusual" in message.lower(),
            "semantic_ready": semantic_ready,
            "semantic_bundle_id": attributes.get("bundle_id") or attributes.get("semantic_bundle_id"),
            "semantic_view_name": attributes.get("semantic_view_name"),
            "semantic_learning_count": semantic_learning_by_entity.get(entity_key, 0),
            "positive_feedback_count": positive_feedback_count,
            "negative_feedback_count": negative_feedback_count,
            "feedback_density": feedback_count,
            "recommendation_accept_rate": helpful_signal_count / signal_count if signal_count else None,
            "mapped_count": None,
            "unmapped_count": None,
            "has_notes_source": any(
                any(token in item.upper() for token in ("NOTE", "AUDIT", "HISTORY")) for item in entity_ids
            ),
            "has_client_knowledge": client_note_count > 0,
            "mapping_goal": None,
            "mapping_intent_present": context_key in intent_contexts,
            "relationship_story": current_understanding or message or title,
        }
        feature_rows.append(
            {
                "FEATURE_KEY": f"fir_feature_snapshot|{context_key}",
                "USER_ID": "bootstrap",
                "SESSION_ID": "bootstrap",
                "PAGE": page,
                "SURFACE": surface,
                "ENTITY_TYPE": str(signal.get("ENTITY_TYPE") or "table_selection").strip() or "table_selection",
                "ENTITY_IDS": json.dumps(entity_ids),
                "FEATURES": json.dumps(features),
                "MODEL_TARGETS": json.dumps({}),
            }
        )

    if not feature_rows:
        return 0

    upload_df = pd.DataFrame(feature_rows)
    temp_name = "TMP_FIR_FEATURE_BOOTSTRAP"
    session.write_pandas(upload_df, temp_name, auto_create_table=True, overwrite=True)
    session.sql(
        f"""
        MERGE INTO {config.fir_features_table} AS target
        USING (
            SELECT
                FEATURE_KEY,
                USER_ID,
                SESSION_ID,
                PAGE,
                SURFACE,
                ENTITY_TYPE,
                PARSE_JSON(ENTITY_IDS) AS ENTITY_IDS,
                PARSE_JSON(FEATURES) AS FEATURES,
                PARSE_JSON(MODEL_TARGETS) AS MODEL_TARGETS
            FROM {temp_name}
        ) AS source
        ON target.FEATURE_KEY = source.FEATURE_KEY
        WHEN MATCHED THEN UPDATE SET
            USER_ID = source.USER_ID,
            SESSION_ID = source.SESSION_ID,
            PAGE = source.PAGE,
            SURFACE = source.SURFACE,
            ENTITY_TYPE = source.ENTITY_TYPE,
            ENTITY_IDS = source.ENTITY_IDS,
            FEATURES = source.FEATURES,
            MODEL_TARGETS = source.MODEL_TARGETS,
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHEN NOT MATCHED THEN INSERT (
            FEATURE_KEY,
            USER_ID,
            SESSION_ID,
            PAGE,
            SURFACE,
            ENTITY_TYPE,
            ENTITY_IDS,
            FEATURES,
            MODEL_TARGETS,
            UPDATED_AT
        ) VALUES (
            source.FEATURE_KEY,
            source.USER_ID,
            source.SESSION_ID,
            source.PAGE,
            source.SURFACE,
            source.ENTITY_TYPE,
            source.ENTITY_IDS,
            source.FEATURES,
            source.MODEL_TARGETS,
            CURRENT_TIMESTAMP()
        )
        """
    ).collect()
    session.sql(f"DROP TABLE IF EXISTS {temp_name}").collect()
    return len(feature_rows)


def register_feature_store(session: Session, config: FirMlConfig) -> None:
    feature_store = FeatureStore(
        session=session,
        database=config.database,
        name="FS_WORKBENCH_FIR",
        default_warehouse=config.warehouse,
        creation_mode=CreationMode.CREATE_IF_NOT_EXIST,
    )
    entity = Entity(
        name="mapping_session",
        join_keys=["CONTEXT_KEY"],
        desc="Stable FIR context key for a live mapping/session context.",
    )
    try:
        feature_store.register_entity(entity)
    except Exception:
        pass

    feature_df = session.sql(
        f"""
        SELECT
            FEATURES:context_key::string AS CONTEXT_KEY,
            PAGE,
            SURFACE,
            ENTITY_TYPE,
            COALESCE(FEATURES:selected_table_count::float, 0) AS SELECTED_TABLE_COUNT,
            COALESCE(FEATURES:join_exists::int, 0) AS JOIN_EXISTS,
            COALESCE(FEATURES:join_confidence::float, 0) AS JOIN_CONFIDENCE,
            COALESCE(FEATURES:suspicious_join::int, 0) AS SUSPICIOUS_JOIN,
            COALESCE(FEATURES:semantic_ready::int, 0) AS SEMANTIC_READY,
            COALESCE(FEATURES:semantic_learning_count::float, 0) AS SEMANTIC_LEARNING_COUNT,
            COALESCE(FEATURES:positive_feedback_count::float, 0) AS POSITIVE_FEEDBACK_COUNT,
            COALESCE(FEATURES:negative_feedback_count::float, 0) AS NEGATIVE_FEEDBACK_COUNT,
            COALESCE(FEATURES:feedback_density::float, 0) AS FEEDBACK_DENSITY,
            COALESCE(FEATURES:recommendation_accept_rate::float, 0) AS RECOMMENDATION_ACCEPT_RATE,
            COALESCE(FEATURES:mapped_count::float, 0) AS MAPPED_COUNT,
            COALESCE(FEATURES:unmapped_count::float, 0) AS UNMAPPED_COUNT,
            COALESCE(FEATURES:has_notes_source::int, 0) AS HAS_NOTES_SOURCE,
            COALESCE(FEATURES:has_client_knowledge::int, 0) AS HAS_CLIENT_KNOWLEDGE,
            COALESCE(FEATURES:mapping_intent_present::int, 0) AS MAPPING_INTENT_PRESENT,
            UPDATED_AT
        FROM {config.fir_features_table}
        """
    )
    feature_view = FeatureView(
        name="FV_WORKBENCH_FIR_CONTEXT",
        entities=[entity],
        feature_df=feature_df,
        timestamp_col="UPDATED_AT",
        desc="Online FIR context features for recommendation, feedback, and ranking decisions.",
        refresh_freq="5 minutes",
    )
    feature_store.register_feature_view(feature_view, version="V1", block=True, overwrite=True)


def build_training_dataframe(session: Session, config: FirMlConfig) -> pd.DataFrame:
    sql = f"""
    WITH feedback_context AS (
        SELECT
            COALESCE(SELECTION_CONTEXT:context_key::string, ENTITY_ID) AS CONTEXT_KEY,
            COUNT(*) AS FEEDBACK_COUNT,
            SUM(IFF(LOWER(COALESCE(OPTION_SELECTED, '')) IN (
                'needs correction',
                'these tables should not be joined directly',
                'should not be joined',
                'not now'
            ), 1, 0)) AS CORRECTED_COUNT,
            SUM(IFF(LOWER(COALESCE(OPTION_SELECTED, '')) IN (
                'looks right',
                'same business entity',
                'these tables are related as shown',
                'this is a new mapping',
                'i am updating an existing mapping'
            ), 1, 0)) AS ACCEPTED_COUNT
        FROM {config.feedback_table}
        GROUP BY 1
    ),
    signal_context AS (
        SELECT
            COALESCE(ATTRIBUTES:context_key::string, ENTITY_IDS[0]::string) AS CONTEXT_KEY,
            COUNT(*) AS SIGNAL_COUNT,
            SUM(IFF(SIGNAL_TYPE = 'recommendation' AND STATUS IN ('acknowledged', 'responded'), 1, 0)) AS HELPFUL_RECOMMENDATION_COUNT,
            MAX(
                COALESCE(
                    ATTRIBUTES:recommendation_class::string,
                    ATTRIBUTES:feedback_class::string,
                    IFF(LOWER(COALESCE(ATTRIBUTES:action_type::string, '')) = 'refresh_semantic_context', 'semantic_gap_needs_feedback', NULL),
                    IFF(LOWER(COALESCE(ATTRIBUTES:action_type::string, '')) = 'explain_relationship', 'business_relationship_confirmation', NULL)
                )
            ) AS RECOMMENDATION_TYPE_LABEL
        FROM {config.assistant_signals_table}
        GROUP BY 1
    )
    SELECT
        f.FEATURES:context_key::string AS CONTEXT_KEY,
        f.PAGE,
        f.SURFACE,
        COALESCE(f.FEATURES:selected_table_count::float, 0) AS SELECTED_TABLE_COUNT,
        COALESCE(f.FEATURES:join_exists::int, 0) AS JOIN_EXISTS,
        COALESCE(f.FEATURES:join_confidence::float, 0) AS JOIN_CONFIDENCE,
        COALESCE(f.FEATURES:suspicious_join::int, 0) AS SUSPICIOUS_JOIN,
        COALESCE(f.FEATURES:semantic_ready::int, 0) AS SEMANTIC_READY,
        COALESCE(f.FEATURES:semantic_learning_count::float, 0) AS SEMANTIC_LEARNING_COUNT,
        COALESCE(f.FEATURES:positive_feedback_count::float, 0) AS POSITIVE_FEEDBACK_COUNT,
        COALESCE(f.FEATURES:negative_feedback_count::float, 0) AS NEGATIVE_FEEDBACK_COUNT,
        COALESCE(f.FEATURES:feedback_density::float, 0) AS FEEDBACK_DENSITY,
        COALESCE(f.FEATURES:recommendation_accept_rate::float, 0) AS RECOMMENDATION_ACCEPT_RATE,
        COALESCE(f.FEATURES:mapped_count::float, 0) AS MAPPED_COUNT,
        COALESCE(f.FEATURES:unmapped_count::float, 0) AS UNMAPPED_COUNT,
        COALESCE(f.FEATURES:has_notes_source::int, 0) AS HAS_NOTES_SOURCE,
        COALESCE(f.FEATURES:has_client_knowledge::int, 0) AS HAS_CLIENT_KNOWLEDGE,
        COALESCE(f.FEATURES:mapping_intent_present::int, 0) AS MAPPING_INTENT_PRESENT,
        IFF(COALESCE(fc.CORRECTED_COUNT, 0) > 0 OR COALESCE(fc.FEEDBACK_COUNT, 0) > 0, 1, 0) AS FEEDBACK_NEEDED_LABEL,
        IFF(COALESCE(sc.HELPFUL_RECOMMENDATION_COUNT, 0) > 0, 1, 0) AS RECOMMENDATION_HELPFUL_LABEL,
        COALESCE(
            sc.RECOMMENDATION_TYPE_LABEL,
            IFF(COALESCE(f.FEATURES:join_exists::int, 0) = 1, 'business_relationship_confirmation', 'source_suggestion')
        ) AS RECOMMENDATION_TYPE_LABEL
    FROM {config.fir_features_table} f
    LEFT JOIN feedback_context fc
      ON fc.CONTEXT_KEY = f.FEATURES:context_key::string
    LEFT JOIN signal_context sc
      ON sc.CONTEXT_KEY = f.FEATURES:context_key::string
    WHERE f.FEATURES:context_key::string IS NOT NULL
    """
    return session.sql(sql).to_pandas()


def build_scoring_dataframe(session: Session, config: FirMlConfig) -> pd.DataFrame:
    sql = f"""
    SELECT
        FEATURES:context_key::string AS CONTEXT_KEY,
        ENTITY_TYPE,
        PAGE,
        SURFACE,
        COALESCE(FEATURES:selected_table_count::float, 0) AS SELECTED_TABLE_COUNT,
        COALESCE(FEATURES:join_exists::int, 0) AS JOIN_EXISTS,
        COALESCE(FEATURES:join_confidence::float, 0) AS JOIN_CONFIDENCE,
        COALESCE(FEATURES:suspicious_join::int, 0) AS SUSPICIOUS_JOIN,
        COALESCE(FEATURES:semantic_ready::int, 0) AS SEMANTIC_READY,
        COALESCE(FEATURES:semantic_learning_count::float, 0) AS SEMANTIC_LEARNING_COUNT,
        COALESCE(FEATURES:positive_feedback_count::float, 0) AS POSITIVE_FEEDBACK_COUNT,
        COALESCE(FEATURES:negative_feedback_count::float, 0) AS NEGATIVE_FEEDBACK_COUNT,
        COALESCE(FEATURES:feedback_density::float, 0) AS FEEDBACK_DENSITY,
        COALESCE(FEATURES:recommendation_accept_rate::float, 0) AS RECOMMENDATION_ACCEPT_RATE,
        COALESCE(FEATURES:mapped_count::float, 0) AS MAPPED_COUNT,
        COALESCE(FEATURES:unmapped_count::float, 0) AS UNMAPPED_COUNT,
        COALESCE(FEATURES:has_notes_source::int, 0) AS HAS_NOTES_SOURCE,
        COALESCE(FEATURES:has_client_knowledge::int, 0) AS HAS_CLIENT_KNOWLEDGE,
        COALESCE(FEATURES:mapping_intent_present::int, 0) AS MAPPING_INTENT_PRESENT
    FROM {config.fir_features_table}
    WHERE FEATURES:context_key::string IS NOT NULL
    """
    return session.sql(sql).to_pandas()


def build_preprocessor(categorical_cols: list[str], numeric_cols: list[str]) -> ColumnTransformer:
    return ColumnTransformer(
        transformers=[
            (
                "categorical",
                Pipeline(
                    [
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        ("onehot", OneHotEncoder(handle_unknown="ignore")),
                    ]
                ),
                categorical_cols,
            ),
            (
                "numeric",
                Pipeline(
                    [
                        ("imputer", SimpleImputer(strategy="constant", fill_value=0.0)),
                    ]
                ),
                numeric_cols,
            ),
        ]
    )


def train_classifier(
    df: pd.DataFrame,
    *,
    label_col: str,
    model_name: str,
    registry: Registry,
    version_name: str,
) -> dict[str, Any] | None:
    if label_col not in df.columns or df[label_col].nunique() < 2:
        return None
    feature_cols = [
        "PAGE",
        "SURFACE",
        "SELECTED_TABLE_COUNT",
        "JOIN_EXISTS",
        "JOIN_CONFIDENCE",
        "SUSPICIOUS_JOIN",
        "SEMANTIC_READY",
        "SEMANTIC_LEARNING_COUNT",
        "POSITIVE_FEEDBACK_COUNT",
        "NEGATIVE_FEEDBACK_COUNT",
        "FEEDBACK_DENSITY",
        "RECOMMENDATION_ACCEPT_RATE",
        "MAPPED_COUNT",
        "UNMAPPED_COUNT",
        "HAS_NOTES_SOURCE",
        "HAS_CLIENT_KNOWLEDGE",
        "MAPPING_INTENT_PRESENT",
    ]
    working = df[feature_cols + [label_col]].copy()
    X = working[feature_cols]
    y = working[label_col]
    categorical_cols = ["PAGE", "SURFACE"]
    numeric_cols = [col for col in feature_cols if col not in categorical_cols]
    pipeline = Pipeline(
        [
            ("preprocessor", build_preprocessor(categorical_cols, numeric_cols)),
            ("classifier", LogisticRegression(max_iter=500)),
        ]
    )
    pipeline.fit(X, y)
    preds = pipeline.predict(X)
    try:
        probs = pipeline.predict_proba(X)[:, 1]
        auc = float(roc_auc_score(y, probs))
    except Exception:
        auc = None
    metrics = {
        "train_accuracy": float(accuracy_score(y, preds)),
        "train_row_count": int(len(working)),
        "positive_rate": float(y.mean()),
    }
    if auc is not None:
        metrics["train_auc"] = auc
    model_version = registry.log_model(
        pipeline,
        model_name=model_name,
        version_name=version_name,
        metrics=metrics,
        sample_input_data=X.head(min(len(X), 20)),
        python_version="3.13",
        pip_requirements=[
            "pandas==2.3.3",
            "scikit-learn==1.7.2",
            "snowflake-ml-python==1.41.0",
        ],
    )
    try:
        model_version.set_alias("DEFAULT")
    except Exception:
        pass
    return {"pipeline": pipeline, "metrics": metrics, "version_name": version_name}


def train_type_classifier(
    df: pd.DataFrame,
    *,
    registry: Registry,
    version_name: str,
) -> dict[str, Any] | None:
    label_col = "RECOMMENDATION_TYPE_LABEL"
    if label_col not in df.columns or df[label_col].nunique() < 2:
        return None
    feature_cols = [
        "PAGE",
        "SURFACE",
        "SELECTED_TABLE_COUNT",
        "JOIN_EXISTS",
        "JOIN_CONFIDENCE",
        "SUSPICIOUS_JOIN",
        "SEMANTIC_READY",
        "SEMANTIC_LEARNING_COUNT",
        "POSITIVE_FEEDBACK_COUNT",
        "NEGATIVE_FEEDBACK_COUNT",
        "FEEDBACK_DENSITY",
        "RECOMMENDATION_ACCEPT_RATE",
        "MAPPED_COUNT",
        "UNMAPPED_COUNT",
        "HAS_NOTES_SOURCE",
        "HAS_CLIENT_KNOWLEDGE",
        "MAPPING_INTENT_PRESENT",
    ]
    working = df[feature_cols + [label_col]].copy()
    X = working[feature_cols]
    y = working[label_col]
    categorical_cols = ["PAGE", "SURFACE"]
    numeric_cols = [col for col in feature_cols if col not in categorical_cols]
    pipeline = Pipeline(
        [
            ("preprocessor", build_preprocessor(categorical_cols, numeric_cols)),
            ("classifier", LogisticRegression(max_iter=500, multi_class="auto")),
        ]
    )
    pipeline.fit(X, y)
    preds = pipeline.predict(X)
    metrics = {
        "train_accuracy": float(accuracy_score(y, preds)),
        "train_row_count": int(len(working)),
    }
    model_version = registry.log_model(
        pipeline,
        model_name="FIR_RECOMMENDATION_TYPE_MODEL",
        version_name=version_name,
        metrics=metrics,
        sample_input_data=X.head(min(len(X), 20)),
        python_version="3.13",
        pip_requirements=[
            "pandas==2.3.3",
            "scikit-learn==1.7.2",
            "snowflake-ml-python==1.41.0",
        ],
    )
    try:
        model_version.set_alias("DEFAULT")
    except Exception:
        pass
    return {"pipeline": pipeline, "metrics": metrics, "version_name": version_name}


def score_contexts(
    scoring_df: pd.DataFrame,
    feedback_model: dict[str, Any] | None,
    helpful_model: dict[str, Any] | None,
    type_model: dict[str, Any] | None,
) -> pd.DataFrame:
    if scoring_df.empty:
        return pd.DataFrame()
    feature_cols = [
        "PAGE",
        "SURFACE",
        "SELECTED_TABLE_COUNT",
        "JOIN_EXISTS",
        "JOIN_CONFIDENCE",
        "SUSPICIOUS_JOIN",
        "SEMANTIC_READY",
        "SEMANTIC_LEARNING_COUNT",
        "POSITIVE_FEEDBACK_COUNT",
        "NEGATIVE_FEEDBACK_COUNT",
        "FEEDBACK_DENSITY",
        "RECOMMENDATION_ACCEPT_RATE",
        "MAPPED_COUNT",
        "UNMAPPED_COUNT",
        "HAS_NOTES_SOURCE",
        "HAS_CLIENT_KNOWLEDGE",
        "MAPPING_INTENT_PRESENT",
    ]
    X = scoring_df[feature_cols].copy()
    output = scoring_df[["CONTEXT_KEY", "ENTITY_TYPE", "PAGE", "SURFACE"]].copy()
    feedback_prob = (
        feedback_model["pipeline"].predict_proba(X)[:, 1]
        if feedback_model is not None
        else pd.Series([0.0] * len(scoring_df))
    )
    helpful_prob = (
        helpful_model["pipeline"].predict_proba(X)[:, 1]
        if helpful_model is not None
        else pd.Series([0.0] * len(scoring_df))
    )
    rec_type = (
        type_model["pipeline"].predict(X)
        if type_model is not None
        else ["source_suggestion"] * len(scoring_df)
    )
    output["FEEDBACK_NEEDED_PROBABILITY"] = feedback_prob
    output["RECOMMENDATION_HELPFULNESS_PROBABILITY"] = helpful_prob
    output["RECOMMENDATION_TYPE"] = rec_type
    output["RECOMMENDATION_PRIORITY"] = output[
        ["FEEDBACK_NEEDED_PROBABILITY", "RECOMMENDATION_HELPFULNESS_PROBABILITY"]
    ].max(axis=1)
    return output


def upsert_scores(
    session: Session,
    config: FirMlConfig,
    scores_df: pd.DataFrame,
    *,
    version_name: str,
) -> None:
    if scores_df.empty:
        return
    temp_name = "TMP_FIR_MODEL_SCORES_UPLOAD"
    prepared = scores_df.copy()
    prepared["SCORE_ID"] = prepared["CONTEXT_KEY"].apply(lambda value: f"score_{abs(hash(str(value))) % 10**12}")
    prepared["MODEL_NAME"] = "FIR_V2_DECISION_STACK"
    prepared["MODEL_VERSION"] = version_name
    prepared["ENTITY_ID"] = prepared["CONTEXT_KEY"]
    prepared["SCORE_PAYLOAD"] = prepared.apply(
        lambda row: json.dumps(
            {
                "feedback_needed_probability": float(row["FEEDBACK_NEEDED_PROBABILITY"]),
                "recommendation_helpfulness_probability": float(row["RECOMMENDATION_HELPFULNESS_PROBABILITY"]),
                "recommendation_type": row["RECOMMENDATION_TYPE"],
                "recommendation_priority": float(row["RECOMMENDATION_PRIORITY"]),
            }
        ),
        axis=1,
    )
    session.write_pandas(
        prepared,
        temp_name,
        auto_create_table=True,
        overwrite=True,
    )
    session.sql(
        f"""
        MERGE INTO {config.model_scores_table} AS target
        USING (
            SELECT
                SCORE_ID,
                MODEL_NAME,
                MODEL_VERSION,
                CONTEXT_KEY,
                ENTITY_TYPE,
                ENTITY_ID,
                PAGE,
                SURFACE,
                FEEDBACK_NEEDED_PROBABILITY,
                RECOMMENDATION_HELPFULNESS_PROBABILITY,
                RECOMMENDATION_TYPE,
                RECOMMENDATION_PRIORITY,
                PARSE_JSON(SCORE_PAYLOAD) AS SCORE_PAYLOAD
            FROM {temp_name}
        ) AS source
        ON target.CONTEXT_KEY = source.CONTEXT_KEY
        WHEN MATCHED THEN UPDATE SET
            SCORE_ID = source.SCORE_ID,
            MODEL_NAME = source.MODEL_NAME,
            MODEL_VERSION = source.MODEL_VERSION,
            ENTITY_TYPE = source.ENTITY_TYPE,
            ENTITY_ID = source.ENTITY_ID,
            PAGE = source.PAGE,
            SURFACE = source.SURFACE,
            FEEDBACK_NEEDED_PROBABILITY = source.FEEDBACK_NEEDED_PROBABILITY,
            RECOMMENDATION_HELPFULNESS_PROBABILITY = source.RECOMMENDATION_HELPFULNESS_PROBABILITY,
            RECOMMENDATION_TYPE = source.RECOMMENDATION_TYPE,
            RECOMMENDATION_PRIORITY = source.RECOMMENDATION_PRIORITY,
            SCORE_PAYLOAD = source.SCORE_PAYLOAD,
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHEN NOT MATCHED THEN INSERT (
            SCORE_ID,
            MODEL_NAME,
            MODEL_VERSION,
            CONTEXT_KEY,
            ENTITY_TYPE,
            ENTITY_ID,
            PAGE,
            SURFACE,
            FEEDBACK_NEEDED_PROBABILITY,
            RECOMMENDATION_HELPFULNESS_PROBABILITY,
            RECOMMENDATION_TYPE,
            RECOMMENDATION_PRIORITY,
            SCORE_PAYLOAD,
            UPDATED_AT,
            CREATED_AT
        ) VALUES (
            source.SCORE_ID,
            source.MODEL_NAME,
            source.MODEL_VERSION,
            source.CONTEXT_KEY,
            source.ENTITY_TYPE,
            source.ENTITY_ID,
            source.PAGE,
            source.SURFACE,
            source.FEEDBACK_NEEDED_PROBABILITY,
            source.RECOMMENDATION_HELPFULNESS_PROBABILITY,
            source.RECOMMENDATION_TYPE,
            source.RECOMMENDATION_PRIORITY,
            source.SCORE_PAYLOAD,
            CURRENT_TIMESTAMP(),
            CURRENT_TIMESTAMP()
        )
        """
    ).collect()
    session.sql(f"DROP TABLE IF EXISTS {temp_name}").collect()


def main() -> None:
    parser = argparse.ArgumentParser(description="Train and score FIR v2 decision models in Snowflake.")
    parser.add_argument(
        "--env-file",
        default="services/sttm-builder/.env.local",
        help="Path to the STTM backend env file.",
    )
    parser.add_argument(
        "--version",
        default=datetime.now(timezone.utc).strftime("V%Y%m%d_%H%M%S"),
        help="Model version name to use in Model Registry.",
    )
    args = parser.parse_args()

    env_path = Path(args.env_file)
    config = resolve_config(env_path)
    session = create_session(config)
    try:
        ensure_model_scores_table(session, config)
        bootstrapped_feature_rows = bootstrap_feature_rows_from_history(session, config)
        register_feature_store(session, config)
        training_df = build_training_dataframe(session, config)
        if training_df.empty:
            raise SystemExit("No FIR feature rows were found to train on even after bootstrap.")

        registry = Registry(session, database_name=config.database, schema_name=config.schema)
        feedback_model = train_classifier(
            training_df,
            label_col="FEEDBACK_NEEDED_LABEL",
            model_name="FIR_FEEDBACK_NEEDED_MODEL",
            registry=registry,
            version_name=args.version,
        )
        helpful_model = train_classifier(
            training_df,
            label_col="RECOMMENDATION_HELPFUL_LABEL",
            model_name="FIR_RECOMMENDATION_HELPFULNESS_MODEL",
            registry=registry,
            version_name=args.version,
        )
        type_model = train_type_classifier(
            training_df,
            registry=registry,
            version_name=args.version,
        )

        scoring_df = build_scoring_dataframe(session, config)
        scores = score_contexts(scoring_df, feedback_model, helpful_model, type_model)
        upsert_scores(session, config, scores, version_name=args.version)

        print(
            json.dumps(
                {
                    "bootstrapped_feature_rows": int(bootstrapped_feature_rows),
                    "trained_rows": int(len(training_df)),
                    "scored_contexts": int(len(scores)),
                    "version": args.version,
                    "models": {
                        "feedback_needed": feedback_model["metrics"] if feedback_model else None,
                        "recommendation_helpfulness": helpful_model["metrics"] if helpful_model else None,
                        "recommendation_type": type_model["metrics"] if type_model else None,
                    },
                },
                indent=2,
            )
        )
    finally:
        session.close()


if __name__ == "__main__":
    main()
