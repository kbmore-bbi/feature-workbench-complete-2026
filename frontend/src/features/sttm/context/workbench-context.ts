import type {
  MappingIntent,
  RelationGraphContext,
  RelationshipContextItem,
  TableRef,
  WorkbenchContextSnapshotV2,
} from "@/types/api-contract";
import type {
  ChatMessage,
  ColumnGroup,
  DerivedSource,
  JoinConfig,
  MappingState,
  RuleGroup,
  TableNode,
} from "@/features/sttm/types/sttm.types";

export type WorkbenchCheckpoint =
  | "project.created"
  | "mapping.created"
  | "target.selected"
  | "source_set.completed"
  | "join.completed"
  | "derived_source.saved"
  | "auto_map.requested"
  | "transformation.requested"
  | "assistant.requested"
  | "validation.completed"
  | "sttm.published"
  | string;

export type WorkbenchSnapshotInput = {
  action: WorkbenchCheckpoint;
  milestone?: string | null;
  page: string;
  surface: string;
  sessionId?: string | null;
  threadId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  projectDescription?: string | null;
  projectDomain?: string | null;
  projectOutcome?: string | null;
  sttmId?: string | null;
  sttmName?: string | null;
  sttmDescription?: string | null;
  mappingLifecycle?: string | null;
  businessGoal?: string | null;
  sourceTables: TableNode[];
  targetTable?: TableNode | null;
  drivingTableId?: string | null;
  sourceAttributeGroups?: ColumnGroup[];
  derivedSources?: DerivedSource[];
  relationships?: JoinConfig[];
  sourceFilterSql?: string;
  sourceQuerySql?: string;
  sourceGroupBySql?: string;
  sourceOrderBySql?: string;
  sourceFilterGroups?: RuleGroup[];
  mappings?: MappingState[];
  selectedMappingIds?: string[];
  activeMappingId?: string | null;
  mappingSql?: string | null;
  mappingPreviewSql?: string | null;
  compiledMappingSql?: string | null;
  compiledMappingPreviewSql?: string | null;
  compiledMappingContextHash?: string | null;
  mappingIntent?: MappingIntent | null;
  semanticBundleId?: string | null;
  semanticBundleHash?: string | null;
  semanticBundleLabel?: string | null;
  semanticLevel?: string | null;
  semanticStatus?: string | null;
  semanticViewName?: string | null;
  semanticLineage?: Array<Record<string, unknown>>;
  mappingArtifacts?: Array<Record<string, unknown>>;
  validationHistory?: Array<Record<string, unknown>>;
  conversationHistory?: ChatMessage[];
  scopeType?: WorkbenchContextSnapshotV2["scope_type"];
  candidateAction?: string | null;
  browsingContext?: WorkbenchContextSnapshotV2["browsing_context"];
};

export function tableRefFromQualifiedName(qualifiedName?: string | null): TableRef | null {
  if (!qualifiedName) return null;
  const parts = qualifiedName
    .split(".")
    .map((part) => part.replace(/^"|"$/g, "").trim())
    .filter(Boolean);
  if (parts.length < 3) return null;
  return { database: parts[0], schema: parts[1], table: parts.slice(2).join(".") };
}

function candidateTableFqn(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || null;
  }
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const qualifiedName = record.qualifiedName ?? record.qualified_name ?? record.fqn;
  if (typeof qualifiedName === "string" && qualifiedName.trim()) {
    return qualifiedName.trim();
  }

  const database = record.database ?? record.database_name;
  const schema = record.schema ?? record.schema_name;
  const table = record.table ?? record.table_name ?? record.name;
  if (
    typeof database === "string"
    && typeof schema === "string"
    && typeof table === "string"
  ) {
    return `${database}.${schema}.${table}`;
  }
  return null;
}

function normalizeBrowsingContext(
  browsingContext: WorkbenchContextSnapshotV2["browsing_context"],
): WorkbenchContextSnapshotV2["browsing_context"] {
  if (!browsingContext) return null;
  const candidates = (
    browsingContext.visible_candidate_tables ?? []
  ) as unknown[];
  return {
    ...browsingContext,
    visible_candidate_tables: Array.from(
      new Set(candidates.map(candidateTableFqn).filter((value): value is string => Boolean(value))),
    ).sort(),
  };
}

function selectedColumns(groups: ColumnGroup[] = []): Record<string, string[]> {
  return Object.fromEntries(
    groups
      .map((group) => [
        group.qualifiedName,
        group.columns
          .filter((column) => column.selected)
          .map((column) => String(column.name || ""))
          .filter(Boolean)
          .sort(),
      ] as const)
      .filter(([, columns]) => columns.length > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function relationshipItems(relationships: JoinConfig[] = []): RelationshipContextItem[] {
  return relationships.flatMap((relationship) => {
    const leftTable = tableRefFromQualifiedName(relationship.leftTableId);
    const rightTable = tableRefFromQualifiedName(relationship.rightTableId);
    if (!leftTable || !rightTable) return [];
    return [{
      left_table: leftTable,
      right_table: rightTable,
      join_type: relationship.joinType,
      constraint_name: relationship.constraintName,
      source: relationship.source,
      locked: relationship.locked,
      conditions: (relationship.conditions ?? []).map((condition) => ({
        left_column: condition.leftColumn ?? "",
        operator: condition.operator,
        right_column: condition.rightColumn ?? "",
      })),
    }];
  });
}

function stableRelationAlias(seed: string, index: number): string {
  const normalized = seed.split(".").pop()
    ?.replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return `${normalized || "source"}_${index + 1}`;
}

function relationGraph(
  sourceTables: TableNode[],
  derivedSources: DerivedSource[],
  relationships: JoinConfig[],
  mappings: MappingState[],
): RelationGraphContext {
  const derivedIdByUiId = new Map<string, string>();
  for (const source of derivedSources) {
    derivedIdByUiId.set(source.id, source.id);
    derivedIdByUiId.set(`DERIVED.${source.sourceName}`, source.id);
  }
  const normalizeRelationId = (value?: string | null) =>
    (value && derivedIdByUiId.get(value)) || value || "";
  const nodes: RelationGraphContext["nodes"] = [
    ...sourceTables.map((table, index) => ({
      relation_id: table.qualifiedName,
      kind: "PHYSICAL_TABLE" as const,
      alias: stableRelationAlias(table.qualifiedName, index),
      table: tableRefFromQualifiedName(table.qualifiedName),
      output_columns: table.columnItems?.map((column) => ({
        name: column.name,
        data_type: column.type,
        is_primary_key: column.isPrimaryKey,
      })) ?? [],
    })),
    ...derivedSources.map((source, index) => ({
      relation_id: source.id,
      kind: "DERIVED_SOURCE" as const,
      alias: source.alias || stableRelationAlias(source.sourceName || source.id, sourceTables.length + index),
      derived_source_id: source.id,
      physical_view_name: source.physicalViewName ?? null,
      sql_text: source.sqlText ?? null,
      output_columns: source.outputColumns ?? [],
      column_semantics: source.columnSemantics ?? [],
      grain: source.grain ?? null,
      keys: source.keys ?? [],
      dependency_hash: source.sourceDependencyHash ?? source.upstreamHash ?? null,
      parent_relation_ids: source.parentDerivedSourceIds ?? source.derivedSourceIds ?? [],
    })),
  ];
  const nodeIds = new Set(nodes.map((node) => node.relation_id));
  return {
    nodes,
    edges: relationships.flatMap((relationship, index) => {
      const leftId = normalizeRelationId(relationship.leftTableId);
      const rightId = normalizeRelationId(relationship.rightTableId);
      if (!nodeIds.has(leftId) || !nodeIds.has(rightId) || !relationship.conditions?.length) return [];
      return [{
        edge_id: relationship.id ?? `relation-edge-${index + 1}`,
        left_relation_id: leftId,
        right_relation_id: rightId,
        join_type: relationship.joinType ?? "INNER",
        provenance: relationship.source ?? "USER_DEFINED",
        validation_status: relationship.locked ? "validated" : "selected",
        conditions: relationship.conditions.map((condition) => ({
          left_column: condition.leftColumn ?? "",
          operator: condition.operator ?? "=",
          right_column: condition.rightColumn ?? "",
        })),
      }];
    }),
    value_bindings: mappings.flatMap((mapping) => {
      if (
        (mapping.mappingMode !== "constant" && mapping.mappingMode !== "attribute")
        || !mapping.constantValue
      ) {
        return [];
      }
      return [{
        binding_id: `value:${mapping.id}`,
        value: mapping.constantValue,
        data_type: mapping.targetType ?? null,
        is_placeholder: mapping.constantValue.startsWith("$"),
        allow_project_specific_value: mapping.mappingMode === "attribute",
        resolution_status: mapping.constantValue.startsWith("$") ? "unresolved" : "resolved",
        attribute_name: mapping.mappingMode === "attribute" ? mapping.attributeName ?? null : null,
      }];
    }),
  };
}

export function buildWorkbenchContextSnapshot(
  input: WorkbenchSnapshotInput,
): WorkbenchContextSnapshotV2 {
  const sourceTables = input.sourceTables
    .map((table) => tableRefFromQualifiedName(table.qualifiedName))
    .filter((table): table is TableRef => Boolean(table))
    .sort((left, right) =>
      `${left.database}.${left.schema}.${left.table}`.localeCompare(
        `${right.database}.${right.schema}.${right.table}`,
      ),
    );
  const selectedDerived = (input.derivedSources ?? []).filter((source) => source.isSelected);
  const relationships = relationshipItems(input.relationships);
  const unifiedRelationGraph = relationGraph(
    input.sourceTables,
    selectedDerived,
    input.relationships ?? [],
    input.mappings ?? [],
  );

  return {
    context_version: "2.0",
    context_hash: "",
    context_key: "",
    captured_at: new Date().toISOString(),
    page: input.page,
    surface: input.surface,
    action: input.action,
    milestone: input.milestone ?? input.action,
    checkpoint: input.milestone ?? input.action,
    scope_type: input.scopeType ?? (input.browsingContext ? "schema" : "table_set"),
    scope_key: "",
    candidate_action: input.candidateAction ?? null,
    browsing_context: normalizeBrowsingContext(input.browsingContext),
    session_id: input.sessionId ?? null,
    thread_id: input.threadId ?? null,
    project_id: input.projectId ?? null,
    project_name: input.projectName ?? null,
    project_description: input.projectDescription ?? null,
    project_domain: input.projectDomain ?? null,
    project_outcome: input.projectOutcome ?? null,
    sttm_id: input.sttmId ?? null,
    sttm_name: input.sttmName ?? null,
    sttm_description: input.sttmDescription ?? null,
    mapping_lifecycle: input.mappingLifecycle ?? null,
    business_goal: input.businessGoal ?? null,
    source_tables: sourceTables,
    target_table: input.targetTable
      ? tableRefFromQualifiedName(input.targetTable.qualifiedName)
      : null,
    driving_table: tableRefFromQualifiedName(input.drivingTableId),
    selected_columns_by_table: selectedColumns(input.sourceAttributeGroups),
    derived_sources: selectedDerived.map((source) => ({
      id: source.id,
      name: source.sourceName,
      sql_text: source.sqlText ?? null,
      physical_view_name: source.physicalViewName ?? null,
      generated_by_request_id: source.generatedByRequestId ?? null,
      semantic_bundle_id: source.semanticBundleId ?? null,
      semantic_bundle_label: source.semanticBundleLabel ?? null,
      semantic_view_name: source.semanticViewName ?? null,
      semantic_level: source.semanticLevel ?? null,
      upstream_hash: source.upstreamHash ?? null,
      source_dependency_hash: source.sourceDependencyHash ?? null,
      purpose: source.purpose ?? null,
      business_description: source.businessDescription ?? null,
      grain: source.grain ?? null,
      keys: source.keys ?? [],
      output_columns: source.outputColumns ?? [],
      column_semantics: source.columnSemantics ?? [],
      semantic_projection: source.semanticProjection ?? {},
      semantic_quality: source.semanticQuality ?? null,
      lineage_depth: source.lineageDepth ?? 0,
      base_source_tables: source.baseSourceTables ?? [],
      table_ids: source.tableIds ?? [],
      alias: source.alias ?? null,
      columns: source.columns ?? [],
      joins: source.joins ?? [],
      filters: source.filters ?? [],
      selected_columns_by_table: source.selectedColumnsByTable ?? {},
      lineage: (input.semanticLineage ?? []).filter(
        (item) => item.derived_source_id === source.id || item.id === source.id,
      ),
    })),
    relation_graph: unifiedRelationGraph,
    relationships,
    filters: {
      filter_sql: input.sourceFilterSql ?? null,
      base_query_sql: input.sourceQuerySql ?? null,
      group_by_sql: input.sourceGroupBySql ?? null,
      order_by_sql: input.sourceOrderBySql ?? null,
      groups: (input.sourceFilterGroups ?? []) as unknown as Array<Record<string, unknown>>,
    },
    mapping_intent: input.mappingIntent ?? null,
    mapping_rows: (input.mappings ?? []).map((mapping) => ({
      id: mapping.id,
      target_column: mapping.targetColumn,
      target_type: mapping.targetType,
      source_columns: mapping.sourceColumns ?? (mapping.sourceColumn ? [mapping.sourceColumn] : []),
      source_type: mapping.sourceType,
      mapping_mode: mapping.mappingMode ?? "source",
      constant_value: mapping.constantValue ?? null,
      attribute_name: mapping.attributeName ?? null,
      rule: mapping.rule,
      expression: mapping.expression,
      natural_language_rule: mapping.nlRule,
      description: mapping.description,
      load_order: mapping.loadOrder,
      confidence: mapping.confidenceScore,
      confidence_reason: mapping.confidenceReason,
      used_inference_ids: mapping.usedInferenceIds ?? [],
      used_recommendation_ids: mapping.usedRecommendationIds ?? [],
      used_learning_ids: mapping.usedLearningIds ?? [],
      status: mapping.status,
    })),
    checked_mapping_row_ids: input.selectedMappingIds ?? [],
    active_mapping_row_id: input.activeMappingId ?? null,
    mapping_sql: input.mappingSql ?? null,
    mapping_preview_sql: input.mappingPreviewSql ?? null,
    compiled_mapping_sql: input.compiledMappingSql ?? null,
    compiled_mapping_preview_sql: input.compiledMappingPreviewSql ?? null,
    compiled_mapping_context_hash: input.compiledMappingContextHash ?? null,
    semantic: {
      bundle_id: input.semanticBundleId ?? null,
      bundle_hash: input.semanticBundleHash ?? null,
      bundle_label: input.semanticBundleLabel ?? null,
      level: input.semanticLevel ?? null,
      status: input.semanticStatus ?? null,
      view_name: input.semanticViewName ?? null,
    },
    semantic_bundle: {
      bundle_id: input.semanticBundleId ?? null,
      bundle_hash: input.semanticBundleHash ?? null,
      bundle_label: input.semanticBundleLabel ?? null,
      level: input.semanticLevel ?? null,
      status: input.semanticStatus ?? null,
      semantic_view_name: input.semanticViewName ?? null,
      source_tables: sourceTables,
      target_table: input.targetTable
        ? tableRefFromQualifiedName(input.targetTable.qualifiedName)
        : null,
      driving_table: tableRefFromQualifiedName(input.drivingTableId),
      derived_source_ids: selectedDerived.map((source) => source.id).sort(),
    },
    mapping_artifacts: input.mappingArtifacts ?? [],
    validation_history: input.validationHistory ?? [],
    conversation_history: (input.conversationHistory ?? [])
      .filter((message) => !message.isStreaming && message.content.trim())
      .slice(-30)
      .map((message) => ({ role: message.role, content: message.content.trim() })),
  };
}
