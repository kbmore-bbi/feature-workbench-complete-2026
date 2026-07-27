"use client";
import { AiaAlert, AiaBox, AiaIconButton, AiaLinearProgress } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  AccountTreeOutlinedIcon,
  AutoAwesomeRoundedIcon,
  KeyboardDoubleArrowRightRoundedIcon,
  ScienceOutlinedIcon,
  TableChartOutlinedIcon,
  TerminalRoundedIcon,
} from "@/utils/icons";

import { AiaResizeHandle } from "@/components/ui/aia-resize-handle";
import { MappingSqlPreview } from "@/components/sql";
import { SttmLineageWorkspacePanel } from "@/features/sttm/lineage/sttm-lineage-workspace-panel";
import { useSttmBuilderContext } from "@/features/sttm/context/sttm-builder-context";
import { TOUR_TARGETS } from "@/features/tour/constants/tour-targets";
import { useTour } from "@/features/tour/engine/tour-context";
import {
  buildFallbackSourceQuerySql,
  buildMappingInsertSql,
  buildMappingSelectSql,
  buildSourceQueryPreviewSql,
  parseSourceColumns,
} from "@/features/sttm/mapping/mapping-utils";
import { BuilderWorkspaceTabBar } from "@/features/sttm/shared/builder-workspace-tab-bar";
import { SttmSidebarCollapsedRail } from "@/features/sttm/layout/sttm-sidebar-collapsed-rail";
import { dbService } from "@/services/dbService";
import { AiSummaryPanel } from "./ai-summary-panel";
import {
  buildDbtConversionRequestPayload,
  DbtConversionTab,
  getCachedDbtConversion,
} from "./dbt-conversion-tab";
import { SummaryExportActions } from "./summary-export-actions";
import { SummaryStatsRow } from "./summary-stats-row";
import {
  buildColumnLineageMermaid,
  buildSummaryMetrics,
  buildTableLineageMermaid,
} from "./summary-utils";
import { SttmSheetTab } from "./sttm-sheet-tab";
import {
  getCachedTestCaseGeneration,
  TestCasesTab,
} from "./test-cases-tab";
import type { TestCaseGenerationRequest } from "@/types/api-contract";

type SummaryTab = "sttm-sheet" | "sql-preview" | "data-lineage" | "dbt-conversion" | "test-cases";

const MIN_AI_SUMMARY_WIDTH = 280;
const MAX_AI_SUMMARY_WIDTH = 420;
const COLLAPSED_AI_SUMMARY_WIDTH = 54;
const DEFAULT_AI_SUMMARY_WIDTH = 320;

function qualifiedNameToTableRef(qualifiedName: string) {
  const [database, schema, table] = qualifiedName.split(".", 3);
  if (!database || !schema || !table) return null;
  return { database, schema, table };
}

function countFilterConditions(
  groups: Array<{ type?: string; children?: unknown[] }>,
): number {
  return groups.reduce((count, group) => {
    if (group.type === "condition") {
      return count + 1;
    }
    const children = Array.isArray(group.children)
      ? (group.children as Array<{ type?: string; children?: unknown[] }>)
      : [];
    return count + countFilterConditions(children);
  }, 0);
}

export function SummaryWorkspace() {
  const {
    mappings,
    sources,
    targets,
    relationships,
    derivedSources,
    session,
    semanticBundleLabel,
    semanticViewName,
    sourceFilterGroups,
    sourceQuerySql,
    sourceFilterSql,
    sourceGroupBySql,
    sourceOrderBySql,
    mappingSql,
    mappingPreviewSql,
    mappingSqlVariant,
    compiledMappingSql,
    compiledMappingPreviewSql,
    drivingTableId,
    semanticLineage,
    semanticContextItems,
    semanticDatahubContext,
    sourceAttributeGroups,
    semanticBundleId,
    activeProjectId,
    activeSttmId,
    activeProjectName,
  } = useSttmBuilderContext();

  const [tab, setTab] = useState<SummaryTab>("sttm-sheet");
  const { notifyTourContextChanged } = useTour();

  useEffect(() => {
    notifyTourContextChanged();
  }, [tab, notifyTourContextChanged]);
  const [excelExportLoading, setExcelExportLoading] = useState(false);
  const [excelExportStage, setExcelExportStage] = useState<string | null>(null);
  const [excelExportProgress, setExcelExportProgress] = useState(0);
  const [excelExportError, setExcelExportError] = useState<string | null>(null);
  const [excelExportNotice, setExcelExportNotice] = useState<string | null>(null);
  const [gitPushNotice, setGitPushNotice] = useState<string | null>(null);
  const [dbtCacheVersion, setDbtCacheVersion] = useState(0);
  const [testCaseCacheVersion, setTestCaseCacheVersion] = useState(0);
  const exportProgressTimerRef = useRef<number | null>(null);

  const selectedTargetQualifiedName =
    targets.find((table) => table.isSelected)?.qualifiedName ?? null;
  const selectedDerivedSourceRecords = useMemo(
    () => derivedSources.filter((source) => source.isSelected),
    [derivedSources],
  );
  const selectedSourceTables = useMemo(
    () =>
      sources
        .filter((table) => table.isSelected)
        .map((table) => qualifiedNameToTableRef(table.qualifiedName))
        .filter((table): table is NonNullable<typeof table> => Boolean(table)),
    [sources],
  );
  const selectedTargetTableRef = useMemo(
    () =>
      selectedTargetQualifiedName
        ? qualifiedNameToTableRef(selectedTargetQualifiedName)
        : null,
    [selectedTargetQualifiedName],
  );
  const drivingTableRef = useMemo(
    () => (drivingTableId ? qualifiedNameToTableRef(drivingTableId) : null),
    [drivingTableId],
  );
  const relationshipPayload = useMemo(
    () =>
      relationships
        .filter((join) => join.leftTableId && join.rightTableId && join.conditions?.length)
        .map((join) => {
          const leftTable = qualifiedNameToTableRef(String(join.leftTableId));
          const rightTable = qualifiedNameToTableRef(String(join.rightTableId));
          return leftTable && rightTable
            ? {
                left_table: leftTable,
                right_table: rightTable,
                join_type: join.joinType ?? "INNER",
                constraint_name: join.constraintName ?? null,
                source: join.source ?? "USER_DEFINED",
                locked: join.locked ?? false,
                conditions: (join.conditions ?? [])
                  .filter((condition) => condition.leftColumn && condition.rightColumn)
                  .map((condition) => ({
                    left_column: String(condition.leftColumn),
                    right_column: String(condition.rightColumn),
                    operator: condition.operator ?? "=",
                  })),
              }
            : null;
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    [relationships],
  );
  const resolvedSourceQuerySql = useMemo(
    () =>
      buildFallbackSourceQuerySql({
        sourceQuerySql,
        sourceTables: selectedSourceTables,
        derivedSources: selectedDerivedSourceRecords,
        relationships: relationshipPayload,
        drivingTable: drivingTableRef,
      }),
    [
      drivingTableRef,
      relationshipPayload,
      selectedDerivedSourceRecords,
      selectedSourceTables,
      sourceQuerySql,
    ],
  );

  const [aiSummaryCollapsed, setAiSummaryCollapsed] = useState(false);
  const [aiSummaryWidth, setAiSummaryWidth] = useState(DEFAULT_AI_SUMMARY_WIDTH);
  const aiSummaryResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const handlePointerMove = (event: globalThis.MouseEvent) => {
      const state = aiSummaryResizeRef.current;
      if (!state) {
        return;
      }
      const nextWidth = Math.min(
        MAX_AI_SUMMARY_WIDTH,
        Math.max(MIN_AI_SUMMARY_WIDTH, state.startWidth + (event.clientX - state.startX)),
      );
      setAiSummaryWidth(nextWidth);
    };

    const handlePointerUp = () => {
      aiSummaryResizeRef.current = null;
    };

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerUp);
    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
    };
  }, []);

  const beginAiSummaryResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    aiSummaryResizeRef.current = {
      startX: event.clientX,
      startWidth: aiSummaryWidth,
    };
  };

  const metrics = useMemo(
    () =>
      buildSummaryMetrics({
        mappings,
        sources,
        joinCount: relationships.length,
      }),
    [mappings, relationships.length, sources],
  );

  const selectedInputCount = useMemo(
    () =>
      sources.filter((table) => table.isSelected).length +
      derivedSources.filter((source) => source.isSelected).length,
    [derivedSources, sources],
  );

  const filterCount = useMemo(
    () => countFilterConditions(sourceFilterGroups as Array<{ type?: string; children?: unknown[] }>),
    [sourceFilterGroups],
  );

  const sourceQueryPreviewSql = useMemo(
    () =>
      buildSourceQueryPreviewSql({
        sourceQuerySql: resolvedSourceQuerySql,
        sourceFilterSql,
        sourceGroupBySql,
        sourceOrderBySql,
      }),
    [resolvedSourceQuerySql, sourceFilterSql, sourceGroupBySql, sourceOrderBySql],
  );

  const generatedSql = useMemo(
    () =>
      buildMappingInsertSql({
        mappings,
        targetQualifiedName: selectedTargetQualifiedName,
        sourceQuerySql: resolvedSourceQuerySql,
        sourceTables: selectedSourceTables,
        derivedSources: selectedDerivedSourceRecords,
        sourceFilterSql,
        sourceGroupBySql,
        sourceOrderBySql,
      }),
    [
      selectedDerivedSourceRecords,
      selectedSourceTables,
      mappings,
      resolvedSourceQuerySql,
      selectedTargetQualifiedName,
      sourceFilterSql,
      sourceGroupBySql,
      sourceOrderBySql,
    ],
  );

  const previewSql = useMemo(
    () =>
      buildMappingSelectSql({
        mappings,
        sourceQuerySql: resolvedSourceQuerySql,
        sourceTables: selectedSourceTables,
        derivedSources: selectedDerivedSourceRecords,
        sourceFilterSql,
        sourceGroupBySql,
        sourceOrderBySql,
      }),
    [
      selectedDerivedSourceRecords,
      selectedSourceTables,
      mappings,
      resolvedSourceQuerySql,
      sourceFilterSql,
      sourceGroupBySql,
      sourceOrderBySql,
    ],
  );
  const finalGeneratedSql = useMemo(
    () => (mappingSql?.trim() ? mappingSql : compiledMappingSql?.trim() ? compiledMappingSql : generatedSql),
    [compiledMappingSql, generatedSql, mappingSql],
  );
  const finalPreviewSql = useMemo(
    () => (
      mappingSql?.trim()
        ? mappingPreviewSql?.trim() ? mappingPreviewSql : mappingSql
        : compiledMappingPreviewSql?.trim()
          ? compiledMappingPreviewSql
          : mappingPreviewSql?.trim() ? mappingPreviewSql : previewSql
    ),
    [compiledMappingPreviewSql, mappingPreviewSql, mappingSql, previewSql],
  );
  const sqlVariantLabel = useMemo(() => {
    if (mappingSqlVariant === "optimized") {
      return "Cortex Analyst optimized SQL";
    }
    if (mappingSqlVariant === "original") {
      return "Original builder SQL";
    }
    return "Current builder SQL";
  }, [mappingSqlVariant]);
  const tableLineageMermaid = useMemo(
    () =>
      buildTableLineageMermaid({
        sourceTables: selectedSourceTables,
        derivedSources,
        relationships: relationshipPayload,
        targetTable: selectedTargetTableRef,
      }),
    [derivedSources, relationshipPayload, selectedSourceTables, selectedTargetTableRef],
  );
  const columnLineageMermaid = useMemo(
    () =>
      buildColumnLineageMermaid({
        mappings,
        targetTable: selectedTargetTableRef,
      }),
    [mappings, selectedTargetTableRef],
  );
  const dbtRequestPayload = useMemo(
    () =>
      buildDbtConversionRequestPayload({
        projectId: activeProjectId,
        sttmId: activeSttmId,
        targets,
        sources,
        relationships,
        derivedSources,
        sourceAttributeGroups,
        mappings,
        semanticBundleId,
        semanticBundleLabel,
        semanticViewName,
        semanticContextItems,
        semanticLineage,
        semanticDatahubContext,
        sourceQuerySql: sourceQueryPreviewSql,
        validatedSql: finalPreviewSql,
        generatedSql: finalGeneratedSql,
      }),
    [
      activeProjectId,
      activeSttmId,
      derivedSources,
      finalGeneratedSql,
      finalPreviewSql,
      mappings,
      relationships,
      semanticBundleId,
      semanticBundleLabel,
      semanticContextItems,
      semanticDatahubContext,
      semanticLineage,
      semanticViewName,
      sourceAttributeGroups,
      sourceQueryPreviewSql,
      sources,
      targets,
    ],
  );
  const cachedDbtConversion = useMemo(
    () => getCachedDbtConversion(dbtRequestPayload),
    [dbtCacheVersion, dbtRequestPayload],
  );
  const testCaseRequestPayload = useMemo<TestCaseGenerationRequest | null>(() => {
    if (!dbtRequestPayload) return null;
    const validatedSql = (finalPreviewSql || finalGeneratedSql).trim();
    if (!validatedSql) return null;

    return {
      project_id: activeProjectId,
      sttm_id: activeSttmId,
      project_name: activeProjectName ?? `${dbtRequestPayload.target_table.table} Test Cases`,
      domain_name: dbtRequestPayload.domain_name ?? null,
      target_layer: dbtRequestPayload.target_layer ?? null,
      materialization: dbtRequestPayload.materialization ?? null,
      source_tables: dbtRequestPayload.source_tables,
      target_table: dbtRequestPayload.target_table,
      relationships: dbtRequestPayload.relationships ?? [],
      validated_sql: validatedSql,
      mappings: dbtRequestPayload.mappings,
      semantic_context: dbtRequestPayload.semantic_context ?? [],
      derived_sources: selectedDerivedSourceRecords.map((source) => ({
        derived_source_name: source.sourceName,
        sql_text: source.sqlText ?? null,
        semantic_view_name: source.semanticViewName ?? null,
        base_sources: (source.baseSourceTables ?? []).map((table) => {
          const qualifiedName = `${table.database}.${table.schema}.${table.table}`;
          const group = sourceAttributeGroups.find(
            (candidate) => candidate.qualifiedName === qualifiedName,
          );
          return {
            table,
            attribute_semantic_model: (group?.columns ?? []).map((column) => ({
              name: column.name ?? null,
              data_type: column.type ?? null,
              is_primary_key: column.isPrimaryKey ?? false,
              is_foreign_key: column.isForeignKey ?? false,
            })),
          };
        }),
      })),
    };
  }, [
    activeProjectId,
    activeProjectName,
    activeSttmId,
    dbtRequestPayload,
    finalGeneratedSql,
    finalPreviewSql,
    selectedDerivedSourceRecords,
    sourceAttributeGroups,
  ]);
  const cachedTestCaseGeneration = useMemo(
    () => getCachedTestCaseGeneration(testCaseRequestPayload),
    [testCaseCacheVersion, testCaseRequestPayload],
  );

  const narrative = useMemo(() => {
    const targetLabel = selectedTargetQualifiedName ?? "the selected target table";
    const sourceLabels = metrics.sourceTableLabels.join(", ") || "selected source tables";
    const transformText =
      metrics.transformRules.length > 0
        ? ` Transform rules applied: ${metrics.transformRules.join(", ")}.`
        : "";
    return `Mapping ${metrics.mappedCount} of ${metrics.totalCount} target columns from ${sourceLabels} into ${targetLabel}.${transformText} Overall coverage is ${metrics.progressPercent}%.`;
  }, [metrics, selectedTargetQualifiedName]);

  const handleExportSql = () => {
    if (!finalGeneratedSql.trim()) {
      return;
    }
    const blob = new Blob([finalGeneratedSql], { type: "text/sql;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "mapping.sql";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const clearExportProgressTimer = () => {
    if (exportProgressTimerRef.current !== null) {
      window.clearInterval(exportProgressTimerRef.current);
      exportProgressTimerRef.current = null;
    }
  };

  useEffect(() => clearExportProgressTimer, []);

  const beginExportProgress = () => {
    clearExportProgressTimer();
    setExcelExportProgress(8);
    exportProgressTimerRef.current = window.setInterval(() => {
      setExcelExportProgress((current) => (current >= 88 ? current : current + 8));
    }, 900);
  };

  const handleExportExcel = async () => {
    setExcelExportLoading(true);
    setGitPushNotice(null);
    setExcelExportError(null);
    setExcelExportNotice(null);
    setExcelExportStage("Collecting mapping context for the workbook...");
    beginExportProgress();
    const targetTable = selectedTargetTableRef;

    if (!cachedDbtConversion?.result) {
      setExcelExportNotice(
        "DBT code is still being generated. Downloading the workbook without the DBT sheet content for now.",
      );
    }

    const payload = {
      project_name: targetTable?.table ? `${targetTable.table} STTM Export` : "STTM Export",
      summary_narrative: narrative,
      created_by:
        session?.display_name ||
        session?.email ||
        (session?.user_id !== undefined && session?.user_id !== null ? String(session.user_id) : "Unknown"),
      created_at: new Date().toISOString(),
      version_label: semanticBundleLabel || semanticViewName || "Current builder session",
      target_table: targetTable,
      source_tables: selectedSourceTables,
      relationships: relationshipPayload,
      derived_sources: selectedDerivedSourceRecords
        .map((source) => ({
          derived_source_id: source.id,
          derived_source_name: source.sourceName,
          sql_text: source.sqlText ?? null,
          source_tables: (source.baseSourceTables ?? []).filter(Boolean),
          base_source_tables: (source.baseSourceTables ?? []).filter(Boolean),
          semantic_view_name: source.semanticViewName ?? null,
          semantic_bundle_label: source.semanticBundleLabel ?? null,
        })),
      filters_sql: sourceFilterSql || null,
      source_query_sql: sourceQueryPreviewSql,
      preview_sql: finalPreviewSql,
      generated_sql: finalGeneratedSql,
      sql_variant_label: sqlVariantLabel,
      derived_source_lineage: semanticLineage ?? [],
      lineage_table_mermaid: tableLineageMermaid,
      lineage_column_mermaid: columnLineageMermaid,
      dbt_conversion: cachedDbtConversion?.result
        ? {
            status: cachedDbtConversion.result.status,
            action: cachedDbtConversion.result.action ?? null,
            message: cachedDbtConversion.result.message ?? null,
            materialization: cachedDbtConversion.result.materialization ?? null,
            materialization_reason: cachedDbtConversion.result.materialization_reason ?? null,
            generated_files: cachedDbtConversion.result.generated_files,
            schema_files: cachedDbtConversion.result.schema_files,
            source_update: cachedDbtConversion.result.source_update ?? null,
          }
        : null,
      test_case_generation: cachedTestCaseGeneration?.result
        ? {
            status: cachedTestCaseGeneration.result.status,
            domain_name: cachedTestCaseGeneration.result.domain_name ?? null,
            target_layer: cachedTestCaseGeneration.result.target_layer ?? null,
            materialization: cachedTestCaseGeneration.result.materialization ?? null,
            target_model: cachedTestCaseGeneration.result.target_model ?? null,
            target_table: cachedTestCaseGeneration.result.target_table ?? null,
            test_groups: cachedTestCaseGeneration.result.test_groups,
            seed_files: cachedTestCaseGeneration.result.seed_files,
            test_case_document: cachedTestCaseGeneration.result.test_case_document,
          }
        : null,
      mappings: mappings
        .filter((mapping) => mapping.status === "MAPPED")
        .map((mapping) => ({
          target_column: mapping.targetColumn,
          target_type: mapping.targetType,
          source_column: mapping.sourceColumn,
          source_columns:
            mapping.sourceColumns && mapping.sourceColumns.length
              ? mapping.sourceColumns
              : parseSourceColumns(mapping.sourceColumn),
          mapping_mode: mapping.mappingMode ?? "source",
          constant_value: mapping.constantValue ?? null,
          expression: mapping.expression,
          rule: mapping.rule,
          status: mapping.status,
          nl_rule: mapping.nlRule ?? null,
          description: mapping.description ?? null,
        })),
    };

    try {
      setExcelExportProgress(28);
      setExcelExportStage("Preparing workbook sheets and sample values...");
      const blob = await dbService.exportSttmWorkbook(payload);
      setExcelExportProgress(95);
      setExcelExportStage("Workbook is ready. Starting the download...");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${targetTable?.table ?? "sttm"}_export.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExcelExportProgress(100);
      setTimeout(() => {
        setExcelExportStage(null);
        setExcelExportProgress(0);
      }, 1200);
    } catch (error) {
      setExcelExportError(
        error instanceof Error ? error.message : "Unable to generate the Excel workbook.",
      );
      setExcelExportStage("Workbook generation failed. Review the error and try again.");
      setExcelExportProgress(0);
    } finally {
      clearExportProgressTimer();
      setExcelExportLoading(false);
    }
  };

  const handlePushToGit = () => {
    setGitPushNotice("Dummy action only for now. The DBT git push wiring is not connected yet.");
  };

  return (
    <AiaBox sx={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0, flexDirection: "column", overflow: "hidden" }}>
      <BuilderWorkspaceTabBar
        backgroundColor="#ffffff"
        tabs={[
          { key: "sttm-sheet", label: "STTM Sheet", icon: <TableChartOutlinedIcon sx={{ fontSize: 17 }} /> },
          {
            key: "sql-preview",
            label: "SQL Preview",
            icon: <TerminalRoundedIcon sx={{ fontSize: 17 }} />,
            badge: metrics.mappedCount > 0 ? metrics.mappedCount : undefined,
          },
          {
            key: "dbt-conversion",
            label: "DBT Conversion",
            icon: <AutoAwesomeRoundedIcon sx={{ fontSize: 17 }} />,
          },
          { key: "data-lineage", label: "Data Lineage", icon: <AccountTreeOutlinedIcon sx={{ fontSize: 17 }} /> },
          { key: "test-cases", label: "Test Cases", icon: <ScienceOutlinedIcon sx={{ fontSize: 17 }} /> },
        ]}
        activeTab={tab}
        onTabChange={setTab}
        trailing={
          <SummaryExportActions
            mappedCount={metrics.mappedCount}
            totalCount={metrics.totalCount}
            excelLoading={excelExportLoading}
            excelLabel={excelExportLoading ? "Generating Excel..." : "Download Excel"}
            onExportExcel={() => {
              void handleExportExcel();
            }}
            onExportSql={handleExportSql}
            onPushToGit={handlePushToGit}
          />
        }
      />

      {excelExportStage || gitPushNotice ? (
        <AiaBox sx={{ px: 2, pt: 1.5, pb: 0.5, backgroundColor: "#ffffff" }}>
          {excelExportStage ? (
            <AiaAlert
              severity={excelExportError ? "error" : excelExportLoading ? "info" : "success"}
              sx={{ borderRadius: 2, alignItems: "center", mb: gitPushNotice ? 1 : 0 }}
            >
              <AiaText sx={{ fontSize: "0.82rem", fontWeight: 700, mb: 0.35 }}>
                {excelExportStage}
              </AiaText>
              {!excelExportError ? (
                <AiaLinearProgress
                  variant={excelExportProgress > 0 ? "determinate" : "indeterminate"}
                  value={excelExportProgress}
                  sx={{
                    mt: 0.75,
                    height: 6,
                    borderRadius: 999,
                    bgcolor: "rgba(148,163,184,0.18)",
                  }}
                />
              ) : (
                <AiaText sx={{ fontSize: "0.78rem", lineHeight: 1.5 }}>
                  {excelExportError}
                </AiaText>
              )}
            </AiaAlert>
          ) : null}
          {excelExportNotice ? (
            <AiaAlert severity="warning" sx={{ borderRadius: 2, mb: gitPushNotice ? 1 : 0 }}>
              <AiaText sx={{ fontSize: "0.8rem", lineHeight: 1.5 }}>
                {excelExportNotice}
              </AiaText>
            </AiaAlert>
          ) : null}
          {gitPushNotice ? (
            <AiaAlert severity="info" sx={{ borderRadius: 2 }}>
              <AiaText sx={{ fontSize: "0.8rem", lineHeight: 1.5 }}>
                {gitPushNotice}
              </AiaText>
            </AiaAlert>
          ) : null}
        </AiaBox>
      ) : null}

      <AiaBox sx={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
        {tab !== "data-lineage" && tab !== "test-cases" ? (
        <AiaBox
          sx={{
            display: "flex",
            width: aiSummaryCollapsed ? COLLAPSED_AI_SUMMARY_WIDTH : aiSummaryWidth,
            minWidth: aiSummaryCollapsed ? COLLAPSED_AI_SUMMARY_WIDTH : MIN_AI_SUMMARY_WIDTH,
            maxWidth: aiSummaryCollapsed ? COLLAPSED_AI_SUMMARY_WIDTH : MAX_AI_SUMMARY_WIDTH,
            flexShrink: 0,
            borderRight: "1px solid #e5e7eb",
            overflow: "hidden",
            bgcolor: "#fafafa",
            minHeight: 0,
            height: "100%",
          }}
        >
          {aiSummaryCollapsed ? (
            <AiaBox
              sx={{
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                overflow: "hidden",
              }}
            >
              <SttmSidebarCollapsedRail items={[{ kind: "ai", label: "AI Summary" }]} />
              <AiaBox sx={{ mt: "auto", pb: 1.25 }}>
                <AiaIconButton
                  size="small"
                  aria-label="Expand AI summary"
                  onClick={() => setAiSummaryCollapsed(false)}
                  sx={{
                    width: 32,
                    height: 32,
                    p: 0,
                    color: "#475569",
                    border: "1px solid #dbe2ea",
                    borderRadius: "50%",
                    backgroundColor: "#fff",
                    "&:hover": {
                      backgroundColor: "#f8fafc",
                    },
                  }}
                >
                  <KeyboardDoubleArrowRightRoundedIcon sx={{ fontSize: 18 }} />
                </AiaIconButton>
              </AiaBox>
            </AiaBox>
          ) : (
            <AiaBox sx={{ display: "flex", width: "100%", minWidth: 0, minHeight: 0, flex: 1 }}>
              <AiaBox
                sx={{
                  minWidth: 0,
                  flex: 1,
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                <AiSummaryPanel
                  metrics={metrics}
                  targetQualifiedName={selectedTargetQualifiedName}
                  narrative={narrative}
                  onCollapse={() => setAiSummaryCollapsed(true)}
                />
              </AiaBox>
              <AiaResizeHandle
                direction="horizontal"
                onMouseDown={beginAiSummaryResize}
                sx={{ alignSelf: "stretch", height: "100%" }}
              />
            </AiaBox>
          )}
        </AiaBox>
        ) : null}

        <AiaBox sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {tab !== "data-lineage" && tab !== "test-cases" ? (
            <SummaryStatsRow metrics={metrics} targetQualifiedName={selectedTargetQualifiedName} />
          ) : null}

          {tab === "sttm-sheet" ? <SttmSheetTab mappings={mappings} /> : null}
          {tab === "sql-preview" ? (
            <AiaBox
              data-tour={TOUR_TARGETS.sttmSqlPreviewPanel}
              sx={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
            >
              <MappingSqlPreview
                readOnly
                sqlTitle={mappingSql?.trim() ? "Imported SQL" : "Agent mappings · compiled SQL"}
                targetLabel={selectedTargetQualifiedName?.split(".").pop() ?? null}
                mappedCount={metrics.mappedCount}
                tableCount={selectedInputCount}
                filterCount={filterCount}
                joinCount={relationships.length}
                sourceQuerySql={sourceQueryPreviewSql}
                generatedSql={finalGeneratedSql}
              />
            </AiaBox>
          ) : null}
          {tab === "data-lineage" ? (
            <AiaBox data-tour={TOUR_TARGETS.sttmDataLineagePanel} sx={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
              <SttmLineageWorkspacePanel />
            </AiaBox>
          ) : null}
          <TestCasesTab
            active={tab === "test-cases"}
            requestPayload={testCaseRequestPayload}
            workbookLoading={excelExportLoading}
            onDownloadWorkbook={() => void handleExportExcel()}
            onCompleted={() => setTestCaseCacheVersion((current) => current + 1)}
          />
          <DbtConversionTab
            active={tab === "dbt-conversion"}
            validatedSql={finalPreviewSql}
            generatedSql={finalGeneratedSql}
            sourceQuerySql={sourceQueryPreviewSql}
            onCompleted={() => setDbtCacheVersion((current) => current + 1)}
          />
        </AiaBox>
      </AiaBox>
    </AiaBox>
  );
}
