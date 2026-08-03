"use client";
import { AiaBox, AiaButton, AiaCircularProgress, AiaCollapse } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { useState } from "react";
import {
  KeyboardArrowDownRoundedIcon,
  KeyboardArrowRightRoundedIcon,
  TableChartOutlinedIcon,
} from '@/utils/icons';
import { AiaCheckbox } from "@/components/ui/aia-checkbox";
import { BODY_SX, SECONDARY_TEXT_SX, TYPOGRAPHY_TOKENS } from "@/config/typography-tokens";
import { HierarchyIcon } from '@/features/sttm/shared/hierarchy-icons';

import { AiaSearchbox } from "@/components/ui/aia-searchbox";
import { useSttmBuilderContext } from "@/features/sttm/context/sttm-builder-context";
import { ResizableSidebarSections } from "@/features/sttm/layout/resizable-sidebar-sections";
import { useSidebarSlot } from "@/features/sttm/layout/sidebar-slot-context";
import { SttmSidebarCollapseFooter } from "@/features/sttm/layout/sttm-sidebar-collapse-footer";
import { SttmSidebarCollapsedRail } from "@/features/sttm/layout/sttm-sidebar-collapsed-rail";
import { SttmSidebarSectionIcon } from "@/features/sttm/layout/sttm-sidebar-icons";
import {
  sttmSidebarBodyTextMutedSx,
  sttmSidebarBodyTextSx,
  sttmSidebarChevronSx,
  sttmSidebarHierarchyIconSx,
  sttmSidebarSearchboxSx,
  sttmSidebarSearchInputSx,
} from "@/features/sttm/layout/sttm-sidebar-text-styles";
import type {
  DatabaseNode,
  DerivedSource,
  SchemaNode,
  SelectionSide,
} from "@/features/sttm/types/sttm.types";
import { TOUR_TARGETS } from "@/features/tour/constants/tour-targets";
import {
  writeDerivedWorkspaceDragPayload,
  writeWorkspaceDragPayload,
} from "@/features/sttm/source-target/source-workspace-dnd";

function getDerivedSourceCounts(source: DerivedSource) {
  const sourceTableCount = source.tableIds?.length ?? source.baseSourceTables?.length ?? 0;
  const outputColumnCount =
    source.outputColumns?.length
    || source.previewColumns?.length
    || source.columns?.length
    || 0;
  const selectedColumnCount = source.selectedColumnsByTable
    ? Object.values(source.selectedColumnsByTable).reduce(
        (total, columns) => total + columns.length,
        0,
      )
    : (source.columns?.length ?? 0);

  return { sourceTableCount, selectedColumnCount, outputColumnCount };
}

function SidebarStateShell({ children }: { children: React.ReactNode }) {
  return (
    <AiaBox
      sx={{
        width: "100%",
        minWidth: 0,
        height: "100%",
        backgroundColor: "var(--color-surface)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        px: 2,
      }}
    >
      {children}
    </AiaBox>
  );
}

export default function DataSelectionPanel() {
  const {
    fullData,
    derivedSources,
    toggleDerivedSource,
    loadState,
    errorState,
    reloadInitialData,
    loadSchemas,
    selectSchema,
  } = useSttmBuilderContext();

  const { setCollapsed, collapsed } = useSidebarSlot();
  const [sourceSearchText, setSourceSearchText] = useState("");
  const [targetSearchText, setTargetSearchText] = useState("");
  const [expandedDbs, setExpandedDbs] = useState<Record<string, boolean>>({});
  const [expandedSchemas, setExpandedSchemas] = useState<Record<string, boolean>>({});

  if (loadState.initial === "loading") {
    return (
      <SidebarStateShell>
        <AiaBox sx={{ textAlign: "center" }}>
          <AiaCircularProgress size={22} />
          <AiaText sx={{ ...sttmSidebarBodyTextMutedSx, mt: 1.5 }}>
            Loading databases...
          </AiaText>
        </AiaBox>
      </SidebarStateShell>
    );
  }

  if (loadState.initial === "error") {
    return (
      <SidebarStateShell>
        <AiaBox sx={{ textAlign: "center" }}>
          <AiaText sx={sttmSidebarBodyTextSx}>
            Unable to load databases
          </AiaText>

          <AiaText sx={{ ...sttmSidebarBodyTextMutedSx, mt: 0.75 }}>
            {errorState.initial || "Please try again."}
          </AiaText>

          <AiaButton
            variant="contained"
            onClick={() => {
              void reloadInitialData();
            }}
            sx={{
              mt: 2,
              height: 30,
              borderRadius: "4px",
              backgroundColor: "var(--color-primary-save)",
              border: "1px solid var(--color-primary-save)",
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: 600,
              textTransform: "none",
              boxShadow: "none",
              "&:hover": {
                backgroundColor: "var(--color-primary-hover)",
                borderColor: "var(--color-primary-hover)",
                boxShadow: "none",
              },
            }}
          >
            Retry
          </AiaButton>
        </AiaBox>
      </SidebarStateShell>
    );
  }

  const hasDatabases =
    (fullData?.sources?.length ?? 0) > 0 || (fullData?.targets?.length ?? 0) > 0;

  if (!hasDatabases) {
    return (
      <SidebarStateShell>
        <AiaBox sx={{ textAlign: "center" }}>
          <AiaText sx={sttmSidebarBodyTextSx}>
            No databases found
          </AiaText>

          <AiaText sx={{ ...sttmSidebarBodyTextMutedSx, mt: 0.75 }}>
            There are no source or target databases available.
          </AiaText>
        </AiaBox>
      </SidebarStateShell>
    );
  }

  if (collapsed) {
    return (
      <AiaBox
        sx={{
          width: "100%",
          minWidth: 0,
          height: "100%",
          backgroundColor: "var(--color-surface)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <SttmSidebarCollapsedRail
          items={[
            { kind: "source", label: "Source Selection" },
            { kind: "target", label: "Target Selection" },
            { kind: "derived", label: "Derived Sources Selection" },
          ]}
        />
      </AiaBox>
    );
  }

  const toggleDb = async (type: SelectionSide, dbId: string) => {
    const key = `${type}:${dbId}`;
    const willExpand = !expandedDbs[key];

    setExpandedDbs((prev) => ({
      ...prev,
      [key]: willExpand,
    }));

    if (willExpand) {
      await loadSchemas(type, dbId);
    }
  };

  const matchesSearch = (value: string, searchText: string) =>
    value.toLowerCase().includes(searchText.toLowerCase());

  const shouldShowDatabase = (db: DatabaseNode, searchText: string) => {
    if (!searchText.trim()) {
      return true;
    }

    if (matchesSearch(db.dbName, searchText)) {
      return true;
    }

    return db.schemas.some((schema) => matchesSearch(schema.schemaName, searchText));
  };

  const renderSchema = (
    schema: SchemaNode,
    dbId: string,
    type: SelectionSide,
    searchText: string,
  ) => {
    const tablesLoadKey = `${type}:${schema.schemaId}`;
    const isTablesLoading = loadState.tablesBySchema[tablesLoadKey] === "loading";
    const tablesError = errorState.tablesBySchema[tablesLoadKey];
    const isSchemaExpanded = Boolean(expandedSchemas[tablesLoadKey]);

    const visibleTables = schema.tables.filter((table) => {
      if (!searchText.trim()) {
        return true;
      }
      return matchesSearch(table.tableName, searchText);
    });

    return (
      <AiaBox key={schema.schemaId}>
        <AiaBox
          draggable={!isTablesLoading}
          onDragStart={(event) => {
            writeWorkspaceDragPayload(event.dataTransfer, {
              items: [{ kind: "schema", dbId, schemaId: schema.schemaId }],
            });
          }}
          onClick={() => {
            if (!isTablesLoading) {
              setExpandedSchemas((prev) => ({
                ...prev,
                [tablesLoadKey]: !prev[tablesLoadKey],
              }));

              // Always call selectSchema so the source/target panels get populated.
              // fetchTables handles caching internally — won't re-fetch if already loaded.
              void selectSchema(type, dbId, schema.schemaId);
            }
          }}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            pl: 3,
            pr: 1,
            py: 0.5,
            borderRadius: "6px",
            cursor: isTablesLoading ? "default" : "pointer",
            backgroundColor: schema.isSelected
              ? "var(--color-surface-muted)"
              : "transparent",
            borderLeft: schema.isSelected
              ? "3px solid var(--color-primary-save)"
              : "3px solid transparent",
            "&:hover": {
              backgroundColor: isTablesLoading
                ? undefined
                : "var(--color-surface-muted)",
            },
          }}
        >
          <HierarchyIcon
            level="schema"
            sx={{
              ...sttmSidebarHierarchyIconSx,
              color: schema.isSelected
                ? "var(--color-primary-save)"
                : "var(--color-muted)",
            }}
          />

          <AiaText
            sx={{
              ...sttmSidebarBodyTextSx,
              flex: 1,
              fontWeight: 400,
              color: schema.isSelected
                ? "var(--color-primary-save)"
                : "var(--color-text)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {schema.schemaName}
          </AiaText>

          {isTablesLoading ? (
            <AiaCircularProgress size={18} />
          ) : isSchemaExpanded ? (
            <KeyboardArrowDownRoundedIcon sx={sttmSidebarChevronSx} />
          ) : (
            <KeyboardArrowRightRoundedIcon sx={sttmSidebarChevronSx} />
          )}
        </AiaBox>

        {tablesError ? (
          <AiaText
            sx={{
              ...sttmSidebarBodyTextSx,
              pl: 5,
              pr: 1,
              pb: 0.5,
              color: "var(--color-danger, #d32f2f)",
            }}
          >
            {tablesError}
          </AiaText>
        ) : null}

        <AiaCollapse in={isSchemaExpanded} timeout="auto" unmountOnExit>
          <AiaBox sx={{ mt: 0.2 }}>
            {isTablesLoading ? (
              <AiaBox
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  pl: 5,
                  py: 0.6,
                }}
              >
                <AiaCircularProgress size={18} />
                <AiaText sx={sttmSidebarBodyTextMutedSx}>
                  Loading tables...
                </AiaText>
              </AiaBox>
            ) : visibleTables.length ? (
              visibleTables.map((table) => (
                <AiaBox
                  key={table.tableId}
                  draggable
                  onDragStart={(event) => {
                    writeWorkspaceDragPayload(event.dataTransfer, {
                      items: [{ kind: "table", tableId: table.tableId }],
                    });
                  }}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    pl: 5,
                    pr: 1,
                    py: 0.45,
                    borderRadius: "6px",
                    color: "var(--color-text)",
                    cursor: "grab",
                    "&:active": { cursor: "grabbing" },
                  }}
                >
                  <HierarchyIcon level="table" sx={sttmSidebarHierarchyIconSx} />
                  <AiaText
                    sx={{
                      ...sttmSidebarBodyTextSx,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {table.tableName}
                  </AiaText>
                </AiaBox>
              ))
            ) : (
              <AiaText
                sx={{
                  ...sttmSidebarBodyTextMutedSx,
                  pl: 5,
                  pr: 1,
                  py: 0.5,
                }}
              >
                No tables found
              </AiaText>
            )}
          </AiaBox>
        </AiaCollapse>
      </AiaBox>
    );
  };

  const renderDatabaseSectionContent = (
    items: DatabaseNode[],
    type: SelectionSide,
    searchText: string,
  ) => (
    <AiaBox sx={{ py: 0.5 }}>
      {items.filter((db) => shouldShowDatabase(db, searchText)).map((db) => {
        const expandKey = `${type}:${db.dbId}`;
        const isDbExpanded = Boolean(expandedDbs[expandKey]);
        const isSchemasLoading = loadState.schemasByDb[expandKey] === "loading";
        const schemasError = errorState.schemasByDb[expandKey];

        return (
          <AiaBox key={db.dbId} sx={{ mb: 0.4 }}>
            <AiaBox
              draggable={!isSchemasLoading}
              onDragStart={(event) => {
                writeWorkspaceDragPayload(event.dataTransfer, {
                  items: [{ kind: "database", dbId: db.dbId }],
                });
              }}
              onClick={() => {
                if (!isSchemasLoading) {
                  void toggleDb(type, db.dbId);
                }
              }}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                px: 1,
                py: 0.6,
                borderRadius: "6px",
                cursor: isSchemasLoading ? "default" : "grab",
                backgroundColor: db.isSelected
                  ? "var(--color-surface-muted)"
                  : "transparent",
                "&:hover": {
                  backgroundColor: isSchemasLoading
                    ? undefined
                    : "var(--color-surface-muted)",
                },
              }}
            >
              {isDbExpanded ? (
                <KeyboardArrowDownRoundedIcon sx={sttmSidebarChevronSx} />
              ) : (
                <KeyboardArrowRightRoundedIcon sx={sttmSidebarChevronSx} />
              )}

              <HierarchyIcon
                level="database"
                sx={{
                  ...sttmSidebarHierarchyIconSx,
                  color: db.isSelected
                    ? "var(--color-primary-save)"
                    : "var(--color-text)",
                }}
              />

              <AiaText
                sx={{
                  ...sttmSidebarBodyTextSx,
                  flex: 1,
                  fontWeight: 400,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {db.dbName}
              </AiaText>

              {isSchemasLoading ? <AiaCircularProgress size={18} /> : null}
            </AiaBox>

            <AiaCollapse in={isDbExpanded} timeout="auto" unmountOnExit>
              <AiaBox sx={{ mt: 0.2 }}>
                {isSchemasLoading ? (
                  <AiaBox
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      pl: 3,
                      py: 0.75,
                    }}
                  >
                    <AiaCircularProgress size={18} />
                    <AiaText sx={sttmSidebarBodyTextMutedSx}>
                      Loading schemas...
                    </AiaText>
                  </AiaBox>
                ) : schemasError ? (
                  <AiaBox sx={{ pl: 3, pr: 1, py: 0.5 }}>
                    <AiaText
                      sx={{
                        ...sttmSidebarBodyTextSx,
                        color: "var(--color-danger, #d32f2f)",
                      }}
                    >
                      {schemasError}
                    </AiaText>

                    <AiaButton
                      variant="text"
                      onClick={() => {
                        void loadSchemas(type, db.dbId);
                      }}
                      sx={{
                        mt: 0.25,
                        px: 0,
                        minWidth: "auto",
                        ...sttmSidebarBodyTextSx,
                        textTransform: "none",
                        color: "var(--color-primary-save)",
                      }}
                    >
                      Retry
                    </AiaButton>
                  </AiaBox>
                ) : (
                  db.schemas
                    .filter(
                      (schema) =>
                        !searchText.trim() || matchesSearch(schema.schemaName, searchText),
                    )
                    .map((schema) => renderSchema(schema, db.dbId, type, searchText))
                )}
              </AiaBox>
            </AiaCollapse>
          </AiaBox>
        );
      })}
    </AiaBox>
  );

  const renderDerivedSourcesContent = () => (
    <AiaBox sx={{ py: 0.5, px: 0.5 }}>
      {derivedSources.length ? (
        derivedSources.map((source) => {
          const isSelected = !!source.isSelected;
          const { sourceTableCount, selectedColumnCount, outputColumnCount } =
            getDerivedSourceCounts(source);

          return (
            <AiaBox
              key={source.id}
              draggable
              onDragStart={(event) => {
                writeDerivedWorkspaceDragPayload(event.dataTransfer, {
                  derivedSourceIds: [source.id],
                });
              }}
              sx={{
                display: "flex",
                alignItems: "center",
                px: 1,
                py: 0.6,
                mb: 0.5,
                gap: 1,
                cursor: "grab",
                "&:active": { cursor: "grabbing" },
              }}
            >
              <AiaCheckbox
                checked={isSelected}
                checkHandler={() => toggleDerivedSource(source.id)}
                uncheckedColor="var(--aia-primary-bg-color)"
                checkedColor="var(--aia-primary-bg-color)"
              />

              <TableChartOutlinedIcon
                sx={{
                  color: "#9ca3af",
                  fontSize: 20,
                  flexShrink: 0,
                }}
              />

              <AiaBox sx={{ flexGrow: 1, minWidth: 0 }}>
                <AiaText
                  sx={{
                    ...BODY_SX,
                    color: TYPOGRAPHY_TOKENS.body.color,
                    whiteSpace: "normal",
                    overflowWrap: "anywhere",
                    wordBreak: "break-word",
                  }}
                >
                  {source.sourceName}
                </AiaText>
                <AiaText
                  sx={{
                    ...SECONDARY_TEXT_SX,
                    display: "block",
                    mt: 0,
                    color: TYPOGRAPHY_TOKENS.secondaryText.color,
                  }}
                >
                  {sourceTableCount} source table{sourceTableCount === 1 ? "" : "s"} ·{" "}
                  {outputColumnCount > 0
                    ? `${outputColumnCount} output column${outputColumnCount === 1 ? "" : "s"}`
                    : `${selectedColumnCount} selected columns`}
                </AiaText>
              </AiaBox>
            </AiaBox>
          );
        })
      ) : (
        <AiaText
          sx={{
            ...sttmSidebarBodyTextMutedSx,
            px: 1,
            py: 0.5,
          }}
        >
          No derived sources saved yet.
        </AiaText>
      )}
    </AiaBox>
  );

  const renderDatabaseSection = (
    items: DatabaseNode[],
    type: SelectionSide,
    searchText: string,
    onSearchChange: (value: string) => void,
  ) => (
    <>
      <AiaBox sx={{ px: 1.5, pb: 1, flexShrink: 0 }}>
        <AiaSearchbox
          value={searchText}
          onChange={onSearchChange}
          placeholder="Search schemas..."
          sx={sttmSidebarSearchboxSx}
          inputSx={sttmSidebarSearchInputSx}
        />
      </AiaBox>
      {renderDatabaseSectionContent(items, type, searchText)}
    </>
  );

  return (
    <AiaBox
      sx={{
        width: "100%",
        minWidth: 0,
        height: "100%",
        backgroundColor: "var(--color-surface)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <AiaBox sx={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <ResizableSidebarSections
          sections={[
            {
              id: "source",
              title: "Source Selection",
              icon: <SttmSidebarSectionIcon kind="source" />,
              tourTarget: TOUR_TARGETS.sttmSourceSelection,
              content: renderDatabaseSection(
                fullData?.sources || [],
                "source",
                sourceSearchText,
                setSourceSearchText,
              ),
            },
            {
              id: "target",
              title: "Target Selection",
              icon: <SttmSidebarSectionIcon kind="target" />,
              tourTarget: TOUR_TARGETS.sttmTargetSelection,
              content: renderDatabaseSection(
                fullData?.targets || [],
                "target",
                targetSearchText,
                setTargetSearchText,
              ),
            },
            {
              id: "derived",
              title: "Derived Sources Selection",
              icon: <SttmSidebarSectionIcon kind="derived" />,
              tourTarget: TOUR_TARGETS.sttmDerivedSources,
              content: renderDerivedSourcesContent(),
            },
          ]}
          defaultExpanded={{ source: true, target: true, derived: true }}
        />
      </AiaBox>

      <SttmSidebarCollapseFooter
        collapsed={false}
        collapseLabel="Collapse source sidebar"
        onToggle={() => setCollapsed(true)}
      />
    </AiaBox>
  );
}
