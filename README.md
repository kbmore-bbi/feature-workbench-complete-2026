# BBI AI Migration Workbench

Monorepo for the client-facing AI migration workbench deployed to Snowflake Snowpark Container Services (SPCS).

## Repository Layout

- `frontend/` contains the Next.js web application.
- `services/sttm-builder/` contains the integrated FastAPI API service used by the current STTM workbench flow.
- `backend/` contains an older API service and is not the supported local path for the integrated STTM frontend.
- `nginx/` contains the reverse proxy used in Docker and SPCS.
- `infra/` contains AWS and Snowflake deployment assets.
- `buildspecs/` contains CodeBuild build specifications.
- `scripts/` contains deployment and release automation.

## Local Development

1. Create a Python virtual environment for `services/sttm-builder/` and install the backend dependencies.
2. Install the frontend dependencies with `npm install` in `frontend/`.
3. Start the stack:

```bash
./start-ai-workbench-dev.sh
```

Default ports:

- frontend: `http://127.0.0.1:3000`
- backend: `http://127.0.0.1:8000`

The frontend uses relative `/api/*` calls. Locally, Next.js rewrites those calls to the backend. In Docker and SPCS, `nginx` proxies the same paths to FastAPI so the browser never needs a hardcoded Snowflake backend URL.

### Backend-only local run

To bootstrap and run only the integrated STTM backend:

```bash
./scripts/start_sttm_backend_local.sh
```

What the script does:

- creates `services/sttm-builder/.venv` only if it does not exist and otherwise reuses it
- creates `services/sttm-builder/.env.local` from `.env.example` if missing
- syncs any newly added keys from `.env.example` into an existing `.env.local` without overwriting existing values
- installs backend dependencies only when they are not already present
- starts the backend on `http://127.0.0.1:8000`

Local auth modes:

- deployed mode: Snowflake injects `Sf-Context-*` headers only at public SPCS ingress, which is how production auth and caller-context work
- local development mode: set `LOCAL_DEV_AUTH_ENABLED=true` in `services/sttm-builder/.env.local` and provide `SNOWFLAKE_USER` / `SNOWFLAKE_PASSWORD`
- in local development mode, the backend connects directly as that developer's Snowflake identity, so the frontend can exercise auth/session and table-selection APIs while still respecting the Snowflake RBAC granted to that user
- keep `LOCAL_DEV_AUTH_ENABLED=false` for deployed environments

### Swagger / OpenAPI

When the backend is running locally:

- Swagger UI: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- OpenAPI JSON: [http://127.0.0.1:8000/openapi.json](http://127.0.0.1:8000/openapi.json)

## CI/CD Overview

The company-side dev pipeline is designed as:

`CodeCommit -> EventBridge -> CodePipeline -> CodeBuild -> ECR -> Snowflake image registry -> SPCS`

Included assets:

- CloudFormation bootstrap template for AWS CI/CD resources
- CodeBuild buildspecs for validation, image promotion, deployment, and release bundles
- Snowflake compute pool and service spec templates
- Release bundle scripts for later client-side import into a locked-down AVD

## Deployment Notes

- `develop` is intended to auto-deploy to the shared dev SPCS environment.
- Feature branches validate only.
- The later client-side rollout is expected to import either a signed source bundle or a prebuilt image bundle and deploy fully inside the client environment.
