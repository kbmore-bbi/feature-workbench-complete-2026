import type { DerivedSource, MappingState, TableNode } from "@/features/sttm/types/sttm.types";
import type { RelationshipContextItem, TableRef } from "@/types/api-contract";

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

function mermaidId(prefix: string, value: string) {
  return `${prefix}_${value.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

function tableLabel(table: TableRef) {
  return `${table.database}.${table.schema}.${table.table}`;
}

function shortTableLabel(table: TableRef) {
  return `${table.schema}.${table.table}`;
}

function escapeMermaidLabel(value: string) {
  return value.replace(/"/g, '\\"');
}

function parseQualifiedSourceColumn(sourceColumn: string) {
  const segments = sourceColumn.split(".").filter(Boolean);
  if (segments.length < 2) {
    return { tableKey: sourceColumn, columnName: sourceColumn };
  }
  return {
    tableKey: segments.slice(0, -1).join("."),
    columnName: segments[segments.length - 1],
  };
}

export function buildTableLineageMermaid(params: {
  sourceTables: TableRef[];
  derivedSources: DerivedSource[];
  relationships: RelationshipContextItem[];
  targetTable: TableRef | null;
}) {
  const { sourceTables, derivedSources, relationships, targetTable } = params;
  const lines = ["flowchart LR"];
  const emittedNodes = new Set<string>();
  const emittedEdges = new Set<string>();

  const ensureTableNode = (table: TableRef) => {
    const id = mermaidId("tbl", tableLabel(table));
    if (!emittedNodes.has(id)) {
      emittedNodes.add(id);
      lines.push(`  ${id}["${escapeMermaidLabel(shortTableLabel(table))}"]`);
    }
    return id;
  };

  const ensureTargetTableNode = (table: TableRef) => {
    const id = mermaidId("target_tbl", tableLabel(table));
    if (!emittedNodes.has(id)) {
      emittedNodes.add(id);
      lines.push(`  ${id}["${escapeMermaidLabel(shortTableLabel(table))}"]`);
    }
    return id;
  };

  const ensureDerivedNode = (source: DerivedSource) => {
    const id = mermaidId("drv", source.id || source.sourceName);
    if (!emittedNodes.has(id)) {
      emittedNodes.add(id);
      lines.push(`  ${id}(["${escapeMermaidLabel(source.sourceName)}"])`);
    }
    return id;
  };

  const targetNodeId = targetTable ? ensureTargetTableNode(targetTable) : null;

  for (const table of sourceTables) {
    ensureTableNode(table);
  }

  for (const relationship of relationships) {
    const leftId = ensureTableNode(relationship.left_table);
    const rightId = ensureTableNode(relationship.right_table);
    const edge = `${leftId}->${rightId}:${relationship.join_type ?? "INNER"} join`;
    if (!emittedEdges.has(edge)) {
      emittedEdges.add(edge);
      lines.push(`  ${leftId} -->|${relationship.join_type ?? "INNER"} join| ${rightId}`);
    }
  }

  for (const source of derivedSources.filter((item) => item.isSelected)) {
    const derivedId = ensureDerivedNode(source);
    for (const table of source.baseSourceTables ?? []) {
      const tableId = ensureTableNode(table);
      const edge = `${tableId}->${derivedId}:feeds`;
      if (!emittedEdges.has(edge)) {
        emittedEdges.add(edge);
        lines.push(`  ${tableId} -->|feeds| ${derivedId}`);
      }
    }
    if (targetNodeId) {
      const edge = `${derivedId}->${targetNodeId}:maps into`;
      if (!emittedEdges.has(edge)) {
        emittedEdges.add(edge);
        lines.push(`  ${derivedId} -->|maps into| ${targetNodeId}`);
      }
    }
  }

  if (targetNodeId) {
    for (const table of sourceTables) {
      const tableId = ensureTableNode(table);
      const edge = `${tableId}->${targetNodeId}:contributes`;
      if (!emittedEdges.has(edge)) {
        emittedEdges.add(edge);
        lines.push(`  ${tableId} -->|contributes| ${targetNodeId}`);
      }
    }
  }

  return lines.join("\n");
}

export function buildColumnLineageMermaid(params: {
  mappings: MappingState[];
  targetTable: TableRef | null;
}) {
  const { mappings, targetTable } = params;
  const lines = ["flowchart LR"];
  const emittedNodes = new Set<string>();
  const emittedEdges = new Set<string>();
  const targetPrefix = targetTable ? shortTableLabel(targetTable) : "Target";

  const ensureNode = (id: string, label: string) => {
    if (!emittedNodes.has(id)) {
      emittedNodes.add(id);
      lines.push(`  ${id}["${escapeMermaidLabel(label)}"]`);
    }
  };

  for (const mapping of mappings.filter((item) => item.status === "MAPPED")) {
    const targetId = mermaidId("target_col", `${targetPrefix}.${mapping.targetColumn}`);
    ensureNode(targetId, `${targetPrefix}.${mapping.targetColumn}`);
    const sourceColumns =
      mapping.sourceColumns && mapping.sourceColumns.length
        ? mapping.sourceColumns
        : mapping.sourceColumn
          ? mapping.sourceColumn.split(",").map((item) => item.trim()).filter(Boolean)
          : [];

    if (!sourceColumns.length) {
      continue;
    }

    for (const sourceColumn of sourceColumns) {
      const parsed = parseQualifiedSourceColumn(sourceColumn);
      const sourceId = mermaidId("source_col", sourceColumn);
      ensureNode(sourceId, sourceColumn);
      const ruleLabel =
        mapping.expression?.trim() ||
        (mapping.rule && mapping.rule !== "Select..." ? mapping.rule : "Direct");
      const edge = `${sourceId}->${targetId}:${ruleLabel}`;
      if (!emittedEdges.has(edge)) {
        emittedEdges.add(edge);
        lines.push(`  ${sourceId} -->|${escapeMermaidLabel(ruleLabel)}| ${targetId}`);
      }
      if (parsed.tableKey && parsed.tableKey !== sourceColumn) {
        const tableNodeId = mermaidId("source_tbl", parsed.tableKey);
        ensureNode(tableNodeId, parsed.tableKey);
        const sourceEdge = `${tableNodeId}->${sourceId}:column`;
        if (!emittedEdges.has(sourceEdge)) {
          emittedEdges.add(sourceEdge);
          lines.push(`  ${tableNodeId} -.-> ${sourceId}`);
        }
      }
    }
  }

  return lines.join("\n");
}
