"use client";
import { AiaBox } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import React, { useEffect, useState } from "react";

import { AllInclusiveIcon } from '@/utils/icons';
import { textStyleCssVars } from '@/config/typography-tokens';

import type { JoinConfig, TableMeta } from "@/features/sttm/types/sttm.types";
import { AiaButton } from "@/components/ui/aia-button";
import { AiaChip } from "@/components/ui/aia-chip";
import { AiaSelect } from "@/components/ui/aia-select";
import { AiaAutocomplete } from "@/components/ui/aia-auto-complete";
import { SqlEditor, SQL_EDITOR_FRAME_SX, SQL_EDITOR_PREVIEW_HEIGHT } from "@/components/sql";
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

function reverseJoinType(joinType: JoinConfig["joinType"]): JoinConfig["joinType"] {
  if (joinType === "LEFT") return "RIGHT";
  if (joinType === "RIGHT") return "LEFT";
  return joinType;
}

function orientJoinAroundDrivingTable(
  join: JoinConfig,
  drivingTableId: string,
): JoinConfig {
  if (!drivingTableId || join.leftTableId === drivingTableId) return join;
  if (join.rightTableId === drivingTableId) {
    return {
      ...join,
      leftTableId: join.rightTableId,
      rightTableId: join.leftTableId,
      joinType: reverseJoinType(join.joinType),
      conditions: (join.conditions ?? []).map((condition) => ({
        ...condition,
        leftColumn: condition.rightColumn,
        rightColumn: condition.leftColumn,
      })),
    };
  }
  return {
    ...join,
    leftTableId: drivingTableId,
    conditions: (join.conditions ?? []).map((condition) => ({
      ...condition,
      leftColumn: "",
    })),
  };
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
        const oriented = orientJoinAroundDrivingTable(editingJoin, drivingTableMetaId);
        setJoinType(oriented.joinType ?? "INNER");
        setLeftTableId(drivingTableMetaId || oriented.leftTableId || "");
        setRightTableId(oriented.rightTableId ?? "");
        const conds = oriented.conditions?.length
          ? oriented.conditions
          : [];
        setRows(
          conds.length
            ? conds.map((c, idx) => ({
                id: `row-${idx + 1}`,
                leftColumn: c.leftColumn ?? "",
                operator: c.operator ?? "",
                rightColumn: c.rightColumn ?? "",
              }))
            : [{ id: "row-1", leftColumn: "", operator: "=", rightColumn: "" }]
        );
      } else {
        setJoinType("INNER");
        const defaultLeft = drivingTableMetaId || initialLeftTableId || (tables[0]?.id ?? "");
        const defaultRight = initialRightTableId || "";
        setLeftTableId(defaultLeft);
        setRightTableId(defaultRight);
        setRows([
          { id: "row-1", leftColumn: "", operator: "=", rightColumn: "" },
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
        label: name || schema,
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
      { id: `row-${prev.length + 1}`, leftColumn: "", operator: "=", rightColumn: "" },
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

  const DerivedChip = () => <AiaChip label="Derived" size="small" color="success" />;

  const sectionLabelSx = {
    ...textStyleCssVars("caption"),
    fontWeight: 400,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  };

  const joinFieldGap = 2.5;
  const joinFieldsWidth = "90%";
  const joinConditionColumnWidth = 108;
  const joinTableGridSx = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: joinFieldGap,
    width: "100%",
  } as const;
  const joinColumnGridColumns = `minmax(0, 1fr) ${joinConditionColumnWidth}px minmax(0, 1fr) max-content`;
  const joinConditionSelectSx = {
    width: joinConditionColumnWidth,
    minWidth: joinConditionColumnWidth,
    maxWidth: joinConditionColumnWidth,
    "& .MuiSelect-select": {
      textAlign: "left",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      paddingLeft: 1,
      paddingRight: "24px !important",
    },
  } as const;
  const joinColumnRowSubgridSx = {
    gridColumn: "1 / -1",
    display: "grid",
    gridTemplateColumns: "subgrid",
    alignItems: "center",
  } as const;
  const joinRowActionButtonSx = {
    minWidth: 28,
    width: 28,
    height: 28,
    p: 0,
    fontSize: 14,
    lineHeight: 1,
    boxShadow: "none",
  } as const;
  const joinRowActionButtonSxBase = {
    ...joinRowActionButtonSx,
    color: "var(--aia-button-color)",
    borderColor: "var(--aia-button-color)",
    "--aia-btn-stroke": "var(--aia-button-color)",
    "&:hover": {
      color: "var(--aia-button-color)",
      borderColor: "var(--aia-button-color)",
      backgroundColor: "color-mix(in srgb, var(--aia-button-color) 6%, transparent)",
    },
  } as const;
  const joinCloseButtonSx = {
    ...joinRowActionButtonSx,
    color: "#94a3b8",
    border: "none",
    backgroundColor: "transparent",
    "&:hover": {
      color: "#94a3b8",
      border: "none",
      backgroundColor: "color-mix(in srgb, var(--aia-button-color) 6%, transparent)",
    },
  } as const;

  return (
    <div className="join-modal-overlay">
      <div className="join-modal">
        <AiaBox sx={{ p: 3, borderBottom: "1px solid #f1f5f9" }}>
          <AiaBox sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
            <AiaBox sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0 }}>
              <AllInclusiveIcon
                sx={{
                  fontSize: "calc(var(--aia-card-title-font-size) + 2px)",
                  color: "var(--aia-card-title-color)",
                  flexShrink: 0,
                }}
                aria-hidden
              />
              <AiaBox sx={{ minWidth: 0 }}>
                <AiaText
                  sx={{
                    ...textStyleCssVars("cardTitle"),
                    textTransform: "capitalize",
                    letterSpacing: "-0.01em",
                  }}
                >
                  Establish Join
                </AiaText>
                <AiaText
                  sx={{
                    ...textStyleCssVars("secondaryText"),
                    mt: 0.25,
                    display: "block",
                  }}
                >
                  Define a relationship between two tables
                </AiaText>
              </AiaBox>
            </AiaBox>
            <AiaButton
              variant="text"
              size="small"
              onClick={onClose}
              sx={joinCloseButtonSx}
              aria-label="Close"
            >
              ✕
            </AiaButton>
          </AiaBox>
        </AiaBox>

        <AiaBox sx={{ p: 3 }}>
          <AiaText sx={{ ...sectionLabelSx, mb: 1.25 }}>
            JOIN TYPE
          </AiaText>
          <AiaBox sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 3 }}>
            {(["INNER", "LEFT", "RIGHT", "FULL"] as const).map((t) => {
              const active = joinType === t;
              return (
                <AiaButton
                  key={t}
                  size="small"
                  variant={active ? "contained" : "outlined"}
                  color="primary"
                  onClick={() => setJoinType(t)}
                  {...(active
                    ? {
                        customBackgroundColor: "var(--aia-primary-bg-color)",
                        customColor: "var(--aia-primary-bg-text-color)",
                        customBorderColor: "var(--aia-primary-bg-color)",
                        customHoverBackgroundColor: "var(--aia-primary-bg-hover-color)",
                      }
                    : {
                        customBorderColor: "var(--aia-primary-bg-color)",
                        customColor: "var(--aia-primary-bg-color)",
                      })}
                >
                  {t} JOIN
                </AiaButton>
              );
            })}
          </AiaBox>

          <AiaBox sx={{ width: joinFieldsWidth, pb: 2.5 }}>
            <AiaBox sx={joinTableGridSx}>
              <AiaBox sx={{ minWidth: 0 }}>
                <AiaText sx={{ ...sectionLabelSx, mb: 1 }}>
                  LEFT TABLE
                </AiaText>
                <AiaSelect
                  options={tableOptions}
                  value={leftTableId}
                  placeholder="Select table"
                  onChange={(val) => {
                    setLeftTableId(String(val));
                    setRows((prev) => prev.map((r) => ({ ...r, leftColumn: "" })));
                  }}
                  disabled={true}
                />
                <AiaText sx={{ mt: 0.65, fontSize: 11, color: "#64748b", overflowWrap: "anywhere" }}>
                  {leftTable ? `${leftTable.database ?? ""}.${leftTable.schema ?? ""}.${leftTable.name ?? ""}`.replace(/\.+/g, ".") : "Driving table"}
                </AiaText>
                {leftIsDerived ? (
                  <AiaBox sx={{ mt: 0.9 }}>
                    <DerivedChip />
                  </AiaBox>
                ) : null}
              </AiaBox>

              <AiaBox sx={{ minWidth: 0 }}>
                <AiaText sx={{ ...sectionLabelSx, mb: 1 }}>
                  RIGHT TABLE
                </AiaText>
                <AiaAutocomplete
                  hideLabel
                  options={tableOptions}
                  value={rightTableId}
                  placeholder="Search table…"
                  onChange={(val) => {
                    setRightTableId(Array.isArray(val) ? val[0] ?? "" : String(val));
                    setRows((prev) => prev.map((r) => ({ ...r, rightColumn: "" })));
                  }}
                />
                <AiaText sx={{ mt: 0.65, fontSize: 11, color: "#64748b", overflowWrap: "anywhere" }}>
                  {rightTable ? `${rightTable.database ?? ""}.${rightTable.schema ?? ""}.${rightTable.name ?? ""}`.replace(/\.+/g, ".") : "Select a related table"}
                </AiaText>
                {rightIsDerived ? (
                  <AiaBox sx={{ mt: 0.9 }}>
                    <DerivedChip />
                  </AiaBox>
                ) : null}
              </AiaBox>
            </AiaBox>
          </AiaBox>

          <AiaBox
            sx={{
              width: "100%",
              borderBottom: "1px solid #e5e7eb",
              mb: 2.5,
            }}
          />

          <AiaBox
            sx={{
              maxHeight: 300,
              overflowY: "auto",
              overflowX: "hidden",
            }}
          >
            <AiaBox
              sx={{
                display: "grid",
                gridTemplateColumns: joinColumnGridColumns,
                columnGap: joinFieldGap,
                width: "100%",
              }}
            >
              <AiaBox sx={{ ...joinColumnRowSubgridSx, mb: 1 }}>
                <AiaText sx={sectionLabelSx}>LEFT COLUMNS</AiaText>
                <AiaText sx={{ ...sectionLabelSx, justifySelf: "start", whiteSpace: "nowrap" }}>
                  CONDITIONS
                </AiaText>
                <AiaText sx={sectionLabelSx}>RIGHT COLUMNS</AiaText>
                <AiaBox />
              </AiaBox>

              {rows.map((row, idx) => (
                <AiaBox
                  key={row.id}
                  sx={{
                    ...joinColumnRowSubgridSx,
                    ...(idx > 0 ? { mt: joinFieldGap } : {}),
                  }}
                >
                  <AiaBox sx={{ minWidth: 0 }}>
                    <AiaAutocomplete
                      hideLabel
                      options={leftColumnOptions}
                      value={row.leftColumn}
                      placeholder="Search column…"
                      onChange={(val) =>
                        updateRow(idx, { leftColumn: Array.isArray(val) ? val[0] ?? "" : String(val) })
                      }
                      disabled={!leftTableId}
                      fullWidth
                    />
                  </AiaBox>

                  <AiaBox sx={{ width: joinConditionColumnWidth, minWidth: joinConditionColumnWidth, maxWidth: joinConditionColumnWidth }}>
                    <AiaSelect
                      options={operatorOptions}
                      value={row.operator}
                      placeholder="Condition"
                      onChange={(val) => updateRow(idx, { operator: String(val) })}
                      fullWidth
                      sx={joinConditionSelectSx}
                    />
                  </AiaBox>

                  <AiaBox sx={{ minWidth: 0 }}>
                    <AiaAutocomplete
                      hideLabel
                      options={rightColumnOptions}
                      value={row.rightColumn}
                      placeholder="Search column…"
                      onChange={(val) =>
                        updateRow(idx, { rightColumn: Array.isArray(val) ? val[0] ?? "" : String(val) })
                      }
                      disabled={!rightTableId}
                      fullWidth
                    />
                  </AiaBox>

                  <AiaBox
                    sx={{
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      gap: 0.75,
                    }}
                  >
                    <AiaButton
                      variant="outlined"
                      size="small"
                      color="primary"
                      onClick={() => removeRow(idx)}
                      disabled={rows.length <= 1}
                      sx={joinRowActionButtonSxBase}
                      customBorderColor="var(--aia-button-color)"
                      customColor="var(--aia-button-color)"
                      aria-label="Remove condition"
                    >
                      ✕
                    </AiaButton>
                    <AiaButton
                      variant="outlined"
                      size="small"
                      color="primary"
                      onClick={addRow}
                      sx={{
                        ...joinRowActionButtonSxBase,
                        fontSize: 20,
                        fontWeight: 600,
                      }}
                      customBorderColor="var(--aia-button-color)"
                      customColor="var(--aia-button-color)"
                      aria-label="Add condition"
                    >
                      +
                    </AiaButton>
                  </AiaBox>
                </AiaBox>
              ))}
            </AiaBox>
          </AiaBox>

          <AiaBox
            sx={{
              mt: 3,
              height: SQL_EDITOR_PREVIEW_HEIGHT,
              flexShrink: 0,
              ...SQL_EDITOR_FRAME_SX,
            }}
          >
            <SqlEditor
              value={sqlPreview || "Select tables and columns to preview SQL join..."}
              readOnly
              title="SQL PREVIEW"
              emptyText="Select tables and columns to preview SQL join..."
              showCopy
              minHeight={SQL_EDITOR_PREVIEW_HEIGHT}
              maxHeight={SQL_EDITOR_PREVIEW_HEIGHT}
              showLineNumbers={false}
            />
          </AiaBox>
        </AiaBox>

        <AiaBox sx={{ px: 3, py: 2.25, borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "flex-end", gap: 1.5 }}>
          <AiaButton
            variant="outlined"
            size="large"
            onClick={onClose}
            customBorderColor="var(--aia-primary-bg-color)"
            customColor="var(--aia-primary-bg-color)"
          >
            Cancel
          </AiaButton>
          <AiaButton
            variant="contained"
            size="large"
            color="primary"
            onClick={handleConfirm}
            disabled={!isFormValid}
            customBackgroundColor="var(--aia-primary-bg-color)"
            customColor="var(--aia-primary-bg-text-color)"
            customBorderColor="var(--aia-primary-bg-color)"
            customHoverBackgroundColor="var(--aia-primary-bg-hover-color)"
          >
            {editingJoin ? "Update Join" : "Add Join"}
          </AiaButton>
        </AiaBox>
      </div>
    </div>
  );
}
