# BBI AI Migration Workbench

Monorepo for the client-facing AI migration workbench deployed to Snowflake Snowpark Container Services (SPCS).

## Repository Layout

- `frontend/` contains the Next.js web application.
- `backend/` contains the FastAPI API service.
- `nginx/` contains the reverse proxy used in Docker and SPCS.
- `infra/` contains AWS and Snowflake deployment assets.
- `buildspecs/` contains CodeBuild build specifications.
- `scripts/` contains deployment and release automation.

## Local Development

1. Create a Python virtual environment for the backend and install the backend dependencies.
2. Install the frontend dependencies with `npm install` in `frontend/`.
3. Start the stack:

```bash
./start-ai-workbench-dev.sh
```

Default ports:

- frontend: `http://127.0.0.1:3000`
- backend: `http://127.0.0.1:8000`
- gateway: `http://127.0.0.1:8080`

The frontend uses relative `/api/*` calls. Locally, Next.js rewrites those calls to the backend. In Docker and SPCS, `nginx` proxies the same paths to FastAPI so the browser never needs a hardcoded Snowflake backend URL.

### Backend-only local run

To bootstrap and run only the integrated STTM backend:

```bash
./scripts/start_sttm_backend_local.sh
```

What the script does:

- creates `services/sttm-builder/.venv` if it does not exist
- creates `services/sttm-builder/.env.local` from `.env.example` if missing
- installs backend dependencies only when they are not already present
- starts the backend on `http://127.0.0.1:8000`

Important local-auth note:

- the backend can run locally, but the deployed SPCS authentication flow does not exist on localhost
- Snowflake only injects `Sf-Context-*` headers at Snowflake public ingress
- endpoints that require deployed caller context will return `401` locally unless a separate local auth bypass is introduced

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
