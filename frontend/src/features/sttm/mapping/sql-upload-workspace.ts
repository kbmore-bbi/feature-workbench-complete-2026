import type {
  JoinConfig,
  MappingState,
  ParsedSqlWorkspaceApplyPayload,
} from "@/features/sttm/types/sttm.types";
import type { SqlUploadResult } from "@/features/sttm/mapping/sql-bundle-review-panel";

export function buildSqlUploadWorkspace(
  uploaded: SqlUploadResult,
  options?: { approvedProjectValueNames?: string[] },
): ParsedSqlWorkspaceApplyPayload {
  const parsed = uploaded.parsed_summary;
  const sqlVariables = Object.fromEntries(
    Object.entries(parsed?.variables ?? {}).map(([name, value]) => [
      name.trim().replace(/^\$/, "").toUpperCase(),
      String(value),
    ]),
  );
  const approvedProjectValueKeys = options?.approvedProjectValueNames
    ? new Set(options.approvedProjectValueNames.map((name) => name.toUpperCase()))
    : null;
  const rows = uploaded.import_preview?.mapping_rows ?? parsed?.column_mappings ?? [];
  const mappings: MappingState[] = rows.map((item, index) => {
    const targetColumn = String(item.target_alias ?? `COLUMN_${index + 1}`);
    const physical = Array.isArray(item.physical_source_columns)
      ? item.physical_source_columns.map(String)
      : [];
    const logical = Array.isArray(item.source_columns)
      ? item.source_columns.map(String)
      : [];
    const sourceColumns = physical.length ? physical : logical;
    const isConstant = String(item.mapping_mode ?? "").toLowerCase() === "constant";
    const rawConstantValue = isConstant ? String(item.constant_value ?? "") : "";
    const variableName = rawConstantValue.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/)?.[1];
    const resolvedVariableValue = variableName
      ? sqlVariables[variableName.toUpperCase()]
      : undefined;
    const hasResolvedSqlVariable = resolvedVariableValue !== undefined;
    const isProjectAttribute = hasResolvedSqlVariable
      && (!approvedProjectValueKeys || approvedProjectValueKeys.has(String(variableName).toUpperCase()));
    const transformation = item.transformation ?? item.expression;

    return {
      id: `upload:${targetColumn}:${index}`,
      targetColumn,
      targetType: "TEXT",
      sourceColumn: isConstant ? null : sourceColumns[0] ?? null,
      sourceColumns,
      sourceType: null,
      mappingMode: isProjectAttribute ? "attribute" : isConstant ? "constant" : "source",
      constantValue:
        isProjectAttribute
          ? resolvedVariableValue
          : isConstant
            ? resolvedVariableValue ?? rawConstantValue
            : null,
      attributeName: isProjectAttribute ? variableName ?? null : null,
      expression: isConstant || !transformation ? null : String(transformation),
      rule: isConstant ? "Value" : transformation ? "Custom" : "Direct",
      status: sourceColumns.length || isConstant ? "MAPPED" : "UNMAPPED",
    };
  });

  const relationships: JoinConfig[] = (parsed?.join_patterns ?? []).map((item, index) => {
    const keys = Array.isArray(item.keys) ? item.keys.map(String) : [];
    const conditionColumns = keys.length >= 2
      ? keys.slice(0, 2)
      : String(item.condition ?? "")
        .split("=")
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 2);
    const joinType = String(item.join_type ?? "INNER")
      .replace(/\s+JOIN$/i, "")
      .toUpperCase();

    return {
      id: `upload-join:${index}`,
      joinType: (["INNER", "LEFT", "RIGHT", "FULL"].includes(joinType)
        ? joinType
        : "INNER") as JoinConfig["joinType"],
      leftTableId: String(item.left_table ?? ""),
      rightTableId: String(item.right_table ?? ""),
      source: "USER_DEFINED",
      conditions: conditionColumns.length >= 2
        ? [{
            leftColumn: conditionColumns[0].split(".").pop(),
            operator: "=",
            rightColumn: conditionColumns[1].split(".").pop(),
          }]
        : [],
    };
  });

  const resolvedReferences = uploaded.import_preview?.table_references ?? [];
  const resolvedSources = resolvedReferences
    .filter((item) =>
      String(item.reference_role ?? "") === "source"
      && String(item.resolution_status ?? "") === "resolved"
      && Boolean(item.resolved_fqn),
    )
    .map((item) => String(item.resolved_fqn));
  const resolvedTarget = resolvedReferences.find((item) =>
    String(item.reference_role ?? "") === "target"
    && String(item.resolution_status ?? "") === "resolved"
    && Boolean(item.resolved_fqn),
  );
  const sourceTableFqns = resolvedSources.length
    ? resolvedSources
    : parsed?.source_tables ?? [];
  const resolveInputTable = (value: string) => {
    const normalized = value.trim().replace(/^"|"$/g, "").toUpperCase();
    if (normalized.split(".").length === 3) return value;
    return sourceTableFqns.find((candidate) => {
      const candidateUpper = candidate.toUpperCase();
      return candidateUpper === normalized || candidateUpper.endsWith(`.${normalized}`);
    }) ?? value;
  };

  return {
    sourceTableFqns,
    targetTableFqn: resolvedTarget
      ? String(resolvedTarget.resolved_fqn)
      : parsed?.target_table ?? null,
    relationships,
    mappings,
    derivedSources: (parsed?.ctes ?? [])
      .filter((item) => Boolean(item.derived_source_candidate))
      .map((item) => ({
        name: String(item.name ?? "derived_source").replace(/^derived_/i, ""),
        sqlText: item.sql_text ? String(item.sql_text) : null,
        inputTables: Array.isArray(item.tables_referenced)
          ? Array.from(
              new Set(item.tables_referenced.map(String).map(resolveInputTable)),
            )
          : [],
        outputColumns: Array.isArray(item.output_columns)
          ? item.output_columns
            .filter((column) =>
              column
              && typeof column === "object"
              && String((column as Record<string, unknown>).name ?? "") !== "*",
            )
            .map((column) => column as Record<string, unknown>)
          : [],
        purpose: item.purpose ? String(item.purpose) : null,
        candidateReasons: Array.isArray(item.derived_source_reasons)
          ? item.derived_source_reasons.map(String)
          : [],
      })),
    filterSql: "",
    sql: uploaded.import_preview?.sql ?? "",
  };
}
