import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import { getApiErrorMessage } from "@/api/axiosInstance";
import { dbService } from "@/services/dbService";
import { workbenchService, type TableRef } from "@/services/workbenchService";
import { authService } from "@/services/authService";
import type {
  SemanticContextItem,
  SourceMappingResult,
  STTMBuilderEnvelopeResponse,
  STTMIntent,
  TransformationResult,
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
  MappingSuggestion,
  PendingDerivedSourceDraft,
  RuleCondition,
  RuleGroup,
  SourceTargetInfo,
  TableNode,
  MappingState,
  PendingAiMappingReview,
} from "@/features/sttm/types/sttm.types";

// ─── helpers ───────────────────────────────────────────────────────
function getErrorMessage(error: unknown, fallback: string): string {
  return getApiErrorMessage(error, fallback);
}

function makeTableRef(qualifiedName: string): TableRef {
  const [database, schema, table] = qualifiedName.split(".", 3);
  return { database, schema, table };
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
    .map((join) => ({
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
    }))
    .filter((join) => join.conditions.length > 0);
}

function getSelectedDerivedSourceIds(derivedSources: DerivedSource[]): string[] {
  return derivedSources.filter((source) => source.isSelected).map((source) => source.id);
}

type SemanticRefreshResult = Awaited<ReturnType<typeof dbService.refreshSemanticContext>>;

function isAnalystReadyLevel(level?: string | null): boolean {
  return level === "L2_ANALYST_READY" || level === "L3_MAPPING_ENRICHED";
}

function isAnalystSqlText(text: string): boolean {
  return [
    "sql",
    "query",
    "count",
    "sum",
    "average",
    "avg",
    "group by",
    "how many",
    "total ",
    "top ",
    "trend",
    "revenue",
    "show rows",
    "show records",
  ].some((token) => text.includes(token));
}

function isDerivedSourceGenerationText(text: string): boolean {
  const directTokens = [
    "derived source",
    "derived table",
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
  return (text.includes("create") || text.includes("build") || text.includes("generate")) &&
    text.includes("join");
}

function createChatMessageId() {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

function buildSourceAttributesForChat(mapping: MappingState, targetQualifiedName: string) {
  const table = makeTableRef(targetQualifiedName);
  const sourceMappings = (mapping.sourceColumns && mapping.sourceColumns.length
    ? mapping.sourceColumns
    : (mapping.sourceColumn ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean))
    .map((value) => {
      const parts = value.split(".");
      if (parts.length >= 4) {
        const [database, schema, tableName, ...attributeParts] = parts;
        return {
          table: { database, schema, table: tableName },
          attribute: attributeParts.join("."),
        };
      }
      if (parts.length >= 2) {
        return {
          table,
          attribute: parts.slice(1).join("."),
        };
      }
      return {
        table,
        attribute: value,
      };
    });

  return {
    target_table: table,
    target_attribute: mapping.targetColumn,
    target_data_type: mapping.targetType ?? null,
    target_description: mapping.description ?? null,
    source_mappings: sourceMappings.length ? sourceMappings : null,
  };
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
  const sourceLineMatch = text.match(/Source Attribute[s]?:\s*([^\n]+)/i);
  const targetLineMatch = text.match(/Target Attribute:\s*([^\n]+)/i);
  const confidenceMatch = text.match(/Confidence:\s*(\d{1,3})%/i);
  const processingOrderMatch = text.match(/Processing Order:\s*(\d+)/i);
  const typeMatch = text.match(/Type:\s*([^\n]+)/i);
  const outputColumnMatch = text.match(/Output Column Name:\s*([^\n]+)/i);

  const parsedRule = (
    codeBlockMatch?.[1] ||
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
}) {
  const sourceAttributes = suggestion.sourceAttributes ?? [];
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

  mapping.sourceColumns = sourceAttributes;
  mapping.sourceColumn = sourceColumn;
  mapping.confidenceScore = suggestion.confidenceScore ?? 0;
  mapping.confidenceReason = suggestion.confidenceReason ?? null;
  mapping.candidateSourceColumns = suggestion.candidateSourceAttributes ?? [];
  mapping.unmatchedReason = suggestion.unmatchedReason ?? null;
  mapping.aiSuggestedRule = inferredRule;
  mapping.aiSuggestedRuleType = inferredRuleType;
  mapping.rule = nextRule;
  mapping.expression = shouldPersistExpression ? inferredRule : null;
  mapping.nlRule = suggestion.preprocessingNlRule ?? mapping.nlRule ?? null;
  mapping.loadOrder =
    suggestion.processingOrder !== null && suggestion.processingOrder !== undefined
      ? String(suggestion.processingOrder)
      : mapping.loadOrder ?? null;
  if (!mapping.descriptionEdited) {
    mapping.description = suggestion.description ?? mapping.description ?? null;
  }
  mapping.status = sourceAttributes.length > 0 ? "MAPPED" : "UNMAPPED";
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
  state.semanticViewName = refresh.semantic_view_name ?? state.semanticViewName;
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

// ─── state shape ───────────────────────────────────────────────────
type SttmBuilderState = {
  sourceDatabases: DatabaseNode[];
  targetDatabases: DatabaseNode[];

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
  agentThreadId: string | null;
  agentParentMessageId: number | null;
  semanticBundleId: string | null;
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
  derivedSources: DerivedSource[];

  sourceFilterSql: string;
  sourceFilterGroups: RuleGroup[];
  sourceQuerySql: string;
  sourceGroupBySql: string;
  sourceOrderBySql: string;

  mappings: MappingState[];
  selectedMappingIds: string[];
  mappingSql: string;
  isPreProcessModalOpen: boolean;
  activeMappingId: string | null;
  pendingAiMappingReviews: PendingAiMappingReview[];
  autoMapStatusMessage: string | null;
};

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

const initialState: SttmBuilderState = {
  sourceDatabases: [],
  targetDatabases: [],

  sources: [],
  targets: [],
  sourceInfo: { dbName: "", schemaName: "" },
  targetInfo: { dbName: "", schemaName: "" },

  sourceAttributeGroups: [],
  targetAttributeGroup: null,

  mappingSuggestions: [],
  mappingLoading: false,

  chatMessages: [
    {
      role: "assistant",
      content: "Hi! I'm your STTM AI Assistant. Ask me about mapping, tables, or next steps.",
    },
  ],
  chatLoading: false,
  agentThreadId: null,
  agentParentMessageId: null,
  semanticBundleId: null,
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
  derivedSources: [],

  sourceFilterSql: "",
  sourceFilterGroups: [],
  sourceQuerySql: "",
  sourceGroupBySql: "",
  sourceOrderBySql: "",

  mappings: [],
  selectedMappingIds: [],
  mappingSql: "",
  isPreProcessModalOpen: false,
  activeMappingId: null,
  pendingAiMappingReviews: [],
  autoMapStatusMessage: null,
};

// ─── async thunks ──────────────────────────────────────────────────

/** Fetch database list (+ session). Cached: won't refetch if already loaded. */
export const fetchDatabases = createAsyncThunk(
  "sttmBuilder/fetchDatabases",
  async (_, { rejectWithValue }) => {
    try {
      const [databases, userSession] = await Promise.all([
        dbService.getExplorerData(),
        authService.getSession().catch(() => null),
      ]);
      return { databases, session: userSession };
    } catch (err) {
      return rejectWithValue(getErrorMessage(err, "Unable to load databases."));
    }
  },
  {
    condition: (_, { getState }) => {
      const state = (getState() as { sttmBuilder: SttmBuilderState }).sttmBuilder;
      // Skip if already loaded or currently loading
      return state.loadState.initial !== "success" && state.loadState.initial !== "loading";
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
    const selectedSourceTables = state.sources.filter((table) => table.isSelected);

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
          source?: "FOREIGN_KEY" | "USER_DEFINED" | null;
          locked?: boolean;
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
      return rows.map(
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
            semanticBundleId: row.semantic_bundle_id ?? null,
            semanticViewName: row.semantic_view_name ?? null,
            semanticLevel: row.semantic_level ?? null,
            upstreamHash: row.upstream_hash ?? null,
            lineageDepth: row.lineage_depth ?? 0,
            drivingTableId: row.driving_table
              ? `${row.driving_table.database}.${row.driving_table.schema}.${row.driving_table.table}`
              : undefined,
            tableIds: sourceTableIds,
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
      );
    } catch (err) {
      return rejectWithValue(getErrorMessage(err, "Unable to load derived sources."));
    }
  }
);

/** Run auto-mapping. */
export const runAutoMap = createAsyncThunk(
  "sttmBuilder/runAutoMap",
  async (_, { dispatch, getState, rejectWithValue }) => {
    const state = (getState() as { sttmBuilder: SttmBuilderState }).sttmBuilder;
    const selectedSourceTables = state.sources.filter((t) => t.isSelected);
    const selectedTargetTable = state.targets.find((table) => table.isSelected);
    if (!selectedSourceTables.length || !state.targetAttributeGroup) return null;

    try {
      let response = null as Awaited<ReturnType<typeof workbenchService.invoke>> | null;
      dispatch(autoMapStreamStatus({ text: "Preparing mapping-ready semantic context." }));
      for await (const event of workbenchService.invokeStream({
        interface: "AUTO_MAP",
        thread_id: null,
        source_tables: selectedSourceTables.map((t) => makeTableRef(t.qualifiedName)),
        target_table: selectedTargetTable ? makeTableRef(selectedTargetTable.qualifiedName) : null,
        driving_table: state.drivingTableId ? makeTableRef(state.drivingTableId) : null,
        relationships: buildRelationshipPayload(state.relationships),
        semantic_context: state.semanticContextItems,
        selected_columns_by_table: buildSelectedColumnsByTable(state.sourceAttributeGroups),
        selected_derived_sources: getSelectedDerivedSourceIds(state.derivedSources),
        semantic_bundle_id: state.semanticBundleId,
        semantic_view_name: state.semanticViewName,
        derived_source_lineage: state.semanticLineage,
        datahub_context: state.semanticDatahubContext,
        surface: "MAPPING",
        semantic_level_requested: "L3_MAPPING_ENRICHED",
        attributes: state.targetAttributeGroup.columns
          .filter((col) => !!col.name)
          .map((col) => ({
            target_table: makeTableRef(state.targetAttributeGroup!.qualifiedName),
            target_attribute: col.name as string,
            target_data_type: col.type ?? null,
            target_description: null,
            source_mappings: null,
          })),
      })) {
        if (event.event === "status") {
          const statusText =
            typeof event.data.message === "string" ? event.data.message : "";
          if (statusText) {
            dispatch(autoMapStreamStatus({ text: statusText }));
          }
          continue;
        }
        if (event.event === "error") {
          throw new Error(event.data.message || "Auto-map streaming request failed.");
        }
        if (event.event === "final") {
          response = event.data;
        }
      }
      if (!response) {
        throw new Error("The auto-map stream ended without a final response.");
      }
      return response;
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
    const selectedTargetTable = state.targets.find((table) => table.isSelected);
    const selectedSourceTables = state.sources
      .filter((table) => table.isSelected)
      .map((table) => makeTableRef(table.qualifiedName));
    const selectedMappingIds = state.selectedMappingIds;
    const scopedAttributes =
      state.targetAttributeGroup?.qualifiedName
        ? state.mappings
            .filter((mapping) =>
              selectedMappingIds.length > 0
                ? selectedMappingIds.includes(mapping.id)
                : state.activeMappingId
                  ? mapping.id === state.activeMappingId
                  : false,
            )
            .map((mapping) =>
              buildSourceAttributesForChat(mapping, state.targetAttributeGroup!.qualifiedName),
            )
        : null;
    const selectedDerivedSourceIds = getSelectedDerivedSourceIds(state.derivedSources);
    const relationships = buildRelationshipPayload(state.relationships);
    const surface = state.targetAttributeGroup ? "MAPPING" : "SOURCE_SELECTION";
    const loweredMessage = trimmed.toLowerCase();
    const needsAnalystReadyContext =
      surface !== "MAPPING" &&
      (isDerivedSourceGenerationText(loweredMessage) || isAnalystSqlText(loweredMessage));
    const requestedSemanticLevel = state.targetAttributeGroup
      ? "L3_MAPPING_ENRICHED"
      : needsAnalystReadyContext
        ? "L2_ANALYST_READY"
        : "L1_CONTEXT";
    const selectedTableIds = [
      ...state.sources.filter((table) => table.isSelected).map((table) => table.qualifiedName),
      ...selectedDerivedSourceIds,
    ];
    const shouldUseStructuredTransformationIntent =
      surface === "MAPPING" &&
      !!scopedAttributes?.length &&
      isTransformationPrompt(loweredMessage);
    const requestInterface: STTMIntent = shouldUseStructuredTransformationIntent ? "TRANSFORM" : "CHAT";
    let semanticRefresh: SemanticRefreshResult | null = null;
    let semanticBundleId = state.semanticBundleId;
    let semanticViewName = state.semanticViewName;
    let threadId =
      isDerivedSourceGenerationText(loweredMessage) || shouldUseStructuredTransformationIntent
        ? null
        : state.agentThreadId;
    let parentMessageId =
      isDerivedSourceGenerationText(loweredMessage) || shouldUseStructuredTransformationIntent
        ? null
        : state.agentParentMessageId;
    try {
      const pushStatus = (text: string) =>
        dispatch(assistantStreamStatus({ messageId, text }));

      if (
        (selectedSourceTables.length > 0 || selectedDerivedSourceIds.length > 0) &&
        needsAnalystReadyContext &&
        (!semanticBundleId || !semanticViewName || !isAnalystReadyLevel(state.semanticLevel))
      ) {
        pushStatus("Preparing analyst-ready semantic context for the current selection.");
        semanticRefresh = await dbService.refreshSemanticContext({
          selected_source_tables: selectedSourceTables,
          selected_derived_sources: selectedDerivedSourceIds,
          target_table: selectedTargetTable ? makeTableRef(selectedTargetTable.qualifiedName) : null,
          relationships: relationships as Array<Record<string, unknown>>,
          requested_level: "L2_ANALYST_READY",
          force: false,
        });
        const promotedBundleChanged =
          semanticRefresh.bundle_id !== state.semanticBundleId ||
          (semanticRefresh.semantic_view_name ?? null) !== (state.semanticViewName ?? null) ||
          !isAnalystReadyLevel(state.semanticLevel);
        semanticBundleId = semanticRefresh.bundle_id;
        semanticViewName = semanticRefresh.semantic_view_name ?? null;
        if (promotedBundleChanged) {
          threadId = null;
          parentMessageId = null;
        }
      }

      let response = null as Awaited<ReturnType<typeof workbenchService.invoke>> | null;
      for await (const event of workbenchService.invokeStream({
        interface: requestInterface,
        thread_id: threadId,
        parent_message_id: threadId ? parentMessageId : null,
        message: trimmed,
        attributes: scopedAttributes,
        source_tables: selectedSourceTables,
        target_table: selectedTargetTable ? makeTableRef(selectedTargetTable.qualifiedName) : null,
        driving_table: state.drivingTableId ? makeTableRef(state.drivingTableId) : null,
        relationships,
        selected_columns_by_table: buildSelectedColumnsByTable(state.sourceAttributeGroups),
        selected_derived_sources: selectedDerivedSourceIds,
        semantic_context: state.semanticContextItems,
        semantic_bundle_id: semanticBundleId,
        semantic_view_name: semanticViewName,
        derived_source_lineage: state.semanticLineage,
        datahub_context: state.semanticDatahubContext,
        surface,
        semantic_level_requested: requestedSemanticLevel,
      })) {
        if (event.event === "status") {
          const statusText =
            typeof event.data.message === "string" ? event.data.message : "";
          if (statusText) pushStatus(statusText);
          continue;
        }
        if (event.event === "delta" && typeof event.data.text === "string") {
          dispatch(assistantStreamDelta({ messageId, text: event.data.text }));
          continue;
        }
        if (event.event === "suggestions" && Array.isArray(event.data.items)) {
          dispatch(
            assistantStreamOptions({
              messageId,
              options: event.data.items.map((item) => String(item)).filter(Boolean),
            })
          );
          continue;
        }
        if (event.event === "error") {
          throw new Error(event.data.message || "Streaming agent request failed.");
        }
        if (event.event === "final") {
          response = event.data;
        }
      }
      if (!response) {
        throw new Error("The STTM agent stream ended without a final response.");
      }
      return {
        userMessage: trimmed,
        response,
        selectedTableIds,
        drivingTableId: state.drivingTableId,
        selectedMappingIds,
        semanticRefresh,
        messageId,
      };
    } catch (err) {
      const errorMessage = getErrorMessage(
        err,
        "I could not reach the STTM agent just now. Please try again."
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

// ─── slice ─────────────────────────────────────────────────────────
export const sttmBuilderSlice = createSlice({
  name: "sttmBuilder",
  initialState,
  reducers: {
    assistantStreamStarted: (state, action: PayloadAction<{ messageId: string }>) => {
      state.chatMessages.push({
        id: action.payload.messageId,
        role: "assistant",
        content: "",
        isStreaming: true,
        status: "completed",
        traceSteps: [],
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
    assistantStreamStatus: (
      state,
      action: PayloadAction<{ messageId: string; text: string }>
    ) => {
      const message = state.chatMessages.find((item) => item.id === action.payload.messageId);
      if (!message) return;
      const text = action.payload.text.trim();
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
    },
    assistantStreamFailed: (
      state,
      action: PayloadAction<{ messageId: string; errorMessage: string }>
    ) => {
      const message = state.chatMessages.find((item) => item.id === action.payload.messageId);
      if (message) {
        message.content = action.payload.errorMessage;
        message.status = "failed";
        message.isStreaming = false;
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
    toggleSource: (state, action: PayloadAction<{ tableId: string }>) => {
      const { tableId } = action.payload;
      state.sources = state.sources.map((t) =>
        t.tableId === tableId ? { ...t, isSelected: !t.isSelected } : t
      );

      // Update tree
      for (const db of state.sourceDatabases) {
        for (const sch of db.schemas) {
          for (const t of sch.tables) {
            if (t.tableId === tableId) {
              t.isSelected = !t.isSelected;
            }
          }
        }
      }

      // Driving table logic
      const justSelected = state.sources.find((t) => t.tableId === tableId)?.isSelected;
      if (justSelected && !state.drivingTableId) {
        state.drivingTableId = tableId;
      } else if (!justSelected && state.drivingTableId === tableId) {
        state.drivingTableId = state.sources.find((t) => t.isSelected)?.tableId ?? null;
      }
      state.agentThreadId = null;
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
      state.agentParentMessageId = null;
      state.targetAttributeGroup = null;
      state.mappingSuggestions = [];
      state.semanticLevel = null;
      state.pendingAiMappingReviews = [];
    },

    setDrivingTable: (state, action: PayloadAction<{ tableId: string | null }>) => {
      state.agentThreadId = null;
      state.agentParentMessageId = null;
      state.drivingTableId = action.payload.tableId;
      state.sourceQuerySql = "";
      state.pendingAiMappingReviews = [];
    },

    setRelationships: (state, action: PayloadAction<{ joins: JoinConfig[] }>) => {
      state.agentThreadId = null;
      state.agentParentMessageId = null;
      state.relationships = action.payload.joins;
      state.sourceQuerySql = "";
      state.pendingAiMappingReviews = [];
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

    // UI Mapping Reducers
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
        state.loadState.initial = "success";
      })
      .addCase(fetchDatabases.rejected, (state, action) => {
        state.loadState.initial = "error";
        state.errorState.initial = action.payload as string;
        state.sourceDatabases = [];
        state.targetDatabases = [];
      });

    builder.addCase(fetchDerivedSources.fulfilled, (state, action) => {
      state.derivedSources = action.payload.map((source: DerivedSource) => ({
        ...source,
        isSelected: source.isSelected ?? false,
      }));
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
        const db = branch.find((d) => d.dbId === dbId);

        if (!cached && rawTables && db) {
          const schema = db.schemas.find((s) => s.schemaId === schemaId);
          if (schema) {
            schema.tables = rawTables.map(
              (t: { table_name: string; row_count?: number | null; column_count?: number }) => ({
              tableId: `${databaseName}.${schemaName}.${t.table_name}`,
              tableName: t.table_name,
              qualifiedName: `${databaseName}.${schemaName}.${t.table_name}`,
              isSelected: false,
              tag: type === "source" ? "Source" : "Target",
              rows:
                t.row_count !== null && t.row_count !== undefined
                  ? String(t.row_count)
                  : "--",
              columns: t.column_count ?? 0,
              columnItems: [],
            })
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
          state.sources = flatTables;
          state.sourceInfo = { dbName: databaseName, schemaName };
          state.sourceAttributeGroups = [];
          state.relationships = [];
          state.mappingSuggestions = [];
          state.agentThreadId = null;
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
        } else {
          state.targets = flatTables;
          state.targetInfo = { dbName: databaseName, schemaName };
          state.targetAttributeGroup = null;
          state.mappingSuggestions = [];
          state.agentThreadId = null;
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
      .addCase(fetchAttributes.pending, (state) => {
        state.loadState.attributes = "loading";
      })
      .addCase(fetchAttributes.fulfilled, (state, action) => {
        if (!action.payload) return;
        const { side, groups } = action.payload;
        if (side === "source") {
          state.sourceAttributeGroups = groups;
          state.sources = mergeColumnsIntoTables(state.sources, groups);
          mergeColumnsIntoBranch(state.sourceDatabases, groups);
        } else {
          state.targetAttributeGroup = groups[0] ?? null;
          state.targets = mergeColumnsIntoTables(state.targets, groups);
          mergeColumnsIntoBranch(state.targetDatabases, groups);
        }
        state.loadState.attributes = "success";
      })
      .addCase(fetchAttributes.rejected, (state, action) => {
        state.loadState.attributes = "error";
        state.errorState.attributes = action.payload as string;
      });

    // ── fetchRelationships ──
    builder
      .addCase(fetchRelationships.pending, (state) => {
        state.loadState.relationships = "loading";
        state.errorState.relationships = undefined;
      })
      .addCase(fetchRelationships.fulfilled, (state, action) => {
        state.loadState.relationships = "success";
        state.relationships = action.payload;
      })
      .addCase(fetchRelationships.rejected, (state, action) => {
        state.loadState.relationships = "error";
        state.errorState.relationships = action.payload as string;
      });

    // ── runAutoMap ──
    builder
      .addCase(runAutoMap.pending, (state) => {
        state.mappingLoading = true;
        state.autoMapStatusMessage = "Preparing mapping-ready semantic context.";
        state.errorState.autoMap = undefined;
      })
      .addCase(runAutoMap.fulfilled, (state, action) => {
        state.mappingLoading = false;
        state.autoMapStatusMessage = null;
        if (!action.payload) return;
        const response = action.payload;
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
        state.semanticViewName = response.data?.semantic_refresh_status?.semantic_view_name ?? state.semanticViewName;
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
          }
        >);
        state.mappingSuggestions = entries.map(([target, val]) => ({
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
        }));

        for (const mapping of state.mappings) {
          const match = entries.find(([target]) =>
            targetKeyVariants(target).has(normalizeTargetKey(mapping.targetColumn)),
          );
          if (!match) continue;
          const [, val] = match;
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
          });
        }

        if (response.message) {
          state.chatMessages.push({ role: "assistant", content: response.message });
        }
      })
      .addCase(runAutoMap.rejected, (state, action) => {
        state.mappingLoading = false;
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
        state.agentThreadId = action.payload.response.thread_id;
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
        state.semanticViewName =
          action.payload.response.data?.semantic_refresh_status?.semantic_view_name ?? state.semanticViewName;
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
        if (action.payload.response.data?.artifact_type === "semantic_context") {
          state.semanticContextSummary =
            (action.payload.response.data?.artifact as Record<string, unknown> | null) ??
            state.semanticContextSummary;
        }
        if (
          action.payload.response.data?.artifact_type === "derived_source_draft" &&
          action.payload.response.data?.artifact &&
          typeof action.payload.response.data.artifact.sql_text === "string"
        ) {
          const artifactSelectedColumns =
            typeof action.payload.response.data.artifact.selected_columns_by_table === "object" &&
            action.payload.response.data.artifact.selected_columns_by_table !== null
              ? (action.payload.response.data.artifact.selected_columns_by_table as Record<string, string[]>)
              : null;
          state.pendingDerivedSourceDraft = {
            sqlText: action.payload.response.data.artifact.sql_text as string,
            sourceNameSuggestion:
              (action.payload.response.data.artifact.source_name_suggestion as string | null) ?? null,
            semanticViewName:
              (action.payload.response.data.artifact.semantic_view_name as string | null) ??
              state.semanticViewName,
            semanticBundleLabel: state.semanticBundleLabel,
            previewRows:
              (action.payload.response.data.artifact.preview_rows as Array<Record<string, unknown>> | undefined) ??
              [],
            selectedColumnsByTable: artifactSelectedColumns,
            selectedTableIds: action.payload.selectedTableIds,
            drivingTableId: action.payload.drivingTableId,
            requestSummary: action.payload.userMessage,
          };
          state.derivedSourceDraftRequested = false;
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
      });
  },
});

export const {
  assistantStreamStarted,
  assistantStreamDelta,
  assistantStreamStatus,
  assistantStreamOptions,
  assistantStreamFinished,
  assistantStreamFailed,
  autoMapStreamStatus,
  applySemanticRefresh,
  toggleSource,
  selectTarget,
  clearSources,
  clearTargets,
  setDrivingTable,
  setRelationships,
  setSourceFilterConditions,
  addDerivedSource,
  updateDerivedSource,
  removeDerivedSource,
  toggleDerivedSource,
  openPendingDerivedSourceDraft,
  acknowledgePendingDerivedSourceDraft,
  dismissPendingDerivedSourceDraft,
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
} = sttmBuilderSlice.actions;

export default sttmBuilderSlice.reducer;
