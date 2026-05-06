"use client";

import React, { useMemo, useState } from "react";
import {
  Dialog,
  Box,
  Typography,
  IconButton,
  InputBase,
} from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import AddCircleOutlineRoundedIcon from "@mui/icons-material/AddCircleOutlineRounded";
import RemoveCircleOutlineRoundedIcon from "@mui/icons-material/RemoveCircleOutlineRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import { useSttmBuilderContext } from "@/features/sttm/context/sttm-builder-context";
import { FocusButton } from "@/components/ui/focus-button";
import { FocusSelect } from "@/components/ui/focus-select";
import { FocusTable } from "@/components/ui/focus-table/focus-table";
import { FilterConditions, type RuleGroup } from "./filter-conditions";
import type { DerivedSource, TableMeta } from "@/features/sttm/types/sttm.types";

interface AddDerivedModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingSource?: DerivedSource | null;
  onConfirm: (source: DerivedSource) => void;
}

type DerivedJoinRow = {
  id: string;
  leftTableId: string;
  joinType: "INNER" | "LEFT" | "RIGHT" | "FULL";
  rightTableId: string;
  conditions: Array<{
    id: string;
    leftColumn: string;
    operator: string;
    rightColumn: string;
  }>;
};

export function AddDerivedModal({ isOpen, onClose, editingSource, onConfirm }: AddDerivedModalProps) {
  const { fullData } = useSttmBuilderContext();

  const [sourceName, setSourceName] = useState("");
  const [joins, setJoins] = useState<DerivedJoinRow[]>([]);
  const [filterGroups, setFilterGroups] = useState<RuleGroup[]>([]);
  const [filterSql, setFilterSql] = useState<string>("");
  const [customSql, setCustomSql] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"SQL" | "Preview">("SQL");

  React.useEffect(() => {
    if (isOpen) {
      if (editingSource) {
        setSourceName(editingSource.sourceName);
        setJoins(editingSource.joins || []);
        setFilterGroups(editingSource.filters || []);
        setFilterSql(""); // Will be recalculated by FilterConditions
        setCustomSql("");
      } else {
        setSourceName("");
        setJoins([]);
        setFilterGroups([]);
        setFilterSql("");
        setCustomSql("");
      }
      setActiveTab("SQL");
    }
  }, [isOpen, editingSource]);

  // Flatten all tables from fullData into TableMeta format
  const availableTables: TableMeta[] = useMemo(() => {
    const tables: TableMeta[] = [];
    for (const db of fullData?.sources ?? []) {
      for (const sch of db.schemas ?? []) {
        for (const tbl of sch.tables ?? []) {
          if (tbl.isSelected) {
            tables.push({
              id: `${db.dbId}:${sch.schemaId}:${tbl.tableId}`,
              name: tbl.tableName,
              schema: sch.schemaName,
              database: db.dbName,
              rowCount: String(tbl.rows ?? "—"),
              colCount: tbl.columns ?? 6,
              columns: [], // We'll mock columns dynamically if needed, or assume they exist
              tag: tbl.tag ?? "Source",
            });
          }
        }
      }
    }
    return tables;
  }, [fullData]);

  // Mock columns based on table name for preview/dropdowns
  const getColumnsForTable = (tableId: string) => {
    const table = availableTables.find((t) => t.id === tableId);
    if (!table) return [];
    const tName = table.name?.toLowerCase() || "";
    if (tName.includes("order")) {
      return [
        { name: "ORDER_ID", type: "BIGINT", isPrimaryKey: true },
        { name: "CUST_ID", type: "INT", isForeignKey: true },
        { name: "ORDER_DATE", type: "DATE" },
        { name: "AMOUNT", type: "DECIMAL" },
        { name: "STATUS", type: "VARCHAR" },
      ];
    }
    if (tName.includes("customer")) {
      return [
        { name: "CUST_ID", type: "BIGINT", isPrimaryKey: true },
        { name: "NAME", type: "VARCHAR" },
        { name: "EMAIL", type: "VARCHAR" },
        { name: "REGION", type: "VARCHAR" },
      ];
    }
    return [
      { name: "ID", type: "BIGINT", isPrimaryKey: true },
      { name: "COL_1", type: "VARCHAR" },
      { name: "COL_2", type: "VARCHAR" },
      { name: "AMOUNT", type: "DECIMAL" },
    ];
  };

  const tableOptions = availableTables.map((t) => ({
    label: `${t.schema}.${t.name}`,
    value: t.id as string,
  }));

  const handleAddJoinRow = () => {
    const prevJoin = joins[joins.length - 1];
    const leftTableId = prevJoin ? prevJoin.leftTableId : (availableTables[0]?.id as string) || "";
    setJoins([...joins, {
      id: Math.random().toString(36).substring(2, 9),
      leftTableId,
      joinType: "LEFT",
      rightTableId: "",
      conditions: [{ id: Math.random().toString(36).substring(2, 9), leftColumn: "", operator: "=", rightColumn: "" }]
    }]);
  };

  const handleRemoveJoinRow = (id: string) => {
    setJoins((prev) => prev.filter((j) => j.id !== id));
  };

  const updateJoinRow = (id: string, updates: Partial<DerivedJoinRow>) => {
    setJoins((prev) => prev.map((j) => (j.id === id ? { ...j, ...updates } : j)));
  };

  const handleAddConditionRow = (joinId: string) => {
    setJoins((prev) => prev.map((j) => {
      if (j.id === joinId) {
        return { ...j, conditions: [...j.conditions, { id: Math.random().toString(36).substring(2, 9), leftColumn: "", operator: "=", rightColumn: "" }] };
      }
      return j;
    }));
  };

  const handleRemoveConditionRow = (joinId: string, conditionId: string) => {
    setJoins((prev) => prev.map((j) => {
      if (j.id === joinId) {
        return { ...j, conditions: j.conditions.filter((c) => c.id !== conditionId) };
      }
      return j;
    }));
  };

  const updateConditionRow = (joinId: string, conditionId: string, updates: any) => {
    setJoins((prev) => prev.map((j) => {
      if (j.id === joinId) {
        return { ...j, conditions: j.conditions.map((c) => c.id === conditionId ? { ...c, ...updates } : c) };
      }
      return j;
    }));
  };

  const involvedTables = useMemo(() => {
    const tableIds = new Set<string>();
    joins.forEach((j) => {
      if (j.leftTableId) tableIds.add(j.leftTableId);
      if (j.rightTableId) tableIds.add(j.rightTableId);
    });
    return availableTables.filter((t) => tableIds.has(t.id as string)).map(t => ({
      ...t,
      columns: getColumnsForTable(t.id as string)
    }));
  }, [joins, availableTables]);

  const joinSqlPreview = useMemo(() => {
    if (joins.length === 0) return "No join clauses defined";
    return joins
      .map((j) => {
        if (!j.leftTableId || !j.rightTableId || !j.conditions || j.conditions.length === 0) return "";
        const leftT = availableTables.find((t) => t.id === j.leftTableId);
        const rightT = availableTables.find((t) => t.id === j.rightTableId);
        if (!leftT || !rightT) return "";
        const lName = `${leftT.schema}.${leftT.name}`;
        const rName = `${rightT.schema}.${rightT.name}`;

        const conds = j.conditions.filter(c => c.leftColumn && c.operator && c.rightColumn).map(c => {
          return `${lName}.${c.leftColumn} ${c.operator} ${rName}.${c.rightColumn}`;
        });

        if (conds.length === 0) return `  ${j.joinType} JOIN ${rName}\n    ON ?`;
        return `  ${j.joinType} JOIN ${rName}\n    ON ${conds.join("\n   AND ")}`;
      })
      .filter(Boolean)
      .join("\n");
  }, [joins, availableTables]);

  const fullSqlExpression = useMemo(() => {
    const lines = ["SELECT"];

    // Build select list from all involved tables
    const selects: string[] = [];
    involvedTables.forEach(t => {
      const alias = t.name?.charAt(0).toLowerCase() || 't';
      getColumnsForTable(t.id as string).slice(0, 3).forEach(c => {
        selects.push(`  ${alias}.${c.name}`);
      });
    });

    if (selects.length > 0) {
      lines.push(selects.join(",\n"));
    } else {
      lines.push("  *");
    }

    if (involvedTables.length > 0) {
      const firstT = involvedTables[0];
      const alias = firstT.name?.charAt(0).toLowerCase() || 't';
      lines.push(`FROM ${firstT.schema}.${firstT.name} ${alias}`);
    } else {
      lines.push("FROM [Select Tables via JOINs]");
    }

    if (joins.length > 0) {
      lines.push(joinSqlPreview);
    }

    // Rough WHERE clause placeholder
    if (filterGroups.length > 0 && filterSql) {
      lines.push(`WHERE\n  ${filterSql.split("\n").join("\n  ")}`);
    }

    return lines.join("\n");
  }, [involvedTables, joins, joinSqlPreview, filterGroups, filterSql]);

  const hasName = sourceName.trim().length > 0;
  const validJoinsCount = joins.filter((j) => j.leftTableId && j.rightTableId).length;
  const hasJoins = validJoinsCount > 0;
  const hasFilters = filterGroups.length > 0;

  const handleConfirm = () => {
    const finalSource: DerivedSource = {
      id: editingSource?.id || `derived_${Math.random().toString(36).substring(2, 9)}`,
      sourceName: sourceName.trim(),
      joins,
      filters: filterGroups,
      columns: involvedTables.flatMap(t => getColumnsForTable(t.id as string)),
    };
    onConfirm(finalSource);
    onClose();
  };

  const StatusChip = ({ label, active }: { label: string; active: boolean }) => (
    <Box
      sx={{
        px: 1.5,
        py: 0.5,
        borderRadius: "16px",
        fontSize: 11,
        fontWeight: 700,
        backgroundColor: active ? "#ecfdf5" : "#f1f5f9",
        color: active ? "#059669" : "#64748b",
        display: "flex",
        alignItems: "center",
        gap: 0.5,
      }}
    >
      {active && <span style={{ fontSize: 14 }}>✓</span>}
      {label}
    </Box>
  );

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      sx={{
        "& .MuiDialog-paper": { height: "90vh", borderRadius: "16px", overflow: "hidden", display: 'flex', flexDirection: 'column' }
      }}
    >
      {/* Header */}
      <Box sx={{ px: 3, py: 2, borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Box sx={{ width: 40, height: 40, borderRadius: "50%", backgroundColor: "#065f46", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <AddCircleOutlineRoundedIcon sx={{ color: "white" }} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 18, fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>
              Add Derived Source
            </Typography>
            <Typography sx={{ fontSize: 13, color: "#64748b" }}>
              Define a virtual table — configure joins, filters and SQL expression
            </Typography>
          </Box>
          <Box sx={{ display: "flex", gap: 1, ml: 4 }}>
            <StatusChip label="Name" active={hasName} />
            <StatusChip label={`Joins (${validJoinsCount})`} active={hasJoins} />
            <StatusChip label="Filters" active={hasFilters} />
            <StatusChip label="SQL" active={hasName && hasJoins} />
          </Box>
        </Box>
        <IconButton onClick={onClose}><CloseRoundedIcon /></IconButton>
      </Box>

      {/* Main Content Area */}
      <Box sx={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left Sidebar */}
        <Box sx={{ width: 260, borderRight: "1px solid #e5e7eb", display: "flex", flexDirection: "column", bgcolor: "#fafafa" }}>
          <Box sx={{ p: 2, flex: 1, overflowY: "auto" }}>
            <Typography sx={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", mb: 1.5, letterSpacing: "0.05em" }}>AVAILABLE TABLES</Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {availableTables.map(t => (
                <Box key={t.id} sx={{ display: "flex", gap: 1.5, alignItems: "flex-start", cursor: "pointer" }}>
                  <TableChartOutlinedIcon sx={{ color: "#94a3b8", fontSize: 20, mt: 0.2 }} />
                  <Box>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>{t.schema}.{t.name}</Typography>
                    <Typography sx={{ fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>{t.colCount} cols</Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
          <Box sx={{ p: 2, borderTop: "1px solid #e5e7eb", bgcolor: "white" }}>
            <Typography sx={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", mb: 1.5, letterSpacing: "0.05em" }}>FUNCTIONS</Typography>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 1.5 }}>
              {['String', 'Numeric', 'Date', 'Logic'].map((cat) => (
                <Box
                  key={cat}
                  component="span"
                  sx={{ cursor: "pointer", fontSize: 10, padding: "4px 8px", border: "1px solid #e2e8f0", borderRadius: 1, color: "#64748b", "&:hover": { bgcolor: "#f1f5f9" } }}
                >
                  {cat}
                </Box>
              ))}
            </Box>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {['UPPER()', 'LOWER()', 'TRIM()', 'CONCAT()', 'SUBSTRING()', 'REPLACE()', 'SELECT', 'GROUP BY', 'HAVING', 'UNION', 'DISTINCT'].map((func) => (
                <Box
                  key={func}
                  component="span"
                  onClick={() => setCustomSql((prev) => (prev || fullSqlExpression) + "\n" + func)}
                  sx={{ cursor: "pointer", fontSize: 10, padding: "4px 8px", border: "1px solid #e2e8f0", borderRadius: 1, color: "#64748b", "&:hover": { bgcolor: "#f1f5f9" } }}
                >
                  {func}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>

        {/* Right Area */}
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto" }}>

            <Box sx={{ p: 3, display: "flex", gap: 2, borderBottom: "1px solid #e5e7eb" }}>
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", mb: 1, letterSpacing: "0.05em" }}>SOURCE NAME</Typography>
                <InputBase
                  fullWidth
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  placeholder="e.g. vw_OrdersSummary"
                  sx={{ border: "1px solid #e2e8f0", borderRadius: 1, px: 1.5, py: 0.75, fontSize: 14 }}
                />
              </Box>
            </Box>

            {/* JOINs Section */}
            <Box sx={{ p: 3, borderBottom: "1px solid #e5e7eb" }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                  <Box sx={{ width: 24, height: 24, borderRadius: "50%", bgcolor: "#eff6ff", color: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>∞</Box>
                  <Typography sx={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>JOIN Clauses</Typography>
                  <Typography sx={{ fontSize: 12, color: "#94a3b8" }}>Define how source tables relate</Typography>
                </Box>
                <FocusButton variant="outlined" size="small" rounded="full" onClick={handleAddJoinRow}>
                  + Add Join
                </FocusButton>
              </Box>

              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                {joins.length === 0 ? (
                  <Box sx={{ border: "1px dashed #cbd5e1", borderRadius: 2, p: 3, display: "flex", alignItems: "center", gap: 2 }}>
                    <Box sx={{ width: 32, height: 32, borderRadius: "50%", bgcolor: "#eff6ff", color: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>∞</Box>
                    <Box>
                      <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>No join clauses defined</Typography>
                      <Typography sx={{ fontSize: 12, color: "#94a3b8", mt: 0.5 }}>Click <strong style={{ color: "#64748b" }}>Add Join</strong> to define how tables relate</Typography>
                    </Box>
                  </Box>
                ) : (
                  joins.map((join, idx) => {
                    const lCols = getColumnsForTable(join.leftTableId).map(c => ({ label: c.name, value: c.name }));
                    const rCols = getColumnsForTable(join.rightTableId).map(c => ({ label: c.name, value: c.name }));
                    const opOptions = [
                      { label: "=", value: "=" }, { label: "!=", value: "!=" },
                      { label: ">", value: ">" }, { label: "<", value: "<" },
                      { label: ">=", value: ">=" }, { label: "<=", value: "<=" }
                    ];

                    return (
                      <Box key={join.id} sx={{ display: "flex", flexDirection: "column", gap: 1, bgcolor: "#f8fafc", p: 2, borderRadius: 2, border: "1px solid #e2e8f0" }}>

                        {/* Tier 1: Table level */}
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          <Typography sx={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", minWidth: 20 }}>{idx + 1}</Typography>

                          <Box sx={{ flex: 1 }}>
                            <FocusSelect options={tableOptions} value={join.leftTableId} onChange={(val) => updateJoinRow(join.id, { leftTableId: String(val) })} placeholder="Left Table" fullWidth />
                          </Box>

                          <Box sx={{ width: 140 }}>
                            <FocusSelect options={[{ label: "LEFT JOIN", value: "LEFT" }, { label: "INNER JOIN", value: "INNER" }, { label: "RIGHT JOIN", value: "RIGHT" }, { label: "FULL JOIN", value: "FULL" }]} value={join.joinType} onChange={(val) => updateJoinRow(join.id, { joinType: String(val) as any })} fullWidth />
                          </Box>

                          <Box sx={{ flex: 1 }}>
                            <FocusSelect options={tableOptions} value={join.rightTableId} onChange={(val) => updateJoinRow(join.id, { rightTableId: String(val) })} placeholder="Right Table" fullWidth />
                          </Box>

                          <IconButton onClick={() => handleRemoveJoinRow(join.id)} size="small" sx={{ color: "#ef4444" }}>
                            <DeleteOutlineRoundedIcon fontSize="small" />
                          </IconButton>
                        </Box>

                        {/* Tier 2: Conditions */}
                        <Box sx={{ pl: 4, display: "flex", flexDirection: "column", gap: 1, mt: 1 }}>
                          {(join.conditions || []).map((cond, cIdx) => (
                            <Box key={cond.id} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                              {cIdx > 0 && <Typography sx={{ fontSize: 11, fontWeight: 700, color: "#64748b", minWidth: 24, textAlign: "right", mr: 1 }}>AND</Typography>}
                              {cIdx === 0 && <Typography sx={{ fontSize: 11, fontWeight: 700, color: "#64748b", minWidth: 24, textAlign: "right", mr: 1 }}>ON</Typography>}

                              <Box sx={{ flex: 1 }}>
                                <FocusSelect options={lCols} value={cond.leftColumn} onChange={(val) => updateConditionRow(join.id, cond.id, { leftColumn: String(val) })} placeholder="Left Column" fullWidth />
                              </Box>

                              <Box sx={{ width: 80 }}>
                                <FocusSelect options={opOptions} value={cond.operator} onChange={(val) => updateConditionRow(join.id, cond.id, { operator: String(val) })} fullWidth />
                              </Box>

                              <Box sx={{ flex: 1 }}>
                                <FocusSelect options={rCols} value={cond.rightColumn} onChange={(val) => updateConditionRow(join.id, cond.id, { rightColumn: String(val) })} placeholder="Right Column" fullWidth />
                              </Box>

                              <IconButton onClick={() => handleRemoveConditionRow(join.id, cond.id)} size="small" sx={{ color: "#ef4444" }}>
                                <RemoveCircleOutlineRoundedIcon fontSize="small" />
                              </IconButton>
                            </Box>
                          ))}
                          <Box sx={{ mt: 0.5, pl: 4.5 }}>
                            <FocusButton variant="text" size="small" onClick={() => handleAddConditionRow(join.id)} customColor="#3b82f6">
                              + Add Condition
                            </FocusButton>
                          </Box>
                        </Box>
                      </Box>
                    );
                  })
                )}
              </Box>

              {joins.length > 0 && (
                <Box sx={{ mt: 2, bgcolor: "#0f172a", borderRadius: 2, p: 2 }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 800, color: "#64748b", mb: 1, letterSpacing: "0.05em" }}>JOIN PREVIEW</Typography>
                  <Box component="pre" sx={{ m: 0, fontSize: 12, color: "#38bdf8", fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
                    {joinSqlPreview}
                  </Box>
                </Box>
              )}
            </Box>

            {/* Filters Section */}
            <Box sx={{ borderBottom: "1px solid #e5e7eb" }}>
              <FilterConditions
                tables={involvedTables}
                initialGroups={React.useMemo(() => editingSource?.filters || [], [editingSource])}
                onChange={(groups, sql) => {
                  setFilterGroups(groups);
                  setFilterSql(sql);
                }}
              />
            </Box>

            {/* Bottom Tabs */}
            <Box sx={{ flex: 1, display: "flex", flexDirection: "column", bgcolor: "#f8fafc", minHeight: 400 }}>
              <Box sx={{ display: "flex", borderBottom: "1px solid #e5e7eb", px: 3, pt: 2, gap: 3, bgcolor: "white" }}>
                <Box
                  onClick={() => setActiveTab("SQL")}
                  sx={{ pb: 1.5, borderBottom: activeTab === "SQL" ? "2px solid #22c55e" : "2px solid transparent", cursor: "pointer" }}
                >
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: activeTab === "SQL" ? "#0f172a" : "#64748b", display: "flex", alignItems: "center", gap: 1 }}>
                    <span style={{ color: "#22c55e" }}>●</span> SQL Expression
                  </Typography>
                </Box>
                <Box
                  onClick={() => setActiveTab("Preview")}
                  sx={{ pb: 1.5, borderBottom: activeTab === "Preview" ? "2px solid #22c55e" : "2px solid transparent", cursor: "pointer" }}
                >
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: activeTab === "Preview" ? "#0f172a" : "#64748b" }}>
                    👁 Preview Columns
                  </Typography>
                </Box>
              </Box>

              <Box sx={{ flex: 1, p: 3 }}>
                {activeTab === "SQL" && (
                  <Box sx={{ height: "100%", bgcolor: "#0f172a", borderRadius: 2, p: 2, display: "flex", flexDirection: "column" }}>
                    <Box component="textarea"
                      value={customSql || fullSqlExpression}
                      onChange={(e: any) => setCustomSql(e.target.value)}
                      sx={{ flex: 1, m: 0, fontSize: 13, color: "white", fontFamily: "monospace", bgcolor: "transparent", border: "none", outline: "none", resize: "none" }}
                    />
                  </Box>
                )}

                {activeTab === "Preview" && (
                  <Box sx={{ height: "100%", bgcolor: "white", borderRadius: 2, border: "1px solid #e5e7eb", display: "flex", flexDirection: "column", overflow: "hidden" }}>

                    {/* Header: Sources Chips */}
                    <Box sx={{ px: 2, py: 1.5, borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Typography sx={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.05em" }}>SOURCES:</Typography>
                        {involvedTables.map(t => (
                          <Box key={t.id} sx={{ px: 1.5, py: 0.25, borderRadius: "12px", border: "1px solid #bfdbfe", color: "#3b82f6", fontSize: 11, fontWeight: 600 }}>
                            {t.name}
                          </Box>
                        ))}
                      </Box>
                      <Typography sx={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>
                        {involvedTables.reduce((acc, t) => acc + getColumnsForTable(t.id as string).length, 0)} columns &middot; 5 sample rows
                      </Typography>
                    </Box>

                    {/* Table Area */}
                    <Box sx={{ flex: 1, overflow: "auto", maxWidth: "100%", whiteSpace: "nowrap" }}>
                      <FocusTable columns={[
                        { key: "index", label: "#" },
                        ...involvedTables.flatMap(t => getColumnsForTable(t.id as string).map(c => ({
                          key: `${t.name}_${c.name}`,
                          label: (
                            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                              <Typography sx={{ fontSize: 12, fontWeight: 800, color: "#0f172a" }}>{c.name}</Typography>
                              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                                <Box sx={{ px: 1, py: 0.25, borderRadius: 1, fontSize: 10, fontWeight: 700, bgcolor: c.type === "VARCHAR" ? "#f1f5f9" : "#ffedd5", color: c.type === "VARCHAR" ? "#475569" : "#c2410c" }}>
                                  {c.type}
                                </Box>
                                <Typography sx={{ fontSize: 10, color: "#94a3b8" }}>{t.name}</Typography>
                              </Box>
                            </Box>
                          )
                        })))
                      ]}>
                        {[1, 2, 3, 4, 5].map((rowIdx) => (
                          <tr key={rowIdx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "12px 16px", fontSize: 12, color: "#94a3b8" }}>{rowIdx}</td>
                            {involvedTables.flatMap(t => getColumnsForTable(t.id as string).map(c => {
                              // Generate mock data based on type
                              let mockVal: any = `Sample ${rowIdx}`;
                              if (c.type === "BIGINT" || c.type === "INT") mockVal = 10000 + rowIdx;
                              else if (c.type === "DECIMAL") mockVal = (Math.random() * 1000).toFixed(2);
                              else if (c.type === "DATE") mockVal = `2023-01-0${rowIdx}`;
                              else if (c.name.includes("NAME")) mockVal = ["Alice Johnson", "Bob Smith", "Carol White", "David Brown", "Eve Davis"][rowIdx - 1];

                              return (
                                <td key={`${t.name}_${c.name}`} style={{ padding: "12px 16px", fontSize: 13, color: c.type === "DECIMAL" ? "#ea580c" : "#0f172a" }}>
                                  {mockVal}
                                </td>
                              );
                            }))}
                          </tr>
                        ))}
                      </FocusTable>
                    </Box>

                    {/* Footer Actions inside Preview */}
                    <Box sx={{ p: 2, borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center", bgcolor: "#fafafa" }}>
                      <Box sx={{ display: "flex", gap: 1 }}>
                        <FocusButton variant="contained" size="small" rounded="full" customBackgroundColor="#6366f1" startIcon={<span style={{ fontSize: 16 }}>👁</span>}>
                          Refresh Preview
                        </FocusButton>
                        <FocusButton variant="outlined" size="small" rounded="full" onClick={() => setActiveTab("SQL")} customColor="#475569" customBorderColor="#cbd5e1">
                          — Back to SQL Editor
                        </FocusButton>
                      </Box>
                      <Typography sx={{ fontSize: 11, color: "#94a3b8" }}>Data is generated from source table schemas</Typography>
                    </Box>
                  </Box>
                )}
              </Box>
            </Box>
          </Box>
          {/* Footer */}
          <Box sx={{ px: 3, py: 2, borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Box sx={{ display: "flex", gap: 1 }}>
              <FocusButton variant="outlined" size="small" rounded="full" customColor="#10b981" customBorderColor="#10b981">
                ✓ Validate SQL
              </FocusButton>
            </Box>
            <Box sx={{ display: "flex", gap: 1 }}>
              <FocusButton variant="text" size="small" rounded="full" onClick={onClose} customColor="#64748b">
                Cancel
              </FocusButton>
              <FocusButton
                variant="contained"
                size="small"
                rounded="full"
                customBackgroundColor="#0f766e"
                disabled={!hasName || !hasJoins}
                onClick={handleConfirm}
              >
                {editingSource ? "Update Derived Source" : "+ Add Derived Source"}
              </FocusButton>
            </Box>
          </Box>
        </Box>

      </Box>


    </Dialog>
  );
}
