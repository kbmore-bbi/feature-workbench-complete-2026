"use client";
import { useState } from "react";
import {
  CheckCircleRoundedIcon,
  KeyboardArrowDownRoundedIcon,
  KeyboardArrowRightRoundedIcon,
  RadioButtonUncheckedRoundedIcon,
} from '@/utils/icons';
import { HierarchyIcon } from '@/features/sttm/shared/hierarchy-icons';







import {
  Box,
  Button,
  CircularProgress,
  Collapse,
  Typography,
} from "@mui/material";
import { AiaSearchbox } from "@/components/ui/aia-searchbox";
import { useSttmBuilderContext } from "@/features/sttm/context/sttm-builder-context";
import { ResizableSidebarSections } from "@/features/sttm/layout/resizable-sidebar-sections";
import type {
  DatabaseNode,
  SchemaNode,
  SelectionSide,
} from "@/features/sttm/types/sttm.types";

function SidebarStateShell({ children }: { children: React.ReactNode }) {
  return (
    <Box
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
    </Box>
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

  const [sourceSearchText, setSourceSearchText] = useState("");
  const [targetSearchText, setTargetSearchText] = useState("");
  const [expandedDbs, setExpandedDbs] = useState<Record<string, boolean>>({});
  const [expandedSchemas, setExpandedSchemas] = useState<Record<string, boolean>>({});

  if (loadState.initial === "loading") {
    return (
      <SidebarStateShell>
        <Box sx={{ textAlign: "center" }}>
          <CircularProgress size={22} />
          <Typography
            sx={{
              mt: 1.5,
              fontSize: "12px",
              color: "var(--color-muted)",
            }}
          >
            Loading databases...
          </Typography>
        </Box>
      </SidebarStateShell>
    );
  }

  if (loadState.initial === "error") {
    return (
      <SidebarStateShell>
        <Box sx={{ textAlign: "center" }}>
          <Typography
            sx={{
              fontSize: "13px",
              fontWeight: 700,
              color: "var(--color-title)",
            }}
          >
            Unable to load databases
          </Typography>

          <Typography
            sx={{
              mt: 0.75,
              fontSize: "12px",
              color: "var(--color-muted)",
            }}
          >
            {errorState.initial || "Please try again."}
          </Typography>

          <Button
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
          </Button>
        </Box>
      </SidebarStateShell>
    );
  }

  const hasDatabases =
    (fullData?.sources?.length ?? 0) > 0 || (fullData?.targets?.length ?? 0) > 0;

  if (!hasDatabases) {
    return (
      <SidebarStateShell>
        <Box sx={{ textAlign: "center" }}>
          <Typography
            sx={{
              fontSize: "13px",
              fontWeight: 700,
              color: "var(--color-title)",
            }}
          >
            No databases found
          </Typography>

          <Typography
            sx={{
              mt: 0.75,
              fontSize: "12px",
              color: "var(--color-muted)",
            }}
          >
            There are no source or target databases available.
          </Typography>
        </Box>
      </SidebarStateShell>
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
      <Box key={schema.schemaId}>
        <Box
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
              color: schema.isSelected
                ? "var(--color-primary-save)"
                : "var(--color-muted)",
            }}
          />

          <Typography
            sx={{
              flex: 1,
              fontSize: 12,
              fontWeight: schema.isSelected ? 700 : 500,
              color: schema.isSelected
                ? "var(--color-primary-save)"
                : "var(--color-text)",
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {schema.schemaName}
          </Typography>

          {isTablesLoading ? (
            <CircularProgress size={14} />
          ) : isSchemaExpanded ? (
            <KeyboardArrowDownRoundedIcon
              sx={{ fontSize: 16, color: "var(--color-muted)" }}
            />
          ) : (
            <KeyboardArrowRightRoundedIcon
              sx={{ fontSize: 16, color: "var(--color-muted)" }}
            />
          )}
        </Box>

        {tablesError ? (
          <Typography
            sx={{
              pl: 5,
              pr: 1,
              pb: 0.5,
              fontSize: 11,
              color: "var(--color-danger, #d32f2f)",
              lineHeight: 1.3,
            }}
          >
            {tablesError}
          </Typography>
        ) : null}

        <Collapse in={isSchemaExpanded} timeout="auto" unmountOnExit>
          <Box sx={{ mt: 0.2 }}>
            {isTablesLoading ? (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  pl: 5,
                  py: 0.6,
                }}
              >
                <CircularProgress size={14} />
                <Typography sx={{ fontSize: 11, color: "var(--color-muted)" }}>
                  Loading tables...
                </Typography>
              </Box>
            ) : visibleTables.length ? (
              visibleTables.map((table) => (
                <Box
                  key={table.tableId}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    pl: 5,
                    pr: 1,
                    py: 0.45,
                    borderRadius: "6px",
                    color: "var(--color-text)",
                  }}
                >
                  <HierarchyIcon level="table" />
                  <Typography
                    sx={{
                      fontSize: 11,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {table.tableName}
                  </Typography>
                </Box>
              ))
            ) : (
              <Typography
                sx={{
                  pl: 5,
                  pr: 1,
                  py: 0.5,
                  fontSize: 11,
                  color: "var(--color-muted)",
                }}
              >
                No tables found
              </Typography>
            )}
          </Box>
        </Collapse>
      </Box >
    );
  };

  const renderDatabaseSectionContent = (
    items: DatabaseNode[],
    type: SelectionSide,
    searchText: string,
  ) => (
    <Box sx={{ py: 0.5 }}>
      {items.filter((db) => shouldShowDatabase(db, searchText)).map((db) => {
        const expandKey = `${type}:${db.dbId}`;
        const isDbExpanded = Boolean(expandedDbs[expandKey]);
        const isSchemasLoading = loadState.schemasByDb[expandKey] === "loading";
        const schemasError = errorState.schemasByDb[expandKey];

        return (
          <Box key={db.dbId} sx={{ mb: 0.4 }}>
            <Box
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
                cursor: isSchemasLoading ? "default" : "pointer",
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
                <KeyboardArrowDownRoundedIcon
                  sx={{ fontSize: 16, color: "var(--color-muted)" }}
                />
              ) : (
                <KeyboardArrowRightRoundedIcon
                  sx={{ fontSize: 16, color: "var(--color-muted)" }}
                />
              )}

              <HierarchyIcon
                level="database"
                sx={{
                  color: db.isSelected
                    ? "var(--color-primary-save)"
                    : "var(--color-text)",
                }}
              />

              <Typography
                sx={{
                  flex: 1,
                  fontSize: 12,
                  fontWeight: db.isSelected ? 700 : 500,
                  color: "var(--color-text)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {db.dbName}
              </Typography>

              {isSchemasLoading ? <CircularProgress size={14} /> : null}
            </Box>

            <Collapse in={isDbExpanded} timeout="auto" unmountOnExit>
              <Box sx={{ mt: 0.2 }}>
                {isSchemasLoading ? (
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      pl: 3,
                      py: 0.75,
                    }}
                  >
                    <CircularProgress size={14} />
                    <Typography
                      sx={{
                        fontSize: 11,
                        color: "var(--color-muted)",
                      }}
                    >
                      Loading schemas...
                    </Typography>
                  </Box>
                ) : schemasError ? (
                  <Box sx={{ pl: 3, pr: 1, py: 0.5 }}>
                    <Typography
                      sx={{
                        fontSize: 11,
                        color: "var(--color-danger, #d32f2f)",
                        lineHeight: 1.3,
                      }}
                    >
                      {schemasError}
                    </Typography>

                    <Button
                      variant="text"
                      onClick={() => {
                        void loadSchemas(type, db.dbId);
                      }}
                      sx={{
                        mt: 0.25,
                        px: 0,
                        minWidth: "auto",
                        fontSize: 11,
                        textTransform: "none",
                        color: "var(--color-primary-save)",
                      }}
                    >
                      Retry
                    </Button>
                  </Box>
                ) : (
                  db.schemas
                    .filter(
                      (schema) =>
                        !searchText.trim() || matchesSearch(schema.schemaName, searchText),
                    )
                    .map((schema) => renderSchema(schema, db.dbId, type, searchText))
                )}
              </Box>
            </Collapse>
          </Box>
        );
      })}
    </Box>
  );

  const renderDerivedSourcesContent = () => (
    <Box sx={{ py: 0.5, px: 0.5 }}>
      {derivedSources.length ? (
        derivedSources.map((source) => (
          <Box
            key={source.id}
            onClick={() => toggleDerivedSource(source.id)}
            sx={{
              mb: 0.75,
              px: 1,
              py: 0.9,
              borderRadius: "8px",
              border: "1px solid",
              borderColor: source.isSelected ? "#16a34a" : "#d1fae5",
              backgroundColor: source.isSelected ? "#dcfce7" : "#ecfdf5",
              cursor: "pointer",
              transition: "120ms ease",
              "&:hover": {
                backgroundColor: source.isSelected ? "#dcfce7" : "#e7f9ee",
              },
            }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "flex-start",
                gap: 1,
              }}
            >
              {source.isSelected ? (
                <CheckCircleRoundedIcon
                  sx={{ mt: 0.1, fontSize: 16, color: "#16a34a", flexShrink: 0 }}
                />
              ) : (
                <RadioButtonUncheckedRoundedIcon
                  sx={{ mt: 0.1, fontSize: 16, color: "#22c55e", flexShrink: 0 }}
                />
              )}
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography
                  sx={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#166534",
                    lineHeight: 1.3,
                    whiteSpace: "normal",
                    overflowWrap: "anywhere",
                    wordBreak: "break-word",
                  }}
                >
                  {source.sourceName}
                </Typography>
                <Typography
                  sx={{
                    mt: 0.4,
                    fontSize: 11,
                    color: "#047857",
                    lineHeight: 1.35,
                  }}
                >
                  {(source.tableIds?.length ?? 0)} source tables · {(source.columns?.length ?? 0)} selected columns
                </Typography>
              </Box>
            </Box>
          </Box>
        ))
      ) : (
        <Typography
          sx={{
            px: 1,
            py: 0.5,
            fontSize: 11,
            color: "var(--color-muted)",
          }}
        >
          No derived sources saved yet.
        </Typography>
      )}
    </Box>
  );

  const renderDatabaseSection = (
    items: DatabaseNode[],
    type: SelectionSide,
    searchText: string,
    onSearchChange: (value: string) => void,
  ) => (
    <>
      <Box sx={{ px: 1.5, pb: 1, flexShrink: 0 }}>
        <AiaSearchbox
          value={searchText}
          onChange={onSearchChange}
          placeholder="Search schemas..."
          inputSx={{
            '& .MuiInputBase-input': {
              fontSize: '0.8rem',
            },
          }}
        />
      </Box>
      {renderDatabaseSectionContent(items, type, searchText)}
    </>
  );

  return (
    <Box
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
      <ResizableSidebarSections
        sections={[
          {
            id: "source",
            title: "Source Selection",
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
            content: renderDerivedSourcesContent(),
          },
        ]}
        defaultExpanded={{ source: true, target: true, derived: true }}
      />
    </Box>
  );
}
