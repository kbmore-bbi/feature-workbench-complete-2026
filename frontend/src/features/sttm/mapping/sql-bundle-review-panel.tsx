"use client";

import { useEffect, useMemo, useState } from "react";
import { AiaBox, AiaButton, AiaStack } from "@/components/ui";
import { AiaText } from "@/components/ui/aia-text";
import { API_ROUTES } from "@/api/routes";
import { resolveApiBaseUrl } from "@/api/axiosInstance";

export type SqlUploadResult = {
  asset_id: string;
  filename?: string;
  learning_job_id?: string | null;
  parsed_summary?: {
    source_tables?: string[];
    target_table?: string | null;
    column_mappings?: Array<Record<string, unknown>>;
    join_patterns?: Array<Record<string, unknown>>;
    ctes?: Array<Record<string, unknown>>;
    variables?: Record<string, string>;
    variable_bindings?: SqlProjectValueCandidate[];
    parse_warnings?: string[];
    stats?: Record<string, number>;
  };
  import_preview?: {
    target_binding?: Record<string, unknown>;
    table_references?: Array<Record<string, unknown>>;
    coverage?: Record<string, number>;
    mapping_rows?: Array<Record<string, unknown>>;
    cte_summary?: Array<Record<string, unknown>>;
    knowledge_graph?: {
      nodes?: Array<Record<string, unknown>>;
      edges?: Array<Record<string, unknown>>;
    };
    diagnostics?: Array<Record<string, unknown>>;
    project_value_candidates?: SqlProjectValueCandidate[];
    sql?: string;
  };
  bundle_context?: {
    context_hash?: string | null;
    semantic_bundle_hash?: string | null;
    semantic_bundle_id?: string | null;
    semantic_bundle_resolution?: string | null;
  };
  warnings?: string[];
};

export type SqlProjectValueCandidate = {
  evidence_id?: string;
  name: string;
  placeholder?: string;
  raw_expression?: string;
  resolved_value?: string | null;
  inferred_type?: string;
  usage_roles?: string[];
  reference_count?: number;
  classification?: string;
  project_value_candidate?: boolean;
  approval_status?: string;
};

type ReviewSection =
  | "Tables"
  | "Columns"
  | "Hardcoded Values"
  | "Relationships"
  | "Derived Sources"
  | "Knowledge Graph";

type UploadExplanations = {
  source?: string;
  model?: string;
  overview?: string;
  warning?: string;
  relationships?: Array<{
    index?: number;
    title?: string;
    explanation?: string;
    risk?: string;
  }>;
  ctes?: Array<{
    name?: string;
    summary?: string;
    classification_explanation?: string;
  }>;
};

const SECTIONS: ReviewSection[] = [
  "Tables",
  "Columns",
  "Hardcoded Values",
  "Relationships",
  "Derived Sources",
  "Knowledge Graph",
];

function label(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function list(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      return String(
        record.name ??
        record.alias ??
        record.column ??
        record.output_name ??
        record.expression ??
        "",
      );
    }
    return String(item ?? "");
  }).filter(Boolean);
}

const SQL_KEYWORDS = new Set([
  "ALL", "AND", "AS", "ASC", "BY", "CASE", "CAST", "COALESCE", "CROSS",
  "DESC", "DISTINCT", "ELSE", "END", "EXISTS", "FROM", "FULL", "GROUP",
  "HAVING", "ILIKE", "IN", "INNER", "IS", "JOIN", "LEFT", "LIKE", "LIMIT",
  "NOT", "NULL", "ON", "OR", "ORDER", "OUTER", "OVER", "PARTITION", "QUALIFY",
  "RIGHT", "ROW_NUMBER", "SELECT", "THEN", "UNION", "WHEN", "WHERE", "WITH",
]);

function highlightedSqlLine(line: string, lineIndex: number) {
  const tokens = line.split(
    /(--.*$|'(?:''|[^'])*'|"(?:[^"]|"")*"|\$[A-Za-z_][A-Za-z0-9_]*|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g,
  );
  return tokens.map((token, tokenIndex) => {
    let color = "#c9d1d9";
    if (token.startsWith("--")) color = "#8b949e";
    else if (token.startsWith("'")) color = "#a5d6ff";
    else if (token.startsWith('"')) color = "#ffa657";
    else if (token.startsWith("$")) color = "#ffa657";
    else if (/^\d+(?:\.\d+)?$/.test(token)) color = "#79c0ff";
    else if (SQL_KEYWORDS.has(token.toUpperCase())) color = "#ff7b72";
    return (
      <span key={`${lineIndex}:${tokenIndex}`} style={{ color }}>
        {token}
      </span>
    );
  });
}

function SqlCodeViewer({ sql }: { sql: string }) {
  const lines = sql.split("\n");
  return (
    <AiaBox
      sx={{
        bgcolor: "#0d1117",
        border: "1px solid #30363d",
        borderRadius: 2,
        overflow: "auto",
        maxHeight: 260,
      }}
    >
      <AiaBox
        component="pre"
        sx={{
          m: 0,
          py: 1.25,
          minWidth: "max-content",
          fontFamily:
            '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
          fontSize: 11,
          lineHeight: 1.65,
        }}
      >
        {lines.map((line, index) => (
          <AiaBox
            component="div"
            key={index}
            sx={{ display: "grid", gridTemplateColumns: "42px 1fr", minHeight: 18 }}
          >
            <AiaBox
              component="span"
              sx={{
                color: "#6e7681",
                textAlign: "right",
                pr: 1.25,
                mr: 1.25,
                borderRight: "1px solid #21262d",
                userSelect: "none",
              }}
            >
              {index + 1}
            </AiaBox>
            <AiaBox component="code" sx={{ pr: 2 }}>
              {highlightedSqlLine(line, index)}
            </AiaBox>
          </AiaBox>
        ))}
      </AiaBox>
    </AiaBox>
  );
}

function GraphNode({
  title,
  subtitle,
  tone = "blue",
}: {
  title: string;
  subtitle: string;
  tone?: "blue" | "violet" | "green";
}) {
  const colors = {
    blue: ["#eff6ff", "#bfdbfe", "#1d4ed8"],
    violet: ["#f5f3ff", "#ddd6fe", "#6d28d9"],
    green: ["#ecfdf5", "#a7f3d0", "#047857"],
  }[tone];
  return (
    <AiaBox sx={{ p: 1, bgcolor: colors[0], border: `1px solid ${colors[1]}`, borderRadius: 2 }}>
      <AiaText sx={{ fontSize: 11.5, fontWeight: 800, color: colors[2], overflowWrap: "anywhere" }}>
        {title}
      </AiaText>
      <AiaText sx={{ fontSize: 10.5, color: "#64748b" }}>{subtitle}</AiaText>
    </AiaBox>
  );
}

export function SqlBundleReviewPanel({
  result,
  onApplyDraft,
  selectedProjectValueNames = [],
  onProjectValueSelectionChange,
}: {
  result: SqlUploadResult;
  onApplyDraft?: () => void;
  selectedProjectValueNames?: string[];
  onProjectValueSelectionChange?: (names: string[]) => void;
}) {
  const [section, setSection] = useState<ReviewSection>("Tables");
  const [explanations, setExplanations] = useState<UploadExplanations | null>(null);
  const [explanationLoading, setExplanationLoading] = useState(true);
  const [selectedCte, setSelectedCte] = useState(0);
  const [showCteSql, setShowCteSql] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(
      `${resolveApiBaseUrl()}${API_ROUTES.upload.sqlExplanations(result.asset_id)}`,
      { method: "POST" },
    )
      .then(async (response) => response.ok ? response.json() : null)
      .then((body) => {
        if (!cancelled && body) setExplanations(body as UploadExplanations);
      })
      .finally(() => {
        if (!cancelled) setExplanationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [result.asset_id]);

  const coverage = result.import_preview?.coverage ?? {};
  const mappings =
    result.import_preview?.mapping_rows ??
    result.parsed_summary?.column_mappings ??
    [];
  const variableBindings: SqlProjectValueCandidate[] =
    result.import_preview?.project_value_candidates ??
    result.parsed_summary?.variable_bindings ??
    Object.entries(result.parsed_summary?.variables ?? {}).map(([name, value]) => ({
      name,
      placeholder: `$${name}`,
      resolved_value: value,
      inferred_type: "VARCHAR",
      usage_roles: ["expression"],
      classification: "mapping_value",
      project_value_candidate: true,
      approval_status: "draft",
    }));
  const selectedProjectValueKeys = new Set(
    selectedProjectValueNames.map((name) => name.toUpperCase()),
  );
  const toggleProjectValue = (name: string) => {
    if (!onProjectValueSelectionChange) return;
    const key = name.toUpperCase();
    const next = selectedProjectValueKeys.has(key)
      ? selectedProjectValueNames.filter((item) => item.toUpperCase() !== key)
      : [...selectedProjectValueNames, name];
    onProjectValueSelectionChange(next);
  };
  const ctes = result.import_preview?.cte_summary ?? [];
  const graph = result.import_preview?.knowledge_graph;
  const graphKinds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of graph?.nodes ?? []) {
      const kind = String(node.kind ?? "evidence");
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [graph?.nodes]);
  const selectedCteItem = ctes[selectedCte] ?? null;
  const selectedCteExplanation = explanations?.ctes?.find(
    (item) => String(item.name ?? "").toUpperCase() ===
      String(selectedCteItem?.name ?? "").toUpperCase(),
  );
  const sourceTables = (result.import_preview?.table_references ?? [])
    .filter((item) => String(item.reference_role ?? "") === "source")
    .slice(0, 6);

  return (
    <AiaStack spacing={1.5} sx={{ width: "100%", minWidth: 0, maxWidth: "100%" }}>
      <AiaBox
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(5, 1fr)" },
          gap: 1,
        }}
      >
        {[
          ["Target columns", coverage.target_columns ?? mappings.length],
          ["Physical lineage", coverage.physical_lineage_resolved ?? 0],
          ["CTEs", coverage.ctes ?? result.parsed_summary?.ctes?.length ?? 0],
          ["Hardcoded values", coverage.project_value_candidates ?? variableBindings.filter((item) => item.project_value_candidate).length],
          ["Warnings", result.import_preview?.diagnostics?.length ?? 0],
        ].map(([name, value]) => (
          <AiaBox key={String(name)} sx={{ p: 1.1, bgcolor: "#f8fafc", borderRadius: 2 }}>
            <AiaText sx={{ fontSize: 11, color: "#64748b" }}>{name}</AiaText>
            <AiaText sx={{ fontSize: 17, fontWeight: 800, color: "#0f172a" }}>{value}</AiaText>
          </AiaBox>
        ))}
      </AiaBox>

      <AiaBox sx={{ p: 1, bgcolor: "#f8fafc", borderRadius: 2 }}>
        <AiaText sx={{ fontSize: 11.5, color: "#475569", lineHeight: 1.45 }}>
          {explanationLoading
            ? "Preparing a plain-language explanation with the fast model…"
            : explanations?.overview ??
              "Deterministic SQL structure is ready. FIR semantic learning continues separately."}
        </AiaText>
        {explanations?.warning ? (
          <AiaText sx={{ fontSize: 10.5, color: "#b45309", mt: 0.4 }}>
            {explanations.warning}
          </AiaText>
        ) : null}
      </AiaBox>

      <AiaBox sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
        {SECTIONS.map((item) => (
          <AiaButton
            key={item}
            size="small"
            variant={section === item ? "contained" : "outlined"}
            onClick={() => setSection(item)}
            sx={{ textTransform: "none", borderRadius: 2, fontSize: 11.5 }}
          >
            {item}
          </AiaButton>
        ))}
      </AiaBox>

      <AiaBox sx={{ width: "100%", minWidth: 0, maxHeight: "min(360px, 42vh)", overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 2, p: 1.5 }}>
        {section === "Tables" &&
          (result.import_preview?.table_references ?? []).map((item, index) => (
            <AiaBox key={index} sx={{ py: 0.55, borderBottom: "1px solid #f1f5f9" }}>
              <AiaText sx={{ fontSize: 12.5, fontWeight: 700, overflowWrap: "anywhere" }}>
                {label(item.resolved_fqn ?? item.raw_reference)}
              </AiaText>
              <AiaText sx={{ fontSize: 11.5, color: "#64748b" }}>
                {label(item.reference_role)} · {label(item.classification)}
              </AiaText>
            </AiaBox>
          ))}

        {section === "Columns" &&
          mappings.map((item, index) => (
            <AiaBox key={index} sx={{ py: 0.65, borderBottom: "1px solid #f1f5f9" }}>
              <AiaText sx={{ fontSize: 12.5, fontWeight: 700 }}>
                {label(item.target_alias ?? item.target_column)}
              </AiaText>
              <AiaText sx={{ fontSize: 11.5, color: "#64748b", overflowWrap: "anywhere" }}>
                {list(item.physical_source_columns).join(", ") || "Constant / unresolved"}
              </AiaText>
              {item.transformation ? (
                <AiaText sx={{ fontSize: 11, color: "#475569", overflowWrap: "anywhere" }}>
                  Rule: {String(item.transformation)}
                </AiaText>
              ) : null}
            </AiaBox>
          ))}

        {section === "Hardcoded Values" && (
          <AiaStack spacing={1}>
            <AiaBox sx={{ p: 1, bgcolor: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 2 }}>
              <AiaText sx={{ fontSize: 11.5, color: "#1e3a8a", lineHeight: 1.45 }}>
                SET variables are parsed deterministically. Selected mapping values become project-scoped
                Hardcoded Values when you continue; environment identifiers remain SQL evidence only.
              </AiaText>
            </AiaBox>
            {variableBindings.length ? variableBindings.map((item) => {
              const eligible = Boolean(item.project_value_candidate);
              const selected = eligible && selectedProjectValueKeys.has(item.name.toUpperCase());
              const disposition = eligible
                ? selected ? "Selected for project" : "Draft"
                : item.classification === "declared_unused" ? "Declared, not used" : "Environment only";
              return (
                <AiaBox
                  key={item.evidence_id ?? item.name}
                  sx={{ display: "grid", gridTemplateColumns: "24px minmax(0, 1fr) auto", gap: 1, alignItems: "start", p: 1.1, bgcolor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 2 }}
                >
                  <AiaBox
                    component="input"
                    type="checkbox"
                    checked={selected}
                    disabled={!eligible || !onProjectValueSelectionChange}
                    onChange={() => toggleProjectValue(item.name)}
                    aria-label={`Use ${item.name} as a project value`}
                    sx={{ mt: 0.3, width: 16, height: 16, cursor: eligible ? "pointer" : "not-allowed" }}
                  />
                  <AiaBox sx={{ minWidth: 0 }}>
                    <AiaText sx={{ fontSize: 12.5, fontWeight: 800, color: "#0f172a", overflowWrap: "anywhere" }}>
                      {item.name} <AiaBox component="span" sx={{ color: "#7c3aed", fontFamily: "monospace" }}>{item.placeholder ?? `$${item.name}`}</AiaBox>
                    </AiaText>
                    <AiaText sx={{ fontSize: 11.25, color: "#334155", mt: 0.25, overflowWrap: "anywhere" }}>
                      Value: {label(item.resolved_value)} · Type: {label(item.inferred_type)}
                    </AiaText>
                    <AiaText sx={{ fontSize: 10.75, color: "#64748b", mt: 0.25 }}>
                      Used in: {(item.usage_roles ?? []).join(", ") || "not referenced"} · {item.reference_count ?? 0} reference(s)
                    </AiaText>
                  </AiaBox>
                  <AiaBox sx={{ px: 0.8, py: 0.35, borderRadius: 10, bgcolor: eligible ? (selected ? "#dcfce7" : "#fef3c7") : "#e2e8f0", color: eligible ? (selected ? "#166534" : "#92400e") : "#475569", fontSize: 10.25, fontWeight: 800, whiteSpace: "nowrap" }}>
                    {disposition}
                  </AiaBox>
                </AiaBox>
              );
            }) : (
              <AiaText sx={{ fontSize: 12, color: "#64748b" }}>No Snowflake SET variables were detected.</AiaText>
            )}
          </AiaStack>
        )}

        {section === "Relationships" &&
          (result.parsed_summary?.join_patterns ?? []).map((item, index) => {
            const explanation = explanations?.relationships?.find(
              (candidate) => Number(candidate.index) === index,
            );
            return (
              <AiaBox key={index} sx={{ p: 1.1, mb: 1, bgcolor: "#f8fafc", borderRadius: 2 }}>
                <AiaText sx={{ fontSize: 12.5, fontWeight: 800 }}>
                  {explanation?.title ?? `${label(item.left_table)} → ${label(item.right_table)}`}
                </AiaText>
                <AiaText sx={{ fontSize: 11.5, color: "#334155", mt: 0.35 }}>
                  {explanation?.explanation ??
                    `${label(item.join_type)} relationship using ${label(item.condition)}.`}
                </AiaText>
                <AiaText sx={{ fontSize: 10.75, color: "#64748b", mt: 0.35, overflowWrap: "anywhere" }}>
                  SQL evidence: {label(item.condition)}
                  {explanation?.risk ? ` · ${explanation.risk}` : ""}
                </AiaText>
              </AiaBox>
            );
          })}

        {section === "Derived Sources" && (
          <AiaBox
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "minmax(150px, 210px) minmax(0, 1fr)" },
              gap: 1.25,
              minWidth: 0,
            }}
          >
            <AiaStack
              spacing={0.6}
              sx={{
                minWidth: 0,
                maxHeight: { xs: 150, sm: 310 },
                overflowY: "auto",
                pr: 0.5,
              }}
            >
              {ctes.map((item, index) => (
                <AiaButton
                  key={`${label(item.name)}:${index}`}
                  size="small"
                  variant={selectedCte === index ? "contained" : "outlined"}
                  onClick={() => {
                    setSelectedCte(index);
                    setShowCteSql(false);
                  }}
                  sx={{
                    width: "100%",
                    minWidth: 0,
                    minHeight: 36,
                    px: 1,
                    py: 0.65,
                    textTransform: "none",
                    justifyContent: "flex-start",
                    textAlign: "left",
                    whiteSpace: "normal",
                    overflowWrap: "anywhere",
                    wordBreak: "break-word",
                    lineHeight: 1.25,
                    fontSize: 10.75,
                  }}
                >
                  {label(item.name)}
                </AiaButton>
              ))}
            </AiaStack>
            {selectedCteItem ? (
              <AiaStack
                spacing={1}
                sx={{
                  minWidth: 0,
                  p: 1.25,
                  bgcolor: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 2,
                }}
              >
                <AiaBox sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
                  <AiaBox sx={{ minWidth: 0 }}>
                    <AiaText sx={{ fontSize: 13, fontWeight: 800, overflowWrap: "anywhere" }}>
                      {label(selectedCteItem.name)}
                    </AiaText>
                    <AiaText sx={{ fontSize: 10.5, color: selectedCteItem.candidate ? "#047857" : "#6d28d9", fontWeight: 700 }}>
                      {selectedCteItem.candidate ? "Reusable derived-source candidate" : "Inline SQL step"}
                    </AiaText>
                  </AiaBox>
                  {selectedCteItem.sql_text ? (
                    <AiaButton
                      size="small"
                      variant={showCteSql ? "contained" : "outlined"}
                      onClick={() => setShowCteSql((visible) => !visible)}
                      sx={{ flexShrink: 0, textTransform: "none", fontSize: 10.75 }}
                    >
                      {showCteSql ? "Hide SQL" : "View SQL"}
                    </AiaButton>
                  ) : null}
                </AiaBox>
                <AiaText sx={{ fontSize: 11.5, color: "#334155", lineHeight: 1.5 }}>
                  {selectedCteExplanation?.summary ??
                    label(selectedCteItem.purpose ?? "Prepares data for downstream SQL.")}
                </AiaText>
                <AiaText sx={{ fontSize: 11.25, color: "#475569", lineHeight: 1.5 }}>
                  {selectedCteExplanation?.classification_explanation ??
                    (selectedCteItem.candidate
                      ? "Candidate for a saved derived source because it contains reusable or grain-changing logic."
                      : "Inline means it remains in lineage and FIR evidence, but is not saved as a reusable derived source.")}
                </AiaText>
                <AiaBox sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" }, gap: 0.75 }}>
                  {[
                    ["Inputs", list(selectedCteItem.tables_referenced).join(", ") || "Other CTEs / unresolved"],
                    ["Used by", list(selectedCteItem.downstream_consumers).join(", ") || "Final SELECT"],
                    ["Outputs", list(selectedCteItem.output_columns).join(", ") || "Not explicitly named"],
                  ].map(([name, value]) => (
                    <AiaBox key={name} sx={{ minWidth: 0, p: 0.75, bgcolor: "#fff", border: "1px solid #e2e8f0", borderRadius: 1.5 }}>
                      <AiaText sx={{ fontSize: 9.75, color: "#64748b", textTransform: "uppercase", fontWeight: 800 }}>{name}</AiaText>
                      <AiaText sx={{ fontSize: 10.5, color: "#334155", mt: 0.2, overflowWrap: "anywhere" }}>{value}</AiaText>
                    </AiaBox>
                  ))}
                </AiaBox>
                {showCteSql && selectedCteItem.sql_text ? (
                  <AiaBox sx={{ minWidth: 0 }}>
                    <SqlCodeViewer sql={String(selectedCteItem.sql_text)} />
                  </AiaBox>
                ) : null}
              </AiaStack>
            ) : (
              <AiaText sx={{ fontSize: 12, color: "#64748b" }}>No CTEs were detected.</AiaText>
            )}
          </AiaBox>
        )}

        {section === "Knowledge Graph" && (
          <AiaStack spacing={1.2}>
            <AiaText sx={{ fontSize: 12, color: "#475569" }}>
              {graph?.nodes?.length ?? 0} nodes · {graph?.edges?.length ?? 0} evidence-linked edges
            </AiaText>
            <AiaBox sx={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 28px minmax(0,1fr) 28px minmax(0,1fr)", alignItems: "center", gap: 0.6 }}>
              <AiaStack spacing={0.6}>
                {sourceTables.map((item, index) => (
                  <GraphNode
                    key={index}
                    title={label(item.resolved_fqn ?? item.raw_reference)}
                    subtitle="Physical source"
                  />
                ))}
              </AiaStack>
              <AiaText sx={{ textAlign: "center", fontSize: 20, color: "#94a3b8" }}>→</AiaText>
              <AiaStack spacing={0.6}>
                {ctes.slice(0, 8).map((item, index) => (
                  <GraphNode
                    key={index}
                    title={label(item.name)}
                    subtitle={item.candidate ? "Derived candidate" : "Inline CTE"}
                    tone="violet"
                  />
                ))}
                {ctes.length > 8 ? (
                  <AiaText sx={{ fontSize: 10.5, color: "#64748b" }}>+{ctes.length - 8} more CTEs</AiaText>
                ) : null}
              </AiaStack>
              <AiaText sx={{ textAlign: "center", fontSize: 20, color: "#94a3b8" }}>→</AiaText>
              <AiaStack spacing={0.6}>
                <GraphNode
                  title={result.parsed_summary?.target_table ?? "Target needs review"}
                  subtitle={`${mappings.length} target columns`}
                  tone="green"
                />
              </AiaStack>
            </AiaBox>
            <AiaBox sx={{ display: "flex", flexWrap: "wrap", gap: 0.6 }}>
              {graphKinds.map(([kind, count]) => (
                <AiaBox key={kind} sx={{ px: 0.8, py: 0.4, bgcolor: "#f1f5f9", borderRadius: 10 }}>
                  <AiaText sx={{ fontSize: 10.5, color: "#475569" }}>{kind}: {count}</AiaText>
                </AiaBox>
              ))}
            </AiaBox>
          </AiaStack>
        )}
      </AiaBox>

      {onApplyDraft && (
        <AiaBox sx={{ display: "flex", justifyContent: "flex-end" }}>
          <AiaButton variant="outlined" onClick={onApplyDraft} sx={{ textTransform: "none" }}>
            {result.parsed_summary?.target_table
              ? "Apply preview to mapping"
              : "Apply preview and select target"}
          </AiaButton>
        </AiaBox>
      )}
    </AiaStack>
  );
}
