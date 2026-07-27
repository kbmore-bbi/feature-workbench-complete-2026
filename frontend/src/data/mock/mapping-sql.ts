import type {
  MappingSqlPreviewRequest,
  MappingSqlPreviewResponse,
  MappingSqlReviewRequest,
  MappingSqlReviewResponse,
} from "@/types/api-contract";

function buildPreviewColumns(mappings: MappingSqlReviewRequest["mappings"]) {
  return mappings.map((mapping) => ({
    name: mapping.target_column,
    data_type: mapping.target_type ?? "VARCHAR",
  }));
}

function buildPreviewRows(
  mappings: MappingSqlReviewRequest["mappings"],
  rowCount = 3,
) {
  const columns = mappings.map((mapping) => mapping.target_column);
  return Array.from({ length: rowCount }, (_, rowIndex) => ({
    values: Object.fromEntries(
      columns.map((column, columnIndex) => [
        column,
        rowIndex === 0 ? `mock-${column.toLowerCase()}` : (rowIndex + 1) * (columnIndex + 1),
      ]),
    ),
  }));
}

export function buildMockMappingSqlReview(
  payload: MappingSqlReviewRequest,
): MappingSqlReviewResponse {
  const optimizedPreviewSql = payload.preview_sql.replace(
    /SELECT/i,
    "SELECT /* mock-optimized */",
  );
  const optimizedGeneratedSql = payload.generated_sql.replace(
    /SELECT/i,
    "SELECT /* mock-optimized */",
  );

  return {
    valid: true,
    review_agent: "MOCK_SQL_REVIEW_AGENT",
    syntax_valid: true,
    execution_ready: true,
    review_summary:
      "Mock SQL review passed. Syntax is valid and the mapping SQL is ready for preview.",
    optimized: true,
    requires_approval: false,
    original_preview_sql: payload.preview_sql,
    original_generated_sql: payload.generated_sql,
    optimized_preview_sql: optimizedPreviewSql,
    optimized_generated_sql: optimizedGeneratedSql,
    semantic_view_name: payload.semantic_view_name ?? "MOCK_SEMANTIC_VIEW",
    warnings: [],
  };
}

export function buildMockMappingSqlPreview(
  payload: MappingSqlPreviewRequest,
): MappingSqlPreviewResponse {
  const executedPreviewSql =
    payload.chosen_variant === "optimized" && payload.approved_preview_sql
      ? payload.approved_preview_sql
      : payload.preview_sql;
  const executedGeneratedSql =
    payload.chosen_variant === "optimized" && payload.approved_generated_sql
      ? payload.approved_generated_sql
      : payload.generated_sql;
  const previewColumns = buildPreviewColumns(payload.mappings);
  const previewRows = buildPreviewRows(payload.mappings);
  const sourceAliases = Object.fromEntries(
    (payload.source_tables ?? []).map((table, index) => [
      `${table.database}.${table.schema}.${table.table}`,
      `src_${index + 1}`,
    ]),
  );

  return {
    valid: true,
    variant_used: payload.chosen_variant,
    executed_preview_sql: executedPreviewSql,
    executed_generated_sql: executedGeneratedSql,
    preview_columns: previewColumns,
    preview_rows: previewRows,
    source_sample_aliases: sourceAliases,
    source_sample_rows: buildPreviewRows(
      payload.mappings.slice(0, Math.min(payload.mappings.length, 4)),
      2,
    ),
    semantic_view_name: payload.semantic_view_name ?? "MOCK_SEMANTIC_VIEW",
    warnings: [],
  };
}
