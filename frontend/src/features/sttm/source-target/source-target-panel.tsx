"use client";
import { AiaBox, AiaButton, AiaStack } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import React from "react";
import SourceTargetList from "./source-target-list";
import DerivedWorkspaceList from "./derived-workspace-list";

import { AddIcon } from '@/utils/icons';
import { SttmSidebarSectionIcon } from '@/features/sttm/layout/sttm-sidebar-icons';
import { CAPTION_SX, textStyleCssVars, TYPOGRAPHY_TOKENS } from '@/config/typography-tokens';

import { useSttmBuilderContext } from "@/features/sttm/context/sttm-builder-context";
import { AiaSearchbox } from "@/components/ui/aia-searchbox";
import { AddDerivedModal } from "./add-derived-modal";
import { TOUR_TARGETS } from "@/features/tour/constants/tour-targets";
import {
  parseDerivedWorkspaceDragPayload,
  parseWorkspaceDragPayload,
} from "./source-workspace-dnd";
import { useWorkspaceListSelection } from "./use-workspace-list-selection";
import {
  resolveSelectedSourceTables,
  resolveSelectedTargetTable,
} from "@/features/sttm/shared/sttm-selection-utils";

const HEADER_TEXT_BUTTON_SX = {
  minWidth: 0,
  px: 0.75,
  py: 0.25,
  fontSize: "var(--aia-caption-font-size)",
  fontWeight: 600,
  textTransform: "none",
  color: "var(--aia-button-color)",
  backgroundColor: "transparent",
  boxShadow: "none",
  "&:hover": {
    backgroundColor: "color-mix(in srgb, var(--aia-button-color) 6%, transparent)",
    color: "var(--aia-button-color)",
    boxShadow: "none",
  },
} as const;

export default function SourceTargetPanel({ type }: { type: "source" | "target" | "derived" }) {
  const {
    selectAllSources,
    clearSources,
    clearTargets,
    clearDerivedSources,
    fullData,
    drivingTableId,
    addDerivedSource,
    pendingDerivedSourceDraft,
    derivedSourceDraftRequested,
    acknowledgePendingDerivedSourceDraft,
    dismissPendingDerivedSourceDraft,
    sources,
    targets,
    derivedSources,
    toggleSource,
    selectTarget,
    toggleDerivedSource,
  } = useSttmBuilderContext();
  const [isDerivedModalOpen, setIsDerivedModalOpen] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState("");
  const [isDropActive, setIsDropActive] = React.useState(false);
  const workspaceSelection = useWorkspaceListSelection();

  React.useEffect(() => {
    if (type === "derived" && derivedSourceDraftRequested && pendingDerivedSourceDraft) {
      setIsDerivedModalOpen(true);
      acknowledgePendingDerivedSourceDraft();
    }
  }, [
    acknowledgePendingDerivedSourceDraft,
    derivedSourceDraftRequested,
    pendingDerivedSourceDraft,
    type,
  ]);

  const title =
    type === "source"
      ? "Source tables"
      : type === "target"
        ? "Target tables"
        : "Derived sources";
  const selectedCount = React.useMemo(() => {
    if (type === "derived") {
      return derivedSources.filter((source) => source.isSelected).length;
    }
    const branch = type === "source" ? fullData?.sources : fullData?.targets;
    if (type === "source") {
      return resolveSelectedSourceTables({
        sourceDatabases: branch ?? [],
        sources,
      }).length;
    }
    if (type === "target") {
      return resolveSelectedTargetTable({
        targetDatabases: branch ?? [],
        targets,
      }) ? 1 : 0;
    }
    let count = 0;
    for (const db of branch ?? []) {
      for (const sch of db.schemas ?? []) {
        for (const tbl of sch.tables ?? []) {
          if (tbl.isSelected) count += 1;
        }
      }
    }
    return count;
  }, [derivedSources, fullData, sources, targets, type]);

  const drivingTableDetails = React.useMemo(() => {
    if (type !== 'source' || !drivingTableId) return null;
    const table = resolveSelectedSourceTables({
      sourceDatabases: fullData?.sources ?? [],
      sources,
    }).find((candidate) => candidate.tableId === drivingTableId);
    if (!table) return null;
    const [dbName = "", schemaName = ""] = table.qualifiedName.split(".");
    return { dbName, schemaName, tableName: table.tableName };
  }, [fullData, drivingTableId, sources, type]);

  const showClearAll = selectedCount > 0;
  const clearAllTourTarget =
    type === "source"
      ? TOUR_TARGETS.sttmClearAllSource
      : type === "target"
        ? TOUR_TARGETS.sttmClearAllTarget
        : TOUR_TARGETS.sttmClearAllDerived;

  const onSelectAll = () => {
    if (type === "source") selectAllSources();
  };

  const onClear = () => {
    if (type === "source") clearSources();
    else if (type === "target") clearTargets();
    else clearDerivedSources();
  };

  const resolveDraggedTableIds = React.useCallback(
    (items: NonNullable<ReturnType<typeof parseWorkspaceDragPayload>>["items"]) => {
      const branch = type === "target" ? fullData?.targets : fullData?.sources;
      const ids: string[] = [];
      for (const item of items) {
        if (item.kind === "table") {
          ids.push(item.tableId);
          continue;
        }
        if (item.kind === "database") {
          const database = branch?.find((entry) => entry.dbId === item.dbId);
          ids.push(
            ...(database?.schemas.flatMap((schema) =>
              schema.tables.map((table) => table.tableId),
            ) ?? []),
          );
          continue;
        }
        const database = branch?.find((entry) => entry.dbId === item.dbId);
        const schema = database?.schemas.find((entry) => entry.schemaId === item.schemaId);
        ids.push(...(schema?.tables.map((table) => table.tableId) ?? []));
      }
      return Array.from(new Set(ids));
    },
    [fullData, type],
  );

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDropActive(false);

    if (type === "derived") {
      const payload = parseDerivedWorkspaceDragPayload(event.dataTransfer);
      for (const id of payload?.derivedSourceIds ?? []) {
        const source = derivedSources.find((item) => item.id === id);
        if (source && !source.isSelected) {
          toggleDerivedSource(id);
        }
      }
      return;
    }

    const payload = parseWorkspaceDragPayload(event.dataTransfer);
    if (!payload) return;
    const tableIds = resolveDraggedTableIds(payload.items);
    if (type === "target") {
      const firstTarget = tableIds[0];
      if (firstTarget) selectTarget(firstTarget);
      return;
    }
    const selectedIds = new Set(
      resolveSelectedSourceTables({
        sourceDatabases: fullData?.sources ?? [],
        sources,
      }).map((table) => table.tableId),
    );
    for (const tableId of tableIds) {
      if (!selectedIds.has(tableId)) {
        toggleSource(tableId);
      }
    }
  };

  return (
    <AiaBox
      sx={{
        width: "100%",
        maxWidth: "100%",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "transparent",
        p: 2,
        outline: isDropActive ? "2px dashed var(--color-primary-save)" : "none",
        outlineOffset: -4,
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setIsDropActive(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsDropActive(false);
        }
      }}
      onDrop={handleDrop}
    >
      <AiaBox
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mt: -2,
          mx: -2,
          px: 2,
          mb: 1.5,
          minHeight: "var(--aia-workspace-section-header-min-height)",
          borderBottom: "1px solid #e5e7eb",
          gap: 2,
          overflow: "visible",
        }}
      >
        <AiaBox
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            minWidth: 0,
            overflow: "visible",
          }}
        >
          <AiaBox
            sx={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
              flexShrink: 0,
              overflow: "visible",
              color: TYPOGRAPHY_TOKENS.cardTitle.color,
              "& .MuiSvgIcon-root": { color: "inherit" },
            }}
          >
            <SttmSidebarSectionIcon
              kind={type}
              sx={{
                fontSize: "calc(var(--aia-card-title-font-size) + 2px)",
                color: "var(--aia-card-title-color)",
                flexShrink: 0,
              }}
            />
          </AiaBox>
          <AiaText
            sx={{
              ...textStyleCssVars("cardTitle"),
              textTransform: "capitalize",
              letterSpacing: "-0.01em",
            }}
          >
            {title}
          </AiaText>
        </AiaBox>
        <AiaBox sx={{ display: "flex", alignItems: "center", gap: 1.25, flexShrink: 0 }}>
          <AiaText sx={CAPTION_SX}>
            {selectedCount} selected
          </AiaText>
          {type === "source" ? (
            <AiaButton variant="text" size="small" onClick={onSelectAll} sx={HEADER_TEXT_BUTTON_SX}>
              Select all
            </AiaButton>
          ) : null}
          {showClearAll ? (
            <AiaButton
              data-tour={clearAllTourTarget}
              variant="text"
              size="small"
              onClick={onClear}
              sx={HEADER_TEXT_BUTTON_SX}
            >
              Clear All
            </AiaButton>
          ) : null}
          {type === "derived" ? (
            <AiaButton
              data-tour={TOUR_TARGETS.sttmAddDerived}
              size="small"
              variant="outlined"
              startIcon={<AddIcon sx={{ fontSize: 18 }} />}
              onClick={() => setIsDerivedModalOpen(true)}
              sx={{ minWidth: 0, boxShadow: "none" }}
              customBorderColor="var(--aia-state-success-color)"
              customColor="var(--aia-state-success-color)"
              customHoverBackgroundColor="var(--aia-state-success-hover-bg)"
            >
              Create CTE
            </AiaButton>
          ) : null}
        </AiaBox>
      </AiaBox>

      {type !== "derived" ? <AiaBox
        sx={{
          display: "flex",
          alignItems: "stretch",
          gap: 1,
          mb: 1.25,
        }}
      >
        <AiaSearchbox
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="search tables or tags"
          sx={{ flex: 1, mb: 0 }}
        />

        {/* <AiaButton
          variant="text"
          size="small"
          startIcon={<FilterListRoundedIcon sx={{ fontSize: 18, color: "#6b7280" }} />}
          sx={filtersControlSx}
        >
          Filters
        </AiaButton> */}
      </AiaBox> : null}

      {type === "source" && (
        <AiaBox sx={{ mx: -2, borderBottom: "1px solid #eef2f7", mb: 1.5 }}>
          <AiaBox
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              pb: 1.5,
              px: 2,
              flexWrap: "wrap",
              gap: 1,
            }}
          >
            {drivingTableDetails ? (
              <AiaBox sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <AiaText
                  sx={{
                    fontSize: 14,
                    fontWeight: 400,
                    color: "#9ca3af",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                  }}
                >
                  Driving table:
                </AiaText>
                <AiaText
                  sx={{
                    fontSize: 14,
                    fontWeight: 400,
                    color: "#1e293b",
                    px: 1,
                    py: 0.25,
                    borderRadius: "4px",
                  }}
                >
                  {drivingTableDetails.dbName} &bull; {drivingTableDetails.schemaName} &bull;{" "}
                  {drivingTableDetails.tableName}
                </AiaText>
              </AiaBox>
            ) : (
              <AiaBox />
            )}
          </AiaBox>
        </AiaBox>
      )}

      <AiaBox sx={{ pr: 0.5, minHeight: type === "derived" ? 130 : undefined }}>
        <AiaStack spacing={0.5}>
          {type === "derived" ? (
            <DerivedWorkspaceList
              orderedIds={derivedSources.filter((source) => source.isSelected).map((source) => source.id)}
              isSelected={workspaceSelection.isSelected}
              onSelect={workspaceSelection.handleSelect}
            />
          ) : (
            <SourceTargetList type={type} searchTerm={searchTerm} />
          )}
        </AiaStack>
      </AiaBox>

      {type === "derived" && (
        <AddDerivedModal
          isOpen={isDerivedModalOpen}
          onClose={() => setIsDerivedModalOpen(false)}
          draftSource={pendingDerivedSourceDraft}
          onConfirm={(source) => {
            addDerivedSource(source);
            dismissPendingDerivedSourceDraft();
            setIsDerivedModalOpen(false);
          }}
        />
      )}
    </AiaBox>
  );
}
