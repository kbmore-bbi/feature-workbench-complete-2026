import { createSlice, createAsyncThunk, createAction, type PayloadAction } from "@reduxjs/toolkit";
import { getApiErrorMessage } from "@/api/axiosInstance";
import { conversationService } from "@/services/conversationService";
import { recommendationService } from "@/services/recommendationService";
import { dbService } from "@/services/dbService";
import { workbenchService, type TableRef } from "@/services/workbenchService";
import {
  type PreparedWorkspaceContext,
} from "@/services/preparedContextService";
import { authService } from "@/services/authService";
import {
  getSttm,
  listProjectAttributes,
  type ProjectAttributeRecord,
} from "@/services/projectService";
import type {
  AssistantInferenceRecord,
  AssistantPreferenceState,
  AssistantSignal,
  AssistantSignalStatus,
  AutoMappingReview,
  ConversationEnvelopeResponse,
  MappingIntent,
  RelationGraphContext,
  SemanticLevel,
  SemanticContextItem,
  SourceMappingResult,
  STTMBuilderEnvelopeResponse,
  TransformationResult,
  FIRRecommendation,
} from "@/types/api-contract";
import type { UserSession } from "@/types/user";
import type {
  BuilderErrorState,
  BuilderLoadState,
  ChatMessage,
  Column,
  ColumnGroup,
  DatabaseNode,
  DerivedSource,
  JoinConfig,
  MappingRuleType,
  MappingStatus,
  MappingSuggestion,
  PendingDerivedSourceDraft,
  RuleCondition,
  RuleGroup,
  SourceTargetInfo,
  TableNode,
  MappingState,
  MappingWorkspaceSnapshot,
  PendingAiMappingReview,
  ParsedSqlWorkspaceApplyPayload,
} from "@/features/sttm/types/sttm.types";
import {
  resolveSelectedSourceTables,
  resolveSelectedTargetTable,
} from "@/features/sttm/shared/sttm-selection-utils";
import {
  buildWorkbenchContextSnapshot,
  type WorkbenchCheckpoint,
} from "@/features/sttm/context/workbench-context";

export {
  collectSelectedSourceQualifiedNames,
  getSelectedSourceTables,
  getSelectedTargetTable,
} from "@/features/sttm/shared/sttm-selection-utils";

// ─── helpers ───────────────────────────────────────────────────────
function getErrorMessage(error: unknown, fallback: string): string {
  return getApiErrorMessage(error, fallback);
}

function isSemanticRelationshipCompatibilityError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const payload = (error as { payload?: { code?: string; message?: string } }).payload;
  return (
    payload?.code === "SEMANTIC_RELATIONSHIP_INVALID" ||
    String(payload?.message ?? "").includes("cannot be represented safely in Cortex Analyst")
  );
}

function makeTableRef(qualifiedName: string): TableRef {
  const [database, schema, table] = qualifiedName.split(".", 3);
  return { database, schema, table };
}

function snapshotTableFqn(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (!value || typeof value !== "object") return null;
  const ref = value as Record<string, unknown>;
  const direct = ref.qualified_name ?? ref.qualifiedName ?? ref.fqn;
  if (typeof direct === "string" && direct) return direct;
  const parts = [ref.database, ref.schema, ref.table].map((part) => String(part ?? ""));
  return parts.every(Boolean) ? parts.join(".") : null;
}

function normalizeSnapshotRelationships(
  value: unknown,
  relationLabels: Map<string, string> = new Map(),
): JoinConfig[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const rawLeft = item.left_table ?? item.leftTableId ?? item.left_relation_id;
    const rawRight = item.right_table ?? item.rightTableId ?? item.right_relation_id;
    const leftKey = typeof rawLeft === "string" ? rawLeft : "";
    const rightKey = typeof rawRight === "string" ? rawRight : "";
    const leftTableId = relationLabels.get(leftKey) ?? snapshotTableFqn(rawLeft);
    const rightTableId = relationLabels.get(rightKey) ?? snapshotTableFqn(rawRight);
    if (!leftTableId || !rightTableId) return [];
    const conditions = Array.isArray(item.conditions)
      ? item.conditions.flatMap((rawCondition) => {
          if (!rawCondition || typeof rawCondition !== "object") return [];
          const condition = rawCondition as Record<string, unknown>;
          const leftColumn = String(condition.left_column ?? condition.leftColumn ?? "");
          const rightColumn = String(condition.right_column ?? condition.rightColumn ?? "");
          if (!leftColumn || !rightColumn) return [];
          return [{
            leftColumn,
            rightColumn,
            operator: String(condition.operator ?? "="),
          }];
        })
      : [];
    if (!conditions.length) return [];
    const rawJoinType = String(item.join_type ?? item.joinType ?? "INNER").toUpperCase();
    const joinType = (["INNER", "LEFT", "RIGHT", "FULL"].includes(rawJoinType)
      ? rawJoinType
      : "INNER") as JoinConfig["joinType"];
    return [{
      id: String(item.id ?? item.constraint_name ?? item.constraintName ?? `snapshot_join_${index}`),
      leftTableId,
      rightTableId,
      joinType,
      constraintName: String(item.constraint_name ?? item.constraintName ?? "") || undefined,
      source: String(item.source ?? "USER_DEFINED").toUpperCase() === "FOREIGN_KEY"
        ? "FOREIGN_KEY"
        : "USER_DEFINED",
      locked: Boolean(item.locked ?? false),
      conditions,
    }];
  });
}

function cloneBranch(branch: DatabaseNode[]): DatabaseNode[] {
  return branch.map((db) => ({
    ...db,
    schemas: db.schemas.map((s) => ({
      ...s,
      tables: s.tables.map((t) => ({ ...t })),
    })),
  }));
}

function mergeColumnsIntoTables(
  tables: TableNode[],
  groups: ColumnGroup[]
): TableNode[] {
  return tables.map((table) => {
    const group = groups.find((item) => item.qualifiedName === table.qualifiedName);
    if (!group) return table;
    return {
      ...table,
      columns: group.columns.length,
      columnItems: group.columns,
    };
  });
}

function mergeColumnsIntoBranch(
  branch: DatabaseNode[],
  groups: ColumnGroup[]
): DatabaseNode[] {
  for (const db of branch) {
    for (const schema of db.schemas) {
      schema.tables = mergeColumnsIntoTables(schema.tables, groups);
    }
  }
  return branch;
}

function buildSelectedColumnsByTable(
  groups: ColumnGroup[]
): Record<string, string[]> | null {
  if (!groups.length) return null;

  const out: Record<string, string[]> = {};
  for (const group of groups) {
    const selected = group.columns
      .filter((column) => !!column.name)
      .map((column) => column.name as string);
    if (selected.length) {
      out[group.qualifiedName] = selected;
    }
  }
  return Object.keys(out).length ? out : null;
}

function buildRelationshipPayload(joins: JoinConfig[]) {
  return joins
    .filter(
      (join) =>
        !!join.leftTableId &&
        !!join.rightTableId &&
        !!join.conditions?.length
    )
    .flatMap((join) => {
      const leftParts = String(join.leftTableId).split(".", 3);
      const rightParts = String(join.rightTableId).split(".", 3);
      // Derived-source IDs are valid relation-graph nodes but are not physical
      // TableRef values. Their joins stay in relation_graph and must not be
      // copied into this legacy physical-table compatibility field.
      if (
        leftParts.length !== 3 ||
        rightParts.length !== 3 ||
        leftParts.some((part) => !part) ||
        rightParts.some((part) => !part)
      ) {
        return [];
      }
      return [{
        left_table: makeTableRef(join.leftTableId as string),
        right_table: makeTableRef(join.rightTableId as string),
        constraint_name: join.constraintName ?? null,
        join_type: join.joinType ?? "INNER",
        source: join.source ?? "USER_DEFINED",
        locked: join.locked ?? false,
        conditions: (join.conditions ?? [])
          .filter((condition) => !!condition.leftColumn && !!condition.rightColumn)
          .map((condition) => ({
            left_column: condition.leftColumn as string,
            right_column: condition.rightColumn as string,
            operator: condition.operator ?? "=",
          })),
      }];
    })
    .filter((join) => join.conditions.length > 0);
}

function getSelectedDerivedSourceIds(derivedSources: DerivedSource[]): string[] {
  return derivedSources.filter((source) => source.isSelected).map((source) => source.id);
}

function stableRelationAlias(seed: string, index: number): string {
  const normalized = seed
    .split(".")
    .pop()
    ?.replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return `${normalized || "source"}_${index + 1}`;
}

function buildRelationGraph(
  sourceTables: ReturnType<typeof resolveSelectedSourceTables>,
  derivedSources: DerivedSource[],
  joins: JoinConfig[],
  mappings: MappingState[],
  projectAttributes: ProjectAttributeRecord[] = [],
): RelationGraphContext {
  const selectedDerived = derivedSources.filter((source) => source.isSelected);
  const nodes: RelationGraphContext["nodes"] = [
    ...sourceTables.map((table, index) => ({
      relation_id: table.qualifiedName,
      kind: "PHYSICAL_TABLE" as const,
      alias: stableRelationAlias(table.qualifiedName, index),
      table: makeTableRef(table.qualifiedName),
      output_columns: table.columnItems?.map((column) => ({
        name: column.name,
        data_type: column.type,
        is_primary_key: column.isPrimaryKey,
      })) ?? [],
    })),
    ...selectedDerived.map((source, index) => ({
      relation_id: source.id,
      kind: "DERIVED_SOURCE" as const,
      alias: source.alias || stableRelationAlias(source.sourceName || source.id, sourceTables.length + index),
      derived_source_id: source.id,
      physical_view_name: source.physicalViewName ?? null,
      sql_text: source.sqlText ?? null,
      output_columns: source.outputColumns ?? source.previewColumns?.map((column) => ({
        name: column.name,
        data_type: column.dataType,
        is_primary_key: column.isPrimaryKey,
      })) ?? [],
      column_semantics: source.columnSemantics ?? [],
      grain: source.grain ?? null,
      keys: source.keys ?? [],
      dependency_hash: source.sourceDependencyHash ?? source.upstreamHash ?? null,
      parent_relation_ids: source.parentDerivedSourceIds ?? source.derivedSourceIds ?? [],
      base_relation_ids: (source.baseSourceTables ?? []).map((table) =>
        `${table.database}.${table.schema}.${table.table}`.replace(/\.+/g, "."),
      ),
    })),
  ];
  const nodeIds = new Set(nodes.map((node) => node.relation_id));
  const edges = joins
    .filter(
      (join) =>
        !!join.leftTableId &&
        !!join.rightTableId &&
        nodeIds.has(join.leftTableId) &&
        nodeIds.has(join.rightTableId) &&
        !!join.conditions?.length,
    )
    .map((join, index) => ({
      edge_id: join.id ?? `relation-edge-${index + 1}`,
      left_relation_id: join.leftTableId as string,
      right_relation_id: join.rightTableId as string,
      join_type: join.joinType ?? "INNER",
      provenance: join.source ?? "USER_DEFINED",
      validation_status: join.locked ? "validated" : "selected",
      conditions: (join.conditions ?? [])
        .filter((condition) => condition.leftColumn && condition.rightColumn)
        .map((condition) => ({
          left_column: condition.leftColumn as string,
          right_column: condition.rightColumn as string,
          operator: condition.operator ?? "=",
        })),
    }))
    .filter((edge) => edge.conditions.length > 0);
  const mappingValueBindings = mappings
    .filter(
      (mapping) =>
        (mapping.mappingMode === "constant" || mapping.mappingMode === "attribute")
        && mapping.constantValue != null,
    )
    .map((mapping) => {
      const projectAttribute = mapping.mappingMode === "attribute"
        ? projectAttributes.find(
            (attribute) => attribute.attribute_name.toUpperCase() === String(mapping.attributeName ?? "").toUpperCase(),
          )
        : undefined;
      const placeholder = projectAttribute
        ? `$${projectAttribute.attribute_name}`
        : String(mapping.constantValue);
      return {
        binding_id: mapping.valueBindingIds?.[0]
          ?? (projectAttribute ? `project-attribute:${projectAttribute.attribute_id}` : mapping.id),
        value: placeholder,
        resolved_value: projectAttribute?.attribute_value,
        data_type: projectAttribute?.attribute_type || mapping.targetType || null,
        is_placeholder: placeholder.trim().startsWith("$"),
        allow_project_specific_value: mapping.mappingMode === "attribute",
        resolution_status: projectAttribute
          ? "project_attribute"
          : placeholder.trim().startsWith("$")
            ? "placeholder_contract"
            : "resolved",
        attribute_name: mapping.mappingMode === "attribute" ? mapping.attributeName ?? null : null,
      };
    });
  const existingBindingNames = new Set(
    mappingValueBindings
      .map((binding) => String(binding.attribute_name ?? "").toUpperCase())
      .filter(Boolean),
  );
  const projectValueBindings = projectAttributes
    .filter((attribute) => !existingBindingNames.has(attribute.attribute_name.toUpperCase()))
    .map((attribute) => ({
      binding_id: `project-attribute:${attribute.attribute_id}`,
      value: `$${attribute.attribute_name}`,
      resolved_value: attribute.attribute_value,
      data_type: attribute.attribute_type || null,
      is_placeholder: true,
      allow_project_specific_value: true,
      resolution_status: "project_attribute",
      attribute_name: attribute.attribute_name,
    }));
  const value_bindings = [...mappingValueBindings, ...projectValueBindings];
  return { nodes, edges, value_bindings };
}

function findTargetDescription(
  semanticItems: SemanticContextItem[] | null | undefined,
  targetFqn: string | null,
  targetColumn: string,
): string | null {
  if (!targetFqn) return null;
  const item = semanticItems?.find((candidate) => {
    const table = candidate.table;
    return `${table.database}.${table.schema}.${table.table}`.toUpperCase() === targetFqn.toUpperCase();
  });
  const model = item?.semantic_model;
  if (!model || typeof model !== "object") return null;
  const attributes = (model as { attributes?: unknown }).attributes;
  if (!Array.isArray(attributes)) return null;
  const attribute = attributes.find(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      String((candidate as Record<string, unknown>).name ?? "").toUpperCase() === targetColumn.toUpperCase(),
  ) as Record<string, unknown> | undefined;
  const description = attribute?.business_meaning ?? attribute?.summary ?? attribute?.description;
  return typeof description === "string" && description.trim() ? description.trim() : null;
}

type SemanticRefreshResult = Awaited<ReturnType<typeof dbService.refreshSemanticContext>>;

function isDerivedSourceGenerationText(text: string): boolean {
  const subjects = ["derived source", "derived sources", "derived table", "cte", "ctes"];
  const migrationSourceSubjects = [
    "reusable household-level source",
    "reusable household level source",
    "reusable source for",
    "migration source",
  ];
  const generationVerbs = ["create", "build", "generate", "write", "save", "make", "implement"];
  const recommendationTokens = ["advice", "advise", "recommend", "best", "which", "what should"];
  const explicitGenerationTokens = [
    "generate sql", "generate query", "generate those", "generate all",
    "build query", "build those", "write sql", "write query",
    "create it", "create this", "create those", "create now",
  ];
  if (
    recommendationTokens.some((token) => text.includes(token)) &&
    !explicitGenerationTokens.some((token) => text.includes(token))
  ) {
    return false;
  }
  const directTokens = [
    "generate sql",
    "generate query",
    "write sql",
    "write query",
    "build query",
    "create query",
  ];
  if (directTokens.some((token) => text.includes(token))) {
    return true;
  }
  if (
    migrationSourceSubjects.some((subject) => text.includes(subject)) &&
    ["prepare", "create", "build", "generate", "make"].some((verb) => text.includes(verb))
  ) {
    return true;
  }
  if (subjects.some((subject) => text.includes(subject)) && generationVerbs.some((verb) => text.includes(verb))) {
    return true;
  }
  return ["generate those", "build those", "create those"].some((token) => text.includes(token));
}

function getCurrentAssistantPage() {
  if (typeof window === "undefined") {
    return "builder" as const;
  }
  const pathname = window.location.pathname;
  if (pathname.includes("/summary")) return "summary" as const;
  if (pathname.includes("/mapping")) return "mapping" as const;
  return "builder" as const;
}

function getCurrentAssistantSurface(page: "builder" | "mapping" | "summary", isDerivedSourcePrompt: boolean) {
  if (page === "mapping") return "MAPPING" as const;
  if (isDerivedSourcePrompt) return "DERIVED_SOURCE" as const;
  return "SOURCE_SELECTION" as const;
}

function createChatMessageId() {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

type AssistantEnvelopeResponse = STTMBuilderEnvelopeResponse | ConversationEnvelopeResponse;

function isConversationEnvelopeResponse(
  response: AssistantEnvelopeResponse | Record<string, unknown> | null | undefined,
): response is ConversationEnvelopeResponse {
  return Boolean(
    response &&
      typeof response === "object" &&
      "operation" in response &&
      typeof response.operation === "string" &&
      response.operation.startsWith("conversation."),
  );
}

function extractClarificationOptions(response: {
  data?: { artifact?: Record<string, unknown> | null; status?: string | null } | null;
}) {
  const artifact = resolveAgentResponseParts(
    response as STTMBuilderEnvelopeResponse,
  ).artifact;
  if (!artifact || typeof artifact !== "object") return [];
  const direct = artifact.clarification_options;
  if (Array.isArray(direct)) {
    return direct.map((item) => String(item)).filter(Boolean);
  }
  const suggestions = artifact.suggestions;
  if (Array.isArray(suggestions)) {
    return suggestions.map((item) => String(item)).filter(Boolean);
  }
  return [];
}

type EmbeddedAgentEnvelope = Partial<STTMBuilderEnvelopeResponse> & {
  data?: {
    agent?: string | null;
    result?: Record<string, unknown> | null;
    message?: string | null;
    artifact_type?: string | null;
    artifact?: Record<string, unknown> | null;
  } | null;
  warnings?: unknown[] | null;
};

type ResolvedAgentResponseParts = {
  agent: string | null;
  artifact: Record<string, unknown> | null;
  artifactType: string | null;
  message: string;
  result: SourceMappingResult | TransformationResult | null;
  warnings: string[];
};

function extractJsonObjectCandidate(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return text.slice(start, end + 1);
  }
  return text.trim();
}

function parseEmbeddedAgentEnvelope(text: string | null | undefined): EmbeddedAgentEnvelope | null {
  if (typeof text !== "string") return null;

  const trimmed = text.trim();
  if (!trimmed) return null;

  const candidates = [
    ...Array.from(trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), (match) => match[1]?.trim() ?? ""),
    trimmed.startsWith("{") && trimmed.endsWith("}") ? trimmed : "",
    trimmed.includes('"contract_version"') || trimmed.includes('"operation"') || trimmed.includes('"data"')
      ? extractJsonObjectCandidate(trimmed)
      : "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(extractJsonObjectCandidate(candidate));
      if (
        parsed &&
        typeof parsed === "object" &&
        (
          "data" in parsed ||
          "operation" in parsed ||
          "contract_version" in parsed
        )
      ) {
        return parsed as EmbeddedAgentEnvelope;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function looksLikeEmbeddedAgentEnvelope(text: string | null | undefined) {
  return parseEmbeddedAgentEnvelope(text) !== null;
}

function extractWarningMessages(warnings: unknown[] | null | undefined) {
  if (!Array.isArray(warnings)) return [];
  return warnings
    .map((warning) => {
      if (typeof warning === "string") {
        return warning.trim();
      }
      if (warning && typeof warning === "object") {
        const message =
          ("message" in warning && typeof warning.message === "string" && warning.message) ||
          ("detail" in warning && typeof warning.detail === "string" && warning.detail) ||
          "";
        return message.trim();
      }
      return "";
    })
    .filter(Boolean);
}

function resolveAgentResponseParts(
  response: STTMBuilderEnvelopeResponse,
): ResolvedAgentResponseParts {
  const embedded =
    parseEmbeddedAgentEnvelope(response.data?.message) ??
    parseEmbeddedAgentEnvelope(response.message);
  const artifact =
    (response.data?.artifact && typeof response.data.artifact === "object"
      ? (response.data.artifact as Record<string, unknown>)
      : null) ??
    (embedded?.data?.artifact && typeof embedded.data.artifact === "object"
      ? embedded.data.artifact
      : null);
  const plainDataMessage =
    typeof response.data?.message === "string" && !looksLikeEmbeddedAgentEnvelope(response.data.message)
      ? response.data.message.trim()
      : "";
  const plainRootMessage =
    typeof response.message === "string" && !looksLikeEmbeddedAgentEnvelope(response.message)
      ? response.message.trim()
      : "";
  const embeddedMessage =
    typeof embedded?.data?.message === "string" ? embedded.data.message.trim() : "";

  return {
    agent:
      response.data?.agent ??
      response.agent ??
      (typeof embedded?.data?.agent === "string" ? embedded.data.agent : null) ??
      (typeof embedded?.agent === "string" ? embedded.agent : null) ??
      null,
    artifact,
    artifactType:
      response.data?.artifact_type ??
      (typeof embedded?.data?.artifact_type === "string" ? embedded.data.artifact_type : null) ??
      null,
    message: plainDataMessage || embeddedMessage || plainRootMessage,
    result:
      (response.data?.result as SourceMappingResult | TransformationResult | null | undefined) ??
      (response.result as SourceMappingResult | TransformationResult | null | undefined) ??
      (embedded?.data?.result && typeof embedded.data.result === "object"
        ? (embedded.data.result as SourceMappingResult | TransformationResult)
        : null) ??
      (embedded?.result && typeof embedded.result === "object"
        ? (embedded.result as SourceMappingResult | TransformationResult)
        : null) ??
      null,
    warnings: [
      ...extractWarningMessages(response.warnings),
      ...extractWarningMessages(embedded?.warnings),
    ],
  };
}

function normalizeTargetKey(value: string) {
  return value.trim().toUpperCase();
}

function targetKeyVariants(value: string) {
  const normalized = normalizeTargetKey(value);
  const parts = normalized.split(".");
  return new Set([normalized, parts[parts.length - 1] ?? normalized]);
}

function isTransformationPrompt(text: string) {
  return [
    "preprocess",
    "pre-process",
    "pre processing",
    "preprocessing",
    "transform",
    "transformation",
    "rule",
    "sql fragment",
  ].some((token) => text.includes(token));
}

function isMappingMutationPrompt(text: string) {
  return /\b(apply|change|correct|fix|map|remap|set|update|use)\b/i.test(text);
}

function normalizeMentionToken(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function resolveChatTargetMappings(
  state: SttmBuilderState,
  currentMessage: string,
): MappingState[] {
  const selected = state.mappings.filter((mapping) => state.selectedMappingIds.includes(mapping.id));
  if (selected.length) return selected;
  const active = state.mappings.find((mapping) => mapping.id === state.activeMappingId);
  if (active) return [active];

  const utterances = [
    ...state.chatMessages
      .filter((message) => message.role === "user" && message.content.trim())
      .map((message) => message.content),
    currentMessage,
  ].reverse();
  for (const utterance of utterances) {
    const normalizedUtterance = normalizeMentionToken(utterance);
    const matches = state.mappings.filter((mapping) => {
      const target = normalizeMentionToken(mapping.targetColumn);
      return target.length >= 3 && normalizedUtterance.includes(target);
    });
    if (matches.length === 1) return matches;
  }
  return [];
}

function parseRequestedConstantValue(text: string): string | null {
  if (!/\b(constant|literal|value)\b/i.test(text)) return null;
  const patterns = [
    /\b(?:constant|literal)\s+(?:value\s+)?(?:of\s+|to\s+|=\s*|:\s*|-\s*)?[`'"]?([^\s,;`'"]+)/i,
    /\bvalue\s*(?:of\s+|to\s+|=\s*|:\s*|-\s*)[`'"]?([^\s,;`'"]+)/i,
  ];
  for (const pattern of patterns) {
    const value = text.match(pattern)?.[1]?.trim();
    if (value && !["for", "all", "the", "this"].includes(value.toLowerCase())) return value;
  }
  return null;
}

function buildConstantMappingProposal(
  state: SttmBuilderState,
  mapping: MappingState,
  value: string,
): STTMBuilderEnvelopeResponse {
  const target = mapping.targetColumn;
  const result: SourceMappingResult = {
    mappings: {
      [target]: {
        source_attributes: [],
        source_dependencies: [],
        value_binding_ids: [],
        mapping_mode: "constant",
        constant_value: value,
        transformation_classification: "value",
        precedent_decision: "unresolved",
        precedent_mapping_id: null,
        confidence_score: 1,
        confidence_reason: `The user explicitly requested constant value ${value} for ${target}.`,
        preprocessing_rule: null,
        preprocessing_rule_type: "Value",
        preprocessing_nl_rule: `Set ${target} to constant value ${value} for every output row.`,
      },
    },
  };
  return {
    contract_version: "1.0",
    request_id: `local-constant-${Date.now()}`,
    operation: "sttm.transform",
    actor: null,
    context: { trace_id: `local-constant-${Date.now()}` },
    data: {
      intent: "TRANSFORM",
      status: "completed",
      agent: "TRANSFORMATION_AGENT",
      result,
      message: `Prepared a constant Value mapping for ${target}. Review it and choose Apply Changes to update the mapping row.`,
      artifact_type: "source_mapping",
      artifact: null,
    },
    warnings: [],
    error: null,
    meta: { deterministic_user_instruction: true },
    thread_id: state.agentThreadId ?? `local-workspace-${state.activeSttmId ?? "new"}`,
    parent_message_id: null,
    agent: "TRANSFORMATION_AGENT",
    result,
    message: `Prepared a constant Value mapping for ${target}. Review it and choose Apply Changes to update the mapping row.`,
  } as unknown as STTMBuilderEnvelopeResponse;
}

function getStructuredAgentResult(response: STTMBuilderEnvelopeResponse) {
  return resolveAgentResponseParts(response).result;
}

function extractNarrativeReviewFields(response: STTMBuilderEnvelopeResponse) {
  const text = resolveAgentResponseParts(response).message.trim();
  if (!text) {
    return null;
  }

  const codeBlockMatch = text.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  const generatedRuleMatch = text.match(/Generated Rule:\s*([\s\S]*?)(?:\n\s*\n|Rule Details:|How It Works:|SQL Fragment Required:|$)/i);
  const preprocessingRuleMatch = text.match(/Preprocessing Rule(?:\s*\([^)]+\))?:\s*([\s\S]*?)(?:\n\s*\n|Rule Details:|How It Works:|SQL Fragment Required:|$)/i);
  const transformationLogicMatch = text.match(
    /Transformation Logic(?:\s*\(SQL\))?:\s*([\s\S]*?)(?:\n\s*\n|This rule will:|Rule Details:|How It Works:|Status:|$)/i,
  );
  const sourceLineMatch = text.match(/Source(?: Attribute[s]?)?:\s*([^\n|]+)/i);
  const targetLineMatch = text.match(/Target Attribute:\s*([^\n|]+)/i);
  const confidenceMatch = text.match(/Confidence:\s*(\d{1,3})%/i);
  const processingOrderMatch = text.match(/Processing Order:\s*(\d+)/i);
  const typeMatch = text.match(/Type:\s*([^\n]+)/i);
  const outputColumnMatch = text.match(/Output Column Name:\s*([^\n]+)/i);

  const parsedRule = (
    codeBlockMatch?.[1] ||
    transformationLogicMatch?.[1] ||
    generatedRuleMatch?.[1] ||
    preprocessingRuleMatch?.[1] ||
    ""
  )
    .replace(/\*\*/g, "")
    .trim();

  const parseSourceList = (raw: string | undefined) =>
    (raw ?? "")
      .split(",")
      .map((part) => part.replace(/[`"]/g, "").trim())
      .filter(Boolean);

  return {
    rule: parsedRule || null,
    sourceAttributes: parseSourceList(sourceLineMatch?.[1]),
    targetAttribute: targetLineMatch?.[1]?.replace(/[`"]/g, "").trim() || null,
    confidenceScore: confidenceMatch ? Math.max(0, Math.min(1, Number(confidenceMatch[1]) / 100)) : null,
    processingOrder: processingOrderMatch ? Number(processingOrderMatch[1]) : null,
    ruleType: typeMatch?.[1]?.replace(/[`"]/g, "").trim() || null,
    outputColumnName: outputColumnMatch?.[1]?.replace(/[`"]/g, "").trim() || null,
    narrative: text,
  };
}

function buildReviewSummary(
  response: STTMBuilderEnvelopeResponse,
  pendingReviews: PendingAiMappingReview[],
): string {
  const firstReview = pendingReviews[0];
  if (!firstReview) {
    return "Done.";
  }

  const reviewCount = pendingReviews.length;
  const resolved = resolveAgentResponseParts(response);
  const structuredResult = resolved.result;
  const isTransformation =
    resolved.agent === "TRANSFORMATION_AGENT" ||
    (!!structuredResult && "rules" in structuredResult);
  const lines: string[] = [];

  lines.push(
    isTransformation ? "## Transformation Suggestion" : "## Mapping Suggestion",
  );
  lines.push(
    reviewCount > 1
      ? `- Prepared **${reviewCount}** suggestions. Review **${firstReview.targetColumn}** first.`
      : `- Prepared a suggestion for **${firstReview.targetColumn}**.`,
  );
  if (firstReview.sourceAttributes.length > 0) {
    lines.push(`- **Source context:** ${firstReview.sourceAttributes.join(", ")}`);
  }
  if (isTransformation && firstReview.preprocessingRule) {
    lines.push(`- **Rule type:** ${firstReview.preprocessingRuleType ?? "Custom"}`);
    lines.push("### Proposed SQL");
    lines.push("```sql");
    lines.push(firstReview.preprocessingRule);
    lines.push("```");
  } else if (firstReview.preprocessingRule) {
    lines.push(`- **Suggested rule:** ${firstReview.preprocessingRule}`);
  }
  if (firstReview.preprocessingNlRule) {
    lines.push(`- **Why this helps:** ${firstReview.preprocessingNlRule}`);
  } else if (firstReview.confidenceReason) {
    lines.push(`- **Why this fits:** ${firstReview.confidenceReason}`);
  }
  if (firstReview.candidateSourceAttributes.length > 0) {
    lines.push(`- **Alternatives considered:** ${firstReview.candidateSourceAttributes.join(", ")}`);
  }
  if (resolved.warnings.length > 0) {
    lines.push("### Watchouts");
    for (const warning of resolved.warnings) {
      lines.push(`- ${warning}`);
    }
  }
  lines.push(
    "Apply it below, make further changes, or dismiss it without changing the current mapping.",
  );

  return lines.join("\n");
}

function buildPendingAiMappingReviews(
  mappings: MappingState[],
  selectedMappingIds: string[],
  activeMappingId: string | null,
  response: STTMBuilderEnvelopeResponse,
): PendingAiMappingReview[] {
  const findMappingByTarget = (targetAttribute: string | null | undefined) => {
    if (!targetAttribute) {
      return null;
    }
    const normalizedTargets = targetKeyVariants(targetAttribute);
    return (
      candidateMappings.find((item) =>
        Array.from(normalizedTargets).some((target) =>
          targetKeyVariants(item.targetColumn).has(target),
        ),
      ) ??
      mappings.find((item) =>
        Array.from(normalizedTargets).some((target) =>
          targetKeyVariants(item.targetColumn).has(target),
        ),
      ) ??
      null
    );
  };
  const candidateMappings =
    selectedMappingIds.length > 0
      ? mappings.filter((item) => selectedMappingIds.includes(item.id))
      : activeMappingId
        ? mappings.filter((item) => item.id === activeMappingId)
        : mappings;
  const resolved = resolveAgentResponseParts(response);
  const result = getStructuredAgentResult(response);
  if (!result) {
    const artifact = resolved.artifact;
    const sqlText =
      artifact && typeof artifact.sql_text === "string" ? artifact.sql_text.trim() : "";
    if (
      resolved.artifactType === "transformation_rules" &&
      sqlText &&
      candidateMappings.length === 1
    ) {
      const mapping = candidateMappings[0];
      if (!mapping) {
        return [];
      }
      const sourceAttributes =
        mapping.sourceColumns && mapping.sourceColumns.length
          ? mapping.sourceColumns
          : (mapping.sourceColumn ?? "")
              .split(",")
              .map((part) => part.trim())
              .filter(Boolean);
      return [
        {
          mappingId: mapping.id,
          targetColumn: mapping.targetColumn,
          sourceAttributes,
          confidenceScore: mapping.confidenceScore ?? (sourceAttributes.length ? 0.9 : 0.72),
          confidenceReason:
            sourceAttributes.length > 0
              ? "The rule is scoped to the selected mapping and can be reviewed before applying."
              : "The rule was generated for the selected target attribute and still needs source review.",
          candidateSourceAttributes: mapping.candidateSourceColumns ?? [],
          unmatchedReason: mapping.unmatchedReason ?? null,
          preprocessingRule: sqlText,
          preprocessingRuleType: inferPreprocessingRuleType(sqlText),
          preprocessingNlRule: resolved.message || mapping.nlRule || null,
          processingOrder:
            mapping.loadOrder && !Number.isNaN(Number(mapping.loadOrder))
              ? Number(mapping.loadOrder)
              : null,
          description: mapping.description ?? null,
        },
      ];
    }
    return [];
  }

  if ("mappings" in result) {
    const reviews: PendingAiMappingReview[] = [];
    for (const mapping of candidateMappings) {
      if (!mapping) continue;

      const responseEntry = Object.entries(result.mappings).find(([target]) =>
        targetKeyVariants(target).has(normalizeTargetKey(mapping.targetColumn)),
      )?.[1];
      if (!responseEntry) continue;

      reviews.push({
        mappingId: mapping.id,
        targetColumn: mapping.targetColumn,
        sourceAttributes: responseEntry.source_attributes ?? [],
        confidenceScore: responseEntry.confidence_score ?? 0,
        confidenceReason: responseEntry.confidence_reason ?? null,
        candidateSourceAttributes: responseEntry.candidate_source_attributes ?? [],
        unmatchedReason: responseEntry.unmatched_reason ?? null,
        preprocessingRule: responseEntry.preprocessing_rule ?? null,
        preprocessingRuleType: responseEntry.preprocessing_rule_type ?? null,
        preprocessingNlRule: responseEntry.preprocessing_nl_rule ?? null,
        processingOrder: responseEntry.processing_order ?? null,
        description: responseEntry.description ?? null,
        mappingMode: responseEntry.mapping_mode ?? "source",
        constantValue: responseEntry.constant_value ?? null,
        sourceDependencies: responseEntry.source_dependencies ?? responseEntry.source_attributes ?? [],
        valueBindingIds: responseEntry.value_binding_ids ?? [],
        transformationClassification: responseEntry.transformation_classification ?? null,
        precedentDecision: responseEntry.precedent_decision ?? null,
        precedentMappingId: responseEntry.precedent_mapping_id ?? null,
        overrideEvidence: responseEntry.override_evidence ?? [],
      });
    }

    if (reviews.length === 0 && candidateMappings.length === 1 && Object.keys(result.mappings).length === 1) {
      const mapping = candidateMappings[0];
      const responseEntry = Object.values(result.mappings)[0];
      reviews.push({
        mappingId: mapping.id,
        targetColumn: mapping.targetColumn,
        sourceAttributes: responseEntry.source_attributes ?? [],
        confidenceScore: responseEntry.confidence_score ?? mapping.confidenceScore ?? 0,
        confidenceReason: responseEntry.confidence_reason ?? null,
        candidateSourceAttributes: responseEntry.candidate_source_attributes ?? [],
        unmatchedReason: responseEntry.unmatched_reason ?? null,
        preprocessingRule: responseEntry.preprocessing_rule ?? null,
        preprocessingRuleType: responseEntry.preprocessing_rule_type ?? null,
        preprocessingNlRule: responseEntry.preprocessing_nl_rule ?? null,
        processingOrder: responseEntry.processing_order ?? null,
        description: responseEntry.description ?? mapping.description ?? null,
        mappingMode: responseEntry.mapping_mode ?? "source",
        constantValue: responseEntry.constant_value ?? null,
        sourceDependencies: responseEntry.source_dependencies ?? responseEntry.source_attributes ?? [],
        valueBindingIds: responseEntry.value_binding_ids ?? [],
        transformationClassification: responseEntry.transformation_classification ?? null,
        precedentDecision: responseEntry.precedent_decision ?? null,
        precedentMappingId: responseEntry.precedent_mapping_id ?? null,
        overrideEvidence: responseEntry.override_evidence ?? [],
      });
    }

    if (reviews.length === 0 && Object.keys(result.mappings).length === 1) {
      const [targetAttribute, responseEntry] = Object.entries(result.mappings)[0];
      const mapping = findMappingByTarget(targetAttribute);
      if (mapping) {
        reviews.push({
          mappingId: mapping.id,
          targetColumn: mapping.targetColumn,
          sourceAttributes: responseEntry.source_attributes ?? [],
          confidenceScore: responseEntry.confidence_score ?? mapping.confidenceScore ?? 0,
          confidenceReason: responseEntry.confidence_reason ?? null,
          candidateSourceAttributes: responseEntry.candidate_source_attributes ?? [],
          unmatchedReason: responseEntry.unmatched_reason ?? null,
          preprocessingRule: responseEntry.preprocessing_rule ?? null,
          preprocessingRuleType: responseEntry.preprocessing_rule_type ?? null,
          preprocessingNlRule: responseEntry.preprocessing_nl_rule ?? null,
          processingOrder: responseEntry.processing_order ?? null,
          description: responseEntry.description ?? mapping.description ?? null,
          mappingMode: responseEntry.mapping_mode ?? "source",
          constantValue: responseEntry.constant_value ?? null,
          sourceDependencies: responseEntry.source_dependencies ?? responseEntry.source_attributes ?? [],
          valueBindingIds: responseEntry.value_binding_ids ?? [],
          transformationClassification: responseEntry.transformation_classification ?? null,
          precedentDecision: responseEntry.precedent_decision ?? null,
          precedentMappingId: responseEntry.precedent_mapping_id ?? null,
          overrideEvidence: responseEntry.override_evidence ?? [],
        });
      }
    }

    return reviews;
  }

  if (!("rules" in result)) {
    return [];
  }

  const reviews: PendingAiMappingReview[] = [];
  for (const mapping of candidateMappings) {
    if (!mapping) continue;

    const responseRule = result.rules.find((rule) =>
      targetKeyVariants(rule.target_attribute).has(normalizeTargetKey(mapping.targetColumn)),
    );
    if (!responseRule) continue;

    const sourceAttributes =
      mapping.sourceColumns && mapping.sourceColumns.length
        ? mapping.sourceColumns
        : (mapping.sourceColumn ?? "")
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean);
    const inferredRuleType = inferPreprocessingRuleType(responseRule.rule);
    const nlRule = responseRule.description?.trim() || responseRule.rule.trim();

    reviews.push({
      mappingId: mapping.id,
      targetColumn: mapping.targetColumn,
      sourceAttributes,
      confidenceScore: mapping.confidenceScore ?? (sourceAttributes.length ? 0.9 : 0.72),
      confidenceReason:
        sourceAttributes.length > 0
          ? "The rule is scoped to the currently selected mapping and uses its active source context."
          : "The rule was generated from the target attribute context and still needs a source selection review.",
      candidateSourceAttributes: mapping.candidateSourceColumns ?? [],
      unmatchedReason: mapping.unmatchedReason ?? null,
      preprocessingRule: responseRule.rule,
      preprocessingRuleType: inferredRuleType,
      preprocessingNlRule: nlRule,
      processingOrder:
        mapping.loadOrder && !Number.isNaN(Number(mapping.loadOrder))
          ? Number(mapping.loadOrder)
          : null,
      description: responseRule.description ?? mapping.description ?? null,
    });
  }

  if (reviews.length === 0 && candidateMappings.length === 1 && result.rules.length === 1) {
    const mapping = candidateMappings[0];
    const responseRule = result.rules[0];
    const sourceAttributes =
      mapping.sourceColumns && mapping.sourceColumns.length
        ? mapping.sourceColumns
        : (mapping.sourceColumn ?? "")
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean);
    const inferredRuleType = inferPreprocessingRuleType(responseRule.rule);
    reviews.push({
      mappingId: mapping.id,
      targetColumn: mapping.targetColumn,
      sourceAttributes,
      confidenceScore: mapping.confidenceScore ?? (sourceAttributes.length ? 0.9 : 0.72),
      confidenceReason:
        sourceAttributes.length > 0
          ? "The rule is scoped to the current mapping context and is ready for review."
          : "The rule was generated for the current target attribute and still needs source review.",
      candidateSourceAttributes: mapping.candidateSourceColumns ?? [],
      unmatchedReason: mapping.unmatchedReason ?? null,
      preprocessingRule: responseRule.rule,
      preprocessingRuleType: inferredRuleType,
      preprocessingNlRule: responseRule.description?.trim() || responseRule.rule.trim(),
      processingOrder:
        mapping.loadOrder && !Number.isNaN(Number(mapping.loadOrder))
          ? Number(mapping.loadOrder)
          : null,
      description: responseRule.description ?? mapping.description ?? null,
    });
  }

  if (reviews.length === 0 && result.rules.length === 1) {
    const responseRule = result.rules[0];
    const mapping = findMappingByTarget(responseRule.target_attribute);
    if (mapping) {
      const sourceAttributes =
        mapping.sourceColumns && mapping.sourceColumns.length
          ? mapping.sourceColumns
          : (mapping.sourceColumn ?? "")
              .split(",")
              .map((part) => part.trim())
              .filter(Boolean);
      const inferredRuleType = inferPreprocessingRuleType(responseRule.rule);
      reviews.push({
        mappingId: mapping.id,
        targetColumn: mapping.targetColumn,
        sourceAttributes,
        confidenceScore: mapping.confidenceScore ?? (sourceAttributes.length ? 0.9 : 0.72),
        confidenceReason: "Matched the generated rule to the current target attribute for review.",
        candidateSourceAttributes: mapping.candidateSourceColumns ?? [],
        unmatchedReason: mapping.unmatchedReason ?? null,
        preprocessingRule: responseRule.rule,
        preprocessingRuleType: inferredRuleType,
        preprocessingNlRule: responseRule.description?.trim() || responseRule.rule.trim(),
        processingOrder:
          mapping.loadOrder && !Number.isNaN(Number(mapping.loadOrder))
            ? Number(mapping.loadOrder)
            : null,
        description: responseRule.description ?? mapping.description ?? null,
      });
    }
  }

  if (reviews.length === 0) {
    const narrative = extractNarrativeReviewFields(response);
    const mapping = findMappingByTarget(narrative?.targetAttribute) ?? (candidateMappings.length === 1 ? candidateMappings[0] : null);
    if (narrative?.rule) {
      const sourceAttributes =
        narrative.sourceAttributes.length > 0
          ? narrative.sourceAttributes
          : mapping?.sourceColumns && mapping.sourceColumns.length
            ? mapping.sourceColumns
            : ((mapping?.sourceColumn ?? "")
                .split(",")
                .map((part) => part.trim())
                .filter(Boolean));
      if (!mapping) {
        return reviews;
      }
      reviews.push({
        mappingId: mapping.id,
        targetColumn: mapping.targetColumn,
        sourceAttributes,
        confidenceScore: narrative.confidenceScore ?? mapping.confidenceScore ?? (sourceAttributes.length ? 0.88 : 0.72),
        confidenceReason: "Parsed from the agent response for the current mapping row and held for your approval.",
        candidateSourceAttributes: mapping.candidateSourceColumns ?? [],
        unmatchedReason: mapping.unmatchedReason ?? null,
        preprocessingRule: narrative.rule,
        preprocessingRuleType: narrative.ruleType ?? inferPreprocessingRuleType(narrative.rule),
        preprocessingNlRule: narrative.narrative,
        processingOrder:
          narrative.processingOrder ??
          (mapping.loadOrder && !Number.isNaN(Number(mapping.loadOrder))
            ? Number(mapping.loadOrder)
            : null),
        description:
          narrative.outputColumnName
            ? `AI suggestion prepared for ${mapping.targetColumn} with output column ${narrative.outputColumnName}.`
            : mapping.description ?? null,
      });
    }
  }

  return reviews;
}

function inferPreprocessingRuleType(rule: string | null | undefined): string | null {
  const trimmed = rule?.trim();
  if (!trimmed) return null;

  const upper = trimmed.toUpperCase();
  if (upper === "DIRECT") return "Direct";
  if (
    [
      "UPPER",
      "LOWER",
      "TRIM",
      "CAST",
      "COALESCE",
      "DATE_FORMAT",
      "SUBSTRING",
      "REPLACE",
      "NULLIF",
      "CONCATENATE",
    ].includes(upper)
  ) {
    return upper;
  }
  return "Custom";
}

function isStructuredSqlExpression(rule: string | null | undefined) {
  const trimmed = rule?.trim();
  if (!trimmed) return false;

  const upper = trimmed.toUpperCase();
  if (
    [
      "DIRECT",
      "UPPER",
      "LOWER",
      "TRIM",
      "CAST",
      "COALESCE",
      "DATE_FORMAT",
      "SUBSTRING",
      "REPLACE",
      "NULLIF",
      "CONCATENATE",
    ].includes(upper)
  ) {
    return false;
  }

  return /[().\s,]/.test(trimmed);
}

function applyMappingSuggestion(mapping: MappingState, suggestion: PendingAiMappingReview | {
  sourceAttributes: string[];
  confidenceScore: number;
  confidenceReason?: string | null;
  candidateSourceAttributes?: string[];
  unmatchedReason?: string | null;
  preprocessingRule?: string | null;
  preprocessingRuleType?: string | null;
  preprocessingNlRule?: string | null;
  processingOrder?: number | null;
  description?: string | null;
  usedInferenceIds?: string[];
  usedRecommendationIds?: string[];
  usedLearningIds?: string[];
  mappingMode?: "source" | "constant" | "attribute";
  constantValue?: string | null;
  attributeName?: string | null;
  sourceDependencies?: string[];
  valueBindingIds?: string[];
  transformationClassification?: string | null;
  precedentDecision?: string | null;
  precedentMappingId?: string | null;
  overrideEvidence?: string[];
}) {
  const mappingMode =
    suggestion.mappingMode === "constant"
      ? "constant"
      : suggestion.mappingMode === "attribute"
        ? "attribute"
        : "source";
  const sourceAttributes =
    mappingMode === "constant" || mappingMode === "attribute"
      ? []
      : suggestion.sourceAttributes ?? [];
  const sourceColumn = sourceAttributes.length ? sourceAttributes.join(", ") : null;
  const inferredRuleType = suggestion.preprocessingRuleType?.trim() || null;
  const inferredRule = suggestion.preprocessingRule?.trim() || null;
  const shouldPersistExpression = isStructuredSqlExpression(inferredRule);
  const shouldUseCustomRule =
    (inferredRuleType?.toUpperCase() === "CUSTOM" || inferredRuleType === null) &&
    !!inferredRule &&
    !["DIRECT", "UPPER", "LOWER", "TRIM", "CAST", "COALESCE", "DATE_FORMAT", "SUBSTRING", "REPLACE", "NULLIF", "CONCATENATE"].includes(inferredRule.toUpperCase());
  const nextRule =
    inferredRuleType === "Direct"
      ? "Direct"
      : shouldUseCustomRule
        ? "Custom"
        : inferredRuleType || inferredRule || (sourceAttributes.length ? "Direct" : "Select...");

  mapping.mappingMode = mappingMode;
  mapping.constantValue =
    mappingMode === "constant" || mappingMode === "attribute"
      ? suggestion.constantValue ?? null
      : null;
  mapping.attributeName = mappingMode === "attribute" ? suggestion.attributeName ?? null : null;
  mapping.sourceColumns = sourceAttributes;
  mapping.sourceColumn = sourceColumn;
  mapping.confidenceScore = suggestion.confidenceScore ?? 0;
  mapping.confidenceReason = suggestion.confidenceReason ?? null;
  mapping.candidateSourceColumns = suggestion.candidateSourceAttributes ?? [];
  mapping.unmatchedReason = suggestion.unmatchedReason ?? null;
  mapping.usedInferenceIds = suggestion.usedInferenceIds ?? [];
  mapping.usedRecommendationIds = suggestion.usedRecommendationIds ?? [];
  mapping.usedLearningIds = suggestion.usedLearningIds ?? [];
  mapping.aiSuggestedRule = inferredRule;
  mapping.aiSuggestedRuleType = inferredRuleType;
  mapping.rule = mappingMode === "constant" || mappingMode === "attribute" ? "Value" : nextRule;
  mapping.expression =
    mappingMode === "constant" || mappingMode === "attribute"
      ? null
      : (shouldPersistExpression ? inferredRule : null);
  mapping.nlRule = suggestion.preprocessingNlRule ?? mapping.nlRule ?? null;
  mapping.loadOrder =
    suggestion.processingOrder !== null && suggestion.processingOrder !== undefined
      ? String(suggestion.processingOrder)
      : mapping.loadOrder ?? null;
  if (!mapping.descriptionEdited) {
    mapping.description = suggestion.description ?? mapping.description ?? null;
  }
  mapping.sourceDependencies = suggestion.sourceDependencies ?? sourceAttributes;
  mapping.valueBindingIds = suggestion.valueBindingIds ?? [];
  mapping.transformationClassification = suggestion.transformationClassification ?? null;
  mapping.precedentDecision = suggestion.precedentDecision ?? null;
  mapping.precedentMappingId = suggestion.precedentMappingId ?? null;
  mapping.overrideEvidence = suggestion.overrideEvidence ?? [];
  const requiresReview =
    suggestion.precedentDecision === "unresolved" ||
    suggestion.transformationClassification === "unresolved";
  mapping.status =
    requiresReview
      ? "UNMAPPED"
      : (mappingMode === "constant" && mapping.constantValue !== null)
        || (mappingMode === "attribute" && Boolean(mapping.attributeName))
        ? "MAPPED"
        : sourceAttributes.length > 0
        ? "MAPPED"
        : "UNMAPPED";
}

function normalizeSemanticContextItems(
  items: Array<Record<string, unknown>> | SemanticContextItem[] | null | undefined,
): SemanticContextItem[] | null {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }
  return items as SemanticContextItem[];
}

function applySemanticRefreshToState(
  state: SttmBuilderState,
  refresh: SemanticRefreshResult,
) {
  state.semanticBundleId = refresh.bundle_id;
  state.semanticBundleLabel = refresh.bundle_label ?? state.semanticBundleLabel;
  state.semanticLevel = refresh.achieved_level ?? state.semanticLevel;
  state.semanticStatus = refresh.status ?? state.semanticStatus;
  state.semanticViewName = refresh.semantic_view_name ?? null;
  state.semanticContextSummary = refresh.summary ?? state.semanticContextSummary;
  state.semanticContextItems =
    normalizeSemanticContextItems(refresh.semantic_context) ?? state.semanticContextItems;
  state.semanticLineage = Array.isArray(refresh.lineage) ? refresh.lineage : state.semanticLineage;
  state.semanticDatahubContext = refresh.datahub_context ?? state.semanticDatahubContext;
  state.datahubStatus =
    typeof refresh.datahub_context?.status === "string"
      ? refresh.datahub_context.status
      : state.datahubStatus;
}

function extractSemanticViewNameFromStatus(
  status: Record<string, unknown> | null | undefined,
  fallback: string | null,
): string | null {
  if (!status || typeof status !== 'object') {
    return fallback;
  }
  if (!Object.prototype.hasOwnProperty.call(status, 'semantic_view_name')) {
    return fallback;
  }
  const value = status.semantic_view_name;
  return typeof value === 'string' && value.trim() ? value : null;
}

function normalizeSemanticIdentifier(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function estimateAutoMapComplexity(
  targetAttribute: string,
  sourceColumnNames: string[],
): number {
  const targetKey = normalizeSemanticIdentifier(targetAttribute);
  if (!targetKey) {
    return 99;
  }
  const normalizedSources = sourceColumnNames.map((name) => normalizeSemanticIdentifier(name));
  if (normalizedSources.includes(targetKey)) {
    return 0;
  }
  if (normalizedSources.some((name) => name.endsWith(targetKey) || targetKey.endsWith(name))) {
    return 1;
  }
  if (normalizedSources.some((name) => name.includes(targetKey) || targetKey.includes(name))) {
    return 2;
  }
  return 3;
}

function extractAutoMappingReview(
  response: STTMBuilderEnvelopeResponse,
): AutoMappingReview | null {
  const value = (response.meta as Record<string, unknown> | undefined)?.auto_mapping_review;
  if (!value || typeof value !== "object") return null;
  const review = value as Partial<AutoMappingReview>;
  if (typeof review.headline !== "string" || !Array.isArray(review.recommendations)) {
    return null;
  }
  return review as AutoMappingReview;
}

function formatAutoMappingReview(review: AutoMappingReview): string {
  const actionRequired = review.recommendations.filter((item) => item.severity === "action_required");
  const needsReview = review.recommendations.filter((item) => item.severity === "review");
  const mappedReviewTargets = new Set(needsReview.map((item) => item.target_attribute));
  const completedWithoutReview =
    review.completed_without_review_count ?? Math.max(0, review.mapped_count - mappedReviewTargets.size);
  const lines = [
    "## Auto-map result",
    "",
    `- **Mapped:** ${review.mapped_count} of ${review.total_count}`,
    `- **Completed with no issue detected:** ${completedWithoutReview}`,
    `- **Mapped but needs review:** ${review.mapped_with_review_count ?? mappedReviewTargets.size}`,
    `- **Still needs input:** ${review.action_required_count ?? review.unresolved_count}`,
  ];
  if (review.missing_derived_output_count > 0) {
    lines.push(
      "",
      "Historical learning was used as evidence only. It was not applied where the current source or derived-source contract does not expose the required output.",
    );
  }

  const appendRecommendationSection = (
    title: string,
    items: AutoMappingReview["recommendations"],
  ) => {
    if (!items.length) return;
    lines.push("", `## ${title}`);
    const byTarget = new Map<string, typeof items>();
    for (const item of items) {
      byTarget.set(item.target_attribute, [...(byTarget.get(item.target_attribute) ?? []), item]);
    }
    for (const [target, targetItems] of byTarget.entries()) {
      const candidates = Array.from(new Set(targetItems.flatMap((item) => item.candidate_sources))).slice(0, 4);
      const evidence = Array.from(new Set(targetItems.flatMap((item) => item.evidence_ids)));
      lines.push(
        "",
        `### ${target}`,
        `- **Issue:** ${targetItems.map((item) => item.title).join("; ")}`,
        `- **Why:** ${targetItems.map((item) => item.detail).filter(Boolean).join(" ")}`,
        `- **Next step:** ${targetItems.map((item) => item.recommended_action).join(" ")}`,
      );
      if (candidates.length) {
        lines.push(`- **Candidate sources:** ${candidates.join(", ")}`);
      }
      if (evidence.length) {
        const visibleEvidence = evidence.slice(0, 3);
        const remaining = evidence.length - visibleEvidence.length;
        lines.push(
          `- **Evidence:** ${visibleEvidence.join(", ")}${remaining > 0 ? ` (+${remaining} more)` : ""}`,
        );
      }
    }
  };

  appendRecommendationSection("Action required", actionRequired);
  appendRecommendationSection("Review before publishing", needsReview);

  if (!review.recommendations.length) {
    lines.push(
      "",
      "## Next check",
      "",
      "Preview representative data and review complex preprocessing rules before publishing.",
    );
  } else {
    lines.push(
      "",
      "## What is not listed",
      "",
      "Mappings counted as completed with no issue are not repeated above. Recommendations contain only unresolved items, missing source outputs, low-confidence mappings, or changes from linked precedent.",
    );
  }
  return lines.join("\n");
}

// ─── cache metadata ───────────────────────────────────────────────
export interface CacheMetadata {
  databasesFetchedAt: string | null;
  derivedSourcesFetchedAt: string | null;
}

const CACHE_FRESHNESS_MS = 5 * 60 * 1000; // 5 minutes

function isCacheFresh(fetchedAt: string | null): boolean {
  if (!fetchedAt) return false;
  const fetchTime = new Date(fetchedAt).getTime();
  return Date.now() - fetchTime < CACHE_FRESHNESS_MS;
}

// ─── state shape ───────────────────────────────────────────────────
type SttmBuilderState = {
  sourceDatabases: DatabaseNode[];
  targetDatabases: DatabaseNode[];
  cacheMetadata: CacheMetadata;

  sources: TableNode[];
  targets: TableNode[];
  sourceInfo: SourceTargetInfo;
  targetInfo: SourceTargetInfo;

  sourceAttributeGroups: ColumnGroup[];
  targetAttributeGroup: ColumnGroup | null;

  mappingSuggestions: MappingSuggestion[];
  mappingLoading: boolean;

  chatMessages: ChatMessage[];
  chatLoading: boolean;
  assistantSignals: AssistantSignal[];
  assistantInferences: AssistantInferenceRecord[];
  assistantPreferences: AssistantPreferenceState;
  assistantUnreadCount: number;
  firRecommendations: FIRRecommendation[];
  firPrimaryQuestion: FIRRecommendation | null;
  firRecommendationLoading: boolean;
  firRecommendationCheckpoint: string | null;
  firRecommendationContextKey: string | null;
  mappingIntent: MappingIntent | null;
  agentThreadId: string | null;
  agentLogicalConversationId: string | null;
  agentPhysicalThreadSegment: number | null;
  agentParentMessageId: number | null;
  semanticBundleId: string | null;
  semanticBundleHash: string | null;
  learningContextId: string | null;
  learningContextHash: string | null;
  workspaceContextId: string | null;
  workspaceContextHash: string | null;
  workspaceContextSnapshotHash: string | null;
  workspaceContextPendingSnapshotHash: string | null;
  workspaceContextStatus: "idle" | "updating" | "ready" | "partial" | "failed";
  workspaceContextCacheStatus: string | null;
  workspaceContextError: string | null;
  semanticBundleLabel: string | null;
  semanticLevel: string | null;
  semanticStatus: string | null;
  semanticViewName: string | null;
  semanticContextSummary: Record<string, unknown> | null;
  semanticContextItems: SemanticContextItem[] | null;
  semanticLineage: Array<Record<string, unknown>>;
  semanticDatahubContext: Record<string, unknown> | null;
  datahubStatus: string | null;
  pendingDerivedSourceDraft: PendingDerivedSourceDraft | null;
  derivedSourceDraftRequested: boolean;

  session: UserSession | null;

  loadState: BuilderLoadState;
  errorState: BuilderErrorState;

  drivingTableId: string | null;
  relationships: JoinConfig[];
  relationshipCandidates: JoinConfig[];
  derivedSources: DerivedSource[];

  sourceFilterSql: string;
  sourceFilterGroups: RuleGroup[];
  sourceQuerySql: string;
  sourceGroupBySql: string;
  sourceOrderBySql: string;

  mappings: MappingState[];
  selectedMappingIds: string[];
  mappingSql: string;
  mappingPreviewSql: string;
  mappingSqlVariant: "original" | "optimized" | null;
  compiledMappingSql: string;
  compiledMappingPreviewSql: string;
  compiledMappingContextHash: string | null;
  isPreProcessModalOpen: boolean;
  activeMappingId: string | null;
  pendingAiMappingReviews: PendingAiMappingReview[];
  autoMapStatusMessage: string | null;
  autoMapProcessingIds: string[];

  // Active STTM context — which saved STTM is currently loaded in the builder.
  activeSttmId: string | null;
  activeProjectId: string | null;
  activeSttmName: string | null;
  activeProjectName: string | null;
  activeSnapshotId: string | null;
  sessionSavedAt: string | null;

  // Tracks the async "open STTM from backend" lifecycle so the UI can show loading/error states.
  openSttmStatus: 'idle' | 'loading' | 'success' | 'error';
  openSttmTargetPage: string | null;
  openSttmErrorMessage: string | null;
  openSttmRequestId: string | null;
  attributeRequestIds: { source: string | null; target: string | null };
  relationshipRequestId: string | null;
};

export function snapshotFromState(
  state: SttmBuilderState,
  action: WorkbenchCheckpoint,
  options: {
    page?: string;
    surface?: string;
    milestone?: string;
    semanticBundleId?: string | null;
    semanticViewName?: string | null;
    scopeType?: "project" | "schema" | "table" | "table_set" | "target" | "mapping" | "column" | "derived_source" | null;
    candidateAction?: string | null;
    browsingContext?: {
      side?: "source" | "target" | null;
      database?: string | null;
      schema?: string | null;
      visible_candidate_tables?: string[];
      search_text?: string | null;
    } | null;
  } = {},
) {
  const selectedSources = resolveSelectedSourceTables(state);
  const target = resolveSelectedTargetTable(state) ?? null;
  return buildWorkbenchContextSnapshot({
    action,
    milestone: options.milestone,
    page: options.page ?? (state.targetAttributeGroup ? "mapping" : "builder"),
    surface: options.surface ?? (state.targetAttributeGroup ? "MAPPING" : "SOURCE_SELECTION"),
    sessionId: state.session ? String(state.session.user_id) : null,
    threadId: state.agentThreadId,
    projectId: state.activeProjectId,
    projectName: state.activeProjectName,
    sttmId: state.activeSttmId,
    sttmName: state.activeSttmName,
    mappingLifecycle: state.mappingIntent?.lifecycle ?? (state.activeSttmId ? "update" : "new"),
    businessGoal: state.mappingIntent?.business_goal ?? state.mappingIntent?.target_outcome ?? null,
    sourceTables: selectedSources,
    targetTable: target,
    drivingTableId: state.drivingTableId,
    sourceAttributeGroups: state.sourceAttributeGroups,
    derivedSources: state.derivedSources,
    relationships: state.relationships,
    sourceFilterSql: state.sourceFilterSql,
    sourceQuerySql: state.sourceQuerySql,
    sourceGroupBySql: state.sourceGroupBySql,
    sourceOrderBySql: state.sourceOrderBySql,
    sourceFilterGroups: state.sourceFilterGroups,
    mappings: state.mappings,
    selectedMappingIds: state.selectedMappingIds,
    activeMappingId: state.activeMappingId,
    mappingSql: state.mappingSql,
    mappingPreviewSql: state.mappingPreviewSql,
    compiledMappingSql: state.compiledMappingSql,
    compiledMappingPreviewSql: state.compiledMappingPreviewSql,
    compiledMappingContextHash: state.compiledMappingContextHash,
    mappingIntent: state.mappingIntent,
    semanticBundleId: options.semanticBundleId ?? state.semanticBundleId,
    semanticBundleLabel: state.semanticBundleLabel,
    semanticLevel: state.semanticLevel,
    semanticStatus: state.semanticStatus,
    semanticViewName: options.semanticViewName ?? state.semanticViewName,
    semanticLineage: state.semanticLineage,
    conversationHistory: state.chatMessages,
    scopeType: options.scopeType,
    candidateAction: options.candidateAction,
    browsingContext: options.browsingContext,
  });
}

function stablePreparedContextValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stablePreparedContextValue).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stablePreparedContextValue(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function compactPreparedContextHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `wdep_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function preparedWorkspaceSnapshot(
  workspace: Record<string, unknown>,
): {
  workspace: Record<string, unknown>;
  dependencyHash: string;
} {
  const preparedWorkspace: Record<string, unknown> = {
    ...workspace,
    // Conversation narrative is checkpointed separately and must never
    // invalidate semantic/FIR context.
    conversation_history: [],
  };
  const filters = (preparedWorkspace.filters ?? {}) as Record<string, unknown>;
  const mappingSql = String(
    preparedWorkspace.compiled_mapping_sql
      ?? preparedWorkspace.raw_mapping_sql
      ?? preparedWorkspace.mapping_sql
      ?? "",
  );
  const dependency = {
    project_id: preparedWorkspace.project_id ?? null,
    sttm_id: preparedWorkspace.sttm_id ?? null,
    source_set_hash: preparedWorkspace.source_set_hash ?? null,
    derived_set_hash: preparedWorkspace.derived_set_hash ?? null,
    source_tables: preparedWorkspace.source_tables ?? [],
    target_table: preparedWorkspace.target_table ?? null,
    driving_table: preparedWorkspace.driving_table ?? null,
    selected_columns_by_table: preparedWorkspace.selected_columns_by_table ?? {},
    derived_sources: preparedWorkspace.derived_sources ?? [],
    relationships: preparedWorkspace.relationships ?? [],
    relation_graph: preparedWorkspace.relation_graph ?? null,
    mapping_intent: preparedWorkspace.mapping_intent ?? null,
    mapping_rows: preparedWorkspace.mapping_rows ?? [],
    filters: {
      filter_sql: filters.filter_sql ?? null,
      base_query_sql: filters.base_query_sql ?? null,
      group_by_sql: filters.group_by_sql ?? null,
      order_by_sql: filters.order_by_sql ?? null,
      groups: filters.groups ?? [],
    },
    mapping_sql: mappingSql,
  };
  return {
    workspace: preparedWorkspace,
    dependencyHash: compactPreparedContextHash(
      stablePreparedContextValue(dependency),
    ),
  };
}

export type PersistedSttmBuilderSession = {
  sourceDatabases: DatabaseNode[];
  targetDatabases: DatabaseNode[];
  cacheMetadata?: CacheMetadata;
  sources: TableNode[];
  targets: TableNode[];
  sourceInfo: SourceTargetInfo;
  targetInfo: SourceTargetInfo;
  sourceAttributeGroups: ColumnGroup[];
  targetAttributeGroup: ColumnGroup | null;
  mappingSuggestions: MappingSuggestion[];
  chatMessages: ChatMessage[];
  assistantSignals: AssistantSignal[];
  assistantInferences: AssistantInferenceRecord[];
  assistantUnreadCount: number;
  firRecommendations?: FIRRecommendation[];
  firPrimaryQuestion?: FIRRecommendation | null;
  firRecommendationLoading?: boolean;
  firRecommendationCheckpoint?: string | null;
  firRecommendationContextKey?: string | null;
  mappingIntent: MappingIntent | null;
  agentThreadId: string | null;
  agentLogicalConversationId?: string | null;
  agentPhysicalThreadSegment?: number | null;
  agentParentMessageId: number | null;
  semanticBundleId: string | null;
  semanticBundleHash?: string | null;
  learningContextId?: string | null;
  learningContextHash?: string | null;
  workspaceContextId?: string | null;
  workspaceContextHash?: string | null;
  workspaceContextSnapshotHash?: string | null;
  workspaceContextPendingSnapshotHash?: string | null;
  workspaceContextStatus?: "idle" | "updating" | "ready" | "partial" | "failed";
  workspaceContextCacheStatus?: string | null;
  workspaceContextError?: string | null;
  semanticBundleLabel: string | null;
  semanticLevel: string | null;
  semanticStatus: string | null;
  semanticViewName: string | null;
  semanticContextSummary: Record<string, unknown> | null;
  semanticContextItems: SemanticContextItem[] | null;
  semanticLineage: Array<Record<string, unknown>>;
  semanticDatahubContext: Record<string, unknown> | null;
  datahubStatus: string | null;
  pendingDerivedSourceDraft: PendingDerivedSourceDraft | null;
  derivedSourceDraftRequested: boolean;
  drivingTableId: string | null;
  relationships: JoinConfig[];
  derivedSources: DerivedSource[];
  sourceFilterSql: string;
  sourceFilterGroups: RuleGroup[];
  sourceQuerySql: string;
  sourceGroupBySql: string;
  sourceOrderBySql: string;
  mappings: MappingState[];
  selectedMappingIds: string[];
  mappingSql: string;
  mappingPreviewSql: string;
  mappingSqlVariant: "original" | "optimized" | null;
  compiledMappingSql: string;
  compiledMappingPreviewSql: string;
  compiledMappingContextHash: string | null;
  isPreProcessModalOpen: boolean;
  activeMappingId: string | null;
  pendingAiMappingReviews: PendingAiMappingReview[];
  // Active STTM identity — persisted so the builder knows which STTM it's editing after refresh.
  activeSttmId: string | null;
  activeProjectId: string | null;
  activeSttmName: string | null;
  activeProjectName: string | null;
  activeSnapshotId?: string | null;
  sessionSavedAt: string | null;
};

const autoMapBatchesInitialized = createAction<{
  totalCount: number;
}>("sttmBuilder/autoMapBatchesInitialized");

const autoMapBatchStarted = createAction<{
  processingIds: string[];
  processedCount: number;
  totalCount: number;
}>("sttmBuilder/autoMapBatchStarted");

const autoMapBatchApplied = createAction<{
  response: STTMBuilderEnvelopeResponse;
  completedMappingIds: string[];
  processedCount: number;
  totalCount: number;
}>("sttmBuilder/autoMapBatchApplied");

const autoMapBatchFailed = createAction<{
  completedMappingIds: string[];
  processedCount: number;
  totalCount: number;
  errorMessage: string;
}>("sttmBuilder/autoMapBatchFailed");

function mergeDerivedSourceLists(
  existing: DerivedSource[],
  incoming: DerivedSource[],
): DerivedSource[] {
  const existingById = new Map(existing.map((source) => [source.id, source]));
  const mergedIncoming = incoming.map((source) => {
    const current = existingById.get(source.id);
    return {
      ...source,
      // Catalog refreshes describe availability, not workspace selection.
      // Preserve the snapshot/UI choice when the same derived source already
      // exists in the active workspace.
      isSelected: current?.isSelected ?? source.isSelected ?? false,
    };
  });
  const incomingIds = new Set(mergedIncoming.map((source) => source.id));
  const localOnly = existing.filter((source) => !incomingIds.has(source.id));
  return [...mergedIncoming, ...localOnly];
}

function cloneRuleNode(node: RuleGroup | RuleCondition): RuleGroup | RuleCondition {
  if (node.type === "condition") {
    return { ...node };
  }
  return {
    ...node,
    children: node.children.map((child) => cloneRuleNode(child)) as Array<RuleGroup | RuleCondition>,
  };
}

function cloneRuleGroups(groups: RuleGroup[]) {
  return groups.map((group) => cloneRuleNode(group) as RuleGroup);
}

function extractAssistantDisplayText(
  response: STTMBuilderEnvelopeResponse,
  pendingReviews: PendingAiMappingReview[] = [],
): string {
  if (pendingReviews.length > 0) {
    return buildReviewSummary(response, pendingReviews);
  }

  const resolved = resolveAgentResponseParts(response);
  const artifact = resolved.artifact;
  const artifactAnswerText =
    artifact && typeof artifact.answer_text === "string" ? artifact.answer_text.trim() : "";
  const rootMessage = resolved.message;

  if (resolved.artifactType === "derived_source_draft" && artifact && typeof artifact === "object") {
    const sqlText =
      typeof artifact.sql_text === "string" ? artifact.sql_text.trim() : "";
    const sourceNameSuggestion =
      typeof artifact.source_name_suggestion === "string"
        ? artifact.source_name_suggestion.trim()
        : "";
    const semanticViewName =
      typeof artifact.semantic_view_name === "string"
        ? artifact.semantic_view_name.trim()
        : "";
    const previewRows = Array.isArray(artifact.preview_rows) ? artifact.preview_rows : [];
    const requestSummary =
      typeof artifact.request_summary === "string" ? artifact.request_summary.trim() : "";
    const detailText =
      artifactAnswerText ||
      (rootMessage.includes("{")
        ? rootMessage.slice(0, rootMessage.indexOf("{")).trim()
        : rootMessage);
    const lines = ["## Derived Source Ready"];

    if (requestSummary) {
      lines.push(`- **What I generated:** ${requestSummary}`);
    } else if (detailText && !looksLikeEmbeddedAgentEnvelope(detailText)) {
      lines.push(`- **What I generated:** ${detailText}`);
    }
    if (sourceNameSuggestion) {
      lines.push(`- **Suggested derived source name:** ${sourceNameSuggestion}`);
    }
    if (semanticViewName) {
      lines.push(`- **Semantic view used:** ${semanticViewName}`);
    }
    if (sqlText) {
      lines.push(`- **SQL shape:** ${previewRows.length > 0 ? `Validated with ${previewRows.length} preview row${previewRows.length === 1 ? "" : "s"}.` : "SQL draft is ready to review and save in the derived-source builder."}`);
      lines.push("- **Business use:** Reuse this curated source in the next mapping step with the joins, filters, and selected attributes already preserved.");
    }
    lines.push("Open it below to review the generated SQL, validate it, and save it through the existing derived-source flow.");
    return lines.join("\n");
  }

  if (resolved.artifactType === "analyst_answer" && artifact && typeof artifact === "object") {
    const sqlText = typeof artifact.sql_text === "string" ? artifact.sql_text.trim() : "";
    const previewRows = Array.isArray(artifact.preview_rows)
      ? artifact.preview_rows.filter(
          (row): row is Record<string, unknown> =>
            typeof row === "object" && row !== null && !Array.isArray(row),
        )
      : [];
    const lines = [
      artifactAnswerText || rootMessage || "## Query result",
    ];
    if (previewRows.length > 0) {
      const columns = Object.keys(previewRows[0]).slice(0, 8);
      const safeCell = (value: unknown) =>
        String(value ?? "")
          .replaceAll("|", "\\|")
          .replace(/\r?\n/g, " ")
          .slice(0, 160);
      lines.push(
        "",
        "### Sample results",
        `| ${columns.map(safeCell).join(" | ")} |`,
        `| ${columns.map(() => "---").join(" | ")} |`,
        ...previewRows
          .slice(0, 5)
          .map((row) => `| ${columns.map((column) => safeCell(row[column])).join(" | ")} |`),
      );
    }
    if (sqlText) {
      lines.push("", "### SQL used", "```sql", sqlText, "```");
    }
    return lines.join("\n");
  }

  const candidates = [artifactAnswerText, rootMessage].filter(Boolean);
  if (!candidates.length) return "Done.";

  const firstReadable = candidates.find(
    (candidate) => !looksLikeEmbeddedAgentEnvelope(candidate),
  );

  if (firstReadable) {
    return firstReadable;
  }

  if (resolved.artifactType === "transformation_rules") {
    return "I generated a transformation suggestion. Review it below and approve before I apply it.";
  }
  if (resolved.artifactType === "source_mapping") {
    return "I generated a mapping suggestion. Review it below and approve before I apply it.";
  }

  return "Done.";
}

const initialLoadState: BuilderLoadState = {
  initial: "idle",
  schemasByDb: {},
  tablesBySchema: {},
  attributes: "idle",
  relationships: "idle",
  autoMap: "idle",
  chat: "idle",
};

const initialErrorState: BuilderErrorState = {
  schemasByDb: {},
  tablesBySchema: {},
};

const STTM_ASSISTANT_WELCOME: ChatMessage = {
  id: "sttm-assistant-welcome",
  role: "assistant",
  content: "",
  options: [
    "Recommend the best derived sources for this selection",
    "Explain the selected table relationships",
    "Assess whether this selection is ready for mapping",
  ],
};

const LEGACY_ASSISTANT_WELCOME =
  "Hi! I'm your STTM AI Assistant. Ask me about mapping, tables, or next steps.";

function currentAssistantWelcome(): ChatMessage {
  return {
    ...STTM_ASSISTANT_WELCOME,
    options: [...(STTM_ASSISTANT_WELCOME.options ?? [])],
  };
}

function upgradeAssistantWelcome(messages: ChatMessage[]): ChatMessage[] {
  if (!messages.length) return [currentAssistantWelcome()];
  const next: ChatMessage[] = messages.map((message) => ({
    ...message,
    options: message.options ? [...message.options] : undefined,
  }));
  if (
    next[0]?.role === "assistant" &&
    (
      next[0].content.trim() === LEGACY_ASSISTANT_WELCOME
      || next[0].content.includes(
        "I can use the selected source and target semantics",
      )
    )
  ) {
    next[0] = currentAssistantWelcome();
  }
  return next;
}

const initialState: SttmBuilderState = {
  sourceDatabases: [],
  targetDatabases: [],
  cacheMetadata: {
    databasesFetchedAt: null,
    derivedSourcesFetchedAt: null,
  },

  sources: [],
  targets: [],
  sourceInfo: { dbName: "", schemaName: "" },
  targetInfo: { dbName: "", schemaName: "" },

  sourceAttributeGroups: [],
  targetAttributeGroup: null,

  mappingSuggestions: [],
  mappingLoading: false,

  chatMessages: [currentAssistantWelcome()],
  chatLoading: false,
  assistantSignals: [],
  assistantInferences: [],
  assistantPreferences: {
    feedback_enabled: true,
    recommendations_enabled: true,
  },
  assistantUnreadCount: 0,
  firRecommendations: [],
  firPrimaryQuestion: null,
  firRecommendationLoading: false,
  firRecommendationCheckpoint: null,
  firRecommendationContextKey: null,
  mappingIntent: null,
  agentThreadId: null,
  agentLogicalConversationId: null,
  agentPhysicalThreadSegment: null,
  agentParentMessageId: null,
  semanticBundleId: null,
  semanticBundleHash: null,
  learningContextId: null,
  learningContextHash: null,
  workspaceContextId: null,
  workspaceContextHash: null,
  workspaceContextSnapshotHash: null,
  workspaceContextPendingSnapshotHash: null,
  workspaceContextStatus: "idle",
  workspaceContextCacheStatus: null,
  workspaceContextError: null,
  semanticBundleLabel: null,
  semanticLevel: null,
  semanticStatus: null,
  semanticViewName: null,
  semanticContextSummary: null,
  semanticContextItems: null,
  semanticLineage: [],
  semanticDatahubContext: null,
  datahubStatus: null,
  pendingDerivedSourceDraft: null,
  derivedSourceDraftRequested: false,

  session: null,

  loadState: initialLoadState,
  errorState: initialErrorState,

  drivingTableId: null,
  relationships: [],
  relationshipCandidates: [],
  derivedSources: [],

  sourceFilterSql: "",
  sourceFilterGroups: [],
  sourceQuerySql: "",
  sourceGroupBySql: "",
  sourceOrderBySql: "",

  mappings: [],
  selectedMappingIds: [],
  mappingSql: "",
  mappingPreviewSql: "",
  mappingSqlVariant: null,
  compiledMappingSql: "",
  compiledMappingPreviewSql: "",
  compiledMappingContextHash: null,
  isPreProcessModalOpen: false,
  activeMappingId: null,
  pendingAiMappingReviews: [],
  autoMapStatusMessage: null,
  autoMapProcessingIds: [],

  activeSttmId: null,
  activeProjectId: null,
  activeSttmName: null,
  activeProjectName: null,
  activeSnapshotId: null,
  sessionSavedAt: null,

  openSttmStatus: 'idle',
  openSttmTargetPage: null,
  openSttmErrorMessage: null,
  openSttmRequestId: null,
  attributeRequestIds: { source: null, target: null },
  relationshipRequestId: null,
};

function applyAutoMapResponseToState(
  state: SttmBuilderState,
  response: STTMBuilderEnvelopeResponse,
) {
  state.semanticBundleId = response.data?.semantic_refresh_status?.bundle_id ?? state.semanticBundleId;
  state.semanticBundleLabel =
    (response.data?.semantic_refresh_status?.bundle_label as string | undefined) ??
    (typeof response.data?.artifact?.summary === "object" &&
    response.data?.artifact?.summary &&
    "bundle_label" in response.data.artifact.summary
      ? (response.data.artifact.summary.bundle_label as string | null)
      : state.semanticBundleLabel);
  state.semanticLevel = response.data?.semantic_level_achieved ?? state.semanticLevel;
  state.semanticStatus = response.data?.semantic_refresh_status?.status ?? state.semanticStatus;
  state.semanticViewName = extractSemanticViewNameFromStatus(
    response.data?.semantic_refresh_status as Record<string, unknown> | undefined,
    state.semanticViewName,
  );
  state.semanticContextSummary =
    response.data?.artifact_type === "semantic_context"
      ? (response.data?.artifact as Record<string, unknown> | null) ?? state.semanticContextSummary
      : state.semanticContextSummary;
  state.semanticContextItems =
    normalizeSemanticContextItems(
      response.context?.semantic_context as Array<Record<string, unknown>> | undefined,
    ) ?? state.semanticContextItems;
  state.semanticLineage = Array.isArray(response.context?.derived_source_lineage)
    ? response.context.derived_source_lineage
    : state.semanticLineage;
  state.semanticDatahubContext =
    (response.context?.datahub_context as Record<string, unknown> | null | undefined) ??
    state.semanticDatahubContext;

  const result = response.result;
  const mappings =
    result && "mappings" in result
      ? result.mappings
      : {};
  const entries = Object.entries(mappings as Record<
    string,
    {
      source_attributes?: string[];
      confidence_score?: number;
      confidence_reason?: string | null;
      candidate_source_attributes?: string[];
      unmatched_reason?: string | null;
      preprocessing_rule?: string | null;
      preprocessing_rule_type?: string | null;
      preprocessing_nl_rule?: string | null;
      processing_order?: number | null;
      description?: string | null;
      used_inference_ids?: string[];
      used_recommendation_ids?: string[];
      used_learning_ids?: string[];
      mapping_mode?: "source" | "constant" | "attribute";
      constant_value?: string | null;
      attribute_name?: string | null;
      source_dependencies?: string[];
      value_binding_ids?: string[];
      transformation_classification?: string | null;
      precedent_decision?: string | null;
      precedent_mapping_id?: string | null;
      override_evidence?: string[];
    }
  >);
  const overrideReviews = buildPendingAiMappingReviews(
    state.mappings,
    [],
    null,
    response,
  ).filter((review) => review.precedentDecision === "override_precedent");

  for (const [target, val] of entries) {
    const existing = state.mappingSuggestions.find(
      (item) => normalizeTargetKey(item.targetAttribute) === normalizeTargetKey(target),
    );
    const nextSuggestion = {
      targetAttribute: target,
      sourceAttributes: val?.source_attributes ?? [],
      confidenceScore: val?.confidence_score ?? 0,
      confidenceReason: val?.confidence_reason ?? null,
      candidateSourceAttributes: val?.candidate_source_attributes ?? [],
      unmatchedReason: val?.unmatched_reason ?? null,
      preprocessingRule: val?.preprocessing_rule ?? null,
      preprocessingRuleType: val?.preprocessing_rule_type ?? null,
      preprocessingNlRule: val?.preprocessing_nl_rule ?? null,
      processingOrder: val?.processing_order ?? null,
      description: val?.description ?? null,
      usedInferenceIds: val?.used_inference_ids ?? [],
      usedRecommendationIds: val?.used_recommendation_ids ?? [],
      usedLearningIds: val?.used_learning_ids ?? [],
      mappingMode: val?.mapping_mode ?? "source",
      constantValue: val?.constant_value ?? null,
      attributeName: val?.attribute_name ?? null,
      sourceDependencies: val?.source_dependencies ?? val?.source_attributes ?? [],
      valueBindingIds: val?.value_binding_ids ?? [],
      transformationClassification: val?.transformation_classification ?? null,
      precedentDecision: val?.precedent_decision ?? null,
      precedentMappingId: val?.precedent_mapping_id ?? null,
      overrideEvidence: val?.override_evidence ?? [],
    };
    if (existing) {
      Object.assign(existing, nextSuggestion);
    } else {
      state.mappingSuggestions.push(nextSuggestion);
    }
  }

  for (const mapping of state.mappings) {
    const match = entries.find(([target]) =>
      targetKeyVariants(target).has(normalizeTargetKey(mapping.targetColumn)),
    );
    if (!match) continue;
    const [, val] = match;
    if (val?.precedent_decision === "override_precedent") {
      const review = overrideReviews.find((item) => item.mappingId === mapping.id);
      if (review) {
        const existingIndex = state.pendingAiMappingReviews.findIndex(
          (item) => item.mappingId === review.mappingId,
        );
        if (existingIndex >= 0) {
          state.pendingAiMappingReviews[existingIndex] = review;
        } else {
          state.pendingAiMappingReviews.push(review);
        }
      }
      continue;
    }
    applyMappingSuggestion(mapping, {
      sourceAttributes: val?.source_attributes ?? [],
      confidenceScore: val?.confidence_score ?? 0,
      confidenceReason: val?.confidence_reason ?? null,
      candidateSourceAttributes: val?.candidate_source_attributes ?? [],
      unmatchedReason: val?.unmatched_reason ?? null,
      preprocessingRule: val?.preprocessing_rule ?? null,
      preprocessingRuleType: val?.preprocessing_rule_type ?? null,
      preprocessingNlRule: val?.preprocessing_nl_rule ?? null,
      processingOrder: val?.processing_order ?? null,
      description: val?.description ?? null,
      usedInferenceIds: val?.used_inference_ids ?? [],
      usedRecommendationIds: val?.used_recommendation_ids ?? [],
      usedLearningIds: val?.used_learning_ids ?? [],
      mappingMode: val?.mapping_mode ?? "source",
      constantValue: val?.constant_value ?? null,
      attributeName: val?.attribute_name ?? null,
      sourceDependencies: val?.source_dependencies ?? val?.source_attributes ?? [],
      valueBindingIds: val?.value_binding_ids ?? [],
      transformationClassification: val?.transformation_classification ?? null,
      precedentDecision: val?.precedent_decision ?? null,
      precedentMappingId: val?.precedent_mapping_id ?? null,
      overrideEvidence: val?.override_evidence ?? [],
    });
  }

  if (response.message) {
    state.chatMessages.push({ role: "assistant", content: response.message });
  }
}

function applyAssistantSignalsData(
  state: SttmBuilderState,
  payload: {
    settings: AssistantPreferenceState;
    signals: AssistantSignal[];
    inferences: AssistantInferenceRecord[];
    unread_count: number;
    mapping_intent?: MappingIntent | null;
  },
) {
  state.assistantPreferences = payload.settings;
  state.assistantSignals = payload.signals;
  state.assistantInferences = payload.inferences;
  state.assistantUnreadCount = payload.unread_count;
  state.mappingIntent = payload.mapping_intent ?? state.mappingIntent;
}

// ─── async thunks ──────────────────────────────────────────────────

/** Fetch database list (+ session). Cached: won't refetch if data is fresh (< 5 minutes old). */
export const fetchDatabases = createAsyncThunk(
  "sttmBuilder/fetchDatabases",
  async (_, { rejectWithValue }) => {
    try {
      const [databases, userSession] = await Promise.all([
        dbService.getExplorerData(),
        authService.getSession().catch(() => null),
      ]);
      return { databases, session: userSession, fetchedAt: new Date().toISOString() };
    } catch (err) {
      return rejectWithValue(getErrorMessage(err, "Unable to load databases."));
    }
  },
  {
    condition: (_, { getState }) => {
      const state = (getState() as { sttmBuilder: SttmBuilderState }).sttmBuilder;
      // Skip if currently loading
      if (state.loadState.initial === "loading") return false;
      // Skip if data is fresh (less than 5 minutes old)
      if (state.loadState.initial === "success" && isCacheFresh(state.cacheMetadata.databasesFetchedAt)) {
        return false;
      }
      return true;
    },
  }
);

/** Fetch schemas for a specific database. Cached per db via schemasLoaded flag. */
export const fetchSchemas = createAsyncThunk(
  "sttmBuilder/fetchSchemas",
  async (
    { type, dbId }: { type: "source" | "target"; dbId: string },
    { rejectWithValue }
  ) => {
    try {
      const schemas = await dbService.getDatabaseSchemas(dbId);
      return { type, dbId, schemas };
    } catch (err) {
      return rejectWithValue({
        type,
        dbId,
        message: getErrorMessage(err, "Unable to load schemas."),
      });
    }
  },
  {
    condition: ({ type, dbId }, { getState }) => {
      const state = (getState() as { sttmBuilder: SttmBuilderState }).sttmBuilder;
      const branch = type === "source" ? state.sourceDatabases : state.targetDatabases;
      const db = branch.find((d) => d.dbId === dbId);
      // Skip if already loaded or currently loading
      if (db?.schemasLoaded) return false;
      const key = `${type}:${dbId}`;
      if (state.loadState.schemasByDb[key] === "loading") return false;
      return true;
    },
  }
);

/** Fetch tables for a schema. Populates the flat sources/targets list. Cached per schema. */
export const fetchTables = createAsyncThunk(
  "sttmBuilder/fetchTables",
  async (
    { type, dbId, schemaId }: { type: "source" | "target"; dbId: string; schemaId: string },
    { getState, rejectWithValue }
  ) => {
    const state = (getState() as { sttmBuilder: SttmBuilderState }).sttmBuilder;
    const branch = type === "source" ? state.sourceDatabases : state.targetDatabases;
    const db = branch.find((d) => d.dbId === dbId);
    const schema = db?.schemas.find((s) => s.schemaId === schemaId);
    if (schema?.tablesLoaded) {
      // Already cached — just return the existing tables so reducer can set them as sources/targets
      return { type, dbId, schemaId, tables: null, cached: true };
    }

    const [databaseName, schemaName] = schemaId.split(":", 2);
    try {
      const tables = await dbService.getSchemaTables(databaseName, schemaName);
      return { type, dbId, schemaId, tables, cached: false };
    } catch (err) {
      return rejectWithValue({
        type,
        schemaId,
        message: getErrorMessage(err, "Unable to load tables."),
      });
    }
  }
);

/** Fetch attributes/columns for selected source tables. */
export const fetchAttributes = createAsyncThunk(
  "sttmBuilder/fetchAttributes",
  async (
    { qualifiedNames, side }: { qualifiedNames: string[]; side: "source" | "target" },
    { rejectWithValue }
  ) => {
    if (!qualifiedNames.length) return { side, groups: [] };
    try {
      const attrs = await dbService.getTableAttributes(qualifiedNames);
      const groups: ColumnGroup[] = attrs.map(
        (item: {
          table: TableRef;
          columns: Array<{
            column_name: string;
            data_type: string;
            is_primary_key?: boolean;
            is_foreign_key?: boolean;
          }>;
        }) => ({
          table: item.table.table,
          qualifiedName: `${item.table.database}.${item.table.schema}.${item.table.table}`,
          columns: item.columns.map(
            (c): Column => ({
              name: c.column_name,
              type: c.data_type,
              isPrimaryKey: !!c.is_primary_key,
              isForeignKey: !!c.is_foreign_key,
              tableName: item.table.table,
            })
          ),
        })
      );
      return { side, groups };
    } catch (err) {
      return rejectWithValue(getErrorMessage(err, "Unable to load attributes."));
    }
  }
);

/** Fetch relationships for currently selected source tables. */
export const fetchRelationships = createAsyncThunk(
  "sttmBuilder/fetchRelationships",
  async (_, { getState, rejectWithValue }) => {
    const state = (getState() as { sttmBuilder: SttmBuilderState }).sttmBuilder;
    const selectedSourceTables = resolveSelectedSourceTables(state);

    if (selectedSourceTables.length < 2) {
      return [];
    }

    try {
      const relationships = await dbService.getTableRelationships(
        selectedSourceTables.map((table) => makeTableRef(table.qualifiedName))
      );

      return relationships.map(
        (item: {
          left_table: TableRef;
          right_table: TableRef;
          constraint_name?: string | null;
          join_type?: "INNER" | "LEFT" | "RIGHT" | "FULL";
          source?: "FOREIGN_KEY" | "USER_DEFINED" | "SEMANTIC_VIEW" | null;
          locked?: boolean;
          review_required?: boolean;
          confidence?: number | null;
          review_reason?: string | null;
          evidence?: Record<string, unknown> | null;
          conditions?: Array<{
            left_column?: string;
            right_column?: string;
            operator?: string;
          }>;
        }): JoinConfig => {
          const leftTableId = `${item.left_table.database}.${item.left_table.schema}.${item.left_table.table}`;
          const rightTableId = `${item.right_table.database}.${item.right_table.schema}.${item.right_table.table}`;
          const baseId = item.constraint_name?.trim()
            ? item.constraint_name
            : `${leftTableId}__${rightTableId}`;

          return {
            id: baseId,
            leftTableId,
            rightTableId,
            joinType: item.join_type ?? "INNER",
            constraintName: item.constraint_name ?? undefined,
            source: item.source ?? "FOREIGN_KEY",
            locked: item.locked ?? true,
            reviewRequired: item.review_required ?? false,
            confidence: item.confidence ?? null,
            reviewReason: item.review_reason ?? null,
            evidence: item.evidence ?? null,
          conditions: (item.conditions ?? [])
              .filter(
                (condition) =>
                  (condition.left_column || (condition as { fk_column?: string }).fk_column) &&
                  (condition.right_column || (condition as { pk_column?: string }).pk_column)
              )
              .map((condition) => ({
                leftColumn:
                  (condition.left_column ??
                    (condition as { fk_column?: string }).fk_column) as string,
                rightColumn:
                  (condition.right_column ??
                    (condition as { pk_column?: string }).pk_column) as string,
                operator: condition.operator ?? "=",
              })),
          };
        }
      );
    } catch (err) {
      return rejectWithValue(getErrorMessage(err, "Unable to load table relationships."));
    }
  }
);

export const fetchDerivedSources = createAsyncThunk(
  "sttmBuilder/fetchDerivedSources",
  async (_, { rejectWithValue }) => {
    try {
      const rows = await dbService.listDerivedSources();
      return {
        derivedSources: rows.map(
        (row): DerivedSource => {
          const sourceTables = row.source_tables ?? [];
          const selectedColumns = row.selected_columns_by_table ?? {};
          const sourceTableIds = sourceTables.map(
            (table) => `${table.database}.${table.schema}.${table.table}`
          );

          return {
            id: row.derived_source_id,
            sourceName: row.derived_source_name,
            sqlText: row.sql_text,
            parentDerivedSourceIds: row.parent_derived_source_ids ?? [],
            semanticBundleId: row.semantic_bundle_id ?? null,
            semanticViewName: row.semantic_view_name ?? null,
            semanticLevel: row.semantic_level ?? null,
            upstreamHash: row.upstream_hash ?? null,
            sourceDependencyHash: row.source_dependency_hash ?? null,
            physicalViewName: row.physical_view_name ?? null,
            generatedByRequestId: row.generated_by_request_id ?? null,
            purpose: row.purpose ?? null,
            businessDescription: row.business_description ?? null,
            grain: row.grain ?? null,
            keys: row.keys ?? [],
            outputColumns: row.output_columns ?? [],
            columnSemantics: row.column_semantics ?? [],
            semanticProjection: row.semantic_projection ?? {},
            semanticQuality: row.semantic_quality ?? "incomplete",
            lineageDepth: row.lineage_depth ?? 0,
            drivingTableId: row.driving_table
              ? `${row.driving_table.database}.${row.driving_table.schema}.${row.driving_table.table}`
              : undefined,
            tableIds: sourceTableIds,
            baseSourceTables: row.base_source_tables ?? [],
            selectedColumnsByTable: selectedColumns,
            joins: (row.relationships ?? []).map((relationship, index) => ({
              id:
                relationship.id ??
                relationship.constraint_name ??
                `${relationship.left_table.database}.${relationship.left_table.schema}.${relationship.left_table.table}__${relationship.right_table.database}.${relationship.right_table.schema}.${relationship.right_table.table}__${index}`,
              joinType: relationship.join_type ?? "INNER",
              leftTableId: `${relationship.left_table.database}.${relationship.left_table.schema}.${relationship.left_table.table}`,
              rightTableId: `${relationship.right_table.database}.${relationship.right_table.schema}.${relationship.right_table.table}`,
              conditions: (relationship.conditions ?? []).map((condition, conditionIndex) => ({
                id: `cond-${index + 1}-${conditionIndex + 1}`,
                leftColumn: condition.left_column,
                operator: condition.operator ?? "=",
                rightColumn: condition.right_column,
              })),
            })),
            filters: (row.filters as RuleGroup[] | undefined) ?? [],
            columns: Object.entries(selectedColumns).flatMap(([tableId, columns]) =>
              columns.map((columnName) => ({
                name: columnName,
                tableId,
                tableName: tableId.split(".").pop(),
              }))
            ).length
              ? Object.entries(selectedColumns).flatMap(([tableId, columns]) =>
                  columns.map((columnName) => ({
                    name: columnName,
                    tableId,
                    tableName: tableId.split(".").pop(),
                  }))
                )
              : (row.preview_columns ?? []).map((column) => ({
                  name: column.name,
                  tableId: row.derived_source_id,
                  tableName: row.derived_source_name,
                })),
            previewColumns: (row.preview_columns ?? []).map((column) => ({
              name: column.name,
              dataType: column.data_type,
              isPrimaryKey: column.is_primary_key,
            })),
          };
        }
      ),
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      return rejectWithValue(getErrorMessage(err, "Unable to load derived sources."));
    }
  },
  {
    condition: (_, { getState }) => {
      const state = (getState() as { sttmBuilder: SttmBuilderState }).sttmBuilder;
      // Skip if data is fresh (less than 5 minutes old) and we have derived sources
      if (state.derivedSources.length > 0 && isCacheFresh(state.cacheMetadata.derivedSourcesFetchedAt)) {
        return false;
      }
      return true;
    },
  }
);

/** Run auto-mapping. */
export const runAutoMap = createAsyncThunk(
  "sttmBuilder/runAutoMap",
  async (_, { dispatch, getState, rejectWithValue }) => {
    const state = (getState() as { sttmBuilder: SttmBuilderState }).sttmBuilder;
    const selectedSourceTables = resolveSelectedSourceTables(state);
    const selectedTargetTable = resolveSelectedTargetTable(state);
    if (!selectedSourceTables.length || !state.targetAttributeGroup) return null;

    try {
      const sourceColumnNames = state.sourceAttributeGroups.flatMap((group) =>
        group.columns.map((column) => String(column.name || '')).filter(Boolean),
      );
      const derivedColumnNames = state.derivedSources
        .filter((source) => source.isSelected)
        .flatMap((source) =>
          (source.previewColumns ?? source.columns ?? [])
            .map((column) => String(column.name || ''))
            .filter(Boolean),
        );
      const candidateSourceNames = [...sourceColumnNames, ...derivedColumnNames];
      const targetAttributes = state.targetAttributeGroup.columns
        .filter((col) => !!col.name)
        .map((col, index) => ({
          target_table: makeTableRef(state.targetAttributeGroup!.qualifiedName),
          target_attribute: col.name as string,
          target_data_type: col.type ?? null,
          target_description: null,
          source_mappings: null,
          _original_index: index,
        }))
        .sort((left, right) => {
          const leftScore = estimateAutoMapComplexity(left.target_attribute, candidateSourceNames);
          const rightScore = estimateAutoMapComplexity(right.target_attribute, candidateSourceNames);
          if (leftScore !== rightScore) {
            return leftScore - rightScore;
          }
          return left._original_index - right._original_index;
        })
        .map(({ _original_index, ...attribute }) => {
          void _original_index;
          return attribute;
        });
      if (!targetAttributes.length) {
        throw new Error("No target attributes are available for auto-map.");
      }
      const mappingIdsByTarget = new Map(
        state.mappings.map((mapping) => [normalizeTargetKey(mapping.targetColumn), mapping.id]),
      );
      dispatch(
        autoMapBatchesInitialized({
          totalCount: targetAttributes.length,
        }),
      );
      let semanticBundleId = state.semanticBundleId;
      let semanticViewName = state.semanticViewName;
      let semanticContextItems = state.semanticContextItems;
      let semanticLineage = state.semanticLineage;
      let semanticDatahubContext = state.semanticDatahubContext;
      let processedCount = 0;
      const failures: string[] = [];
      const autoMappingReviewHolder: { current: AutoMappingReview | null } = {
        current: null,
      };
      const selectedDerivedSourceIds = getSelectedDerivedSourceIds(state.derivedSources);
      const projectAttributes = state.activeProjectId
        ? await listProjectAttributes(state.activeProjectId).catch(() => [])
        : [];
      if (!semanticBundleId || !semanticContextItems?.length) {
        dispatch(
          autoMapStreamStatus({
            text: "Resolving semantic context for the current selection...",
          }),
        );
        const sourceTables = selectedSourceTables.map((t) => makeTableRef(t.qualifiedName));
        const relationships = buildRelationshipPayload(state.relationships);
        const semanticRequest = {
          selected_source_tables: sourceTables,
          selected_derived_sources: selectedDerivedSourceIds,
          target_table: selectedTargetTable ? makeTableRef(selectedTargetTable.qualifiedName) : null,
          relationships: relationships as Array<Record<string, unknown>>,
          requested_level: "FULL_REGISTRY" as const,
          force: false,
        };
        let semanticRefresh;
        try {
          semanticRefresh = await dbService.refreshSemanticContext(semanticRequest);
        } catch (error) {
          if (!isSemanticRelationshipCompatibilityError(error)) throw error;
          dispatch(
            autoMapStreamStatus({
              text: "Loading table semantics; selected joins will be passed directly to Auto-map...",
            }),
          );
          semanticRefresh = await dbService.refreshSemanticContext({
            ...semanticRequest,
            relationships: [],
          });
        }
        semanticBundleId = semanticRefresh.bundle_id;
        semanticViewName = semanticRefresh.semantic_view_name ?? null;
        semanticContextItems =
          (semanticRefresh.semantic_context as SemanticContextItem[] | null | undefined) ??
          semanticContextItems;
        semanticLineage = semanticRefresh.lineage ?? semanticLineage;
        semanticDatahubContext = semanticRefresh.datahub_context ?? semanticDatahubContext;
        if (!semanticBundleId && !semanticViewName && !semanticContextItems?.length) {
          throw new Error(
            'Auto-map could not resolve semantic context for the current selection. Please ensure tables are properly selected.',
          );
        }
      }
      dispatch(
        autoMapStreamStatus({
          text: "Semantic context ready. Starting auto-map...",
        }),
      );

      const workspaceSnapshot = snapshotFromState(state, "auto_map.requested", {
        page: "mapping",
        surface: "MAPPING",
        semanticBundleId,
        semanticViewName,
      });

      const enrichedTargetAttributes = targetAttributes.map((attribute) => ({
        ...attribute,
        target_description:
          findTargetDescription(
            semanticContextItems,
            selectedTargetTable?.qualifiedName ?? null,
            attribute.target_attribute,
          ) ?? attribute.target_description,
      }));
      const allMappingIds = enrichedTargetAttributes
        .map((attribute) => mappingIdsByTarget.get(normalizeTargetKey(attribute.target_attribute)))
        .filter((value): value is string => Boolean(value));
      const autoMapRequest = {
        interface: "AUTO_MAP" as const,
        thread_id: null,
        source_tables: selectedSourceTables.map((table) => makeTableRef(table.qualifiedName)),
        target_table: selectedTargetTable ? makeTableRef(selectedTargetTable.qualifiedName) : null,
        driving_table: state.drivingTableId ? makeTableRef(state.drivingTableId) : null,
        relationships: buildRelationshipPayload(state.relationships),
        relation_graph: buildRelationGraph(
          selectedSourceTables,
          state.derivedSources,
          state.relationships,
          state.mappings,
          projectAttributes,
        ),
        semantic_context: semanticContextItems,
        selected_columns_by_table: buildSelectedColumnsByTable(state.sourceAttributeGroups),
        selected_derived_sources: selectedDerivedSourceIds,
        semantic_bundle_id: semanticBundleId,
        semantic_view_name: semanticViewName,
        derived_source_lineage: semanticLineage,
        datahub_context: semanticDatahubContext,
        surface: "MAPPING" as const,
        semantic_level_requested: "FULL_REGISTRY" as const,
        attributes: enrichedTargetAttributes,
        project_id: state.activeProjectId,
        sttm_id: state.activeSttmId,
        workspace_context: workspaceSnapshot,
      };
      dispatch(
        autoMapBatchStarted({
          processingIds: allMappingIds,
          processedCount: 0,
          totalCount: enrichedTargetAttributes.length,
        }),
      );

      const applyResponse = (
        response: STTMBuilderEnvelopeResponse,
        targetNames: string[],
        completedCount: number,
      ) => {
        autoMappingReviewHolder.current =
          extractAutoMappingReview(response) ?? autoMappingReviewHolder.current;
        semanticBundleId = response.data?.semantic_refresh_status?.bundle_id ?? semanticBundleId;
        semanticViewName = extractSemanticViewNameFromStatus(
          response.data?.semantic_refresh_status as Record<string, unknown> | undefined,
          semanticViewName,
        );
        semanticContextItems =
          normalizeSemanticContextItems(
            response.context?.semantic_context as Array<Record<string, unknown>> | undefined,
          ) ?? semanticContextItems;
        semanticLineage = Array.isArray(response.context?.derived_source_lineage)
          ? response.context.derived_source_lineage
          : semanticLineage;
        semanticDatahubContext =
          (response.context?.datahub_context as Record<string, unknown> | null | undefined) ??
          semanticDatahubContext;
        processedCount = Math.max(processedCount, completedCount);
        dispatch(
          autoMapBatchApplied({
            response,
            completedMappingIds: targetNames
              .map((target) => mappingIdsByTarget.get(normalizeTargetKey(target)))
              .filter((value): value is string => Boolean(value)),
            processedCount,
            totalCount: enrichedTargetAttributes.length,
          }),
        );
      };

      let usedJobApi = false;
      try {
        const startedJob = await workbenchService.startAutoMapJob(autoMapRequest);
        usedJobApi = true;
        const appliedBatches = new Set<number>();
        let job = startedJob;
        let consecutivePollFailures = 0;
        const deadline = Date.now() + 20 * 60 * 1000;
        while (job.status === "queued" || job.status === "running") {
          dispatch(
            autoMapStreamStatus({
              text: `Auto-map ${job.stage ?? job.status}: ${job.completed_attribute_count}/${job.attribute_count} targets completed across ${job.batch_count} adaptive batches.`,
            }),
          );
          for (const partial of job.partial_responses ?? []) {
            if (appliedBatches.has(partial.batch_index)) continue;
            appliedBatches.add(partial.batch_index);
            applyResponse(partial.response, partial.target_attributes, job.completed_attribute_count);
          }
          if (Date.now() >= deadline) {
            throw new Error("Auto-map job exceeded the 20-minute safety timeout.");
          }
          // One durable job is polled until completion. Polling does not launch
          // agent batches; it only reads the latest durable state. A moderate
          // cadence avoids flooding DevTools/Snowflake while preserving timely
          // partial-result delivery.
          const pollDelayMs = job.completed_batch_count > 0 ? 1500 : 2500;
          await new Promise((resolve) => window.setTimeout(resolve, pollDelayMs));
          try {
            job = await workbenchService.getAutoMapJob(job.job_id);
            consecutivePollFailures = 0;
          } catch (pollError) {
            const pollMessage = getErrorMessage(pollError, "Auto-map status request failed.");
            const transient = /network error|timeout|timed out|fetch|connection|502|503|504/i.test(pollMessage);
            consecutivePollFailures += 1;
            if (!transient || consecutivePollFailures > 8) {
              throw pollError;
            }
            const retryDelayMs = Math.min(15_000, 1_500 * (2 ** (consecutivePollFailures - 1)));
            dispatch(
              autoMapStreamStatus({
                text: `Connection interrupted while checking Auto-map. The durable job is still running; retrying status (${consecutivePollFailures}/8).`,
              }),
            );
            await new Promise((resolve) => window.setTimeout(resolve, retryDelayMs));
          }
        }
        for (const partial of job.partial_responses ?? []) {
          if (appliedBatches.has(partial.batch_index)) continue;
          appliedBatches.add(partial.batch_index);
          applyResponse(partial.response, partial.target_attributes, job.completed_attribute_count);
        }
        if (job.status === "failed") {
          throw new Error(job.error?.message || "The Auto-map job failed.");
        }
        // The merged terminal response is authoritative. Reapply it even when
        // partial batches were streamed so a missing/empty terminal partial
        // cannot silently drop mappings. Application is idempotent, and rows
        // with an unresolved decision remain UNMAPPED for review.
        if (job.response) {
          applyResponse(
            job.response,
            enrichedTargetAttributes.map((attribute) => attribute.target_attribute),
            enrichedTargetAttributes.length,
          );
        }
        processedCount = enrichedTargetAttributes.length;
      } catch (jobError) {
        const jobMessage = getErrorMessage(jobError, "");
        const canUseCompatibilityStream =
          !usedJobApi &&
          /not an auto-map operation|worker service is not configured|404|not found/i.test(jobMessage);
        if (!canUseCompatibilityStream) throw jobError;
        dispatch(
          autoMapStreamStatus({
            text: "Durable Auto-map jobs are unavailable locally; using one compatibility request.",
          }),
        );
        let response: STTMBuilderEnvelopeResponse | null = null;
        for await (const event of workbenchService.invokeStream(autoMapRequest)) {
          if (
            (
              event.event === "status" ||
              event.event === "context.resolved" ||
              event.event === "activity.started" ||
              event.event === "activity.progress" ||
              event.event === "activity.completed"
            ) &&
            typeof event.data.message === "string"
          ) {
            dispatch(autoMapStreamStatus({ text: event.data.message }));
          } else if (event.event === "error" || event.event === "response.failed") {
            throw new Error(event.data.message || "Auto-map streaming request failed.");
          } else if (event.event === "final" || event.event === "response.completed") {
            response = event.data;
          }
        }
        if (!response) throw new Error("Auto-map returned no final response.");
        applyResponse(
          response,
          enrichedTargetAttributes.map((attribute) => attribute.target_attribute),
          enrichedTargetAttributes.length,
        );
      }
      return {
        processedCount,
        totalCount: targetAttributes.length,
        failedTargets:
          autoMappingReviewHolder.current?.recommendations
            .filter((item) => item.severity === "action_required")
            .map((item) => item.target_attribute) ?? failures,
        autoMappingReview: autoMappingReviewHolder.current,
        reviewSummary: autoMappingReviewHolder.current
          ? formatAutoMappingReview(autoMappingReviewHolder.current)
          : null,
        semanticBundleId,
        semanticViewName,
        semanticContextItems,
        semanticLineage,
        semanticDatahubContext,
      };
    } catch (err) {
      return rejectWithValue(getErrorMessage(err, "Auto-map failed."));
    }
  }
);

/** Send chat message to agent. */
export const sendChatMessage = createAsyncThunk(
  "sttmBuilder/sendChatMessage",
  async (message: string, { dispatch, getState, rejectWithValue }) => {
    const trimmed = message.trim();
    if (!trimmed) {
      return rejectWithValue({
        userMessage: "",
        errorMessage: "Please enter a message before sending.",
        semanticRefresh: null,
        messageId: createChatMessageId(),
      });
    }
    const messageId = createChatMessageId();
    dispatch(assistantStreamStarted({ messageId }));
    const state = (getState() as { sttmBuilder: SttmBuilderState }).sttmBuilder;
    const selectedTargetTable = resolveSelectedTargetTable(state);
    const selectedSourceTables = resolveSelectedSourceTables(state).map((table) =>
      makeTableRef(table.qualifiedName),
    );
    const selectedMappingIds = state.selectedMappingIds;
    const selectedDerivedSourceIds = getSelectedDerivedSourceIds(state.derivedSources);
    const relationships = buildRelationshipPayload(state.relationships);
    const loweredMessage = trimmed.toLowerCase();
    const isDerivedSourcePrompt = isDerivedSourceGenerationText(loweredMessage);
    const currentAssistantPage = getCurrentAssistantPage();
    const surface = getCurrentAssistantSurface(currentAssistantPage, isDerivedSourcePrompt);
    const chatTargetMappings = resolveChatTargetMappings(state, trimmed);
    const requestedConstantValue =
      chatTargetMappings.length === 1 ? parseRequestedConstantValue(trimmed) : null;
    // Always use FULL_REGISTRY for the best agent experience - it provides full semantic views with reading instructions
    const requestedSemanticLevel: SemanticLevel = "FULL_REGISTRY";
    const shouldUseStructuredTransformationIntent =
      currentAssistantPage === "mapping" &&
      chatTargetMappings.length > 0 &&
      (isTransformationPrompt(loweredMessage) || isMappingMutationPrompt(loweredMessage));
    // The STTM Builder is the single product-facing orchestrator. Do not make
    // routing decisions from frontend keywords: the orchestrator decides
    // whether to answer from prepared context or invoke Analyst/search/a
    // specialist. This also avoids the extra general-conversation hop.
    const useDirectWorkbenchStream = true;
    const selectedTableIds = [
      ...resolveSelectedSourceTables(state).map((table) => table.qualifiedName),
      ...selectedDerivedSourceIds,
    ];
    const semanticRefresh: SemanticRefreshResult | null = null;
    const semanticBundleId = state.semanticBundleId;
    const semanticViewName = state.semanticViewName;
    const semanticContextItems = state.semanticContextItems;
    const semanticLineage = state.semanticLineage;
    const semanticDatahubContext = state.semanticDatahubContext;
    const semanticLevelForRequest: SemanticLevel = requestedSemanticLevel;
    const semanticBundleHash = state.semanticBundleHash;
    const learningContextId = state.learningContextId;
    const learningContextHash = state.learningContextHash;
    const workspaceContextId = state.workspaceContextId;
    const workspaceContextHash = state.workspaceContextHash;
    const threadId = state.agentThreadId;
    const parentMessageId = state.agentParentMessageId;
    const streamBatchingEnabled = process.env.NEXT_PUBLIC_AGENT_STREAM_BATCHING_V1 !== "false";
    let answerRenderBuffer = "";
    let sqlRenderBuffer = "";
    let lastRenderFlush = Date.now();
    const flushRenderBuffers = () => {
      if (answerRenderBuffer) {
        dispatch(assistantStreamDelta({ messageId, text: answerRenderBuffer }));
        answerRenderBuffer = "";
      }
      if (sqlRenderBuffer) {
        dispatch(assistantStreamSqlDelta({ messageId, text: sqlRenderBuffer }));
        sqlRenderBuffer = "";
      }
      lastRenderFlush = Date.now();
    };
    const queueRenderDelta = (kind: "answer" | "sql", text: string) => {
      if (!streamBatchingEnabled) {
        if (kind === "answer") dispatch(assistantStreamDelta({ messageId, text }));
        else dispatch(assistantStreamSqlDelta({ messageId, text }));
        return;
      }
      if (kind === "answer") answerRenderBuffer += text;
      else sqlRenderBuffer += text;
      if (Date.now() - lastRenderFlush >= 50) flushRenderBuffers();
    };
    try {
      const pushStatus = (
        text: string,
        phase?: string | null,
        elapsedSeconds?: number | null,
      ) =>
        dispatch(assistantStreamStatus({ messageId, text, phase, elapsedSeconds }));

      if (requestedConstantValue && chatTargetMappings.length === 1) {
        return {
          userMessage: trimmed,
          response: buildConstantMappingProposal(
            state,
            chatTargetMappings[0],
            requestedConstantValue,
          ),
          selectedTableIds,
          drivingTableId: state.drivingTableId,
          selectedMappingIds: [chatTargetMappings[0].id],
          semanticRefresh,
          messageId,
        };
      }

      const rawWorkspaceContextForAgent = snapshotFromState(
        state,
        shouldUseStructuredTransformationIntent
          ? "transformation.requested"
          : "assistant.requested",
        {
          page: currentAssistantPage,
          surface,
          semanticBundleId,
          semanticViewName,
        },
      );
      const {
        workspace: workspaceContextForAgent,
        dependencyHash: workspaceSnapshotHash,
      } = preparedWorkspaceSnapshot(
        rawWorkspaceContextForAgent as unknown as Record<string, unknown>,
      );
      const hasSelectedWorkspace =
        selectedSourceTables.length > 0 ||
        selectedDerivedSourceIds.length > 0 ||
        Boolean(selectedTargetTable);
      const hasPreparedWorkspaceContext = Boolean(
        workspaceContextId && workspaceContextHash,
      );
      const preparedContextMatchesCurrentWorkspace = Boolean(
        hasPreparedWorkspaceContext
        && state.workspaceContextSnapshotHash === workspaceSnapshotHash,
      );
      // Context preparation is deliberately background-only.  When the selection
      // changes, keep using the last valid immutable context as a baseline and send
      // the current workspace as an authoritative overlay.  This avoids blocking
      // every question for a full semantic/FIR rebuild while still giving the
      // orchestrator the newly selected tables, columns, joins, and target.
      const sendLiveWorkspaceOverlay =
        hasSelectedWorkspace && !preparedContextMatchesCurrentWorkspace;
      const sendLiveSemanticOverlay =
        sendLiveWorkspaceOverlay || !hasPreparedWorkspaceContext;
      const transformationAttributes = shouldUseStructuredTransformationIntent && selectedTargetTable
        ? chatTargetMappings.map((mapping) => ({
            target_table: makeTableRef(selectedTargetTable.qualifiedName),
            target_attribute: mapping.targetColumn,
            target_data_type: mapping.targetType ?? null,
            target_description:
              mapping.description ??
              mapping.nlRule ??
              findTargetDescription(
                semanticContextItems,
                selectedTargetTable.qualifiedName,
                mapping.targetColumn,
              ),
            // Derived relations are represented in relation_graph. Physical
            // source mappings are included here when their four-part FQN is known.
            source_mappings: (
              mapping.sourceColumns ??
              (mapping.sourceColumn
                ? mapping.sourceColumn.split(",").map((item) => item.trim()).filter(Boolean)
                : [])
            )
              .flatMap((source) => {
                const parts = source.split(".");
                if (parts.length !== 4) return [];
                return [{
                  table: { database: parts[0], schema: parts[1], table: parts[2] },
                  attribute: parts[3],
                }];
              }) || null,
          }))
        : null;
      const stream = useDirectWorkbenchStream
        ? workbenchService.invokeStream({
            interface: shouldUseStructuredTransformationIntent ? "TRANSFORM" : "CHAT",
          thread_id: threadId,
          logical_conversation_id: state.agentLogicalConversationId,
          physical_thread_segment: state.agentPhysicalThreadSegment,
          parent_message_id: threadId ? parentMessageId : null,
            message: trimmed,
            attributes: transformationAttributes,
            source_tables: selectedSourceTables,
            target_table: selectedTargetTable ? makeTableRef(selectedTargetTable.qualifiedName) : null,
            driving_table: state.drivingTableId ? makeTableRef(state.drivingTableId) : null,
            relationships,
            relation_graph: buildRelationGraph(
              resolveSelectedSourceTables(state),
              state.derivedSources,
              state.relationships,
              state.mappings,
            ),
            selected_columns_by_table: buildSelectedColumnsByTable(state.sourceAttributeGroups),
            selected_derived_sources: selectedDerivedSourceIds,
            semantic_context: sendLiveSemanticOverlay ? semanticContextItems : null,
            surface,
            semantic_level_requested: semanticLevelForRequest,
            session_id: state.session ? String(state.session.user_id) : null,
            semantic_bundle_id: semanticBundleId,
            semantic_bundle_hash: semanticBundleHash,
            learning_context_id: learningContextId,
            learning_context_hash: learningContextHash,
            workspace_context_id: workspaceContextId,
            workspace_context_hash: workspaceContextHash,
            semantic_view_name: semanticViewName,
            derived_source_lineage: sendLiveSemanticOverlay ? semanticLineage : null,
            datahub_context: sendLiveSemanticOverlay ? semanticDatahubContext : null,
            mapping_intent: state.mappingIntent,
            project_id: state.activeProjectId,
            sttm_id: state.activeSttmId,
            workspace_context:
              sendLiveWorkspaceOverlay || !hasPreparedWorkspaceContext
                ? workspaceContextForAgent
                : null,
          })
        : conversationService.invokeStream({
            operation: "conversation.ask",
            thread_id: threadId,
            logical_conversation_id: state.agentLogicalConversationId,
            physical_thread_segment: state.agentPhysicalThreadSegment,
            parent_message_id: threadId ? parentMessageId : null,
            session_id: state.session ? String(state.session.user_id) : null,
            message: trimmed,
            source_tables: selectedSourceTables,
            target_table: selectedTargetTable ? makeTableRef(selectedTargetTable.qualifiedName) : null,
            driving_table: state.drivingTableId ? makeTableRef(state.drivingTableId) : null,
            relationships,
            selected_columns_by_table: buildSelectedColumnsByTable(state.sourceAttributeGroups),
            selected_derived_sources: selectedDerivedSourceIds,
            requested_sources: ["relationships", "semantic", "recommendations", "feedback", "conversations"],
            semantic_context: sendLiveSemanticOverlay ? semanticContextItems : null,
            semantic_bundle_label: state.semanticBundleLabel,
            semantic_bundle_id: semanticBundleId,
            semantic_bundle_hash: semanticBundleHash,
            learning_context_id: learningContextId,
            learning_context_hash: learningContextHash,
            workspace_context_id: workspaceContextId,
            workspace_context_hash: workspaceContextHash,
            semantic_view_name: semanticViewName,
            derived_source_lineage: sendLiveSemanticOverlay ? semanticLineage : null,
            datahub_context: sendLiveSemanticOverlay ? semanticDatahubContext : null,
            surface,
            semantic_level_requested: semanticLevelForRequest,
            mapping_intent: state.mappingIntent,
            project_id: state.activeProjectId,
            sttm_id: state.activeSttmId,
            workspace_context:
              sendLiveWorkspaceOverlay || !hasPreparedWorkspaceContext
                ? workspaceContextForAgent
                : null,
            checked_mapping_row_ids: selectedMappingIds.length > 0 ? selectedMappingIds : null,
            mapping_rows: selectedMappingIds.length > 0
              ? state.mappings
                  .filter((m) => selectedMappingIds.includes(m.id))
                  .map((m) => ({
                    id: m.id,
                    target_column: m.targetColumn,
                    source_column: m.sourceColumn,
                    source_columns: m.sourceColumns ?? [],
                    mapping_mode: m.mappingMode ?? "source",
                    constant_value: m.constantValue ?? null,
                    attribute_name: m.attributeName ?? null,
                    expression: m.expression,
                    rule: m.rule,
                    status: m.status,
                    confidence_score: m.confidenceScore,
                  }))
              : null,
          });
      let response = null as AssistantEnvelopeResponse | null;
      let answerDeltaMode: "undecided" | "plain" | "structured" = "undecided";
      let pendingAnswerDelta = "";
      const visibleAnswerDelta = (delta: string): string => {
        if (answerDeltaMode === "structured") return "";
        if (answerDeltaMode === "plain") return delta;
        pendingAnswerDelta += delta;
        const candidate = pendingAnswerDelta.trimStart();
        if (!candidate) return "";
        const structuredPrefixes = ["{", "```json", "```JSON"];
        if (structuredPrefixes.some((prefix) => candidate.startsWith(prefix))) {
          answerDeltaMode = "structured";
          pendingAnswerDelta = "";
          return "";
        }
        if (structuredPrefixes.some((prefix) => prefix.startsWith(candidate))) {
          return "";
        }
        answerDeltaMode = "plain";
        const visible = pendingAnswerDelta;
        pendingAnswerDelta = "";
        return visible;
      };
      for await (const event of stream) {
        if (
          event.event === "status" ||
          event.event === "context.resolved" ||
          event.event === "activity.started" ||
          event.event === "activity.progress" ||
          event.event === "activity.completed"
        ) {
          let statusText =
            typeof event.data.message === "string" ? event.data.message : "";
          if (
            isDerivedSourcePrompt &&
            statusText === "Checking semantic context for the current selection."
          ) {
            statusText = "Looking for an existing semantic context for this selection.";
          }
          const phase = typeof event.data.phase === "string" ? event.data.phase : null;
          const elapsedSeconds = typeof event.data.elapsed_seconds === "number" ? event.data.elapsed_seconds : null;
          if (statusText) pushStatus(statusText, phase, elapsedSeconds);
          continue;
        }
        if (
          (event.event === "delta" || event.event === "response.text.delta") &&
          typeof event.data.text === "string"
        ) {
          const visible = visibleAnswerDelta(event.data.text);
          if (visible) {
            queueRenderDelta("answer", visible);
          }
          continue;
        }
        if (
          event.event === "response.sql.delta" &&
          typeof event.data.text === "string"
        ) {
          queueRenderDelta("sql", event.data.text);
          continue;
        }
        if (
          (event.event === "suggestions" || event.event === "suggestions.delta") &&
          Array.isArray(event.data.items)
        ) {
          dispatch(
            assistantStreamOptions({
              messageId,
              options: event.data.items.map((item) => String(item)).filter(Boolean),
            })
          );
          continue;
        }
        if (event.event === "error" || event.event === "response.failed") {
          flushRenderBuffers();
          const nested = "error" in event.data ? event.data.error : null;
          throw new Error(
            event.data.message ||
              nested?.detail ||
              nested?.title ||
              "Streaming assistant request failed."
          );
        }
        if (event.event === "final" || event.event === "response.completed") {
          flushRenderBuffers();
          response = event.data as AssistantEnvelopeResponse;
        }
      }
      flushRenderBuffers();
      if (!response) {
        throw new Error("The assistant stream ended without a final response.");
      }
      return {
        userMessage: trimmed,
        response,
        selectedTableIds,
        drivingTableId: state.drivingTableId,
        selectedMappingIds: shouldUseStructuredTransformationIntent
          ? chatTargetMappings.map((mapping) => mapping.id)
          : selectedMappingIds,
        semanticRefresh,
        workspaceSnapshotHash,
        messageId,
      };
    } catch (err) {
      flushRenderBuffers();
      const errorMessage = getErrorMessage(
        err,
        "I could not reach the assistant just now. Please try again."
      );
      dispatch(
        assistantStreamFailed({
          messageId,
          errorMessage,
        })
      );
      return rejectWithValue({
        userMessage: trimmed,
        errorMessage,
        semanticRefresh,
        messageId,
      });
    }
  }
);

export const submitChatFeedback = createAsyncThunk(
  "sttmBuilder/submitChatFeedback",
  async (
    payload: { messageId: string; requestId?: string | null; conversationId?: string | null; rating: number; comment?: string | null },
    { getState, rejectWithValue },
  ) => {
    const state = (getState() as { sttmBuilder: SttmBuilderState }).sttmBuilder;
    try {
      const response = await conversationService.invoke({
        operation: "conversation.feedback",
        message: "",
        thread_id: payload.conversationId ?? state.agentThreadId,
        source_tables: resolveSelectedSourceTables(state)
          .map((table) => makeTableRef(table.qualifiedName)),
        relationships: buildRelationshipPayload(state.relationships),
        selected_columns_by_table: buildSelectedColumnsByTable(state.sourceAttributeGroups),
        selected_derived_sources: getSelectedDerivedSourceIds(state.derivedSources),
        semantic_context: state.semanticContextItems,
        semantic_bundle_id: state.semanticBundleId,
        semantic_bundle_label: state.semanticBundleLabel,
        semantic_view_name: state.semanticViewName,
        derived_source_lineage: state.semanticLineage,
        datahub_context: state.semanticDatahubContext,
        surface: state.targetAttributeGroup ? "MAPPING" : "SOURCE_SELECTION",
        semantic_level_requested: (state.semanticLevel as SemanticLevel | null) ?? "FULL_REGISTRY",
        session_id: state.session ? String(state.session.user_id) : null,
        mapping_intent: state.mappingIntent,
        feedback: {
          category: "agent_quality",
          rating: payload.rating,
          comment: payload.comment ?? null,
          target_request_id: payload.requestId ?? null,
        },
      });
      return {
        messageId: payload.messageId,
        requestId: response.request_id ?? payload.requestId ?? null,
        rating: payload.rating,
      };
    } catch (err) {
      return rejectWithValue({
        messageId: payload.messageId,
        errorMessage: getErrorMessage(err, "Could not save feedback right now."),
      });
    }
  },
);

export const fetchAssistantSignals = createAsyncThunk(
  "sttmBuilder/fetchAssistantSignals",
  async (_, { rejectWithValue }) => {
    try {
      return await conversationService.listSignals();
    } catch (err) {
      return rejectWithValue(getErrorMessage(err, "Could not load assistant signals."));
    }
  },
);

export const updateAssistantPreferences = createAsyncThunk(
  "sttmBuilder/updateAssistantPreferences",
  async (settings: AssistantPreferenceState, { rejectWithValue }) => {
    try {
      return await conversationService.updateAssistantSettings(settings);
    } catch (err) {
      return rejectWithValue(getErrorMessage(err, "Could not update assistant settings."));
    }
  },
);

let _firRecommendationCorrelationCounter = 0;

export function abortPendingEvaluateSignals() {
  // Invalidate a result that belongs to an older workspace snapshot without
  // cancelling its HTTP request. Browser-level cancellation made healthy,
  // superseded evaluations appear as failed requests in DevTools.
  _firRecommendationCorrelationCounter += 1;
}

export const evaluateFirRecommendations = createAsyncThunk(
  "sttmBuilder/evaluateFirRecommendations",
  async (
    payload: {
      checkpoint: string;
      page?: string;
      surface?: string;
      scopeType?: "project" | "schema" | "table" | "table_set" | "target" | "mapping" | "column" | "derived_source";
      candidateAction?: string | null;
      browsingContext?: {
        side?: "source" | "target" | null;
        database?: string | null;
        schema?: string | null;
        visible_candidate_tables?: string[];
        search_text?: string | null;
      } | null;
    },
    { getState, rejectWithValue, signal },
  ) => {
    const correlationId = `fir_eval_${++_firRecommendationCorrelationCounter}`;
    const state = (getState() as { sttmBuilder: SttmBuilderState }).sttmBuilder;
    try {
      const snapshot = snapshotFromState(state, payload.checkpoint, {
        page: payload.page,
        surface: payload.surface,
        milestone: payload.checkpoint,
        scopeType: payload.scopeType,
        candidateAction: payload.candidateAction,
        browsingContext: payload.browsingContext,
      });
      const result = await recommendationService.evaluate(snapshot, {
        checkpoint: payload.checkpoint,
        projectId: state.activeProjectId,
        signal,
      });
      return { ...result, _correlationId: correlationId };
    } catch (err) {
      const name =
        typeof err === "object" && err !== null && "name" in err
          ? String((err as { name?: unknown }).name ?? "")
          : "";
      if (name === "CanceledError" || name === "AbortError") {
        return {
          checkpoint: payload.checkpoint,
          context_key: "",
          scope_key: "",
          primary_question: null,
          items: [],
          total: 0,
          _correlationId: correlationId,
          _cancelled: true,
        };
      }
      return rejectWithValue(getErrorMessage(err, "Could not retrieve FIR recommendations."));
    }
  },
);

export const respondToAssistantSignal = createAsyncThunk(
  "sttmBuilder/respondToAssistantSignal",
  async (
    payload: {
      signalId: string;
      status?: "acknowledged" | "responded" | "dismissed";
      optionSelected?: string | null;
      rating?: number | null;
      comment?: string | null;
    },
    { rejectWithValue },
  ) => {
    try {
      await conversationService.respondToSignal({
        signal_id: payload.signalId,
        status: payload.status ?? "responded",
        option_selected: payload.optionSelected ?? null,
        rating: payload.rating ?? null,
        comment: payload.comment ?? null,
        feedback_type: "business_context",
      });
      return {
        signalId: payload.signalId,
        status: payload.status ?? "responded",
      };
    } catch (err) {
      return rejectWithValue(getErrorMessage(err, "Could not save assistant signal response."));
    }
  },
);

// ─── openSttmFromBackend thunk ──────────────────────────────────────
/**
 * Load a saved STTM from Snowflake into the builder.
 *
 * Fetches the full STTMDetail from the backend, reconstructs the builder state
 * (sources, targets, mapping rows, relationships) from the saved workspace snapshot
 * and metadata rows, and signals the target builder page for navigation.
 *
 * Attribute/column groups are intentionally left empty — the mapping page auto-fetches
 * them on mount via its selectedSourceKey/selectedTargetKey effect.
 */
export const openSttmFromBackend = createAsyncThunk(
  'sttmBuilder/openSttmFromBackend',
  async (
    { sttmId, projectId }: { sttmId: string; projectId?: string },
    { rejectWithValue },
  ) => {
    try {
      const detail = await getSttm(sttmId);
      return {
        sttmId,
        projectId: projectId || String(detail.project?.project_id ?? detail.sttm.project_id ?? ""),
        detail,
      };
    } catch (err) {
      return rejectWithValue(getErrorMessage(err, 'Failed to load STTM from Snowflake.'));
    }
  },
);

// ─── slice ─────────────────────────────────────────────────────────
export const sttmBuilderSlice = createSlice({
  name: "sttmBuilder",
  initialState,
  reducers: {
    clearAssistantSignalsForContext: (state) => {
      state.assistantSignals = [];
      state.assistantInferences = [];
      state.assistantUnreadCount = 0;
      state.firRecommendations = [];
      state.firPrimaryQuestion = null;
      state.firRecommendationCheckpoint = null;
      state.firRecommendationContextKey = null;
      state.firRecommendationLoading = false;
    },
    assistantStreamStarted: (state, action: PayloadAction<{ messageId: string }>) => {
      state.chatMessages.push({
        id: action.payload.messageId,
        role: "assistant",
        content: "",
        isStreaming: true,
        status: "completed",
        traceSteps: [],
        statusPhase: "preparing",
        statusMessage: "Preparing context for your request...",
        elapsedSeconds: null,
      });
    },
    assistantStreamDelta: (
      state,
      action: PayloadAction<{ messageId: string; text: string }>
    ) => {
      const message = state.chatMessages.find((item) => item.id === action.payload.messageId);
      if (!message) return;
      message.content = `${message.content}${action.payload.text}`;
      message.isStreaming = true;
    },
    assistantStreamSqlDelta: (
      state,
      action: PayloadAction<{ messageId: string; text: string }>
    ) => {
      const message = state.chatMessages.find((item) => item.id === action.payload.messageId);
      if (!message) return;
      message.streamingSql = `${message.streamingSql ?? ""}${action.payload.text}`;
      message.isStreaming = true;
    },
    assistantStreamStatus: (
      state,
      action: PayloadAction<{
        messageId: string;
        text: string;
        phase?: string | null;
        elapsedSeconds?: number | null;
      }>
    ) => {
      const message = state.chatMessages.find((item) => item.id === action.payload.messageId);
      if (!message) return;
      const text = action.payload.text.trim();
      // Update status phase and message for progress indicator
      if (action.payload.phase) {
        message.statusPhase = action.payload.phase as ChatMessage["statusPhase"];
        message.statusMessage = text || null;
      }
      if (action.payload.elapsedSeconds !== undefined) {
        message.elapsedSeconds = action.payload.elapsedSeconds;
      }
      if (!text) return;
      const existingSteps = message.traceSteps ?? [];
      if (existingSteps.includes(text)) return;
      message.traceSteps = [...existingSteps, text];
      message.isStreaming = true;
    },
    assistantStreamOptions: (
      state,
      action: PayloadAction<{ messageId: string; options: string[] }>
    ) => {
      const message = state.chatMessages.find((item) => item.id === action.payload.messageId);
      if (!message) return;
      message.options = action.payload.options;
      if (action.payload.options.length) {
        message.status = "needs_input";
      }
    },
    assistantStreamFinished: (
      state,
      action: PayloadAction<{
        messageId: string;
        content: string;
        status?: "completed" | "needs_input" | "failed";
        options?: string[];
      }>
    ) => {
      const message = state.chatMessages.find((item) => item.id === action.payload.messageId);
      if (!message) return;
      const finalContent = action.payload.content.trim();
      if (finalContent) {
        message.content = finalContent;
      }
      message.status = action.payload.status ?? "completed";
      message.options = action.payload.options ?? message.options;
      message.isStreaming = false;
      // Clear status phase when streaming is finished
      message.statusPhase = null;
      message.statusMessage = null;
      message.elapsedSeconds = null;
    },
    assistantStreamFailed: (
      state,
      action: PayloadAction<{ messageId: string; errorMessage: string }>
    ) => {
      const message = state.chatMessages.find((item) => item.id === action.payload.messageId);
      if (message) {
        message.content = message.content.trim()
          ? `${message.content}\n\n> Response interrupted: ${action.payload.errorMessage}`
          : action.payload.errorMessage;
        message.status = "failed";
        message.isStreaming = false;
        message.statusPhase = null;
        message.statusMessage = null;
        message.elapsedSeconds = null;
        return;
      }
      state.chatMessages.push({
        id: action.payload.messageId,
        role: "assistant",
        content: action.payload.errorMessage,
        status: "failed",
        isStreaming: false,
      });
    },
    setChatMessageFeedbackStatus: (
      state,
      action: PayloadAction<{ messageId: string; feedbackStatus: "idle" | "sent" | "failed" }>
    ) => {
      const message = state.chatMessages.find((item) => item.id === action.payload.messageId);
      if (!message) return;
      message.feedbackStatus = action.payload.feedbackStatus;
    },
    autoMapStreamStatus: (
      state,
      action: PayloadAction<{ text: string }>
    ) => {
      const text = action.payload.text.trim();
      state.autoMapStatusMessage = text || null;
    },
    applySemanticRefresh: (
      state,
      action: PayloadAction<SemanticRefreshResult>
    ) => {
      applySemanticRefreshToState(state, action.payload);
    },
    markPreparedWorkspaceContextUpdating: (
      state,
      action: PayloadAction<{ snapshotHash: string }>,
    ) => {
      // Preserve the last good immutable context while the replacement builds.
      // workspaceContextSnapshotHash always describes the installed handle;
      // the pending hash describes the live workspace currently being prepared.
      state.workspaceContextPendingSnapshotHash = action.payload.snapshotHash;
      state.workspaceContextStatus = "updating";
      state.workspaceContextError = null;
    },
    applyPreparedWorkspaceContext: (
      state,
      action: PayloadAction<{
        context: PreparedWorkspaceContext;
        snapshotHash: string;
      }>,
    ) => {
      const prepared = action.payload.context;
      state.workspaceContextId = prepared.workspace_context_id;
      state.workspaceContextHash = prepared.workspace_context_hash;
      state.workspaceContextSnapshotHash = action.payload.snapshotHash;
      state.workspaceContextPendingSnapshotHash = null;
      state.workspaceContextStatus =
        prepared.status === "ready" ? "ready" : prepared.status;
      state.workspaceContextCacheStatus = prepared.cache_status;
      state.workspaceContextError =
        prepared.status === "failed"
          ? (prepared.warnings ?? []).join("; ") || "AI context preparation failed."
          : null;
      state.semanticBundleId = prepared.semantic_bundle_id ?? state.semanticBundleId;
      state.semanticBundleHash =
        prepared.semantic_bundle_hash ?? state.semanticBundleHash;
      state.learningContextId =
        prepared.learning_context_id ?? state.learningContextId;
      state.learningContextHash =
        prepared.learning_context_hash ?? state.learningContextHash;
    },
    failPreparedWorkspaceContext: (
      state,
      action: PayloadAction<{ snapshotHash: string; error: string }>,
    ) => {
      if (state.workspaceContextPendingSnapshotHash !== action.payload.snapshotHash) return;
      state.workspaceContextPendingSnapshotHash = null;
      // A failed refresh must not invalidate the last usable context.
      state.workspaceContextStatus =
        state.workspaceContextId && state.workspaceContextHash ? "ready" : "failed";
      state.workspaceContextError = action.payload.error;
    },
    toggleSource: (state, action: PayloadAction<{ tableId: string }>) => {
      const { tableId } = action.payload;
      let toggledSelected: boolean | undefined;
      let toggledTable: TableNode | undefined;

      for (const db of state.sourceDatabases) {
        for (const sch of db.schemas) {
          for (const t of sch.tables) {
            if (t.tableId === tableId) {
              t.isSelected = !t.isSelected;
              toggledSelected = t.isSelected;
              toggledTable = { ...t };
            }
          }
        }
      }

      // Imported/saved mappings hydrate the flat list before the user expands
      // the corresponding schema. Those tables must remain fully interactive.
      if (toggledSelected === undefined) {
        const flatTable = state.sources.find((table) => table.tableId === tableId);
        if (flatTable) {
          toggledSelected = !flatTable.isSelected;
        }
      }

      state.sources = state.sources.map((t) =>
        t.tableId === tableId && toggledSelected !== undefined
          ? { ...t, isSelected: toggledSelected }
          : t,
      );
      // The relationship canvas resolves selection from the complete database
      // hierarchy, while the Source Tables list renders the flat collection.
      // A table dragged from a schema that is not the currently active schema
      // must be represented in both collections.
      if (
        toggledSelected &&
        toggledTable &&
        !state.sources.some((table) => table.tableId === tableId)
      ) {
        state.sources.push(toggledTable);
      }

      const selectedSources = resolveSelectedSourceTables(state);
      if (toggledSelected && !state.drivingTableId) {
        state.drivingTableId = tableId;
      } else if (!toggledSelected && state.drivingTableId === tableId) {
        state.drivingTableId = selectedSources.find((t) => t.isSelected)?.tableId ?? null;
      }
      if (!toggledSelected) {
        state.relationships = state.relationships.filter(
          (join) => join.leftTableId !== tableId && join.rightTableId !== tableId,
        );
        state.sourceAttributeGroups = state.sourceAttributeGroups.filter(
          (group) => group.qualifiedName !== tableId,
        );
      }
      state.agentThreadId = null;
      state.agentLogicalConversationId = null;
      state.agentPhysicalThreadSegment = null;
      state.agentParentMessageId = null;
      state.semanticBundleId = null;
      state.semanticBundleLabel = null;
      state.semanticLevel = null;
      state.semanticStatus = null;
      state.semanticViewName = null;
      state.semanticContextSummary = null;
      state.semanticContextItems = null;
      state.semanticLineage = [];
      state.semanticDatahubContext = null;
      state.datahubStatus = null;
      state.autoMapStatusMessage = null;
      state.pendingDerivedSourceDraft = null;
      state.derivedSourceDraftRequested = false;
      state.sourceQuerySql = "";
      state.sourceGroupBySql = "";
      state.sourceOrderBySql = "";
      state.pendingAiMappingReviews = [];
    },

    selectTarget: (state, action: PayloadAction<{ tableId: string }>) => {
      const { tableId } = action.payload;
      state.targets = state.targets.map((t) => ({
        ...t,
        isSelected: t.tableId === tableId,
      }));

      for (const db of state.targetDatabases) {
        for (const sch of db.schemas) {
          for (const t of sch.tables) {
            t.isSelected = t.tableId === tableId;
          }
        }
      }
      state.agentThreadId = null;
      state.agentLogicalConversationId = null;
      state.agentPhysicalThreadSegment = null;
      state.agentParentMessageId = null;
      state.semanticBundleId = null;
      state.semanticBundleLabel = null;
      state.semanticLevel = null;
      state.semanticStatus = null;
      state.semanticViewName = null;
      state.semanticContextSummary = null;
      state.semanticContextItems = null;
      state.semanticLineage = [];
      state.semanticDatahubContext = null;
      state.datahubStatus = null;
      state.autoMapStatusMessage = null;
      state.pendingAiMappingReviews = [];
    },

    selectAllSources: (state) => {
      let firstSelectedId: string | null = null;

      for (const db of state.sourceDatabases) {
        for (const sch of db.schemas) {
          for (const t of sch.tables) {
            t.isSelected = true;
            if (!firstSelectedId) {
              firstSelectedId = t.tableId;
            }
          }
        }
      }

      state.sources = state.sources.map((t) => ({ ...t, isSelected: true }));

      if (!state.drivingTableId && firstSelectedId) {
        state.drivingTableId = firstSelectedId;
      }
    },

    clearSources: (state) => {
      state.sources = state.sources.map((t) => ({ ...t, isSelected: false }));
      for (const db of state.sourceDatabases) {
        for (const sch of db.schemas) {
          for (const t of sch.tables) {
            t.isSelected = false;
          }
        }
      }
      state.agentThreadId = null;
      state.agentLogicalConversationId = null;
      state.agentPhysicalThreadSegment = null;
      state.agentParentMessageId = null;
      state.drivingTableId = null;
      state.relationships = [];
      state.sourceAttributeGroups = [];
      state.mappingSuggestions = [];
      state.semanticBundleId = null;
      state.semanticBundleLabel = null;
      state.semanticLevel = null;
      state.semanticStatus = null;
      state.semanticViewName = null;
      state.semanticContextSummary = null;
      state.semanticContextItems = null;
      state.semanticLineage = [];
      state.semanticDatahubContext = null;
      state.datahubStatus = null;
      state.autoMapStatusMessage = null;
      state.pendingDerivedSourceDraft = null;
      state.derivedSourceDraftRequested = false;
      state.sourceQuerySql = "";
      state.sourceGroupBySql = "";
      state.sourceOrderBySql = "";
      state.pendingAiMappingReviews = [];
      state.derivedSources = state.derivedSources.map((source) => ({
        ...source,
        isSelected: false,
      }));
    },

    setSourceFilterConditions: (
      state,
      action: PayloadAction<{
        sql: string;
        groups: RuleGroup[];
        baseSql?: string;
        groupBySql?: string;
        orderBySql?: string;
      }>
    ) => {
      state.sourceFilterSql = action.payload.sql;
      state.sourceFilterGroups = cloneRuleGroups(action.payload.groups);
      state.sourceQuerySql = action.payload.baseSql ?? state.sourceQuerySql;
      state.sourceGroupBySql = action.payload.groupBySql ?? "";
      state.sourceOrderBySql = action.payload.orderBySql ?? "";
    },

    clearTargets: (state) => {
      state.targets = state.targets.map((t) => ({ ...t, isSelected: false }));
      for (const db of state.targetDatabases) {
        for (const sch of db.schemas) {
          for (const t of sch.tables) {
            t.isSelected = false;
          }
        }
      }
      state.agentThreadId = null;
      state.agentLogicalConversationId = null;
      state.agentPhysicalThreadSegment = null;
      state.agentParentMessageId = null;
      state.targetAttributeGroup = null;
      state.mappingSuggestions = [];
      state.semanticLevel = null;
      state.pendingAiMappingReviews = [];
    },

    setDrivingTable: (state, action: PayloadAction<{ tableId: string | null }>) => {
      state.agentThreadId = null;
      state.agentLogicalConversationId = null;
      state.agentPhysicalThreadSegment = null;
      state.agentParentMessageId = null;
      state.drivingTableId = action.payload.tableId;
      state.sourceQuerySql = "";
      state.pendingAiMappingReviews = [];
    },

    setRelationships: (state, action: PayloadAction<{ joins: JoinConfig[] }>) => {
      state.agentThreadId = null;
      state.agentLogicalConversationId = null;
      state.agentPhysicalThreadSegment = null;
      state.agentParentMessageId = null;
      state.relationships = action.payload.joins;
      state.sourceQuerySql = "";
      state.pendingAiMappingReviews = [];
    },

    approveRelationshipCandidate: (state, action: PayloadAction<{ id: string }>) => {
      const candidate = state.relationshipCandidates.find((item) => item.id === action.payload.id);
      if (!candidate) return;
      state.relationshipCandidates = state.relationshipCandidates.filter(
        (item) => item.id !== action.payload.id,
      );
      state.relationships.push({
        ...candidate,
        reviewRequired: false,
        locked: false,
        source: "USER_DEFINED",
      });
      state.sourceQuerySql = "";
    },

    rejectRelationshipCandidate: (state, action: PayloadAction<{ id: string }>) => {
      state.relationshipCandidates = state.relationshipCandidates.filter(
        (item) => item.id !== action.payload.id,
      );
    },

    addDerivedSource: (state, action: PayloadAction<DerivedSource>) => {
      state.derivedSources.push({ ...action.payload, isSelected: false });
    },

    updateDerivedSource: (state, action: PayloadAction<DerivedSource>) => {
      const idx = state.derivedSources.findIndex((s) => s.id === action.payload.id);
      if (idx !== -1) {
        state.derivedSources[idx] = {
          ...action.payload,
          isSelected: state.derivedSources[idx].isSelected ?? false,
        };
      }
      state.pendingAiMappingReviews = [];
    },

    removeDerivedSource: (state, action: PayloadAction<{ id: string }>) => {
      state.derivedSources = state.derivedSources.filter((s) => s.id !== action.payload.id);
    },

    toggleDerivedSource: (state, action: PayloadAction<{ id: string }>) => {
      state.derivedSources = state.derivedSources.map((source) =>
        source.id === action.payload.id
          ? { ...source, isSelected: !source.isSelected }
          : source
      );
      state.agentThreadId = null;
      state.agentLogicalConversationId = null;
      state.agentPhysicalThreadSegment = null;
      state.agentParentMessageId = null;
      state.semanticBundleId = null;
      state.semanticBundleLabel = null;
      state.semanticLevel = null;
      state.semanticStatus = null;
      state.semanticViewName = null;
      state.semanticContextSummary = null;
      state.semanticContextItems = null;
      state.semanticLineage = [];
      state.semanticDatahubContext = null;
      state.datahubStatus = null;
      state.autoMapStatusMessage = null;
      state.pendingDerivedSourceDraft = null;
      state.derivedSourceDraftRequested = false;
      state.sourceQuerySql = "";
      state.sourceGroupBySql = "";
      state.sourceOrderBySql = "";
      state.pendingAiMappingReviews = [];
    },
    openPendingDerivedSourceDraft: (state) => {
      if (state.pendingDerivedSourceDraft) {
        state.derivedSourceDraftRequested = true;
      }
    },
    acknowledgePendingDerivedSourceDraft: (state) => {
      state.derivedSourceDraftRequested = false;
    },
    dismissPendingDerivedSourceDraft: (state) => {
      state.pendingDerivedSourceDraft = null;
      state.derivedSourceDraftRequested = false;
    },
    resetChatSession: (state) => {
      state.chatMessages = [currentAssistantWelcome()];
      state.agentThreadId = null;
      state.agentLogicalConversationId = null;
      state.agentPhysicalThreadSegment = null;
      state.agentParentMessageId = null;
    },
    restoreChatSession: (
      state,
      action: PayloadAction<{ messages: ChatMessage[] }>,
    ) => {
      state.chatMessages = upgradeAssistantWelcome(action.payload.messages);
      state.agentThreadId = null;
      state.agentLogicalConversationId = null;
      state.agentPhysicalThreadSegment = null;
      state.agentParentMessageId = null;
    },
    hydrateBuilderSession: (state, action: PayloadAction<PersistedSttmBuilderSession>) => {
      state.sourceDatabases = action.payload.sourceDatabases;
      state.targetDatabases = action.payload.targetDatabases;
      // Restore cache metadata if available, otherwise keep defaults
      if (action.payload.cacheMetadata) {
        state.cacheMetadata = action.payload.cacheMetadata;
      }
      state.sources = action.payload.sources;
      state.targets = action.payload.targets;
      state.sourceInfo = action.payload.sourceInfo;
      state.targetInfo = action.payload.targetInfo;
      state.sourceAttributeGroups = action.payload.sourceAttributeGroups;
      state.targetAttributeGroup = action.payload.targetAttributeGroup;
      state.mappingSuggestions = action.payload.mappingSuggestions;
      state.chatMessages = upgradeAssistantWelcome(action.payload.chatMessages);
      state.assistantSignals = action.payload.assistantSignals;
      state.assistantInferences = action.payload.assistantInferences;
      state.assistantUnreadCount = action.payload.assistantUnreadCount;
      // Recommendations are server-scoped runtime data. Never restore them from
      // a browser draft because doing so can leak cards across mappings/users.
      state.firRecommendations = [];
      state.firPrimaryQuestion = null;
      state.firRecommendationLoading = false;
      state.firRecommendationCheckpoint = null;
      state.firRecommendationContextKey = null;
      state.mappingIntent = action.payload.mappingIntent;
      state.agentThreadId = action.payload.agentThreadId;
      state.agentLogicalConversationId = action.payload.agentLogicalConversationId ?? null;
      state.agentPhysicalThreadSegment = action.payload.agentPhysicalThreadSegment ?? null;
      state.agentParentMessageId = action.payload.agentParentMessageId;
      state.semanticBundleId = action.payload.semanticBundleId;
      state.semanticBundleHash = action.payload.semanticBundleHash ?? null;
      state.learningContextId = action.payload.learningContextId ?? null;
      state.learningContextHash = action.payload.learningContextHash ?? null;
      state.workspaceContextId = action.payload.workspaceContextId ?? null;
      state.workspaceContextHash = action.payload.workspaceContextHash ?? null;
      state.workspaceContextSnapshotHash =
        action.payload.workspaceContextSnapshotHash ?? null;
      state.workspaceContextPendingSnapshotHash =
        action.payload.workspaceContextPendingSnapshotHash ?? null;
      state.workspaceContextStatus =
        action.payload.workspaceContextStatus ?? "idle";
      state.workspaceContextCacheStatus =
        action.payload.workspaceContextCacheStatus ?? null;
      state.workspaceContextError = action.payload.workspaceContextError ?? null;
      state.semanticBundleLabel = action.payload.semanticBundleLabel;
      state.semanticLevel = action.payload.semanticLevel;
      state.semanticStatus = action.payload.semanticStatus;
      state.semanticViewName = action.payload.semanticViewName;
      state.semanticContextSummary = action.payload.semanticContextSummary;
      state.semanticContextItems = action.payload.semanticContextItems;
      state.semanticLineage = action.payload.semanticLineage;
      state.semanticDatahubContext = action.payload.semanticDatahubContext;
      state.datahubStatus = action.payload.datahubStatus;
      state.pendingDerivedSourceDraft = action.payload.pendingDerivedSourceDraft;
      state.derivedSourceDraftRequested = action.payload.derivedSourceDraftRequested;
      state.drivingTableId = action.payload.drivingTableId;
      state.relationships = action.payload.relationships;
      state.derivedSources = action.payload.derivedSources;
      state.sourceFilterSql = action.payload.sourceFilterSql;
      state.sourceFilterGroups = cloneRuleGroups(action.payload.sourceFilterGroups);
      state.sourceQuerySql = action.payload.sourceQuerySql;
      state.sourceGroupBySql = action.payload.sourceGroupBySql;
      state.sourceOrderBySql = action.payload.sourceOrderBySql;
      state.mappings = action.payload.mappings;
      state.selectedMappingIds = action.payload.selectedMappingIds;
      state.mappingSql = action.payload.mappingSql;
      state.mappingPreviewSql = action.payload.mappingPreviewSql;
      state.mappingSqlVariant = action.payload.mappingSqlVariant;
      state.compiledMappingSql = action.payload.compiledMappingSql ?? "";
      state.compiledMappingPreviewSql = action.payload.compiledMappingPreviewSql ?? "";
      state.compiledMappingContextHash = action.payload.compiledMappingContextHash ?? null;
      state.isPreProcessModalOpen = action.payload.isPreProcessModalOpen;
      state.activeMappingId = action.payload.activeMappingId;
      state.pendingAiMappingReviews = action.payload.pendingAiMappingReviews;
      state.activeSttmId = action.payload.activeSttmId ?? null;
      state.activeProjectId = action.payload.activeProjectId ?? null;
      state.activeSttmName = action.payload.activeSttmName ?? null;
      state.activeProjectName = action.payload.activeProjectName ?? null;
      state.activeSnapshotId = action.payload.activeSnapshotId ?? null;
      state.sessionSavedAt = action.payload.sessionSavedAt ?? null;
      state.mappingLoading = false;
      state.chatLoading = false;
      state.autoMapStatusMessage = null;
      state.autoMapProcessingIds = [];
    },

    resetBuilderForNewMapping: (state) => {
      const sourceDatabases = cloneBranch(state.sourceDatabases).map((database) => ({
        ...database,
        isSelected: false,
        schemas: database.schemas.map((schema) => ({
          ...schema,
          isSelected: false,
          tables: schema.tables.map((table) => ({ ...table, isSelected: false })),
        })),
      }));
      const targetDatabases = cloneBranch(state.targetDatabases).map((database) => ({
        ...database,
        isSelected: false,
        schemas: database.schemas.map((schema) => ({
          ...schema,
          isSelected: false,
          tables: schema.tables.map((table) => ({ ...table, isSelected: false })),
        })),
      }));
      const session = state.session;
      const cacheMetadata = state.cacheMetadata;
      const initialStatus = state.loadState.initial;
      const derivedSources = state.derivedSources.map((source) => ({
        ...source,
        isSelected: false,
      }));
      Object.assign(state, {
        ...initialState,
        sourceDatabases,
        targetDatabases,
        session,
        cacheMetadata,
        derivedSources,
        loadState: { ...initialLoadState, initial: initialStatus },
      });
    },

    // UI Mapping Reducers
    loadMappingWorkspaceSnapshot: (
      state,
      action: PayloadAction<MappingWorkspaceSnapshot>,
    ) => {
      const snapshot = action.payload;
      state.sources = snapshot.sources;
      state.targets = snapshot.targets;
      state.sourceAttributeGroups = snapshot.sourceAttributeGroups;
      state.targetAttributeGroup = snapshot.targetAttributeGroup;
      state.mappings = snapshot.mappings;
      state.relationships = snapshot.relationships ?? [];
      state.drivingTableId =
        snapshot.drivingTableId ??
        snapshot.sources.find((table) => table.isSelected)?.tableId ??
        null;
      state.selectedMappingIds = [];
      state.pendingAiMappingReviews = [];
      state.mappingSuggestions = [];
      state.loadState.attributes = "success";
      state.activeSttmId = null;
      state.activeProjectId = null;
      state.activeSttmName = null;
      state.activeProjectName = null;
      state.activeSnapshotId = null;
      state.openSttmStatus = 'idle';
      state.openSttmTargetPage = null;
      state.openSttmErrorMessage = null;
      state.openSttmRequestId = null;
      state.firRecommendations = [];
      state.firPrimaryQuestion = null;
      state.firRecommendationCheckpoint = null;
      state.firRecommendationContextKey = null;
    },
    clearOpenSttmNavigation: (state) => {
      state.openSttmStatus = 'idle';
      state.openSttmTargetPage = null;
      state.openSttmErrorMessage = null;
      state.openSttmRequestId = null;
    },
    initializeMappings: (state, action: PayloadAction<MappingState[]>) => {
      state.mappings = action.payload;
      state.selectedMappingIds = [];
      state.pendingAiMappingReviews = [];
    },
    updateMapping: (state, action: PayloadAction<{ id: string; updates: Partial<MappingState> }>) => {
      const mapping = state.mappings.find((m) => m.id === action.payload.id);
      if (mapping) {
        Object.assign(mapping, action.payload.updates);
      }
    },
    applyPendingAiMappingReview: (state) => {
      const review = state.pendingAiMappingReviews[0];
      if (!review) return;
      const mapping = state.mappings.find((item) => item.id === review.mappingId);
      if (mapping) {
        applyMappingSuggestion(mapping, review);
      }
      state.pendingAiMappingReviews = state.pendingAiMappingReviews.slice(1);
      state.selectedMappingIds = state.selectedMappingIds.filter((id) => id !== review.mappingId);
    },
    skipPendingAiMappingReview: (state) => {
      state.pendingAiMappingReviews = state.pendingAiMappingReviews.slice(1);
    },
    toggleMappingSelection: (state, action: PayloadAction<{ id: string }>) => {
      const idx = state.selectedMappingIds.indexOf(action.payload.id);
      if (idx >= 0) {
        state.selectedMappingIds.splice(idx, 1);
      } else {
        state.selectedMappingIds.push(action.payload.id);
      }
    },
    selectAllMappings: (state, action: PayloadAction<{ ids: string[]; select: boolean }>) => {
      if (action.payload.select) {
        state.selectedMappingIds = Array.from(new Set([...state.selectedMappingIds, ...action.payload.ids]));
      } else {
        state.selectedMappingIds = state.selectedMappingIds.filter((id) => !action.payload.ids.includes(id));
      }
    },
    bulkMarkMapped: (state, action: PayloadAction<{ ids: string[] }>) => {
      state.mappings.forEach((mapping) => {
        if (action.payload.ids.includes(mapping.id) && mapping.sourceColumn) {
          mapping.status = "MAPPED";
        }
      });
      state.selectedMappingIds = [];
    },
    bulkSetDirect: (state, action: PayloadAction<{ ids: string[] }>) => {
      state.mappings.forEach((mapping) => {
        if (action.payload.ids.includes(mapping.id)) {
          mapping.rule = "Direct";
          mapping.expression = null;
          if (mapping.sourceColumn) {
            mapping.status = "MAPPED";
          }
        }
      });
      state.selectedMappingIds = [];
    },
    setPreProcessModalOpen: (
      state,
      action: PayloadAction<{ open: boolean; mappingId?: string | null }>
    ) => {
      state.isPreProcessModalOpen = action.payload.open;
      if (action.payload.open && action.payload.mappingId) {
        state.activeMappingId = action.payload.mappingId;
      } else if (!action.payload.open) {
        state.activeMappingId = null;
      }
    },
    setMappingSql: (state, action: PayloadAction<{ sql: string }>) => {
      state.mappingSql = action.payload.sql;
    },
    setMappingPreviewSql: (state, action: PayloadAction<{ sql: string }>) => {
      state.mappingPreviewSql = action.payload.sql;
    },
    setMappingSqlVariant: (
      state,
      action: PayloadAction<{ variant: "original" | "optimized" | null }>,
    ) => {
      state.mappingSqlVariant = action.payload.variant;
    },
    setCompiledMappingResult: (
      state,
      action: PayloadAction<{
        generatedSql: string;
        previewSql: string;
        contextHash: string;
      }>,
    ) => {
      state.compiledMappingSql = action.payload.generatedSql;
      state.compiledMappingPreviewSql = action.payload.previewSql;
      state.compiledMappingContextHash = action.payload.contextHash;
    },
    applyParsedSqlWorkspace: (
      state,
      action: PayloadAction<ParsedSqlWorkspaceApplyPayload>,
    ) => {
      const sourceFqns = new Set(action.payload.sourceTableFqns.map((value) => value.toUpperCase()));
      const targetFqn = action.payload.targetTableFqn?.toUpperCase() ?? null;
      const sourcePlaceholders: TableNode[] = action.payload.sourceTableFqns
        .filter(
          (qualifiedName) =>
            !state.sources.some(
              (table) => table.qualifiedName.toUpperCase() === qualifiedName.toUpperCase(),
            ),
        )
        .map((qualifiedName) => ({
          tableId: qualifiedName,
          tableName: qualifiedName.split(".").pop() ?? qualifiedName,
          qualifiedName,
          isSelected: true,
          tag: "Source",
          rows: "--",
          columns: 0,
          columnItems: [],
        }));
      state.sources = [...state.sources.map((table) => ({
        ...table,
        isSelected: sourceFqns.has(table.qualifiedName.toUpperCase()),
      })), ...sourcePlaceholders];
      const targetPlaceholder: TableNode[] =
        action.payload.targetTableFqn &&
        !state.targets.some(
          (table) =>
            table.qualifiedName.toUpperCase() ===
            action.payload.targetTableFqn!.toUpperCase(),
        )
          ? [{
              tableId: action.payload.targetTableFqn,
              tableName:
                action.payload.targetTableFqn.split(".").pop() ??
                action.payload.targetTableFqn,
              qualifiedName: action.payload.targetTableFqn,
              isSelected: true,
              tag: "Target",
              rows: "--",
              columns: action.payload.mappings.length,
              columnItems: [],
            }]
          : [];
      state.targets = [...state.targets.map((table) => ({
        ...table,
        isSelected: targetFqn === table.qualifiedName.toUpperCase(),
      })), ...targetPlaceholder];
      for (const database of state.sourceDatabases) {
        for (const schema of database.schemas) {
          for (const table of schema.tables) {
            table.isSelected = sourceFqns.has(table.qualifiedName.toUpperCase());
          }
        }
      }
      for (const database of state.targetDatabases) {
        for (const schema of database.schemas) {
          for (const table of schema.tables) {
            table.isSelected = targetFqn === table.qualifiedName.toUpperCase();
          }
        }
      }
      state.drivingTableId =
        state.sources.find((table) => table.isSelected)?.tableId ??
        Array.from(sourceFqns)[0] ??
        null;
      state.relationships = action.payload.relationships;
      state.mappings = action.payload.mappings;
      state.selectedMappingIds = [];
      state.sourceFilterSql = action.payload.filterSql;
      state.sourceFilterGroups = [];
      state.derivedSources = [
        ...state.derivedSources.filter(
          (source) => !action.payload.derivedSources.some((item) => item.name === source.sourceName),
        ),
        ...action.payload.derivedSources.map((item) => ({
          id: `sql-cte:${item.name}`,
          sourceName: item.name,
          isSelected: true,
          sqlText: item.sqlText ?? undefined,
          purpose: item.purpose ?? undefined,
          businessDescription: item.candidateReasons?.length
            ? item.candidateReasons.join("; ")
            : undefined,
          outputColumns: item.outputColumns ?? [],
          baseSourceTables: (item.inputTables ?? []).map(makeTableRef),
          tableIds: item.inputTables ?? [],
          selectedColumnsByTable: {},
          joins: [],
          filters: [],
          columns: (item.outputColumns ?? [])
            .map((column) => ({
              name: String(column.name ?? column.column_name ?? "").trim(),
              type: String(
                column.data_type ?? column.dataType ?? column.type ?? "—",
              ),
            }))
            .filter((column) => Boolean(column.name)),
        })),
      ];
      state.mappingSql = action.payload.sql;
      state.mappingPreviewSql = "";
      state.mappingSqlVariant = null;
      state.compiledMappingSql = "";
      state.compiledMappingPreviewSql = "";
      state.compiledMappingContextHash = null;
      state.pendingAiMappingReviews = [];
      state.agentThreadId = null;
      state.agentLogicalConversationId = null;
      state.agentPhysicalThreadSegment = null;
      state.agentParentMessageId = null;
    },
  },

  extraReducers: (builder) => {
    // ── fetchDatabases ──
    builder
      .addCase(fetchDatabases.pending, (state) => {
        state.loadState.initial = "loading";
        state.errorState.initial = undefined;
      })
      .addCase(fetchDatabases.fulfilled, (state, action) => {
        const branch: DatabaseNode[] = action.payload.databases.map(
          (db: { database_name: string }) => ({
            dbId: db.database_name,
            dbName: db.database_name,
            dbType: "SNOWFLAKE",
            connectionId: db.database_name,
            isSelected: false,
            schemas: [],
            schemasLoaded: false,
          })
        );
        state.sourceDatabases = branch;
        state.targetDatabases = cloneBranch(branch);
        state.session = action.payload.session;
        state.cacheMetadata.databasesFetchedAt = action.payload.fetchedAt;
        state.loadState.initial = "success";
      })
      .addCase(fetchDatabases.rejected, (state, action) => {
        state.loadState.initial = "error";
        state.errorState.initial = action.payload as string;
        state.sourceDatabases = [];
        state.targetDatabases = [];
      });

    builder.addCase(fetchDerivedSources.fulfilled, (state, action) => {
      state.derivedSources = mergeDerivedSourceLists(
        state.derivedSources,
        action.payload.derivedSources.map((source: DerivedSource) => ({
          ...source,
          isSelected: source.isSelected ?? false,
        })),
      );
      state.cacheMetadata.derivedSourcesFetchedAt = action.payload.fetchedAt;
    });

    // ── fetchSchemas ──
    builder
      .addCase(fetchSchemas.pending, (state, action) => {
        const key = `${action.meta.arg.type}:${action.meta.arg.dbId}`;
        state.loadState.schemasByDb[key] = "loading";
        state.errorState.schemasByDb[key] = undefined;
      })
      .addCase(fetchSchemas.fulfilled, (state, action) => {
        const { type, dbId, schemas } = action.payload;
        const key = `${type}:${dbId}`;
        const branch = type === "source" ? state.sourceDatabases : state.targetDatabases;
        const db = branch.find((d) => d.dbId === dbId);
        if (db) {
          db.schemas = schemas.map((s: { schema_name: string }) => ({
            schemaId: `${dbId}:${s.schema_name}`,
            schemaName: s.schema_name,
            isSelected: false,
            tables: [],
            tablesLoaded: false,
          }));
          db.schemasLoaded = true;
        }
        state.loadState.schemasByDb[key] = "success";
      })
      .addCase(fetchSchemas.rejected, (state, action) => {
        const p = action.payload as { type: string; dbId: string; message: string };
        const key = `${p.type}:${p.dbId}`;
        state.loadState.schemasByDb[key] = "error";
        state.errorState.schemasByDb[key] = p.message;
      });

    // ── fetchTables ──
    builder
      .addCase(fetchTables.pending, (state, action) => {
        const key = `${action.meta.arg.type}:${action.meta.arg.schemaId}`;
        state.loadState.tablesBySchema[key] = "loading";
        state.errorState.tablesBySchema[key] = undefined;
      })
      .addCase(fetchTables.fulfilled, (state, action) => {
        if (!action.payload) return;
        const { type, dbId, schemaId, tables: rawTables, cached } = action.payload;
        const key = `${type}:${schemaId}`;
        const [databaseName, schemaName] = schemaId.split(":", 2);

        const branch = type === "source" ? state.sourceDatabases : state.targetDatabases;
        const selectedBeforeLoad = new Map(
          (type === "source"
            ? resolveSelectedSourceTables(state)
            : state.targets.filter((table) => table.isSelected)
          ).map((table) => [table.qualifiedName.toUpperCase(), table]),
        );
        const db = branch.find((d) => d.dbId === dbId);

        if (!cached && rawTables && db) {
          const schema = db.schemas.find((s) => s.schemaId === schemaId);
          if (schema) {
            const previousTables = schema.tables;
            schema.tables = rawTables.map(
              (t: { table_name: string; row_count?: number | null; column_count?: number }) => {
                const qualifiedName = `${databaseName}.${schemaName}.${t.table_name}`;
                const existing = previousTables.find((item) => item.qualifiedName === qualifiedName);
                const hydrated = selectedBeforeLoad.get(qualifiedName.toUpperCase());
                return {
                  tableId: qualifiedName,
                  tableName: t.table_name,
                  qualifiedName,
                  isSelected: existing?.isSelected ?? Boolean(hydrated?.isSelected),
                  tag: type === "source" ? "Source" : "Target",
                  rows:
                    t.row_count !== null && t.row_count !== undefined
                      ? String(t.row_count)
                      : "--",
                  columns: t.column_count ?? hydrated?.columns ?? 0,
                  columnItems: existing?.columnItems ?? hydrated?.columnItems ?? [],
                };
              },
            );
            schema.tablesLoaded = true;
          }
        }

        // Set active selection + flat list
        branch.forEach((d) => {
          const isActiveDb = d.dbId === dbId;
          d.isSelected = isActiveDb;
          d.schemas.forEach((s) => {
            s.isSelected = isActiveDb && s.schemaId === schemaId;
          });
        });

        const activeSchema = db?.schemas.find((s) => s.schemaId === schemaId);
        const flatTables = activeSchema?.tables.map((t) => ({ ...t })) ?? [];

        if (type === "source") {
          const selectedOutsideActiveSchema = [...selectedBeforeLoad.values()].filter(
            (table) =>
              table.isSelected &&
              !flatTables.some(
                (candidate) =>
                  candidate.qualifiedName.toUpperCase() === table.qualifiedName.toUpperCase(),
              ),
          );
          state.sources = [...flatTables, ...selectedOutsideActiveSchema];
          state.sourceInfo = { dbName: databaseName, schemaName };
        } else {
          const selectedTarget = [...selectedBeforeLoad.values()].find((table) => table.isSelected);
          state.targets =
            selectedTarget &&
            !flatTables.some(
              (candidate) =>
                candidate.qualifiedName.toUpperCase() === selectedTarget.qualifiedName.toUpperCase(),
            )
              ? [...flatTables, selectedTarget]
              : flatTables;
          state.targetInfo = { dbName: databaseName, schemaName };
          state.targetAttributeGroup = null;
          state.mappingSuggestions = [];
          state.agentThreadId = null;
          state.agentLogicalConversationId = null;
          state.agentPhysicalThreadSegment = null;
          state.agentParentMessageId = null;
        }

        state.loadState.tablesBySchema[key] = "success";
      })
      .addCase(fetchTables.rejected, (state, action) => {
        const p = action.payload as { type: string; schemaId: string; message: string };
        const key = `${p.type}:${p.schemaId}`;
        state.loadState.tablesBySchema[key] = "error";
        state.errorState.tablesBySchema[key] = p.message;
      });

    // ── fetchAttributes ──
    builder
      .addCase(fetchAttributes.pending, (state, action) => {
        state.loadState.attributes = "loading";
        state.attributeRequestIds[action.meta.arg.side] = action.meta.requestId;
        if (action.meta.arg.side === "target") {
          state.errorState.attributes = undefined;
        }
      })
      .addCase(fetchAttributes.fulfilled, (state, action) => {
        if (!action.payload) return;
        const { side, groups } = action.payload;
        // Source metadata is hydrated incrementally. A later request can cover
        // newly selected tables while an earlier request is still running, so
        // both valid result sets must be merged. Target selection remains
        // single-valued and keeps stale-response protection.
        if (
          side === "target"
          && state.attributeRequestIds[side] !== action.meta.requestId
        ) return;
        if (side === "source") {
          const mergedGroups = new Map(
            state.sourceAttributeGroups.map((group) => [group.qualifiedName, group]),
          );
          for (const group of groups) {
            mergedGroups.set(group.qualifiedName, group);
          }
          state.sourceAttributeGroups = Array.from(mergedGroups.values());
          state.sources = mergeColumnsIntoTables(state.sources, groups);
          mergeColumnsIntoBranch(state.sourceDatabases, groups);
        } else {
          state.targetAttributeGroup = groups[0] ?? null;
          state.targets = mergeColumnsIntoTables(state.targets, groups);
          mergeColumnsIntoBranch(state.targetDatabases, groups);
        }
        state.attributeRequestIds[side] = null;
        state.loadState.attributes = "success";
      })
      .addCase(fetchAttributes.rejected, (state, action) => {
        const side = action.meta.arg.side;
        if (
          side === "target"
          && state.attributeRequestIds[side] !== action.meta.requestId
        ) return;
        state.attributeRequestIds[side] = null;
        state.loadState.attributes = "error";
        state.errorState.attributes = action.payload as string;
      });

    // ── fetchRelationships ──
    builder
      .addCase(fetchRelationships.pending, (state, action) => {
        state.loadState.relationships = "loading";
        state.relationshipRequestId = action.meta.requestId;
        state.errorState.relationships = undefined;
      })
      .addCase(fetchRelationships.fulfilled, (state, action) => {
        if (state.relationshipRequestId !== action.meta.requestId) return;
        state.relationshipRequestId = null;
        state.loadState.relationships = "success";
        const selectedTableIds = new Set(
          [
            ...resolveSelectedSourceTables(state).map((table) => table.qualifiedName),
            ...state.derivedSources
              .filter((source) => source.isSelected)
              .flatMap((source) => [source.id, `DERIVED.${source.sourceName}`]),
          ].map((relationId) => relationId.toUpperCase()),
        );
        const activePayload = action.payload.filter((item) => !item.reviewRequired);
        const reviewPayload = action.payload.filter((item) => item.reviewRequired);
        const merged = new Map<string, JoinConfig>();
        for (const relationship of [...state.relationships, ...activePayload].filter(
          (item) =>
            Boolean(item.leftTableId) &&
            Boolean(item.rightTableId) &&
            selectedTableIds.has(String(item.leftTableId).toUpperCase()) &&
            selectedTableIds.has(String(item.rightTableId).toUpperCase()),
        )) {
          const conditionKey = (relationship.conditions ?? [])
            .map((condition) =>
              `${condition.leftColumn ?? ""}${condition.operator ?? "="}${condition.rightColumn ?? ""}`,
            )
            .join("&");
          const key = relationship.id ??
            `${relationship.leftTableId}|${relationship.rightTableId}|${conditionKey}`;
          const current = merged.get(key);
          // Explicit/imported joins carry business SQL that a metadata lookup
          // cannot safely replace with an empty or less specific relationship.
          if (!current || current.source !== "USER_DEFINED") {
            merged.set(key, relationship);
          }
        }
        state.relationships = [...merged.values()];
        state.relationshipCandidates = reviewPayload.filter(
          (item) =>
            Boolean(item.leftTableId) &&
            Boolean(item.rightTableId) &&
            selectedTableIds.has(String(item.leftTableId).toUpperCase()) &&
            selectedTableIds.has(String(item.rightTableId).toUpperCase()),
        );
      })
      .addCase(fetchRelationships.rejected, (state, action) => {
        if (state.relationshipRequestId !== action.meta.requestId) return;
        state.relationshipRequestId = null;
        state.loadState.relationships = "error";
        state.errorState.relationships = action.payload as string;
      });

    // ── runAutoMap ──
    builder
      .addCase(autoMapBatchesInitialized, (state, action) => {
        state.autoMapProcessingIds = [];
        state.autoMapStatusMessage = `Auto-mapping 0/${action.payload.totalCount} target columns...`;
      })
      .addCase(autoMapBatchStarted, (state, action) => {
        state.autoMapProcessingIds = action.payload.processingIds;
        for (const mapping of state.mappings) {
          if (action.payload.processingIds.includes(mapping.id) && mapping.status !== "MAPPED") {
            mapping.status = "PROCESSING";
          }
        }
        const nextCount = Math.min(
          action.payload.processedCount + action.payload.processingIds.length,
          action.payload.totalCount,
        );
        state.autoMapStatusMessage = `Auto-mapping ${action.payload.processedCount + 1}-${nextCount} of ${action.payload.totalCount} target columns...`;
      })
      .addCase(autoMapBatchApplied, (state, action) => {
        state.autoMapProcessingIds = state.autoMapProcessingIds.filter(
          (id) => !action.payload.completedMappingIds.includes(id),
        );
        applyAutoMapResponseToState(state, action.payload.response);
        state.autoMapStatusMessage =
          action.payload.processedCount < action.payload.totalCount
            ? `Auto-mapped ${action.payload.processedCount}/${action.payload.totalCount} target columns...`
            : `Auto-mapped ${action.payload.totalCount}/${action.payload.totalCount} target columns.`;
      })
      .addCase(autoMapBatchFailed, (state, action) => {
        state.autoMapProcessingIds = state.autoMapProcessingIds.filter(
          (id) => !action.payload.completedMappingIds.includes(id),
        );
        for (const mapping of state.mappings) {
          if (action.payload.completedMappingIds.includes(mapping.id) && mapping.status === "PROCESSING") {
            mapping.status = "UNMAPPED";
          }
        }
        state.errorState.autoMap = action.payload.errorMessage;
        state.autoMapStatusMessage =
          action.payload.processedCount < action.payload.totalCount
            ? `Auto-mapped ${action.payload.processedCount}/${action.payload.totalCount} target columns...`
            : action.payload.errorMessage;
      })
      .addCase(runAutoMap.pending, (state) => {
        state.mappingLoading = true;
        state.autoMapStatusMessage = "Preparing mapping-ready semantic context.";
        state.autoMapProcessingIds = [];
        state.errorState.autoMap = undefined;
      })
      .addCase(runAutoMap.fulfilled, (state, action) => {
        state.mappingLoading = false;
        state.autoMapProcessingIds = [];
        if (!action.payload) return;
        state.autoMapStatusMessage =
          action.payload.autoMappingReview?.headline ??
          (action.payload.failedTargets.length > 0
            ? `Auto-map finished with ${action.payload.failedTargets.length} issue(s).`
            : null);
        if (action.payload.reviewSummary) {
          state.chatMessages.push({
            id: createChatMessageId(),
            role: "assistant",
            content: action.payload.reviewSummary,
            status: "completed",
          });
          state.assistantUnreadCount += 1;
        }
        if (action.payload.semanticBundleId) {
          state.semanticBundleId = action.payload.semanticBundleId;
        }
        if (action.payload.semanticViewName) {
          state.semanticViewName = action.payload.semanticViewName;
        }
        if (action.payload.semanticContextItems) {
          state.semanticContextItems = action.payload.semanticContextItems;
        }
      })
      .addCase(runAutoMap.rejected, (state, action) => {
        state.mappingLoading = false;
        state.autoMapProcessingIds = [];
        state.autoMapStatusMessage = null;
        state.errorState.autoMap =
          (action.payload as string | undefined) ?? "Auto-map failed.";
      });

    // ── sendChatMessage ──
    builder
      .addCase(sendChatMessage.pending, (state, action) => {
        state.chatLoading = true;
        state.pendingAiMappingReviews = [];
        const msg = action.meta.arg.trim();
        if (msg) {
          state.chatMessages.push({ id: createChatMessageId(), role: "user", content: msg });
        }
      })
      .addCase(sendChatMessage.fulfilled, (state, action) => {
        state.chatLoading = false;
        if (!action.payload) return;
        if (action.payload.semanticRefresh) {
          applySemanticRefreshToState(state, action.payload.semanticRefresh);
        }
        if (isConversationEnvelopeResponse(action.payload.response)) {
          const conversationResponse = action.payload.response;
          state.agentThreadId =
            (typeof conversationResponse.context?.thread_id === "string"
              ? conversationResponse.context.thread_id
              : state.agentThreadId);
          state.agentLogicalConversationId =
            (typeof conversationResponse.context?.logical_conversation_id === "string"
              ? conversationResponse.context.logical_conversation_id
              : typeof conversationResponse.meta?.logical_conversation_id === "string"
                ? conversationResponse.meta.logical_conversation_id
                : conversationResponse.data?.artifact?.conversation_id ??
                  state.agentLogicalConversationId);
          state.agentPhysicalThreadSegment =
            (typeof conversationResponse.context?.physical_thread_segment === "number"
              ? conversationResponse.context.physical_thread_segment
              : typeof conversationResponse.meta?.thread_segment === "number"
                ? conversationResponse.meta.thread_segment
                : state.agentPhysicalThreadSegment);
          state.agentParentMessageId = null;
          if (action.payload.messageId) {
            const message = state.chatMessages.find((item) => item.id === action.payload.messageId);
            if (message) {
              message.content = (conversationResponse.data?.message ?? "").trim();
              message.status =
                (conversationResponse.data?.status as "completed" | "needs_input" | "failed" | undefined) ??
                "completed";
              message.options =
                conversationResponse.data?.artifact?.quick_replies?.map((item) => String(item)).filter(Boolean) ??
                [];
              message.isStreaming = false;
              message.requestId = conversationResponse.request_id ?? null;
              message.conversationId = conversationResponse.data?.artifact?.conversation_id ?? null;
              message.feedbackStatus = "idle";
              message.feedbackRating = null;
            }
          }
          return;
        }

        state.agentThreadId =
          action.payload.response.thread_id ??
          (typeof action.payload.response.context?.thread_id === "string"
            ? action.payload.response.context.thread_id
            : state.agentThreadId);
        state.agentLogicalConversationId =
          (typeof action.payload.response.context?.logical_conversation_id === "string"
            ? action.payload.response.context.logical_conversation_id
            : typeof action.payload.response.meta?.logical_conversation_id === "string"
              ? action.payload.response.meta.logical_conversation_id
              : state.agentLogicalConversationId);
        state.agentPhysicalThreadSegment =
          (typeof action.payload.response.context?.physical_thread_segment === "number"
            ? action.payload.response.context.physical_thread_segment
            : typeof action.payload.response.meta?.thread_segment === "number"
              ? action.payload.response.meta.thread_segment
              : state.agentPhysicalThreadSegment);
        state.agentParentMessageId =
          action.payload.response.parent_message_id ??
          action.payload.response.context?.parent_message_id ??
          null;
        state.semanticBundleId =
          action.payload.response.data?.semantic_refresh_status?.bundle_id ?? state.semanticBundleId;
        state.semanticBundleLabel =
          (action.payload.response.data?.semantic_refresh_status?.bundle_label as string | undefined) ??
          (typeof action.payload.response.data?.artifact?.summary === "object" &&
          action.payload.response.data?.artifact?.summary &&
          "bundle_label" in action.payload.response.data.artifact.summary
            ? (action.payload.response.data.artifact.summary.bundle_label as string | null)
            : state.semanticBundleLabel);
        state.semanticLevel =
          action.payload.response.data?.semantic_level_achieved ?? state.semanticLevel;
        state.semanticStatus =
          action.payload.response.data?.semantic_refresh_status?.status ?? state.semanticStatus;
        state.semanticViewName = extractSemanticViewNameFromStatus(
          action.payload.response.data?.semantic_refresh_status as Record<string, unknown> | undefined,
          state.semanticViewName,
        );
        state.semanticContextItems =
          normalizeSemanticContextItems(
            action.payload.response.context?.semantic_context as Array<Record<string, unknown>> | undefined,
          ) ?? state.semanticContextItems;
        state.semanticLineage = Array.isArray(action.payload.response.context?.derived_source_lineage)
          ? action.payload.response.context.derived_source_lineage
          : state.semanticLineage;
        state.semanticDatahubContext =
          (action.payload.response.context?.datahub_context as Record<string, unknown> | null | undefined) ??
          state.semanticDatahubContext;
        const resolved = resolveAgentResponseParts(action.payload.response);
        if (resolved.artifactType === "semantic_context") {
          state.semanticContextSummary =
            (resolved.artifact as Record<string, unknown> | null) ??
            state.semanticContextSummary;
        }
        if (resolved.artifactType === "derived_source_draft" && resolved.artifact) {
          const artifact = resolved.artifact;
          if (typeof artifact.sql_text === "string") {
          const artifactSelectedColumns =
            typeof artifact.selected_columns_by_table === "object" &&
            artifact.selected_columns_by_table !== null
              ? (artifact.selected_columns_by_table as Record<string, string[]>)
              : null;
          state.pendingDerivedSourceDraft = {
            sqlText: artifact.sql_text as string,
            sourceNameSuggestion:
              (artifact.source_name_suggestion as string | null) ?? null,
            semanticViewName:
              (artifact.semantic_view_name as string | null) ??
              state.semanticViewName,
            semanticBundleLabel: state.semanticBundleLabel,
            previewRows:
              (artifact.preview_rows as Array<Record<string, unknown>> | undefined) ??
              [],
            selectedColumnsByTable: artifactSelectedColumns,
            selectedTableIds: action.payload.selectedTableIds,
            drivingTableId: action.payload.drivingTableId,
            requestSummary:
              (artifact.request_summary as string | null) ??
              action.payload.userMessage,
            purpose: (artifact.purpose as string | null) ?? action.payload.userMessage,
            businessDescription:
              (artifact.business_description as string | null) ??
              (artifact.request_summary as string | null) ??
              action.payload.userMessage,
            grain: (artifact.grain as string | null) ?? null,
            keys: Array.isArray(artifact.keys) ? (artifact.keys as string[]) : [],
            outputColumns: Array.isArray(artifact.output_columns)
              ? (artifact.output_columns as Array<Record<string, unknown>>)
              : [],
            columnSemantics: Array.isArray(artifact.column_semantics)
              ? (artifact.column_semantics as Array<Record<string, unknown>>)
              : [],
            generatedByRequestId:
              (action.payload.response.request_id as string | null | undefined) ?? null,
          };
          state.derivedSourceDraftRequested = false;
          }
        }
        const clarificationOptions = extractClarificationOptions(action.payload.response);
        const responseStatus = action.payload.response.data?.status as
          | "completed"
          | "needs_input"
          | "failed"
          | undefined;
        const pendingReviews = buildPendingAiMappingReviews(
          state.mappings,
          action.payload.selectedMappingIds ?? [],
          state.activeMappingId,
          action.payload.response,
        );
        if (action.payload.messageId) {
          const finalMessage = extractAssistantDisplayText(
            action.payload.response,
            pendingReviews,
          );
          const message = state.chatMessages.find((item) => item.id === action.payload.messageId);
          if (message) {
            message.content = finalMessage;
            message.status = responseStatus ?? "completed";
            message.options = clarificationOptions;
            message.isStreaming = false;
          }
        }
        const datahubContext = action.payload.response.context?.datahub_context as
          | Record<string, unknown>
          | null
          | undefined;
        state.datahubStatus =
          typeof datahubContext?.status === "string" ? datahubContext.status : state.datahubStatus;
        if (pendingReviews.length > 0) {
          state.pendingAiMappingReviews = pendingReviews;
        }
      })
      .addCase(sendChatMessage.rejected, (state, action) => {
        state.chatLoading = false;
        const payload = action.payload as
          | {
              errorMessage?: string;
              semanticRefresh?: SemanticRefreshResult | null;
            }
          | undefined;
        if (payload?.semanticRefresh) {
          applySemanticRefreshToState(state, payload.semanticRefresh);
        }
      })
      .addCase(submitChatFeedback.fulfilled, (state, action) => {
        const message = state.chatMessages.find((item) => item.id === action.payload.messageId);
        if (!message) return;
        message.feedbackStatus = "sent";
        message.feedbackRating = action.payload.rating ?? null;
      })
      .addCase(submitChatFeedback.rejected, (state, action) => {
        const payload = action.payload as { messageId?: string } | undefined;
        if (!payload?.messageId) return;
        const message = state.chatMessages.find((item) => item.id === payload.messageId);
        if (!message) return;
        message.feedbackStatus = "failed";
      })
      .addCase(fetchAssistantSignals.fulfilled, (state, action) => {
        applyAssistantSignalsData(state, action.payload);
      })
      .addCase(updateAssistantPreferences.fulfilled, (state, action) => {
        state.assistantPreferences = action.payload.settings;
      })
      .addCase(evaluateFirRecommendations.pending, (state) => {
        state.firRecommendationLoading = true;
        // FIR 2.0 is the only proactive guidance source. Clear any saved
        // conversation-signal cards so legacy generic prompts cannot reappear.
        state.assistantSignals = [];
        state.assistantUnreadCount = 0;
      })
      .addCase(evaluateFirRecommendations.fulfilled, (state, action) => {
        const payload = action.payload as Record<string, unknown>;
        if (payload._cancelled) return;
        const correlationId = payload._correlationId as string | undefined;
        if (
          correlationId &&
          correlationId !== `fir_eval_${_firRecommendationCorrelationCounter}`
        ) {
          return;
        }
        const incoming = (payload.items as FIRRecommendation[] | undefined) ?? [];
        const currentCheckpoint = String(payload.checkpoint ?? "") || null;
        const currentContextKey = String(payload.context_key ?? "") || null;
        const seen = new Set<string>();
        // Each evaluation response replaces the previous scope immediately.
        // The backend returns all applicable cards for the active checkpoint.
        state.firRecommendations = incoming
          .filter((item) => {
            const key = `${item.recommendation_id}:${item.content_version ?? 1}:${item.checkpoint ?? ""}:${item.scope_key ?? ""}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 50);
        state.firPrimaryQuestion =
          (payload.primary_question as FIRRecommendation | null | undefined) ?? null;
        state.firRecommendationCheckpoint = currentCheckpoint;
        state.firRecommendationContextKey = currentContextKey;
        state.firRecommendationLoading = false;
      })
      .addCase(evaluateFirRecommendations.rejected, (state) => {
        state.firRecommendationLoading = false;
      })
      .addCase(respondToAssistantSignal.pending, (state, action) => {
        const signalId = action.meta.arg.signalId;
        const nextStatus = action.meta.arg.status ?? "responded";
        const signal = state.assistantSignals.find((item) => item.signal_id === signalId);
        if (signal) {
          signal.status = nextStatus as AssistantSignalStatus;
        }
        state.assistantUnreadCount = state.assistantSignals.filter((item) => item.status === "new").length;
      })
      .addCase(respondToAssistantSignal.fulfilled, (state, action) => {
        const signal = state.assistantSignals.find((item) => item.signal_id === action.payload.signalId);
        if (signal) {
          signal.status = action.payload.status as AssistantSignalStatus;
        }
        state.assistantUnreadCount = state.assistantSignals.filter((item) => item.status === "new").length;
      })

      // ─── openSttmFromBackend ──────────────────────────────────────
      .addCase(openSttmFromBackend.pending, (state, action) => {
        state.openSttmStatus = 'loading';
        state.openSttmTargetPage = null;
        state.openSttmErrorMessage = null;
        state.openSttmRequestId = action.meta.requestId;
        state.firRecommendations = [];
        state.firPrimaryQuestion = null;
      })
      .addCase(openSttmFromBackend.fulfilled, (state, action) => {
        if (state.openSttmRequestId !== action.meta.requestId) return;
        const { sttmId, projectId, detail } = action.payload;
        const snapshot = detail.latest_snapshot as Record<string, unknown> | null | undefined;

        // Reconstruct source TableNodes from snapshot source_tables
        const snapshotSources = Array.isArray(snapshot?.source_tables)
          ? (snapshot.source_tables as Array<Record<string, string>>)
          : [];
        const persistedSources = (detail.sources as Array<Record<string, unknown>>)
          .filter((row) => String(row.DESCRIPTION ?? row.description ?? '').startsWith('DERIVED_SOURCE:') === false)
          .map((row) => ({
            database: String(row.DATABASE_NAME ?? row.database_name ?? ''),
            schema: String(row.SCHEMA_NAME ?? row.schema_name ?? ''),
            table: String(row.TABLE_NAME ?? row.table_name ?? ''),
          }))
          .filter((ref) => ref.database && ref.schema && ref.table);
        const rawSources = snapshotSources.length ? snapshotSources : persistedSources;
        state.sources = rawSources.map((ref) => {
          const qn = `${ref.database}.${ref.schema}.${ref.table}`;
          return {
            tableId: qn,
            tableName: ref.table,
            qualifiedName: qn,
            isSelected: true,
            tag: '',
            rows: '',
            columns: 0,
          } as TableNode;
        });

        // Reconstruct target TableNode from sttm record
        const snapshotTarget = snapshotTableFqn(
          snapshot?.target_table
          ?? (Array.isArray(snapshot?.target_tables) ? snapshot.target_tables[0] : null),
        );
        const targetQn = detail.sttm.target_table ?? snapshotTarget ?? '';
        const targetParts = targetQn.split('.');
        if (targetQn) {
          state.targets = [
            {
              tableId: targetQn,
              tableName: targetParts[targetParts.length - 1] ?? targetQn,
              qualifiedName: targetQn,
              isSelected: true,
              tag: '',
              rows: '',
              columns: 0,
            } as TableNode,
          ];
        }

        // Reconstruct MappingState[] from persisted STTM attributes.
        // The backend normalizes existing TBL_STTM_ATTRIBUTES rows to lower-case
        // keys, while these fallbacks keep older saved payloads readable.
        const snapshotMappingRows = Array.isArray(snapshot?.mapping_rows)
          ? snapshot.mapping_rows as Array<Record<string, unknown>>
          : [];
        const rawMappingRows = snapshotMappingRows.length
          ? snapshotMappingRows
          : detail.mapping_rows as Array<Record<string, unknown>>;
        state.mappings = rawMappingRows.map((row) => {
          const rawSourceColumns = row.source_columns ?? row.SOURCE_COLUMNS;
          const sourceColumns = Array.isArray(rawSourceColumns)
            ? rawSourceColumns.map((value) => String(value)).filter(Boolean)
            : typeof rawSourceColumns === 'string' && rawSourceColumns.trim()
              ? rawSourceColumns.split(',').map((value) => value.trim()).filter(Boolean)
              : [];
          const ruleRaw = String(row.rule ?? row.preprocessing_rule ?? row.PREPROCESSING_RULE ?? 'Direct') || 'Direct';
          const statusRaw = String(row.status ?? row.STATUS ?? '').toUpperCase();
          const confidenceRaw = row.confidence ?? row.CONFIDENCE;
          const mappingModeRaw = String(row.mapping_mode ?? row.MAPPING_MODE ?? "source").toLowerCase();
          const mappingMode =
            mappingModeRaw === "constant"
              ? "constant"
              : mappingModeRaw === "attribute"
                ? "attribute"
                : "source";
          return {
            id: String(row.id ?? row.mapping_row_id ?? row.MAPPING_ROW_ID ?? row.attribute_id ?? ''),
            targetColumn: String(row.target_column ?? row.TARGET_COLUMN ?? row.ATTRIBUTE_NAME ?? ''),
            targetType: String(row.target_type ?? row.TARGET_DATA_TYPE ?? row.DATA_TYPE ?? ''),
            sourceColumn: sourceColumns[0] ?? null,
            sourceType: null,
            sourceColumns,
            mappingMode,
            constantValue:
              (row.constant_value ?? row.CONSTANT_VALUE ?? null) as string | null,
            attributeName:
              (row.attribute_name ?? row.ATTRIBUTE_NAME_ATTR ?? null) as string | null,
            expression:
              mappingMode === "constant" || mappingMode === "attribute"
                ? null
                : (row.expression ?? row.TRANSFORMATION_EXPR ?? row.TRANSFORMATION_LOGIC ?? null) as string | null,
            rule: ruleRaw as MappingRuleType,
            status: (statusRaw === 'MAPPED' || statusRaw === 'ACCEPTED' ? 'MAPPED' : 'UNMAPPED') as MappingStatus,
            nlRule: (row.natural_language_rule ?? row.NATURAL_LANGUAGE_RULE ?? null) as string | null,
            loadOrder: row.load_order != null ? String(row.load_order) : row.LOAD_ORDER != null ? String(row.LOAD_ORDER) : null,
            description: (row.description ?? row.DESCRIPTION ?? null) as string | null,
            confidenceScore: typeof confidenceRaw === 'number' ? confidenceRaw : null,
            confidenceReason: (row.confidence_reason ?? row.CONFIDENCE_REASON ?? null) as string | null,
          } satisfies MappingState;
        });

        // Relationships and driving table from snapshot
        state.relationships = normalizeSnapshotRelationships(snapshot?.relationships);
        const drivingRef = snapshot?.driving_table as Record<string, string> | null | undefined;
        state.drivingTableId = drivingRef
          ? `${drivingRef.database}.${drivingRef.schema}.${drivingRef.table}`
          : (state.sources.find((s) => s.isSelected)?.tableId ?? null);

        // Clear attribute groups — mapping page will auto-fetch them on mount
        state.sourceAttributeGroups = [];
        state.targetAttributeGroup = null;
        state.loadState.attributes = 'idle';

        const filters = (snapshot?.filters ?? {}) as Record<string, unknown>;
        state.sourceFilterSql = String(filters.filter_sql ?? "");
        state.sourceQuerySql = String(filters.base_query_sql ?? "");
        state.sourceGroupBySql = String(filters.group_by_sql ?? "");
        state.sourceOrderBySql = String(filters.order_by_sql ?? "");
        state.sourceFilterGroups = Array.isArray(filters.groups)
          ? (filters.groups as RuleGroup[])
          : [];
        state.mappingSql = String(snapshot?.raw_mapping_sql ?? snapshot?.mapping_sql ?? "");
        state.mappingPreviewSql = String(snapshot?.mapping_preview_sql ?? "");
        state.mappingSqlVariant = state.mappingPreviewSql ? "original" : null;
        state.compiledMappingSql = String(snapshot?.compiled_mapping_sql ?? "");
        state.compiledMappingPreviewSql = String(snapshot?.compiled_mapping_preview_sql ?? "");
        state.compiledMappingContextHash = String(snapshot?.compiled_mapping_context_hash ?? "") || null;

        const mappingIntent = snapshot?.mapping_intent;
        state.mappingIntent = mappingIntent && typeof mappingIntent === "object"
          ? (mappingIntent as MappingIntent)
          : null;

        const snapshotDerivedSources = (
          Array.isArray(snapshot?.derived_sources) ? snapshot.derived_sources : []
        ).filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
        const existingDerivedById = new Map(state.derivedSources.map((source) => [source.id, source]));
        state.derivedSources = snapshotDerivedSources.map((item, index) => {
          const id = String(item.id ?? item.derived_source_id ?? `derived-${index}`);
          const existing = existingDerivedById.get(id);
          return {
            id,
            sourceName: String(item.name ?? item.source_name ?? existing?.sourceName ?? id),
            isSelected: true,
            sqlText: String(item.sql_text ?? item.sqlText ?? existing?.sqlText ?? ''),
            semanticBundleId: String(item.semantic_bundle_id ?? item.semanticBundleId ?? '') || null,
            semanticBundleLabel: String(item.semantic_bundle_label ?? item.semanticBundleLabel ?? '') || null,
            semanticViewName: String(item.semantic_view_name ?? item.semanticViewName ?? '') || null,
            semanticLevel: String(item.semantic_level ?? item.semanticLevel ?? '') || null,
            upstreamHash: String(item.upstream_hash ?? item.upstreamHash ?? '') || null,
            sourceDependencyHash: String(item.source_dependency_hash ?? item.sourceDependencyHash ?? existing?.sourceDependencyHash ?? '') || null,
            physicalViewName: String(item.physical_view_name ?? item.physicalViewName ?? existing?.physicalViewName ?? '') || null,
            generatedByRequestId: String(item.generated_by_request_id ?? item.generatedByRequestId ?? existing?.generatedByRequestId ?? '') || null,
            purpose: String(item.purpose ?? existing?.purpose ?? '') || null,
            businessDescription: String(item.business_description ?? item.businessDescription ?? existing?.businessDescription ?? '') || null,
            grain: String(item.grain ?? existing?.grain ?? '') || null,
            keys: Array.isArray(item.keys) ? item.keys.map(String) : (existing?.keys ?? []),
            outputColumns: Array.isArray(item.output_columns ?? item.outputColumns)
              ? (item.output_columns ?? item.outputColumns) as Array<Record<string, unknown>>
              : (existing?.outputColumns ?? []),
            columnSemantics: Array.isArray(item.column_semantics ?? item.columnSemantics)
              ? (item.column_semantics ?? item.columnSemantics) as Array<Record<string, unknown>>
              : (existing?.columnSemantics ?? []),
            semanticProjection:
              (item.semantic_projection ?? item.semanticProjection ?? existing?.semanticProjection ?? {}) as Record<string, unknown>,
            semanticQuality: String(item.semantic_quality ?? item.semanticQuality ?? existing?.semanticQuality ?? '') || null,
            lineageDepth: Number(item.lineage_depth ?? item.lineageDepth ?? existing?.lineageDepth ?? 0),
            alias: String(item.alias ?? existing?.alias ?? '') || undefined,
            drivingTableId: String(item.driving_table_id ?? item.drivingTableId ?? '') || undefined,
            tableIds: Array.isArray(item.table_ids ?? item.tableIds)
              ? ((item.table_ids ?? item.tableIds) as unknown[]).map(String)
              : (existing?.tableIds ?? []),
            baseSourceTables: Array.isArray(item.base_source_tables ?? item.baseSourceTables)
              ? (item.base_source_tables ?? item.baseSourceTables) as TableRef[]
              : (existing?.baseSourceTables ?? []),
            selectedColumnsByTable:
              (item.selected_columns_by_table ?? item.selectedColumnsByTable ?? existing?.selectedColumnsByTable ?? {}) as Record<string, string[]>,
            joins: Array.isArray(item.joins) ? item.joins as DerivedSource['joins'] : (existing?.joins ?? []),
            filters: Array.isArray(item.filters) ? item.filters as RuleGroup[] : (existing?.filters ?? []),
            columns: Array.isArray(item.columns) ? item.columns as Column[] : (existing?.columns ?? []),
          } satisfies DerivedSource;
        });
        const relationGraph = snapshot?.relation_graph as Record<string, unknown> | null | undefined;
        const graphEdges = relationGraph?.edges;
        if (Array.isArray(graphEdges)) {
          const relationLabels = new Map<string, string>();
          for (const source of state.derivedSources) {
            // RelationshipFlow uses the stable derived-source ID as its node
            // identity; DERIVED.<name> is display text only.
            relationLabels.set(source.id, source.id);
          }
          state.relationships = normalizeSnapshotRelationships(graphEdges, relationLabels);
        }

        // Semantic identity is snapshot-scoped. Never retain the previous
        // mapping's bundle when this mapping has no linked semantic bundle.
        const semantic = (snapshot?.semantic ?? {}) as Record<string, unknown>;
        state.semanticBundleId = String(
          detail.sttm.semantic_bundle_id ?? semantic.bundle_id ?? "",
        ) || null;
        state.semanticBundleLabel = String(semantic.bundle_label ?? "") || null;
        state.semanticLevel = String(semantic.level ?? "") || null;
        state.semanticStatus = String(semantic.status ?? "") || null;
        state.semanticViewName = String(semantic.view_name ?? "") || null;
        state.semanticContextSummary = null;
        state.semanticContextItems = null;
        state.semanticLineage = [];
        state.semanticDatahubContext = null;
        state.datahubStatus = null;

        // Reset transient state
        const checkedIds = Array.isArray(snapshot?.checked_mapping_row_ids)
          ? snapshot.checked_mapping_row_ids.map(String)
          : [];
        state.selectedMappingIds = checkedIds.length
          ? checkedIds
          : state.mappings.filter((mapping) => mapping.status === "MAPPED").map((mapping) => mapping.id);
        state.activeMappingId = String(snapshot?.active_mapping_row_id ?? "") || null;
        state.pendingAiMappingReviews = [];
        state.mappingSuggestions = [];
        state.autoMapStatusMessage = null;

        // Chat and notification state belongs to user + project + mapping. A
        // newly opened STTM must never inherit the previous workspace thread.
        state.chatMessages = [currentAssistantWelcome()];
        state.agentThreadId = null;
        state.agentLogicalConversationId = null;
        state.agentPhysicalThreadSegment = null;
        state.agentParentMessageId = null;
        state.assistantSignals = [];
        state.assistantInferences = [];
        state.assistantUnreadCount = 0;
        state.firRecommendations = [];
        state.firPrimaryQuestion = null;
        state.firRecommendationCheckpoint = null;
        state.firRecommendationContextKey = null;

        // Set active STTM identity
        state.activeSttmId = sttmId;
        state.activeProjectId = projectId;
        state.activeSttmName = detail.sttm.sttm_name ?? null;
        state.activeProjectName = detail.project?.project_name ?? null;
        state.activeSnapshotId = String(
          snapshot?.snapshot_id ?? detail.sttm.last_snapshot_id ?? "",
        ) || null;
        state.sessionSavedAt = new Date().toISOString();

        // Determine target page from snapshot page field.
        // 'summary' → summary step, 'mapping' → mapping step, anything else (incl.
        // 'builder' or absent snapshot) → source/target selection step.
        const page = typeof snapshot?.page === 'string' ? snapshot.page : '';
        const durableRouteEnabled = process.env.NEXT_PUBLIC_DURABLE_STTM_ROUTE_V1 !== "false";
        const routeBase = durableRouteEnabled
          ? `/sttm/builder/${encodeURIComponent(sttmId)}`
          : "/sttm/builder/new";
        const targetPage =
          page === 'summary' ? `${routeBase}/summary` :
          page === 'mapping' || state.mappings.length > 0
            ? `${routeBase}/mapping`
            : routeBase;

        state.openSttmStatus = 'success';
        state.openSttmTargetPage = targetPage;
        state.openSttmErrorMessage = null;
        state.openSttmRequestId = null;
      })
      .addCase(openSttmFromBackend.rejected, (state, action) => {
        if (state.openSttmRequestId !== action.meta.requestId) return;
        state.openSttmStatus = 'error';
        state.openSttmErrorMessage = String(action.payload ?? 'Failed to load STTM.');
        state.openSttmTargetPage = null;
        state.openSttmRequestId = null;
      });
  },
});

export const {
  clearAssistantSignalsForContext,
  assistantStreamStarted,
  assistantStreamDelta,
  assistantStreamSqlDelta,
  assistantStreamStatus,
  assistantStreamOptions,
  assistantStreamFinished,
  assistantStreamFailed,
  setChatMessageFeedbackStatus,
  autoMapStreamStatus,
  applySemanticRefresh,
  markPreparedWorkspaceContextUpdating,
  applyPreparedWorkspaceContext,
  failPreparedWorkspaceContext,
  toggleSource,
  selectTarget,
  selectAllSources,
  clearSources,
  clearTargets,
  setDrivingTable,
  setRelationships,
  approveRelationshipCandidate,
  rejectRelationshipCandidate,
  setSourceFilterConditions,
  addDerivedSource,
  updateDerivedSource,
  removeDerivedSource,
  toggleDerivedSource,
  openPendingDerivedSourceDraft,
  acknowledgePendingDerivedSourceDraft,
  dismissPendingDerivedSourceDraft,
  resetChatSession,
  restoreChatSession,
  loadMappingWorkspaceSnapshot,
  hydrateBuilderSession,
  resetBuilderForNewMapping,
  clearOpenSttmNavigation,
  initializeMappings,
  updateMapping,
  applyPendingAiMappingReview,
  skipPendingAiMappingReview,
  toggleMappingSelection,
  selectAllMappings,
  bulkMarkMapped,
  bulkSetDirect,
  setPreProcessModalOpen,
  setMappingSql,
  setMappingPreviewSql,
  setMappingSqlVariant,
  setCompiledMappingResult,
  applyParsedSqlWorkspace,
} = sttmBuilderSlice.actions;

export default sttmBuilderSlice.reducer;
