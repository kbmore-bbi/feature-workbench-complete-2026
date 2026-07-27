"use client";
import { AiaBox, AiaPaper, AiaTableBody, AiaTableCellPrimitive, AiaTableContainer, AiaTableHead, AiaTablePagination, AiaTablePrimitive, AiaTableRowPrimitive } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import { useMemo, useState } from "react";

import type { MappingState } from "@/features/sttm/types/sttm.types";
import {
  MappingRowIndexCell,
  MappingStatusCell,
  MappingTargetColumnCell,
  MappingTypePreviewCell,
} from "@/features/sttm/mapping/cells";
import {
  MAPPING_TABLE_CONTAINER_SX,
  MAPPING_TABLE_HEADER_CELL_SX,
  MAPPING_TABLE_PAGINATION_SX,
  MAPPING_TABLE_ROW_SX,
  scrollableMappingTableSx,
} from "@/features/sttm/mapping/mapping-table-styles";
import {
  generateMappingDescription,
  parseSourceColumns,
} from "@/features/sttm/mapping/mapping-utils";
import { formatMappingRule } from "./summary-utils";
import {
  SttmSheetDescriptionCell,
  SttmSheetSourceColumnCell,
  SttmSheetTransformRuleCell,
} from "./sttm-sheet-table-cells";

type SttmSheetTabProps = {
  mappings: MappingState[];
};

const DEFAULT_ROWS_PER_PAGE = 25;
const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

const STTM_SHEET_COLUMN_WIDTH = {
  index: 48,
  targetColumn: 168,
  transformRule: 140,
  sourceColumn: 300,
  type: 112,
  description: 320,
  status: 120,
} as const;

const STTM_SHEET_TABLE_MIN_WIDTH = Object.values(STTM_SHEET_COLUMN_WIDTH).reduce(
  (total, width) => total + width,
  0,
);

export function SttmSheetTab({ mappings }: SttmSheetTabProps) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);

  const paginatedMappings = useMemo(() => {
    const start = page * rowsPerPage;
    return mappings.slice(start, start + rowsPerPage);
  }, [mappings, page, rowsPerPage]);

  return (
    <AiaBox
      sx={{
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        bgcolor: "#fff",
      }}
    >
      <AiaTableContainer component={AiaPaper} elevation={0} sx={MAPPING_TABLE_CONTAINER_SX}>
        <AiaTablePrimitive stickyHeader size="small" sx={scrollableMappingTableSx(STTM_SHEET_TABLE_MIN_WIDTH)}>
          <colgroup>
            {Object.values(STTM_SHEET_COLUMN_WIDTH).map((columnWidth, index) => (
              <col key={`sttm-sheet-col-${index}`} style={{ width: columnWidth }} />
            ))}
          </colgroup>
          <AiaTableHead>
            <AiaTableRowPrimitive>
              <AiaTableCellPrimitive sx={{ ...MAPPING_TABLE_HEADER_CELL_SX, width: STTM_SHEET_COLUMN_WIDTH.index }}>
                #
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive sx={{ ...MAPPING_TABLE_HEADER_CELL_SX, minWidth: STTM_SHEET_COLUMN_WIDTH.targetColumn }}>
                Target Column
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive sx={{ ...MAPPING_TABLE_HEADER_CELL_SX, minWidth: STTM_SHEET_COLUMN_WIDTH.transformRule }}>
                Transform Rule
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive sx={{ ...MAPPING_TABLE_HEADER_CELL_SX, minWidth: STTM_SHEET_COLUMN_WIDTH.sourceColumn }}>
                Source Column
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive sx={{ ...MAPPING_TABLE_HEADER_CELL_SX, minWidth: STTM_SHEET_COLUMN_WIDTH.type }}>
                Type
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive sx={{ ...MAPPING_TABLE_HEADER_CELL_SX, minWidth: STTM_SHEET_COLUMN_WIDTH.description }}>
                Description
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive sx={{ ...MAPPING_TABLE_HEADER_CELL_SX, minWidth: STTM_SHEET_COLUMN_WIDTH.status }}>
                Status
              </AiaTableCellPrimitive>
            </AiaTableRowPrimitive>
          </AiaTableHead>
          <AiaTableBody>
            {paginatedMappings.map((row, index) => {
              const mapped = row.status === "MAPPED";
              const rule = formatMappingRule(row.rule);
              const previewType = row.sourceType ?? row.targetType ?? undefined;
              const sourceColumns =
                row.sourceColumns && row.sourceColumns.length
                  ? row.sourceColumns
                  : parseSourceColumns(row.sourceColumn);
              const autoDescription = generateMappingDescription({
                rule: row.rule || "Direct",
                sourceColumns,
                targetColumn: row.targetColumn,
                expression: row.expression,
              });
              const description = row.description ?? autoDescription ?? "";

              return (
                <AiaTableRowPrimitive key={row.id} sx={MAPPING_TABLE_ROW_SX}>
                  <MappingRowIndexCell
                    index={page * rowsPerPage + index + 1}
                    width={STTM_SHEET_COLUMN_WIDTH.index}
                    minWidth={STTM_SHEET_COLUMN_WIDTH.index}
                  />

                  <MappingTargetColumnCell
                    name={row.targetColumn}
                    showMappedIcon={false}
                    width={STTM_SHEET_COLUMN_WIDTH.targetColumn}
                    minWidth={STTM_SHEET_COLUMN_WIDTH.targetColumn}
                  />

                  <SttmSheetTransformRuleCell
                    rule={rule}
                    width={STTM_SHEET_COLUMN_WIDTH.transformRule}
                    minWidth={STTM_SHEET_COLUMN_WIDTH.transformRule}
                  />

                  <SttmSheetSourceColumnCell
                    value={row.sourceColumn}
                    sourceType={row.sourceType ?? row.targetType}
                    mapped={mapped}
                    width={STTM_SHEET_COLUMN_WIDTH.sourceColumn}
                    minWidth={STTM_SHEET_COLUMN_WIDTH.sourceColumn}
                  />

                  <MappingTypePreviewCell
                    dataType={previewType}
                    width={STTM_SHEET_COLUMN_WIDTH.type}
                    minWidth={STTM_SHEET_COLUMN_WIDTH.type}
                  />

                  <SttmSheetDescriptionCell
                    description={description}
                    width={STTM_SHEET_COLUMN_WIDTH.description}
                    minWidth={STTM_SHEET_COLUMN_WIDTH.description}
                  />

                  <MappingStatusCell
                    status={row.status}
                    width={STTM_SHEET_COLUMN_WIDTH.status}
                    minWidth={STTM_SHEET_COLUMN_WIDTH.status}
                    sx={{ overflow: "hidden" }}
                  />
                </AiaTableRowPrimitive>
              );
            })}
            {!paginatedMappings.length ? (
              <AiaTableRowPrimitive>
                <AiaTableCellPrimitive colSpan={7} sx={{ py: 4, textAlign: "center" }}>
                  <AiaText sx={{ fontSize: "0.82rem", color: "#64748b" }}>
                    No mapping rows to display.
                  </AiaText>
                </AiaTableCellPrimitive>
              </AiaTableRowPrimitive>
            ) : null}
          </AiaTableBody>
        </AiaTablePrimitive>
      </AiaTableContainer>

      <AiaTablePagination
        component="div"
        count={mappings.length}
        page={page}
        onPageChange={(_, nextPage) => setPage(nextPage)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(event) => {
          setRowsPerPage(Number.parseInt(event.target.value, 10));
          setPage(0);
        }}
        rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
        sx={MAPPING_TABLE_PAGINATION_SX}
      />
    </AiaBox>
  );
}
