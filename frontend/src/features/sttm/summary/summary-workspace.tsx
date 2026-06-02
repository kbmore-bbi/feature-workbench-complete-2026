"use client";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  AccountTreeOutlinedIcon,
  KeyboardDoubleArrowRightRoundedIcon,
  TableChartOutlinedIcon,
  TerminalRoundedIcon,
} from '@/utils/icons';

import { Box, IconButton } from "@mui/material";
import { AiaResizeHandle } from "@/components/ui/aia-resize-handle";
import { MappingSqlPreview } from "@/components/sql";
import { SttmLineageWorkspacePanel } from "@/features/sttm/lineage/sttm-lineage-workspace-panel";
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

const MIN_AI_SUMMARY_WIDTH = 280;
const MAX_AI_SUMMARY_WIDTH = 420;
const COLLAPSED_AI_SUMMARY_WIDTH = 54;
const DEFAULT_AI_SUMMARY_WIDTH = 320;

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
  const [aiSummaryCollapsed, setAiSummaryCollapsed] = useState(false);
  const [aiSummaryWidth, setAiSummaryWidth] = useState(DEFAULT_AI_SUMMARY_WIDTH);
  const aiSummaryResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const handlePointerMove = (event: MouseEvent) => {
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

  const beginAiSummaryResize = (event: MouseEvent<HTMLDivElement>) => {
    aiSummaryResizeRef.current = {
      startX: event.clientX,
      startWidth: aiSummaryWidth,
    };
  };

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
        {tab !== "data-lineage" ? (
        <Box
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
            <Box
              sx={{
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                justifyContent: "flex-end",
                pb: 1.25,
                pl: 0.75,
              }}
            >
              <IconButton
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
              </IconButton>
            </Box>
          ) : (
            <Box sx={{ display: "flex", width: "100%", minWidth: 0, minHeight: 0, flex: 1 }}>
              <Box
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
              </Box>
              <AiaResizeHandle
                direction="horizontal"
                onMouseDown={beginAiSummaryResize}
                sx={{ alignSelf: "stretch", height: "100%" }}
              />
            </Box>
          )}
        </Box>
        ) : null}

        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {tab !== "data-lineage" ? (
            <SummaryStatsRow metrics={metrics} targetQualifiedName={selectedTargetQualifiedName} />
          ) : null}

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
          {tab === "data-lineage" ? <SttmLineageWorkspacePanel /> : null}
        </Box>
      </Box>
    </Box>
  );
}
