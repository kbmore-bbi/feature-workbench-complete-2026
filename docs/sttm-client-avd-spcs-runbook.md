# STTM Client AVD + SPCS Runbook

## Purpose
This document records:

- the STTM frontend/backend/infrastructure changes made in this integration cycle
- the errors encountered while bringing the app up on a client AVD Windows environment
- the fixes applied
- the differences between repo changes and manual AVD-only hotfixes
- the expected SPCS deployment flow

This is the working reference for future client bring-up and deployment.

---

## 1. Functional changes delivered

### Frontend
- Integrated the newer STTM UI branch into the current workbench frontend.
- Fixed landing-page runtime styling issue (`max-width` to `maxWidth`).
- Added logged-in user display and persona in the top-right header.
- Wired source/target table explorer to real backend metadata.
- Added:
  - real database/schema/table loading
  - real column counts
  - real row counts
  - PK/FK-aware table cards
  - automatic table relationship visualization
- Implemented the **Add Derived Table** workflow:
  - source selection
  - driving table
  - table relationship canvas
  - join editor
  - selected-column driven SQL generation
  - SQL validation
  - resulting columns preview
  - save derived source
- Added **Derived Sources Selection** in the left sidebar.
- Allowed saved derived sources to be reused as inputs to new derived sources.
- Added derived chips in cards and join modal.
- Integrated AI Assistant into the STTM builder UI.

### Backend
- Added local dev auth mode for STTM backend using `LOCAL_DEV_AUTH_ENABLED=true`.
- Added support for:
  - username/password local Snowflake auth
  - `externalbrowser` local Snowflake auth
- Preserved SPCS deployed auth path using Snowflake ingress caller context.
- Added/updated backend services for:
  - databases / schemas / tables / columns
  - table relationships
  - semantic model retrieval/generation
  - STTM orchestration agent invocation
  - derived source validate/save/list
- Added derived-source endpoints:
  - `GET /api/v1/derived-sources`
  - `POST /api/v1/derived-sources/validate`
  - `POST /api/v1/derived-sources`
- Added config normalization for:
  - `AGT_STTM_BUILDER`
  - `AGT_SEMANTIC_MODEL`
  - `SP_GET_TABLE_RELATIONSHIPS`
  - `TBL_SEMANTIC_MODELS`
  - `TBL_DERIVED_SOURCES`

### Snowflake / infra
- Added derived sources metadata table DDL.
- Added metadata bootstrap script(s) for client namespace creation.
- Added client PowerShell deployment scripts.
- Updated SPCS service spec templates to pass account, host, agents, procedures, and metadata tables correctly.

---

## 2. Relationship logic

### Current source of truth
Automatic table relationships are not calculated in the UI.

They come from Snowflake via:

- backend route: `POST /api/v1/table-selection/relationships`
- backend service: `services/sttm-builder/app/core/table_selection.py`
- Snowflake stored procedure:
  - `SP_GET_TABLE_RELATIONSHIPS`

The UI only:
- renders those relationships
- lets the user edit/delete/override them

### Derived source relationships
Saved derived sources currently store enough metadata to support lineage:

- source tables
- driving table
- joins
- filters
- selected columns
- SQL text

This enables derived-source lineage rendering and reuse in future derived-source creation.

---

## 3. AI assistant context

The assistant receives structured context, not just a plain question.

Current payload shape includes:

- `interface`
- `thread_id`
- `message`
- `source_tables`
- `driving_table`
- `relationships`
- `selected_columns_by_table`
- `attributes` for AUTO_MAP / TRANSFORM
- `semantic_context` when available

Schema:
- `services/sttm-builder/app/schema/sttm_builder.py`

Important note:
- local follow-up chat threading is still not fully stable
- first question works
- follow-up handling needs a proper Snowflake thread implementation using real thread metadata

---

## 4. Local AVD bring-up target namespace

Client metadata/control plane namespace used during bring-up:

- database: `FFP_HDP_DLAB_DB_DEV`
- schema: `SCH_STTM_METADATA`

Client Snow CLI connection used:

- `client-spcs-v4`

Local backend auth mode used on AVD:

- `LOCAL_DEV_AUTH_ENABLED=true`
- `SNOWFLAKE_AUTHENTICATOR=externalbrowser`

---

## 5. Scripts included in repo

### Local / AVD
- `start-ai-workbench.ps1`
- `start-ai-workbench-dev.ps1`
- `scripts/start_sttm_backend_local.ps1`
- `scripts/bootstrap_client_spcs_tools.ps1`
- `scripts/configure_client_snow_connection.ps1`
- `scripts/bootstrap_dbt_repo_infra.ps1`
- `scripts/bootstrap_sttm_metadata_infra.ps1`
- `scripts/bootstrap_sttm_metadata_infra.py`

### SPCS deploy
- `scripts/deploy_spcs_client_snow.ps1`
- `scripts/run_client_spcs_browser_deploy.ps1`
- `scripts/bootstrap_dbt_repo_infra.sh`
- `scripts/deploy_spcs_client_snow.sh`
- `scripts/run_client_spcs_browser_deploy.sh`

### Templates / env
- `infra/snowflake/env/client.env.example`
- `infra/snowflake/service-specs/webapp.yaml.tmpl`
- `infra/snowflake/service-specs/sttm-builder.yaml.tmpl`
- `infra/snowflake/service-specs/sttm-builder-deploy.sql.tmpl`

---

## 5A. What was in the AVD zip packages

The client AVD machine was initialized from these two zip files rather than from a git clone:

- `bbi-mig-ai-workbench-avd-part1-app-20260508.zip`
- `bbi-mig-ai-workbench-avd-part2-infra-20260508.zip`

### Part 1: app package baseline
This package contained the application/UI side of the repo, including:

- repo root launchers:
  - `start-ai-workbench-dev.ps1`
  - `start-ai-workbench-dev.sh`
- the full `frontend/` tree at the May 8 package baseline
- the `nginx/` folder
- root files such as:
  - `README.md`
  - `docker-compose.yml`
  - `.env.example`

### Part 2: infra/backend package baseline
This package contained the infra/backend side, including:

- `infra/snowflake/...`
- `services/sttm-builder/...`
- bootstrap/deploy scripts such as:
  - `scripts/bootstrap_client_spcs_tools.ps1`
  - `scripts/configure_client_snow_connection.ps1`
  - `scripts/bootstrap_sttm_metadata_infra.ps1`
  - `scripts/bootstrap_sttm_metadata_infra.py`
  - `scripts/start_sttm_backend_local.ps1`
  - `scripts/deploy_spcs_client_snow.ps1`
  - `scripts/run_client_spcs_browser_deploy.ps1`
- env templates such as:
  - `infra/snowflake/env/client.env.example`
  - `services/sttm-builder/.env.example`

### Important baseline note
The zip packages already contained the client bootstrap/deploy scripts, but they were the earlier packaged versions. The AVD troubleshooting work then modified some of those files manually on the client machine in order to get bring-up working.

## 5B. Current 2026-06-03 handoff packages

Current source-only handoff zips are generated under:

- `release-packages/20260603/`

Files:

- `bbi-mig-ai-workbench-20260603-part1-root-and-launchers.zip`
- `bbi-mig-ai-workbench-20260603-part2-frontend-source.zip`
- `bbi-mig-ai-workbench-20260603-part3-backend-service.zip`
- `bbi-mig-ai-workbench-20260603-part4-infra-scripts-docs.zip`

These packages intentionally exclude local runtime artifacts such as:

- `frontend/node_modules`
- `frontend/.next`
- `frontend/.next-*`
- `services/sttm-builder/.venv`
- local client tool virtualenvs

That keeps the upload size low and avoids shipping machine-specific build output.

### Important launcher note
- `start-ai-workbench.ps1` and `start-ai-workbench-dev.ps1` only start the local backend and frontend.
- They do **not** create Snowflake metadata tables, procedures, stages, or Cortex agents.
- `scripts/bootstrap_dbt_repo_infra.ps1` is the optional script that creates:
  - the DBT Git API integration
  - the DBT Git secret
  - the `DBT_REPO` Snowflake Git repository object
  - the DBT repo fetch and supporting file format
- `scripts/bootstrap_sttm_metadata_infra.ps1` is the script that creates:
  - metadata tables
  - stored procedures
  - semantic cache and table-context procedures
  - DBT tool procedures (`SP_DBT_*`)
  - stage uploads for skills
  - Cortex agents including `AGT_WORKBENCH_CONVERSATION`, `AGT_SEMANTIC_MODEL`, and `AGT_DBT_CONVERSION`
  - restored Cortex Analyst tools on `AGT_STTM_BUILDER` for promoted semantic bundles when bundle metadata already exists

---

## 6. AVD / client bring-up errors and fixes

This section records the actual issues encountered while standing the app up on Windows AVD.

### 6.1 Backend local launcher assumed Unix venv path
**Symptom**
- backend launcher tried `.venv/bin/python`
- Windows venv had `Scripts/python.exe`

**Fix**
- launcher updated to detect Windows venv layout

### 6.2 Missing local auth config
**Symptom**
- backend started but APIs returned:
  - `401 Missing Snowflake authentication context`

**Cause**
- `.env.local` missing local auth settings

**Fix**
- set:
  - `LOCAL_DEV_AUTH_ENABLED=true`
  - `SNOWFLAKE_AUTHENTICATOR=externalbrowser` or password mode
  - Snowflake account/user/warehouse/role/database/schema

### 6.3 Snow CLI bootstrap PowerShell issue with `py -3`
**Symptom**
- `py -3` not recognized on Windows machine

**Backported fix**
- `bootstrap_client_spcs_tools.ps1` now resolves Python via `Get-Command`
- it accepts command names like `python`
- it no longer depends on `py -3`

### 6.4 Snow CLI install did not expose `snow.exe`
**Symptom**
- `.client-tools-venv\Scripts\snow.exe` missing

**Cause**
- Windows required install through:
  - `python.exe -m pip`

**Backported fix**
- Snow CLI bootstrap now installs tooling through the venv interpreter:
  - `python.exe -m pip install ...`

### 6.5 Snow connection test failed because schema did not yet exist
**Symptom**
- Snow CLI connection test failed with missing `SCH_STTM_METADATA`

**Cause**
- connection / bootstrap assumed target schema already existed

**Backported fix**
- Snow CLI connection setup no longer binds the connection to the target schema up front
- the wrapper flow now bootstraps metadata before deploy

### 6.6 Bootstrap script connected using a non-existent schema
**Symptom**
- bootstrap could not create new namespace cleanly

**Cause**
- `bootstrap_sttm_metadata_infra.py` added `schema` to connection kwargs before schema creation

**Backported fix**
- removed:

```python
if args.schema:
    kwargs["schema"] = args.schema
```

### 6.7 DDL foreign-key type mismatch
**Symptom**
- Snowflake error:
  - `Primary key and foreign key data type does not match`

**Cause**
- `TBL_USERS.USER_ID` is `VARCHAR(128)`
- several referencing columns in `create-table-ddl.sql` were still `NUMBER`

**Backported fix**
- changed user reference columns like:
  - `CREATED_BY`
  - `LAST_MODIFIED_BY`
  - `PUBLISHED_BY`
from `NUMBER` to `VARCHAR(128)` where referencing `TBL_USERS(USER_ID)`

### 6.8 Bootstrap failed with `unexpected '||'`
**Symptom**
- Snowflake syntax error around `||`

**Cause**
- old `infra/snowflake/stored-proc/table-selection.sql` was being applied during bootstrap
- current app does not use these old procedures

**Fix**
- skip/remove `infra/snowflake/stored-proc/table-selection.sql` from bootstrap SQL list

### 6.9 Active warehouse required to create procedures
**Symptom**
- bootstrap complained active warehouse required

**Cause**
- wrong warehouse value was used in at least one bootstrap attempt

**Resolution**
- rerun with the correct warehouse from client env:
  - `FFP_HDP_DLAB_DB_ADHOC_XS_WH_DEV`

### 6.10 Backend PowerShell parse errors
**Symptom**
- `start_sttm_backend_local.ps1` failed with parser errors

**Cause**
- PowerShell-5 incompatible syntax / interpolation in local script:
  - `??`
  - `$EnvFile:`
- also some local path confusion during edits

**Backported fix**
- `start_sttm_backend_local.ps1` now uses PowerShell-5-compatible syntax
- local validation messages no longer use parse-breaking `$EnvFile:` interpolation
- Python resolution no longer depends on `py -3`

### 6.11 Python version mismatch on AVD
**Symptom**
- package install failed because backend package required Python `>=3.12`
- machine had Python `3.11`
- follow-on error:
  - `No module named uvicorn`

**Backported fix**
- changed:

```toml
requires-python = ">=3.12"
```

to:

```toml
requires-python = ">=3.11"
```

**Decision applied in repo**
- local/client bring-up now accepts Python `3.11+`
- revisit `3.12+` only if the backend later adopts 3.12-only language/runtime features

### 6.12 Dependency wiring bug in backend deps
**Symptom**
- `get_semantic_model_service is not defined`

**Cause**
- dependency referenced before function definition in `app/api/deps.py`

**Fix**
- reorder function definitions so semantic model dependency is defined first

### 6.13 Repeated browser tabs with `externalbrowser`
**Symptom**
- multiple Okta / browser tabs opened for repeated requests

**Causes found**
- per-request Snowflake sessions
- direct connector calls outside cached Snowpark path
- no secure local token storage initially

**Fixes attempted**
- cache local Snowpark client
- cache local connector connection
- install:
  - `keyring`
  - `snowflake-connector-python[secure-local-storage]`
- bypass metadata for local persona resolution

**Current status**
- local repeated browser auth was reduced during troubleshooting but still needs a final clean pass and repo backport to ensure a single stable local session flow

### 6.14 AI chat follow-up fails with 502
**Symptom**
- first question answered
- follow-up question failed
- Snowflake monitoring showed:
  - blank `THREAD ID`
  - `THREAD LENGTH = 1`

**Cause**
- app stores only `thread_id`
- does not manage real Snowflake continuation metadata correctly
- backend may invent fallback thread ids on non-JSON/SSE responses

**Current status**
- first-turn chat works
- follow-up chat still needs a proper fix
- immediate fallback approach discussed:
  - stop using thread continuation for chat
  - send recent conversation history in prompt
- long-term fix still needed:
  - parse and persist real thread metadata from Snowflake

---

## 7. Manual AVD changes made after extracting the zip packages

These are the notable changes made directly on the client AVD copy after the two zip packages were extracted.

### Config files created or edited on AVD
- created/filled `infra/snowflake/env/client.env`
  - with client account, user, role, warehouse, database, schema, registry, compute pool, service, and agent/table names
- created/filled `services/sttm-builder/.env.local`
  - for local `externalbrowser` auth and STTM metadata object names
- corrected at least one local env typo during troubleshooting:
  - `SNOWFLAKE_SEMANTIC_MODEL_TABLE`

### Script and bootstrap edits made on AVD
- removed `py -3` from the PowerShell bootstrap flow so Windows could use `python`
- installed Snow CLI using the venv Python directly
- edited `bootstrap_sttm_metadata_infra.py` to:
  - remove schema binding before `CREATE SCHEMA`
  - skip the obsolete `infra/snowflake/stored-proc/table-selection.sql`
  - explicitly activate role / warehouse / database before procedure creation
- edited `start_sttm_backend_local.ps1` to:
  - use PowerShell-compatible syntax
  - avoid parse-breaking `$EnvFile:` interpolation
  - work with the correct backend `.venv`
- changed backend Python requirement from `>=3.12` to `>=3.11`
- reordered backend dependency wiring in `services/sttm-builder/app/api/deps.py`
  - to resolve `get_semantic_model_service is not defined`

### Snowflake-side actions performed from AVD
- created or bootstrapped metadata namespace in:
  - `FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA`
- created Snow CLI connection:
  - `client-spcs-v4`
- ran metadata bootstrap to create:
  - metadata tables
  - derived sources table
  - procedures
  - tools
  - agents

### Local auth/chat troubleshooting attempted on AVD
- installed:
  - `keyring`
  - `snowflake-connector-python[secure-local-storage]`
- attempted local Snowflake session caching changes
- investigated AI follow-up chat failure and Snowflake thread monitoring behavior

### Documentation meaning
Some of the items above are now backported into the repo. Others are still simply part of the troubleshooting history and remain open issues.

---

## 8. Remaining AVD-specific or still-open items

These were either still manual during troubleshooting or still need a cleaner final repo implementation:

- finalize local `externalbrowser` session caching
- finalize AI follow-up chat handling

---

## 9. Current repo-side deployment position

### Included scripts
Yes, the repo already includes client/Windows-ready deployment scripts:

- local tooling bootstrap
- local backend launcher
- local full-stack launcher
- metadata bootstrap
- Snow connection configuration
- SPCS deploy wrapper

### Current status
The major AVD bootstrap blockers have been backported into the repo:

- Windows Python resolution in PowerShell scripts
- Snow CLI install through `python.exe -m pip`
- bootstrap without pre-existing schema
- bootstrap SQL cleanup
- user metadata FK datatype correction
- PowerShell-5-compatible backend launcher
- Python `3.11+` compatibility for local/client setup

The main remaining non-repeatable areas are:
- local `externalbrowser` session reuse still needs a cleaner final implementation
- AI follow-up chat still needs proper Snowflake thread handling

---

## 10. SPCS deployment flow

### Recommended order
1. Prepare `infra/snowflake/env/client.env`
2. Bootstrap Snow CLI tools
3. Configure Snow connection
4. Bootstrap the DBT repo objects if AGT_DBT_CONVERSION will be used
5. Bootstrap metadata schema/tables/procedures/agents
6. Start the local app if you want an AVD localhost smoke test
7. Build and deploy service to SPCS

### Typical commands
Windows / PowerShell:

```powershell
.\scripts\bootstrap_client_spcs_tools.ps1
.\scripts\configure_client_snow_connection.ps1
.\scripts\bootstrap_dbt_repo_infra.ps1
.\scripts\bootstrap_sttm_metadata_infra.ps1
.\start-ai-workbench.ps1
.\scripts\deploy_spcs_client_snow.ps1
```

Or one wrapper:

```powershell
.\scripts\run_client_spcs_browser_deploy.ps1
```

That wrapper now performs:

1. tool bootstrap
2. Snow connection setup
3. DBT repo bootstrap when configured
4. metadata bootstrap
5. SPCS deploy

### What `deploy_spcs_client_snow.ps1` does
- validates `client.env`
- ensures Snow CLI is present
- tests Snow connection
- logs Docker into Snowflake image registry
- builds images:
  - backend
  - frontend
  - nginx
- pushes images
- renders service spec
- creates/upgrades service
- lists service endpoints

---

## 11. Authentication and authorization behavior in SPCS

### Will local auth changes affect SPCS?
No, not if configured correctly.

Reason:
- local externalbrowser path is only intended for:
  - `LOCAL_DEV_AUTH_ENABLED=true`
  - no ingress user token
- deployed SPCS path still uses:
  - Snowflake ingress user token
  - service token
  - caller-rights token combination

### Expected deployed behavior
In SPCS:
- authentication should still come from Snowflake / Okta through ingress
- authorization / persona resolution should still depend on:
  - active user role
  - app role mapping
  - metadata tables

### Conditions
This remains safe only if:
- `LOCAL_DEV_AUTH_ENABLED` is not enabled in deployed service env
- deployed env/spec uses the real agent/procedure/table names
- service spec passes correct account/host/agent/procedure/table variables

---

## 12. What should be done before production/client rollout

### Recommended remaining fixes
Finish and retest these before the next packaged delivery:

1. local externalbrowser single-session handling
2. AI assistant follow-up chat fix

### Recommended smoke tests
After backports:

- local Windows AVD
  - frontend loads
  - backend starts
  - schema/tables load
  - relationships load
  - add derived validate/save works
  - AI first question works
  - AI follow-up works

- SPCS deployed
  - service endpoint opens
  - session endpoint works
  - source/target databases load
  - relationships load
  - AI assistant works
  - derived source validate/save works

---

## 13. Bottom line

### What is already in place
- the major STTM functionality is integrated
- client SPCS deploy scripts exist
- metadata bootstrap scripts exist
- local externalbrowser path exists
- the Windows/bootstrap/schema-creation fixes from AVD are now backported into the repo

### What still needs cleanup
- chat follow-up threading still needs a proper final fix
- local externalbrowser session reuse needs a final stable pass

This means:
- the branch is close
- and the repo now matches the successful AVD bootstrap flow much more closely
- but the local auth/chat polish still needs one more cleanup pass before final handoff
### 6.4 Metadata namespace drift from legacy fully-qualified env values
**Symptom**
- app errors referenced `FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA` even after changing:
  - `SNOWFLAKE_DATABASE`
  - `SNOWFLAKE_SCHEMA`

**Cause**
- older env files and defaults could still contain fully-qualified object names pinned to the legacy namespace
- changing only the top-level database/schema was not always enough in older builds

**Current behavior**
- the current repo rebases legacy default metadata object names onto the active:
  - `SNOWFLAKE_DATABASE`
  - `SNOWFLAKE_SCHEMA`
- this includes table names, search service names, and agent names such as:
  - `AGT_STTM_BUILDER`
  - `AGT_WORKBENCH_CONVERSATION`

**Recommendation**
- still keep the env file internally consistent and update any explicit client overrides where possible
- but the current code no longer falls back to the legacy `FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA` namespace just because an older fully-qualified env value is present
