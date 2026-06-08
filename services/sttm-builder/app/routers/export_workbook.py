from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.api.deps import get_workbook_export_service
from app.core.export_workbook import WorkbookExportService
from app.core.exceptions import SnowflakeQueryError
from app.schema.contracts import ApiRequestEnvelope
from app.schema.export_workbook import WorkbookExportRequest


router = APIRouter(prefix="/workbench/exports", tags=["Workbook Export"])


@router.post("/sttm-excel")
def export_sttm_excel(
    body: ApiRequestEnvelope[WorkbookExportRequest] | WorkbookExportRequest,
    service: WorkbookExportService = Depends(get_workbook_export_service),
):
    payload = body.data if isinstance(body, ApiRequestEnvelope) else body
    try:
        workbook_bytes = service.build_workbook(payload)
    except SnowflakeQueryError:
        raise
    except Exception as exc:
        raise SnowflakeQueryError(
            f"Failed to generate the STTM Excel workbook: {exc}"
        ) from exc
    filename = f"sttm_export_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return StreamingResponse(
        iter([workbook_bytes]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )
