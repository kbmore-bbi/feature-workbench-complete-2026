# Backend Service

FastAPI service for the AI migration workbench.

## Structure

- `app/api/` for HTTP cross-cutting concerns
- `app/core/` for business logic
- `app/models/` for persistence models
- `app/routers/` for FastAPI routes
- `app/schemas/` for request and response schemas
- `tests/` for unit and integration coverage

## Run Locally

```bash
python -m uvicorn app.main:app --reload --port 8000
```

