from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_derived_source_service
from app.core.derived_source import DerivedSourceService
from app.schema.derived_source import (
    DerivedSourceRecord,
    DerivedSourceValidateRequest,
    DerivedSourceValidateResponse,
    DerivedSourceDefinition,
)

router = APIRouter(prefix="/derived-sources", tags=["Derived Sources"])


@router.get("", response_model=list[DerivedSourceRecord])
def list_derived_sources(
    service: Annotated[DerivedSourceService, Depends(get_derived_source_service)],
) -> list[DerivedSourceRecord]:
    return service.list_sources()


@router.post("/validate", response_model=DerivedSourceValidateResponse)
def validate_derived_source_sql(
    body: DerivedSourceValidateRequest,
    service: Annotated[DerivedSourceService, Depends(get_derived_source_service)],
) -> DerivedSourceValidateResponse:
    return service.validate_sql(body)


@router.post("", response_model=DerivedSourceRecord)
def save_derived_source(
    body: DerivedSourceDefinition,
    service: Annotated[DerivedSourceService, Depends(get_derived_source_service)],
) -> DerivedSourceRecord:
    return service.save_source(body)
