import type { MappingState, TableNode } from "@/features/sttm/types/sttm.types";

export type SummaryMetrics = {
  totalCount: number;
  mappedCount: number;
  unmappedCount: number;
  progressPercent: number;
  directRuleCount: number;
  transformRuleCount: number;
  joinCount: number;
  sourceTableCount: number;
  transformRules: string[];
  sourceTableLabels: string[];
  unmappedColumns: string[];
  mappedPairs: Array<{ source: string; target: string }>;
};

export function buildSummaryMetrics(params: {
  mappings: MappingState[];
  sources: TableNode[];
  joinCount: number;
}): SummaryMetrics {
  const { mappings, sources, joinCount } = params;
  const totalCount = mappings.length;
  const mappedRows = mappings.filter((row) => row.status === "MAPPED");
  const mappedCount = mappedRows.length;
  const unmappedCount = totalCount - mappedCount;
  const progressPercent = totalCount > 0 ? Math.round((mappedCount / totalCount) * 100) : 0;

  const transformRules = Array.from(
    new Set(
      mappedRows
        .map((row) => (row.rule === "Select..." ? "Direct" : row.rule || "Direct"))
        .filter((rule) => rule !== "Direct"),
    ),
  );

  const directRuleCount = mappedRows.filter((row) => {
    const rule = row.rule === "Select..." ? "Direct" : row.rule || "Direct";
    return rule === "Direct";
  }).length;

  return {
    totalCount,
    mappedCount,
    unmappedCount,
    progressPercent,
    directRuleCount,
    transformRuleCount: transformRules.length,
    joinCount,
    sourceTableCount: sources.filter((table) => table.isSelected).length,
    transformRules,
    sourceTableLabels: sources
      .filter((table) => table.isSelected)
      .map((table) => table.qualifiedName),
    unmappedColumns: mappings.filter((row) => row.status !== "MAPPED").map((row) => row.targetColumn),
    mappedPairs: mappedRows
      .filter((row) => row.sourceColumn)
      .map((row) => ({
        source: row.sourceColumn as string,
        target: row.targetColumn,
      })),
  };
}

export function formatMappingRule(rule: string | null | undefined) {
  if (!rule || rule === "Select...") {
    return "Direct";
  }
  return rule;
}

export function summaryStatusLabel(metrics: SummaryMetrics) {
  if (metrics.mappedCount === 0) {
    return "Not started";
  }
  if (metrics.unmappedCount === 0) {
    return "Complete";
  }
  return "Partial";
}
