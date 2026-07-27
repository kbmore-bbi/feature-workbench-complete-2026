"""Admin API for FIR template management.

Provides endpoints for listing, creating, updating, and testing FIR templates.
"""
from __future__ import annotations

import json
from typing import Annotated, Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, Field
from snowflake.snowpark import Session

from app.core.fir_template_engine import FIRTemplateEngine, FIRTemplate
from app.core.config import Settings, get_settings


router = APIRouter(prefix="/fir", tags=["FIR Admin"])


# --- Request/Response Models ---

class TemplateListItem(BaseModel):
    template_id: str
    template_type: str
    source_event_type: str
    entity_type: str | None
    name: str
    description: str | None
    version: str
    status: str


class TemplateListResponse(BaseModel):
    templates: list[TemplateListItem]
    total: int


class TemplateDetailResponse(BaseModel):
    template_id: str
    template_type: str
    source_event_type: str
    entity_type: str | None
    name: str
    description: str | None
    extraction_schema: dict
    prompt_guidance: str | None
    recommendation_rules: list[dict]
    version: str
    status: str
    created_at: str | None
    updated_at: str | None


class CreateTemplateRequest(BaseModel):
    template_id: str | None = None
    template_type: str
    source_event_type: str
    entity_type: str | None = None
    name: str
    description: str | None = None
    extraction_schema: dict
    prompt_guidance: str | None = None
    recommendation_rules: list[dict] = Field(default_factory=list)
    version: str = "1.0"


class UpdateTemplateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    extraction_schema: dict | None = None
    prompt_guidance: str | None = None
    recommendation_rules: list[dict] | None = None
    version: str | None = None
    status: str | None = None


class TestTemplateRequest(BaseModel):
    event: dict
    context: dict


class TestTemplateResponse(BaseModel):
    success: bool
    extraction_result: dict | None = None
    inference_record: dict | None = None
    recommendation_actions: list[dict] | None = None
    errors: list[str] = Field(default_factory=list)


class CoverageItem(BaseModel):
    event_type: str
    has_template: bool
    template_id: str | None = None
    template_name: str | None = None


class CoverageResponse(BaseModel):
    coverage: list[CoverageItem]
    covered_count: int
    uncovered_count: int


# --- Dependency injection helper ---

def _get_session_from_request(request: Request) -> Session:
    """Get the Snowpark session from the request state.

    This avoids circular imports by relying on the session being set
    by the get_snowflake_client dependency in the main API.
    """
    client = getattr(request.state, "snowflake_client", None)
    if client is None:
        raise HTTPException(status_code=500, detail="Snowflake client not initialized")
    return client.session


# --- Endpoints ---

@router.get("/templates", response_model=TemplateListResponse)
async def list_templates(
    request: Request,
    status: str | None = None,
    template_type: str | None = None,
    settings: Annotated[Settings, Depends(get_settings)] = None,
):
    """List all FIR templates with optional filtering."""
    session = _get_session_from_request(request)
    table_name = settings.qualify_table_name(settings.snowflake_fir_templates_table) if settings else "TBL_WORKBENCH_FIR_TEMPLATES"

    query = f"""
    SELECT
        TEMPLATE_ID, TEMPLATE_TYPE, SOURCE_EVENT_TYPE, ENTITY_TYPE,
        NAME, DESCRIPTION, VERSION, STATUS
    FROM {table_name}
    WHERE 1=1
    """
    params = []

    if status:
        query += f" AND STATUS = '{status}'"
    if template_type:
        query += f" AND TEMPLATE_TYPE = '{template_type}'"

    query += " ORDER BY TEMPLATE_TYPE, NAME"

    rows = session.sql(query).collect()

    templates = [
        TemplateListItem(
            template_id=row["TEMPLATE_ID"],
            template_type=row["TEMPLATE_TYPE"],
            source_event_type=row["SOURCE_EVENT_TYPE"],
            entity_type=row["ENTITY_TYPE"],
            name=row["NAME"],
            description=row["DESCRIPTION"],
            version=row["VERSION"],
            status=row["STATUS"],
        )
        for row in rows
    ]

    return TemplateListResponse(templates=templates, total=len(templates))


async def _get_template_detail(
    template_id: str,
    session: Session,
    table_name: str,
) -> TemplateDetailResponse:
    """Get a specific template by ID (helper function)."""
    query = f"""
    SELECT
        TEMPLATE_ID, TEMPLATE_TYPE, SOURCE_EVENT_TYPE, ENTITY_TYPE,
        NAME, DESCRIPTION, EXTRACTION_SCHEMA, PROMPT_GUIDANCE,
        RECOMMENDATION_RULES, VERSION, STATUS, CREATED_AT, UPDATED_AT
    FROM {table_name}
    WHERE TEMPLATE_ID = '{template_id}'
    """
    rows = session.sql(query).collect()

    if not rows:
        raise HTTPException(status_code=404, detail=f"Template not found: {template_id}")

    row = rows[0]
    extraction_schema = row["EXTRACTION_SCHEMA"]
    if isinstance(extraction_schema, str):
        extraction_schema = json.loads(extraction_schema)
    elif extraction_schema is None:
        extraction_schema = {}

    recommendation_rules = row["RECOMMENDATION_RULES"]
    if isinstance(recommendation_rules, str):
        recommendation_rules = json.loads(recommendation_rules)
    elif recommendation_rules is None:
        recommendation_rules = []

    return TemplateDetailResponse(
        template_id=row["TEMPLATE_ID"],
        template_type=row["TEMPLATE_TYPE"],
        source_event_type=row["SOURCE_EVENT_TYPE"],
        entity_type=row["ENTITY_TYPE"],
        name=row["NAME"],
        description=row["DESCRIPTION"],
        extraction_schema=extraction_schema,
        prompt_guidance=row["PROMPT_GUIDANCE"],
        recommendation_rules=recommendation_rules,
        version=row["VERSION"],
        status=row["STATUS"],
        created_at=str(row["CREATED_AT"]) if row["CREATED_AT"] else None,
        updated_at=str(row["UPDATED_AT"]) if row["UPDATED_AT"] else None,
    )


@router.get("/templates/{template_id}", response_model=TemplateDetailResponse)
async def get_template(
    request: Request,
    template_id: str,
    settings: Annotated[Settings, Depends(get_settings)] = None,
):
    """Get a specific template by ID."""
    session = _get_session_from_request(request)
    table_name = settings.qualify_table_name(settings.snowflake_fir_templates_table) if settings else "TBL_WORKBENCH_FIR_TEMPLATES"
    return await _get_template_detail(template_id, session, table_name)


@router.post("/templates", response_model=TemplateDetailResponse)
async def create_template(
    request: Request,
    body: CreateTemplateRequest,
    settings: Annotated[Settings, Depends(get_settings)] = None,
):
    """Create a new FIR template."""
    session = _get_session_from_request(request)
    table_name = settings.qualify_table_name(settings.snowflake_fir_templates_table) if settings else "TBL_WORKBENCH_FIR_TEMPLATES"

    template_id = body.template_id or f"TPL_{body.template_type.upper()}_{uuid4().hex[:8]}"

    extraction_schema_json = json.dumps(body.extraction_schema)
    recommendation_rules_json = json.dumps(body.recommendation_rules)

    query = f"""
    INSERT INTO {table_name} (
        TEMPLATE_ID, TEMPLATE_TYPE, SOURCE_EVENT_TYPE, ENTITY_TYPE,
        NAME, DESCRIPTION, EXTRACTION_SCHEMA, PROMPT_GUIDANCE,
        RECOMMENDATION_RULES, VERSION, STATUS, CREATED_AT, UPDATED_AT
    )
    SELECT
        '{template_id}',
        '{body.template_type}',
        '{body.source_event_type}',
        {f"'{body.entity_type}'" if body.entity_type else 'NULL'},
        '{body.name.replace("'", "''")}',
        {f"'{body.description.replace(chr(39), chr(39)+chr(39))}'" if body.description else 'NULL'},
        PARSE_JSON($${extraction_schema_json}$$),
        {f"'{body.prompt_guidance.replace(chr(39), chr(39)+chr(39))}'" if body.prompt_guidance else 'NULL'},
        PARSE_JSON($${recommendation_rules_json}$$),
        '{body.version}',
        'active',
        CURRENT_TIMESTAMP(),
        CURRENT_TIMESTAMP()
    """

    try:
        session.sql(query).collect()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create template: {str(e)}")

    return await _get_template_detail(template_id, session, table_name)


@router.put("/templates/{template_id}", response_model=TemplateDetailResponse)
async def update_template(
    request: Request,
    template_id: str,
    body: UpdateTemplateRequest,
    settings: Annotated[Settings, Depends(get_settings)] = None,
):
    """Update an existing FIR template."""
    session = _get_session_from_request(request)
    table_name = settings.qualify_table_name(settings.snowflake_fir_templates_table) if settings else "TBL_WORKBENCH_FIR_TEMPLATES"

    await _get_template_detail(template_id, session, table_name)

    updates = []

    if body.name is not None:
        updates.append(f"NAME = '{body.name.replace(chr(39), chr(39)+chr(39))}'")
    if body.description is not None:
        updates.append(f"DESCRIPTION = '{body.description.replace(chr(39), chr(39)+chr(39))}'")
    if body.extraction_schema is not None:
        schema_json = json.dumps(body.extraction_schema)
        updates.append(f"EXTRACTION_SCHEMA = PARSE_JSON($${schema_json}$$)")
    if body.prompt_guidance is not None:
        updates.append(f"PROMPT_GUIDANCE = '{body.prompt_guidance.replace(chr(39), chr(39)+chr(39))}'")
    if body.recommendation_rules is not None:
        rules_json = json.dumps(body.recommendation_rules)
        updates.append(f"RECOMMENDATION_RULES = PARSE_JSON($${rules_json}$$)")
    if body.version is not None:
        updates.append(f"VERSION = '{body.version}'")
    if body.status is not None:
        updates.append(f"STATUS = '{body.status}'")

    if not updates:
        return await _get_template_detail(template_id, session, table_name)

    updates.append("UPDATED_AT = CURRENT_TIMESTAMP()")

    query = f"""
    UPDATE {table_name}
    SET {', '.join(updates)}
    WHERE TEMPLATE_ID = '{template_id}'
    """

    session.sql(query).collect()

    return await _get_template_detail(template_id, session, table_name)


@router.delete("/templates/{template_id}")
async def delete_template(
    request: Request,
    template_id: str,
    settings: Annotated[Settings, Depends(get_settings)] = None,
):
    """Soft-delete a template by setting status to 'deleted'."""
    session = _get_session_from_request(request)
    table_name = settings.qualify_table_name(settings.snowflake_fir_templates_table) if settings else "TBL_WORKBENCH_FIR_TEMPLATES"

    await _get_template_detail(template_id, session, table_name)

    query = f"""
    UPDATE {table_name}
    SET STATUS = 'deleted', UPDATED_AT = CURRENT_TIMESTAMP()
    WHERE TEMPLATE_ID = '{template_id}'
    """
    session.sql(query).collect()

    return {"message": f"Template {template_id} deleted"}


@router.post("/templates/{template_id}/test", response_model=TestTemplateResponse)
async def test_template(
    request: Request,
    template_id: str,
    body: TestTemplateRequest,
    settings: Annotated[Settings, Depends(get_settings)] = None,
):
    """Test a template against a sample event."""
    session = _get_session_from_request(request)
    table_name = settings.qualify_table_name(settings.snowflake_fir_templates_table) if settings else "TBL_WORKBENCH_FIR_TEMPLATES"

    template_row = await _get_template_detail(template_id, session, table_name)

    template = FIRTemplate(
        template_id=template_row.template_id,
        template_type=template_row.template_type,
        source_event_type=template_row.source_event_type,
        entity_type=template_row.entity_type,
        name=template_row.name,
        description=template_row.description,
        extraction_schema=template_row.extraction_schema,
        prompt_guidance=template_row.prompt_guidance,
        recommendation_rules=template_row.recommendation_rules,
        version=template_row.version,
    )

    engine = FIRTemplateEngine(session, None, settings)

    errors = []
    extraction_result = None
    inference_record = None
    recommendation_actions = None

    try:
        extraction = engine.extract_inference(body.event, body.context, template)
        extraction_result = {
            "required_fields": extraction.required_fields,
            "derived_fields": extraction.derived_fields,
            "llm_fields": extraction.llm_fields,
            "cross_references": extraction.cross_references,
            "confidence": extraction.confidence,
        }
        errors.extend(extraction.errors)

        inference = engine.generate_inference_record(extraction, template)
        inference_record = {
            "inference_id": inference.inference_id,
            "inference_key": inference.inference_key,
            "inference_type": inference.inference_type,
            "summary": inference.summary,
            "confidence": inference.confidence,
            "entity_type": inference.entity_type,
            "entity_ids": inference.entity_ids,
            "tags": inference.tags,
        }

        actions = engine.apply_recommendation_rules(extraction, inference, template)
        recommendation_actions = [
            {
                "action_type": a.action_type,
                "params": a.params,
                "priority": a.priority,
            }
            for a in actions
        ]

    except Exception as e:
        errors.append(f"Template execution failed: {str(e)}")

    return TestTemplateResponse(
        success=len(errors) == 0,
        extraction_result=extraction_result,
        inference_record=inference_record,
        recommendation_actions=recommendation_actions,
        errors=errors,
    )


@router.get("/coverage", response_model=CoverageResponse)
async def get_template_coverage(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)] = None,
):
    """Show which event types have templates and which don't."""
    session = _get_session_from_request(request)
    table_name = settings.qualify_table_name(settings.snowflake_fir_templates_table) if settings else "TBL_WORKBENCH_FIR_TEMPLATES"

    known_event_types = [
        "conversation.feedback",
        "mapping.accept",
        "mapping.edit",
        "mapping.reject",
        "sttm.save",
        "sttm.publish",
        "sttm.validate",
        "knowledge.import",
        "project.create",
        "project.context_update",
        "derived_source.create",
        "derived_source.update",
        "relationship.add",
        "relationship.remove",
    ]

    query = f"""
    SELECT SOURCE_EVENT_TYPE, TEMPLATE_ID, NAME
    FROM {table_name}
    WHERE STATUS = 'active'
    """
    rows = session.sql(query).collect()

    templates_by_event: dict[str, tuple[str, str]] = {
        row["SOURCE_EVENT_TYPE"]: (row["TEMPLATE_ID"], row["NAME"])
        for row in rows
    }

    coverage = []
    covered = 0
    uncovered = 0

    for event_type in known_event_types:
        if event_type in templates_by_event:
            template_id, name = templates_by_event[event_type]
            coverage.append(CoverageItem(
                event_type=event_type,
                has_template=True,
                template_id=template_id,
                template_name=name,
            ))
            covered += 1
        else:
            coverage.append(CoverageItem(
                event_type=event_type,
                has_template=False,
            ))
            uncovered += 1

    for event_type, (template_id, name) in templates_by_event.items():
        if event_type not in known_event_types:
            coverage.append(CoverageItem(
                event_type=event_type,
                has_template=True,
                template_id=template_id,
                template_name=name,
            ))
            covered += 1

    return CoverageResponse(
        coverage=coverage,
        covered_count=covered,
        uncovered_count=uncovered,
    )


@router.post("/validate-schema")
async def validate_schema(extraction_schema: dict):
    """Validate an extraction schema before saving."""
    errors = []
    warnings = []

    if "version" not in extraction_schema:
        warnings.append("Missing 'version' field - defaults to '1.0'")

    if "required_fields" not in extraction_schema:
        errors.append("Missing 'required_fields' array")
    else:
        for i, field in enumerate(extraction_schema["required_fields"]):
            if "name" not in field:
                errors.append(f"required_fields[{i}]: missing 'name'")
            if "source" not in field:
                errors.append(f"required_fields[{i}]: missing 'source'")

    if "derived_fields" in extraction_schema:
        for i, field in enumerate(extraction_schema["derived_fields"]):
            if "name" not in field:
                errors.append(f"derived_fields[{i}]: missing 'name'")
            if "expression" not in field:
                errors.append(f"derived_fields[{i}]: missing 'expression'")

    if "llm_extraction" in extraction_schema:
        llm = extraction_schema["llm_extraction"]
        if llm.get("enabled", False):
            for i, field in enumerate(llm.get("fields", [])):
                if "name" not in field:
                    errors.append(f"llm_extraction.fields[{i}]: missing 'name'")
                if "prompt" not in field:
                    errors.append(f"llm_extraction.fields[{i}]: missing 'prompt'")

    if "inference_output" not in extraction_schema:
        warnings.append("Missing 'inference_output' configuration")
    else:
        output = extraction_schema["inference_output"]
        if "inference_type" not in output:
            errors.append("inference_output: missing 'inference_type'")
        if "summary_template" not in output:
            warnings.append("inference_output: missing 'summary_template'")

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }
