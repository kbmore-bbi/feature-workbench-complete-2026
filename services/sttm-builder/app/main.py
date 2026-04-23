from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError

from app.api import router
from app.api.error_handlers import (
    app_error_handler,
    request_validation_error_handler,
    unhandled_error_handler,
)
from app.core.exceptions import AppError

app = FastAPI(title="STTM Builder", version="0.1.0")

app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(RequestValidationError, request_validation_error_handler)
app.add_exception_handler(Exception, unhandled_error_handler)

app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok"}
