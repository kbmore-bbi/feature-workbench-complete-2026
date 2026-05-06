from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schema.common import TableRef


class GenerateRequest(BaseModel):
    tables: list[TableRef] = Field(description="Fully-qualified tables to generate semantic models for.")
    force: bool = Field(default=False, description="Regenerate even if the stored model is current.")


class GenerateResponse(BaseModel):
    job_id: str
    total: int = Field(description="Total generation tasks queued (SCHEMA + TABLE + ATTRIBUTE per table, schemas deduplicated).")
    message: str


class JobStatus(BaseModel):
    job_id: str
    status: Literal["pending", "running", "completed", "failed"]
    tables: list[str] = Field(description="Qualified names of the requested tables.")
    total: int
    completed: int = 0
    skipped: int = 0
    failed_count: int = 0
    errors: list[str] = []
    started_at: datetime
    completed_at: datetime | None = None


class SemanticModelRecord(BaseModel):
    scope: str
    database: str
    schema_name: str
    table_name: str | None
    attribute_name: str | None
    semantic_model: Any
    generated_at: datetime
    updated_at: datetime
