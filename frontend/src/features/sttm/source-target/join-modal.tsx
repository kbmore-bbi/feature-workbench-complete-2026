"use client";

import React, { useEffect, useState } from "react";
import { Box, IconButton, Typography } from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import AddCircleOutlineRoundedIcon from "@mui/icons-material/AddCircleOutlineRounded";
import RemoveCircleOutlineRoundedIcon from "@mui/icons-material/RemoveCircleOutlineRounded";
import type { JoinConfig, TableMeta } from "@/features/sttm/types/sttm.types";
import { FocusButton } from "@/components/ui/focus-button";
import { FocusSelect } from "@/components/ui/focus-select";
import { useSttmBuilderContext } from "@/features/sttm/context/sttm-builder-context";

interface JoinModalProps {
  isOpen: boolean;
  onClose: () => void;
  tables: TableMeta[];
  initialLeftTableId?: string;
  initialRightTableId?: string;
  drivingTableIdOverride?: string | null;
  editingJoin?: JoinConfig | null;
  onConfirm: (join: JoinConfig) => void;
}

export function JoinModal({
  isOpen,
  onClose,
  tables,
  initialLeftTableId,
  initialRightTableId,
  drivingTableIdOverride,
  editingJoin,
  onConfirm,
}: JoinModalProps) {
  const [joinType, setJoinType] = useState<"INNER" | "LEFT" | "RIGHT" | "FULL">(
    "INNER"
  );

  type PairRow = {
    id: string;
    leftColumn: string;
    operator: string;
    rightColumn: string;
  };
  const { drivingTableId } = useSttmBuilderContext();
  const [leftTableId, setLeftTableId] = useState<string>("");
  const [rightTableId, setRightTableId] = useState<string>("");
  const [rows, setRows] = useState<PairRow[]>([]);

  const drivingTableMetaId = React.useMemo(() => {
    if (drivingTableIdOverride) {
      return tables.find((table) => table.id === drivingTableIdOverride)?.id || "";
    }
    if (!drivingTableId) return "";
    return tables.find((table) => table.id?.endsWith(`:${drivingTableId}`) || table.id === drivingTableId)?.id || "";
  }, [drivingTableId, drivingTableIdOverride, tables]);

  useEffect(() => {
    if (isOpen) {
      if (editingJoin) {
        setJoinType(editingJoin.joinType ?? "INNER");
        setLeftTableId(editingJoin.leftTableId || drivingTableMetaId || "");
        setRightTableId(editingJoin.rightTableId ?? "");
        const conds = editingJoin.conditions?.length
          ? editingJoin.conditions
          : [];
        setRows(
          conds.length
            ? conds.map((c, idx) => ({
                id: `row-${idx + 1}`,
                leftColumn: c.leftColumn ?? "",
                operator: c.operator ?? "",
                rightColumn: c.rightColumn ?? "",
              }))
            : [{ id: "row-1", leftColumn: "", operator: "", rightColumn: "" }]
        );
      } else {
        setJoinType("INNER");
        const defaultLeft = drivingTableMetaId || initialLeftTableId || (tables[0]?.id ?? "");
        const defaultRight = initialRightTableId || "";
        setLeftTableId(defaultLeft);
        setRightTableId(defaultRight);
        setRows([
          { id: "row-1", leftColumn: "", operator: "", rightColumn: "" },
        ]);
      }
    }
  }, [
    drivingTableMetaId,
    editingJoin,
    initialLeftTableId,
    initialRightTableId,
    isOpen,
    tables,
  ]);

  if (!isOpen) return null;

  const tableOptions = tables
    .filter((t) => !!t.id)
    .map((t) => {
      const schema = t.schema ?? "";
      const name = t.name ?? "";
      return {
        label: `${schema}.${name}`.replace(/\.+/g, "."),
        value: t.id as string,
      };
    });

  const handleConfirm = () => {
    const validRows = rows.filter((r) => r.leftColumn && r.operator && r.rightColumn);
    if (validRows.length === 0) return;
    if (!leftTableId || !rightTableId) return;

    const out: JoinConfig = {
      id:
        editingJoin?.id ??
        `${leftTableId}__${rightTableId}`, // one join per table-pair
      joinType,
      leftTableId,
      rightTableId,
      constraintName: editingJoin?.constraintName,
      source: editingJoin ? "USER_DEFINED" : "USER_DEFINED",
      locked: false,
      conditions: validRows.map((r) => ({
        leftColumn: r.leftColumn,
        operator: r.operator,
        rightColumn: r.rightColumn,
      })),
    };

    onConfirm(out);
    onClose();
  };

  const isFormValid =
    !!leftTableId &&
    !!rightTableId &&
    rows.some((r) => r.leftColumn && r.operator && r.rightColumn);

  const updateRow = (idx: number, patch: Partial<PairRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      { id: `row-${prev.length + 1}`, leftColumn: "", operator: "", rightColumn: "" },
    ]);
  };

  const removeRow = (idx: number) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const leftTable = tables.find((t) => t.id === leftTableId);
  const rightTable = tables.find((t) => t.id === rightTableId);
  const leftIsDerived = leftTable?.tag?.toLowerCase().includes("derived") ?? false;
  const rightIsDerived = rightTable?.tag?.toLowerCase().includes("derived") ?? false;

  const leftColumnOptions = (leftTable?.columns ?? [])
    .filter((c) => !!c.name)
    .map((c) => ({
      label: `${c.name} (${c.type ?? ""})`,
      value: c.name as string,
    }));
  const rightColumnOptions = (rightTable?.columns ?? [])
    .filter((c) => !!c.name)
    .map((c) => ({
      label: `${c.name} (${c.type ?? ""})`,
      value: c.name as string,
    }));

  const sqlPreview = (() => {
    const pairs = rows.filter((r) => r.leftColumn && r.operator && r.rightColumn);
    if (!leftTable || !rightTable || pairs.length === 0) return "";
    const lSchema = leftTable.schema ?? "";
    const lName = leftTable.name ?? "";
    const rSchema = rightTable.schema ?? "";
    const rName = rightTable.name ?? "";
    const conditions = pairs
      .map(
        (p) =>
          `${lSchema}.${lName}.${p.leftColumn} ${p.operator} ${rSchema}.${rName}.${p.rightColumn}`.replace(
            /\.+/g,
            "."
          )
      )
      .join("\n  AND ");
    return `${joinType} JOIN ${rSchema}.${rName}`.replace(/\.+/g, ".") + `\nON ${conditions}`;
  })();

  const operatorOptions = [
    { label: "— op —", value: "" },
    { label: "=", value: "=" },
    { label: "≠", value: "!=" },
    { label: ">", value: ">" },
    { label: "<", value: "<" },
    { label: "≥", value: ">=" },
    { label: "≤", value: "<=" },
  ];

  const DerivedChip = () => (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        px: 1,
        py: 0.3,
        borderRadius: "999px",
        backgroundColor: "#dcfce7",
        color: "#166534",
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: "0.02em",
      }}
    >
      Derived
    </Box>
  );

  return (
    <div className="join-modal-overlay">
      <div className="join-modal">
        <Box sx={{ p: 3, borderBottom: "1px solid #f1f5f9" }}>
          <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
            <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start" }}>
              <Box
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: "12px",
                  backgroundColor: "#2563eb",
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 800,
                  fontSize: 18,
                  flexShrink: 0,
                }}
              >
                ∞
              </Box>
              <Box>
                <Typography sx={{ fontSize: 20, fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>
                  Establish Join
                </Typography>
                <Typography sx={{ fontSize: 14, fontWeight: 500, color: "#64748b", mt: 0.5 }}>
                  Define a relationship between two tables
                </Typography>
              </Box>
            </Box>
            <IconButton onClick={onClose} sx={{ color: "#94a3b8" }}>
              <CloseRoundedIcon />
            </IconButton>
          </Box>
        </Box>

        <Box sx={{ p: 3 }}>
          <Typography sx={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.08em", mb: 1.25 }}>
            JOIN TYPE
          </Typography>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 3 }}>
            {(["INNER", "LEFT", "RIGHT", "FULL"] as const).map((t) => {
              const active = joinType === t;
              return (
                <FocusButton
                  key={t}
                  size="small"
                  variant="outlined"
                  rounded="full"
                  onClick={() => setJoinType(t)}
                  customBorderColor={active ? "#0f172a" : "#e2e8f0"}
                  customBackgroundColor={active ? "#0f172a" : "#ffffff"}
                  customColor={active ? "#ffffff" : "#475569"}
                  customHoverBackgroundColor={active ? "#0b1220" : "#f8fafc"}
                >
                  {t} JOIN
                </FocusButton>
              );
            })}
          </Box>

          <Box sx={{ display: "flex", gap: 2.5, alignItems: "flex-start", width: "100%" }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.08em", mb: 1 }}>
                LEFT TABLE
              </Typography>
              <FocusSelect
                options={tableOptions}
                value={leftTableId}
                placeholder="Select table"
                onChange={(val) => {
                  setLeftTableId(String(val));
                  setRows((prev) => prev.map((r) => ({ ...r, leftColumn: "" })));
                }}
                disabled={true}
              />
              {leftIsDerived ? (
                <Box sx={{ mt: 0.9 }}>
                  <DerivedChip />
                </Box>
              ) : null}
            </Box>

            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.08em", mb: 1 }}>
                RIGHT TABLE
              </Typography>
              <FocusSelect
                options={tableOptions}
                value={rightTableId}
                placeholder="Select table"
                onChange={(val) => {
                  setRightTableId(String(val));
                  setRows((prev) => prev.map((r) => ({ ...r, rightColumn: "" })));
                }}
              />
              {rightIsDerived ? (
                <Box sx={{ mt: 0.9 }}>
                  <DerivedChip />
                </Box>
              ) : null}
            </Box>
          </Box>

          {/* Column pairs grid (next row, full width) */}
          <Box
            sx={{
              mt: 2,
              maxHeight: 300,
              overflowY: "auto",
              pr: 0.5,
              overflowX: "hidden",
            }}
          >
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
              {rows.map((row, idx) => (
                <Box
                  key={row.id}
                  sx={{
                    display: "grid",
                    gridTemplateColumns:
                      "1fr 0.6fr 1fr 72px",
                    alignItems: "center",
                    gap: 1.25,
                    width: "100%",
                  }}
                >
                  <FocusSelect
                    options={[{ label: "— column —", value: "" }, ...leftColumnOptions]}
                    value={row.leftColumn}
                    placeholder="Column…"
                    onChange={(val) => updateRow(idx, { leftColumn: String(val) })}
                    disabled={!leftTableId}
                  />

                  <FocusSelect
                    options={operatorOptions}
                    value={row.operator}
                    placeholder="Conditions…"
                    onChange={(val) => updateRow(idx, { operator: String(val) })}
                  />

                  <FocusSelect
                    options={[{ label: "— column —", value: "" }, ...rightColumnOptions]}
                    value={row.rightColumn}
                    placeholder="Column…"
                    onChange={(val) => updateRow(idx, { rightColumn: String(val) })}
                    disabled={!rightTableId}
                  />

                  <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 0.1 }}>
                    <IconButton
                      onClick={() => removeRow(idx)}
                      disabled={rows.length <= 1}
                      sx={{
                        width: 36,
                        height: 36,
                        color: rows.length <= 1 ? "#cbd5e1" : "#ef4444",
                        "&:hover": {
                          backgroundColor: rows.length <= 1 ? "transparent" : "#fef2f2",
                        },
                      }}
                    >
                      <RemoveCircleOutlineRoundedIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      onClick={addRow}
                      sx={{
                        width: 36,
                        height: 36,
                        color: "#22c55e",
                        "&:hover": { backgroundColor: "#ecfdf5" },
                      }}
                    >
                      <AddCircleOutlineRoundedIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>

          <Box
            sx={{
              mt: 3,
              backgroundColor: "#0b1220",
              borderRadius: "14px",
              p: 2.5,
              border: "1px solid rgba(255,255,255,0.06)",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <Typography sx={{ fontSize: 11, fontWeight: 800, color: "#64748b", letterSpacing: "0.08em", mb: 1 }}>
              SQL PREVIEW
            </Typography>
            <Box
              component="pre"
              sx={{
                m: 0,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontSize: 13,
                lineHeight: 1.6,
                color: "#22c55e",
                whiteSpace: "pre-wrap",
              }}
            >
              {sqlPreview || "Select tables and columns to preview SQL join..."}
            </Box>
          </Box>
        </Box>

        <Box sx={{ px: 3, py: 2.25, borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "flex-end", gap: 1.5 }}>
          <FocusButton variant="text" size="small" rounded="full" onClick={onClose} customColor="#64748b">
            Cancel
          </FocusButton>
          <FocusButton
            variant="contained"
            size="small"
            rounded="full"
            onClick={handleConfirm}
            disabled={!isFormValid}
          >
            {editingJoin ? "Update Join" : "Add Join"}
          </FocusButton>
        </Box>
      </div>
    </div>
  );
}
