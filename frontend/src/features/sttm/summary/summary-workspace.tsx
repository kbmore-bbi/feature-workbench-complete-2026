"use client";

import { useMemo, useState } from "react";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import TerminalRoundedIcon from "@mui/icons-material/TerminalRounded";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import { Box } from "@mui/material";
import { MappingSqlPreview } from "@/components/sql";
import LineageTab from "@/features/sttm/lineage/lineage-tab";
import { useSttmBuilderContext } from "@/features/sttm/context/sttm-builder-context";
import {
  buildMappingInsertSql,
  buildSourceQueryPreviewSql,
} from "@/features/sttm/mapping/mapping-utils";
import { BuilderWorkspaceTabBar } from "@/features/sttm/shared/builder-workspace-tab-bar";
import { AiSummaryPanel } from "./ai-summary-panel";
import { SummaryExportActions } from "./summary-export-actions";
import { SummaryStatsRow } from "./summary-stats-row";
import { buildSummaryMetrics } from "./summary-utils";
import { SttmSheetTab } from "./sttm-sheet-tab";

type SummaryTab = "sttm-sheet" | "sql-preview" | "data-lineage";

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
    sourceFilterGroups,
    sourceQuerySql,
    sourceFilterSql,
    sourceGroupBySql,
    sourceOrderBySql,
  } = useSttmBuilderContext();

  const [tab, setTab] = useState<SummaryTab>("sttm-sheet");

  const selectedTargetQualifiedName =
    targets.find((table) => table.isSelected)?.qualifiedName ?? null;

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
        sourceQuerySql,
        sourceFilterSql,
        sourceGroupBySql,
        sourceOrderBySql,
      }),
    [sourceFilterSql, sourceGroupBySql, sourceOrderBySql, sourceQuerySql],
  );

  const generatedSql = useMemo(
    () =>
      buildMappingInsertSql({
        mappings,
        targetQualifiedName: selectedTargetQualifiedName,
        sourceQuerySql,
        sourceFilterSql,
        sourceGroupBySql,
        sourceOrderBySql,
      }),
    [
      mappings,
      selectedTargetQualifiedName,
      sourceQuerySql,
      sourceFilterSql,
      sourceGroupBySql,
      sourceOrderBySql,
    ],
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
    if (!generatedSql.trim()) {
      return;
    }
    const blob = new Blob([generatedSql], { type: "text/sql;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "mapping.sql";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box sx={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0, flexDirection: "column", overflow: "hidden" }}>
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
          { key: "data-lineage", label: "Data Lineage", icon: <AccountTreeOutlinedIcon sx={{ fontSize: 17 }} /> },
        ]}
        activeTab={tab}
        onTabChange={setTab}
        trailing={
          <SummaryExportActions
            mappedCount={metrics.mappedCount}
            totalCount={metrics.totalCount}
            onExportSql={handleExportSql}
          />
        }
      />

      <Box sx={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <SummaryStatsRow metrics={metrics} targetQualifiedName={selectedTargetQualifiedName} />

          {tab === "sttm-sheet" ? <SttmSheetTab mappings={mappings} /> : null}
          {tab === "sql-preview" ? (
            <MappingSqlPreview
              readOnly
              targetLabel={selectedTargetQualifiedName?.split(".").pop() ?? null}
              mappedCount={metrics.mappedCount}
              tableCount={selectedInputCount}
              filterCount={filterCount}
              joinCount={relationships.length}
              sourceQuerySql={sourceQueryPreviewSql}
              generatedSql={generatedSql}
            />
          ) : null}
          {tab === "data-lineage" ? (
            <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
              <LineageTab />
            </Box>
          ) : null}
        </Box>

        <AiSummaryPanel
          metrics={metrics}
          targetQualifiedName={selectedTargetQualifiedName}
          narrative={narrative}
        />
      </Box>
    </Box>
  );
}
