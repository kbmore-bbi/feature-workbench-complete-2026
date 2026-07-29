"use client";

import {
  AiaBox,
  AiaCheckbox,
  AiaIconButton,
  AiaStack,
  AiaTableBody,
  AiaTableCellPrimitive,
  AiaTableContainer,
  AiaTableHead,
  AiaTablePrimitive,
  AiaTableRowPrimitive,
} from "@/components/ui";
import { AiaText } from "@/components/ui/aia-text";
import { DeleteOutlinedIcon, EditOutlinedIcon } from "@/utils/icons";

import type { HardcodedAttribute } from "./attributes-data";

type ColumnKey =
  | "select"
  | "attributeId"
  | "attributeName"
  | "attributeType"
  | "projectName"
  | "importedAttribute"
  | "attributeValue"
  | "actions";

type ColumnDef = {
  key: ColumnKey;
  label: string;
  align: "left" | "center" | "right";
  /** Floor width — columns never shrink below this. */
  minWidth: number;
  /** Fixed columns (checkbox/actions) keep an exact width and do not grow. */
  fixed?: boolean;
};

const BASE_COLUMNS: ColumnDef[] = [
  {
    key: "select",
    label: "",
    align: "center",
    minWidth: 56,
    fixed: true,
  },
  {
    key: "attributeId",
    label: "ATTRIBUTE ID",
    align: "left",
    minWidth: 150,
  },
  {
    key: "attributeName",
    label: "ATTRIBUTE NAME",
    align: "left",
    minWidth: 180,
  },
  {
    key: "attributeType",
    label: "ATTRIBUTE TYPE",
    align: "left",
    minWidth: 140,
  },
  {
    key: "projectName",
    label: "PROJECT NAME",
    align: "left",
    minWidth: 240,
  },
  {
    key: "importedAttribute",
    label: "IMPORTED ATTRIBUTE",
    align: "left",
    minWidth: 240,
  },
  {
    key: "attributeValue",
    label: "ATTRIBUTE VALUE",
    align: "left",
    minWidth: 280,
  },
  {
    key: "actions",
    label: "ACTIONS",
    align: "center",
    minWidth: 108,
    fixed: true,
  },
];

function getColumnSx(
  column: ColumnDef,
  flexMinTotal: number,
): { width: number | string; minWidth: number; maxWidth?: number } {
  if (column.fixed || flexMinTotal <= 0) {
    return {
      width: column.minWidth,
      minWidth: column.minWidth,
      maxWidth: column.minWidth,
    };
  }

  // Share remaining table width in proportion to each column's minWidth.
  return {
    width: `${(column.minWidth / flexMinTotal) * 100}%`,
    minWidth: column.minWidth,
  };
}

const tableContainerSx = {
  border: "1px solid #E5E7EB",
  borderRadius: "12px",
  bgcolor: "#FFFFFF",
  overflowX: "auto",
  overflowY: "auto",
  width: "100%",
  "& .MuiTableCell-root": {
    borderBottom: "1px solid #EDF2F7",
    py: 1.5,
    px: 2,
    fontSize: 13,
    color: "#334155",
    verticalAlign: "top",
    boxSizing: "border-box",
  },
  "& .MuiTableHead-root .MuiTableCell-root": {
    borderBottom: "1px solid #E5E7EB",
    py: 1.25,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "#64748B",
    backgroundColor: "#FAFAFA",
    position: "sticky",
    top: 0,
    zIndex: 1,
    whiteSpace: "nowrap",
  },
} as const;

const cellTextSx = {
  fontSize: 13,
  color: "#334155",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
} as const;

const actionButtonSx = {
  width: 32,
  height: 32,
  borderRadius: "8px",
  border: "1px solid #E5E7EB",
  color: "#64748B",
  bgcolor: "#FFFFFF",
  "&:hover": {
    bgcolor: "#F8FAFC",
    borderColor: "#D1D5DB",
  },
} as const;

function getImportedAttributeDisplay(row: HardcodedAttribute): string {
  const value = row.importProjectName?.trim();
  return value ? value : "-";
}

export type AttributesTableProps = {
  rows: HardcodedAttribute[];
  /** Landing shows actions + imported attribute; import shows checkboxes. */
  variant?: "landing" | "import";
  emptyMessage?: string;
  maxHeight?: string | number;
  selectedIds?: string[];
  onToggleRow?: (row: HardcodedAttribute, checked: boolean) => void;
  onToggleAll?: (checked: boolean) => void;
  onEdit?: (row: HardcodedAttribute) => void;
  onDelete?: (row: HardcodedAttribute) => void;
};

export default function AttributesTable({
  rows,
  variant = "landing",
  emptyMessage = "No hardcoded attributes yet. Create one to get started.",
  maxHeight = "calc(100vh - 240px)",
  selectedIds = [],
  onToggleRow,
  onToggleAll,
  onEdit,
  onDelete,
}: AttributesTableProps) {
  const showCheckbox = variant === "import";
  const showActions = variant === "landing";
  const showImportedAttribute = variant === "landing";

  const columns = BASE_COLUMNS.filter((column) => {
    if (column.key === "select") {
      return showCheckbox;
    }
    if (column.key === "actions") {
      return showActions;
    }
    if (column.key === "importedAttribute") {
      return showImportedAttribute;
    }
    return true;
  });

  const tableMinWidth = columns.reduce((sum, column) => sum + column.minWidth, 0);
  const flexMinTotal = columns
    .filter((column) => !column.fixed)
    .reduce((sum, column) => sum + column.minWidth, 0);

  const columnSxByKey = Object.fromEntries(
    columns.map((column) => [column.key, getColumnSx(column, flexMinTotal)]),
  ) as Record<ColumnKey, ReturnType<typeof getColumnSx>>;

  const selectedSet = new Set(selectedIds);
  const allSelected = rows.length > 0 && rows.every((row) => selectedSet.has(row.id));
  const someSelected = rows.some((row) => selectedSet.has(row.id)) && !allSelected;

  return (
    <AiaTableContainer
      sx={{
        ...tableContainerSx,
        maxHeight,
        "& table": {
          tableLayout: "fixed",
          width: "100%",
          minWidth: tableMinWidth,
        },
      }}
    >
      <AiaTablePrimitive size="small" stickyHeader>
        <AiaTableHead>
          <AiaTableRowPrimitive>
            {columns.map((column) => (
              <AiaTableCellPrimitive
                key={column.key}
                align={column.align}
                sx={columnSxByKey[column.key]}
              >
                {column.key === "select" ? (
                  <AiaCheckbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    checkHandler={(checked) => onToggleAll?.(checked)}
                  />
                ) : (
                  column.label
                )}
              </AiaTableCellPrimitive>
            ))}
          </AiaTableRowPrimitive>
        </AiaTableHead>
        <AiaTableBody>
          {rows.length === 0 ? (
            <AiaTableRowPrimitive>
              <AiaTableCellPrimitive colSpan={columns.length}>
                <AiaBox
                  sx={{
                    minHeight: 160,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <AiaText sx={{ color: "#64748B", fontSize: 13, fontWeight: 600 }}>
                    {emptyMessage}
                  </AiaText>
                </AiaBox>
              </AiaTableCellPrimitive>
            </AiaTableRowPrimitive>
          ) : (
            rows.map((row) => {
              const isSelected = selectedSet.has(row.id);
              return (
                <AiaTableRowPrimitive key={row.id} hover selected={showCheckbox && isSelected}>
                  {showCheckbox ? (
                    <AiaTableCellPrimitive align="center" sx={columnSxByKey.select}>
                      <AiaCheckbox
                        checked={isSelected}
                        checkHandler={(checked) => onToggleRow?.(row, checked)}
                      />
                    </AiaTableCellPrimitive>
                  ) : null}
                  <AiaTableCellPrimitive sx={columnSxByKey.attributeId}>
                    <AiaText sx={{ ...cellTextSx, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}>
                      {row.id}
                    </AiaText>
                  </AiaTableCellPrimitive>
                  <AiaTableCellPrimitive sx={columnSxByKey.attributeName}>
                    <AiaText sx={{ ...cellTextSx, fontWeight: 700, color: "#111827" }}>
                      {row.attributeName}
                    </AiaText>
                  </AiaTableCellPrimitive>
                  <AiaTableCellPrimitive sx={columnSxByKey.attributeType}>
                    <AiaText sx={cellTextSx}>{row.attributeType}</AiaText>
                  </AiaTableCellPrimitive>
                  <AiaTableCellPrimitive sx={columnSxByKey.projectName}>
                    <AiaText sx={cellTextSx}>{row.projectName}</AiaText>
                  </AiaTableCellPrimitive>
                  {showImportedAttribute ? (
                    <AiaTableCellPrimitive sx={columnSxByKey.importedAttribute}>
                      <AiaText sx={cellTextSx}>{getImportedAttributeDisplay(row)}</AiaText>
                    </AiaTableCellPrimitive>
                  ) : null}
                  <AiaTableCellPrimitive sx={columnSxByKey.attributeValue}>
                    <AiaText sx={cellTextSx}>{row.attributeValue}</AiaText>
                  </AiaTableCellPrimitive>
                  {showActions ? (
                    <AiaTableCellPrimitive align="center" sx={columnSxByKey.actions}>
                      <AiaStack
                        direction="row"
                        spacing={0.75}
                        sx={{ justifyContent: "center", alignItems: "center" }}
                      >
                        <AiaIconButton
                          aria-label={`Edit ${row.attributeName}`}
                          onClick={() => onEdit?.(row)}
                          sx={actionButtonSx}
                        >
                          <EditOutlinedIcon sx={{ fontSize: 16 }} />
                        </AiaIconButton>
                        <AiaIconButton
                          aria-label={`Delete ${row.attributeName}`}
                          onClick={() => onDelete?.(row)}
                          sx={{
                            ...actionButtonSx,
                            color: "#DC2626",
                            "&:hover": {
                              bgcolor: "#FEF2F2",
                              borderColor: "#FECACA",
                            },
                          }}
                        >
                          <DeleteOutlinedIcon sx={{ fontSize: 16 }} />
                        </AiaIconButton>
                      </AiaStack>
                    </AiaTableCellPrimitive>
                  ) : null}
                </AiaTableRowPrimitive>
              );
            })
          )}
        </AiaTableBody>
      </AiaTablePrimitive>
    </AiaTableContainer>
  );
}
