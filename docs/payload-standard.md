# Workbench Payload Standard

## Purpose

This standard exists so every integration point in the workbench speaks the same language.

Today, the system has multiple boundaries:

- frontend to backend
- backend to orchestration agent
- orchestration agent to sub-agents
- sub-agents back to backend
- backend back to frontend
- future backend endpoints, agent skills, and Snowflake tools

Before this change, those boundaries used different shapes. The frontend sent structured JSON, the backend collapsed it into prompt text for the agent, the agent returned partially structured JSON, and the backend had to guess how to parse it. That made the system harder to extend, harder to validate, and more fragile whenever we add new endpoints or new agent tools.

The goal of this standard is:

1. one canonical request/response envelope
2. one place for shared context
3. one way to represent warnings and errors
4. a shape that works for normal APIs and agent/tool workflows
5. backward compatibility while we migrate existing endpoints

## Canonical Envelope

```json
{
  "contract_version": "1.0",
  "request_id": "uuid-or-client-generated-id",
  "operation": "sttm.auto_map",
  "actor": {
    "user_id": "optional",
    "role": "optional"
  },
  "context": {},
  "data": {},
  "warnings": [],
  "error": null,
  "meta": {}
}
```

## Why Each Field Exists

### `contract_version`

Reason:
- We need an explicit version so future payload changes do not become silent breaking changes.
- Agents, frontend, backend, and tools may evolve at different speeds. A version gives us a stable compatibility checkpoint.

Why not rely only on endpoint names:
- Endpoints alone do not help when the same logical operation is reused across frontend, agent, and tool boundaries.
- The same route may support both legacy and standardized payloads during migration.

### `request_id`

Reason:
- Lets us trace a single action across frontend logs, backend logs, and agent/tool calls.
- Helps debug multi-step failures when the same user action touches multiple services.
- Important for future observability, audit trails, and distributed tracing.

Why it matters for agents:
- Agent workflows are not single function calls. A request can fan out into orchestration and sub-agent calls. `request_id` gives that whole chain a shared correlation ID.

### `operation`

Reason:
- A route name is not enough because the same endpoint may support multiple intents.
- We need one machine-readable action identity across HTTP, agents, and Snowflake tools.

Examples:
- `sttm.auto_map`
- `sttm.chat`
- `sttm.transform`
- future: `semantic_model.generate`
- future: `table_selection.list_tables`

Why this is better than inferring from payload fields:
- Inference becomes brittle as features grow.
- Explicit operations let us validate, route, authorize, log, and test behavior consistently.

### `actor`

Reason:
- Keeps caller identity concerns separate from business payload data.
- Useful for future role-aware behaviors, audit history, and agent/tool safety rules.

Why it is optional:
- The backend can derive identity from auth/session context today.
- We still want the envelope to support flows where actor metadata is attached explicitly later.

### `context`

Reason:
- This is the shared state needed to execute an operation, but it is not the main business payload itself.
- Context should travel intact across frontend, backend, orchestration agent, and sub-agents.

What belongs here:
- thread/session IDs
- selected source tables
- driving table
- relationships
- semantic context
- selected columns
- role/database/schema context
- trace metadata

Why separate it from `data`:
- `data` should mean "what this operation is doing"
- `context` should mean "what surrounding state this operation needs"

That separation matters because agent workflows are stateful. A chat instruction, auto-map request, and transform request may all reuse the same context while changing only the business payload.

### `data`

Reason:
- This is the operation-specific payload.
- It keeps each endpoint or agent action strongly typed without losing a shared top-level format.

Examples:
- For `sttm.auto_map`, `data` contains `intent`, target attributes, and optional message.
- For `sttm.transform`, `data` contains `intent`, mapped attributes, and transform instructions.
- For future CRUD/list endpoints, `data` can contain filters, records, or job inputs.

Why not put everything at the top level:
- Flat payloads become inconsistent quickly across features.
- A standard envelope with typed `data` gives us reuse without losing clarity.

### `warnings`

Reason:
- Some events are important but should not fail the request.
- We need a standard place for compatibility notes, normalization notes, and partial-fallback behavior.

Current example:
- `LEGACY_PAYLOAD` when the backend accepts the old flat STTM request and normalizes it into the standard envelope.

Why warnings are separate from errors:
- Errors stop success.
- Warnings keep success but explain that the request was adapted or partially degraded.

### `error`

Reason:
- We need one machine-readable failure format across API and agent boundaries.
- This makes frontend error handling predictable and keeps the same contract available for future tools and skills.

Why this shape:
- It is aligned with RFC 9457 problem-details style fields such as `title`, `status`, and `detail`.
- It works for both HTTP failures and internal agent/tool failures.

Why keep legacy `code` and `message` today:
- Existing callers already use them.
- We can expose richer structured errors now without breaking old consumers.

### `meta`

Reason:
- Some information is useful but should not be treated as business payload.
- This includes timing, model/tool metadata, pagination, debug-safe diagnostics, or feature flags.

Why not merge into `context`:
- `context` is request state required for execution.
- `meta` is supporting metadata about how the request was handled or should be interpreted.

## What This Standard Covers Right Now

This implementation already covers the most important inconsistent boundary in the app: the STTM AI flow.

### Covered now

- frontend `workbenchService.invoke()` builds the standardized envelope
- backend `/api/v1/workbench/invoke` accepts both:
  - new standardized envelope
  - old flat legacy STTM payload
- backend normalizes legacy payloads into the canonical envelope before invoking core logic
- backend sends a canonical agent-payload JSON subset to the Snowflake orchestration agent
- orchestration/sub-agent response parsing accepts:
  - canonical envelope responses
  - temporary legacy agent shapes during migration
- frontend error parsing now understands structured envelope errors
- backend error responses now include structured `error` details alongside legacy fields
- other current backend routes now return the same envelope shape for table selection, derived sources, semantic model, auth, user, agents, and workbench info

### Covered models and concepts

- request envelope
- response envelope
- API warnings
- API error details
- STTM context
- STTM request data
- STTM response data
- source-mapping result
- transformation-rule result

## What This Standard Is Designed to Cover Next

This is not meant to stay STTM-only. The structure is intentionally broad enough for future endpoints and tools.

### Planned coverage

- table selection endpoints
- derived source endpoints
- semantic model endpoints
- auth and user-related endpoints where useful
- future agent skills
- future Snowflake tools and procedures
- future multi-agent workflows

### Why the same envelope works for those too

- simple endpoints need consistent errors, warnings, tracing, and metadata
- stateful AI endpoints need consistent context, operation naming, and typed results
- tools and skills need a transport-neutral shape that can move through backend and agent layers unchanged

## STTM-Specific Design Choices

### Why `operation` and `intent` both exist

Reason:
- `operation` is the stable system-level action name
- `intent` is the domain-level STTM action inside the typed payload

This gives us:
- explicit routing at the envelope level
- typed STTM semantics inside `data`
- room for future routes where one endpoint may still support more than one intent

### Why legacy top-level fields still exist in the response

Current preserved fields:
- `thread_id`
- `agent`
- `result`
- `message`

Reason:
- Existing frontend reducers and components already read them.
- We want to migrate safely without breaking the current app while we shift consumers toward `context` and `data`.

### Why backend now sends JSON to the agent instead of prompt-shaped text

Reason:
- Prompt text loses structure.
- JSON is easier to validate, test, and evolve.
- The same payload can now pass frontend -> backend -> agent -> backend with minimal shape translation.

That is the biggest reliability win in this change.

## Agent Payload Profile

The full app envelope remains the standard for frontend and backend APIs.

Agents are a special case because Snowflake's `agent:run` API accepts `messages`,
which means our structured payload still travels as message text. The best practice
is not to send a prose prompt, but also not to send every transport-only field to the model.

So we use a slimmer agent-facing profile that preserves the same core shape:

```json
{
  "contract_version": "1.0",
  "request_id": "uuid-or-client-generated-id",
  "operation": "sttm.chat",
  "context": {},
  "data": {}
}
```

### Why the agent payload is slimmer

We keep:
- `contract_version` so agents and sub-agents stay on a recognizable contract
- `request_id` for correlation across orchestration and sub-agent calls
- `operation` for explicit routing and response shaping
- relevant `context` because the model needs state to reason
- `data` because it is the business payload

We omit on agent input unless meaningful:
- `actor`
- `warnings`
- `error`
- `meta`
- `thread_id` inside the JSON body

Reasons:
- `actor`, `warnings`, `error`, and `meta` are mostly transport or observability concerns, not reasoning inputs
- Snowflake threads already maintain the conversation context, so `thread_id` belongs in the API transport rather than in the model-facing JSON body
- keeping the payload focused reduces token noise and makes tool routing more reliable

### Agent output

For agent output, we still want structured responses because the backend consumes them programmatically.

Agent responses should return:
- `contract_version`
- `request_id` when present on input
- `operation`
- `context`
- `data`

They may also return:
- `warnings`
- `error`
- `meta`

Those output fields are worth preserving because they can carry:
- clarifying warnings
- structured failure details
- agent or tool metadata useful for debugging and observability

So the rule is:
- app-facing requests and responses use the full envelope
- agent-facing requests use a slimmer subset
- agent-facing responses may include the richer optional fields, and the backend preserves them

## Progressive Semantic Context

The STTM payload now also carries cross-surface semantic state so source selection, derived-source authoring,
and mapping can reuse the same bundle instead of rebuilding context from scratch each time.

New STTM context fields:
- `surface`
- `semantic_level_requested`
- `target_table`
- `selected_derived_sources`
- `semantic_bundle_id`
- `semantic_view_name`
- `derived_source_lineage`
- `datahub_context`

Why these fields exist:
- `surface` tells the orchestrator whether the user is asking from source selection, derived-source design, or mapping.
- `semantic_level_requested` lets us keep semantics progressive instead of always paying for the heaviest enrichment.
- `selected_derived_sources` and `derived_source_lineage` make derived sources first-class semantic assets.
- `semantic_bundle_id` and `semantic_view_name` let later pages reuse promoted semantic state.
- `datahub_context` stays optional and read-only so metadata enrichment can help reasoning without becoming a hard dependency.

## Compatibility Rules

### Current migration behavior

- new clients should send the standardized envelope
- old STTM clients can still send the flat request body
- callers still sending `schema_version` are normalized to `contract_version` during migration
- backend emits a `LEGACY_PAYLOAD` warning when it normalizes old input
- agent parsing still tolerates old result variants while we update deployed agent specs

### Why we chose compatibility adapters

Reason:
- The app is still evolving.
- We need a durable standard without forcing a risky all-at-once rewrite.
- Compatibility adapters let us establish one internal truth now and migrate callers incrementally.

## Why This Standard Was Chosen Over Simpler Alternatives

### Why not keep endpoint-specific payloads only

- That keeps duplication high.
- It does not solve agent/tool consistency.
- It makes frontend/backend/agent drift more likely over time.

### Why not use a heavy resource format like JSON:API

- JSON:API is good for CRUD resources.
- This app has a large workflow/agent component, not just resource CRUD.
- We need a format that handles conversational and tool-driven actions naturally.

### Why not use only OpenAPI-generated request/response shapes

- OpenAPI helps frontend/backend typing, and we should keep using it.
- But OpenAPI alone does not define one cross-boundary contract for agents and Snowflake tools.
- We still need a shared payload shape those systems can all understand.

## Files Implementing the Standard

- Backend base models: [contracts.py](/Users/ankurshome/Desktop/storage/Mr-Bucky/bbi-mig-ai-workbench/services/sttm-builder/app/schema/contracts.py)
- STTM envelope and adapters: [sttm_builder.py](/Users/ankurshome/Desktop/storage/Mr-Bucky/bbi-mig-ai-workbench/services/sttm-builder/app/schema/sttm_builder.py)
- STTM service normalization and agent transport: [sttm_builder.py](/Users/ankurshome/Desktop/storage/Mr-Bucky/bbi-mig-ai-workbench/services/sttm-builder/app/core/sttm_builder.py)
- Invoke route compatibility layer: [sttm_builder.py](/Users/ankurshome/Desktop/storage/Mr-Bucky/bbi-mig-ai-workbench/services/sttm-builder/app/routers/sttm_builder.py)
- Frontend shared contract types: [api-contract.ts](/Users/ankurshome/Desktop/storage/Mr-Bucky/bbi-mig-ai-workbench/frontend/src/types/api-contract.ts)
- Frontend STTM request builder: [workbenchService.ts](/Users/ankurshome/Desktop/storage/Mr-Bucky/bbi-mig-ai-workbench/frontend/src/services/workbenchService.ts)
- Structured frontend error parsing: [axiosInstance.ts](/Users/ankurshome/Desktop/storage/Mr-Bucky/bbi-mig-ai-workbench/frontend/src/api/axiosInstance.ts)
- Agent spec contract updates:
  - [agent_spec_sttm_builder.yaml](/Users/ankurshome/Desktop/storage/Mr-Bucky/bbi-mig-ai-workbench/infra/snowflake/agents/agent_spec_sttm_builder.yaml)
  - [agent_spec_source_mapping.yaml](/Users/ankurshome/Desktop/storage/Mr-Bucky/bbi-mig-ai-workbench/infra/snowflake/agents/agent_spec_source_mapping.yaml)
  - [agent_spec_transformation_rule.yaml](/Users/ankurshome/Desktop/storage/Mr-Bucky/bbi-mig-ai-workbench/infra/snowflake/agents/agent_spec_transformation_rule.yaml)

## Current Gaps

The standard is defined broadly, but only the STTM AI boundary is fully migrated right now.

Not fully migrated yet:

- table selection responses
- derived source responses
- semantic model responses
- auth/user endpoints
- full OpenAPI-driven frontend type generation workflow

Those should move next, but now they have a concrete standard to move toward instead of inventing their own shapes.
