"use client";

import { useState } from "react";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import StorageRoundedIcon from "@mui/icons-material/StorageRounded";
import SchemaRoundedIcon from "@mui/icons-material/SchemaRounded";
import TableRowsRoundedIcon from "@mui/icons-material/TableRowsRounded";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import KeyboardArrowRightRoundedIcon from "@mui/icons-material/KeyboardArrowRightRounded";
import {
  Box,
  Button,
  CircularProgress,
  Collapse,
  InputBase,
  Typography,
} from "@mui/material";
import { useSttmBuilderContext } from "@/features/sttm/context/sttm-builder-context";
import type {
  DatabaseNode,
  SchemaNode,
  SelectionSide,
} from "@/features/sttm/types/sttm.types";

function SidebarStateShell({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        width: 260,
        height: "100%",
        flexShrink: 0,
        borderRight: "1px solid var(--color-soft-border)",
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
    loadState,
    errorState,
    reloadInitialData,
    loadSchemas,
    selectSchema,
  } = useSttmBuilderContext();

  const [searchText, setSearchText] = useState("");
  const [expandedDbs, setExpandedDbs] = useState<Record<string, boolean>>({});
  const [expandedSchemas, setExpandedSchemas] = useState<Record<string, boolean>>(
    {}
  );

  if (loadState.initial === "loading" || !fullData) {
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
    fullData.sources.length > 0 || fullData.targets.length > 0;

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

  const matchesSearch = (value: string) =>
    value.toLowerCase().includes(searchText.toLowerCase());

  const shouldShowDatabase = (db: DatabaseNode) => {
    if (!searchText.trim()) {
      return true;
    }

    if (matchesSearch(db.dbName)) {
      return true;
    }

    return db.schemas.some((schema) => matchesSearch(schema.schemaName));
  };

  const renderSchema = (
    schema: SchemaNode,
    dbId: string,
    type: SelectionSide
  ) => {
    const tablesLoadKey = `${type}:${schema.schemaId}`;
    const isTablesLoading = loadState.tablesBySchema[tablesLoadKey] === "loading";
    const tablesError = errorState.tablesBySchema[tablesLoadKey];
    const isSchemaExpanded = Boolean(expandedSchemas[tablesLoadKey]);

    const visibleTables = schema.tables.filter((table) => {
      if (!searchText.trim()) {
        return true;
      }
      return matchesSearch(table.tableName);
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
          <SchemaRoundedIcon
            sx={{
              fontSize: 14,
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
                  <TableRowsRoundedIcon
                    sx={{ fontSize: 14, color: "var(--color-muted)" }}
                  />
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

  const renderDatabaseSection = (
    title: string,
    items: DatabaseNode[],
    type: SelectionSide
  ) => {
    return (
      <Box sx={{ mb: 2.5 }}>
        <Typography
          sx={{
            px: 1.5,
            mb: 1,
            fontSize: 10,
            fontWeight: 700,
            color: "var(--color-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {title}
        </Typography>

        {items.filter(shouldShowDatabase).map((db) => {
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

                <StorageRoundedIcon
                  sx={{
                    fontSize: 15,
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
                          !searchText.trim() || matchesSearch(schema.schemaName)
                      )
                      .map((schema) => renderSchema(schema, db.dbId, type))
                  )}
                </Box>
              </Collapse>
            </Box>
          );
        })}
      </Box >
    );
  };

  return (
    <Box
      sx={{
        width: 260,
        height: "100%",
        flexShrink: 0,
        borderRight: "1px solid var(--color-soft-border)",
        backgroundColor: "var(--color-surface)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box sx={{ px: 2, py: 2 }}>
        <Typography
          sx={{
            fontSize: 16,
            fontWeight: 800,
            color: "var(--color-title)",
            mb: 2,
          }}
        >
          STTM Builder
        </Typography>

        <Box className="mb-3 flex h-[38px] items-center justify-between rounded-full bg-[var(--color-surface-muted)] px-4">
          <Typography className="text-[13px] font-medium text-[var(--color-text)]">
            Cortex
          </Typography>
          <KeyboardArrowDownRoundedIcon
            sx={{ fontSize: 18, color: "var(--color-muted)" }}
          />
        </Box>

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 1.5,
            py: 0.8,
            borderRadius: "8px",
            backgroundColor: "var(--color-surface-muted)",
            border: "1px solid transparent",
            "&:focus-within": {
              backgroundColor: "var(--color-surface)",
              borderColor: "var(--color-primary-save)",
              boxShadow: "0 0 0 2px rgba(0, 115, 160, 0.12)",
            },
          }}
        >
          <SearchRoundedIcon
            sx={{ fontSize: 18, color: "var(--color-muted)" }}
          />
          <InputBase
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search schemas..."
            sx={{
              flex: 1,
              fontSize: 13,
              color: "var(--color-text)",
            }}
          />
        </Box>
      </Box>

      <Box sx={{ flex: 1, overflowY: "auto", px: 1 }}>
        {renderDatabaseSection("Source Selection", fullData.sources, "source")}
        {renderDatabaseSection("Target Selection", fullData.targets, "target")}
      </Box>
    </Box>
  );
}
