"use client";

import { Box, TablePagination, Typography } from "@mui/material";
import { MAPPINGS_BORDER_RADIUS } from "./mappings-ui-styles";

type MappingsTableFooterProps = {
  total: number;
  complete: number;
  partial: number;
  draft: number;
  page: number;
  rowsPerPage: number;
  filteredCount: number;
  onPageChange: (page: number) => void;
  onRowsPerPageChange: (rowsPerPage: number) => void;
};

type SummaryItemProps = {
  value: number;
  label: string;
  valueColor?: string;
};

function SummaryItem({ value, label, valueColor = "#111827" }: SummaryItemProps) {
  return (
    <Box className="flex items-baseline gap-1">
      <Typography
        component="span"
        sx={{ fontSize: "13px", fontWeight: 700, color: valueColor, lineHeight: 1 }}
      >
        {value}
      </Typography>
      <Typography
        component="span"
        sx={{ fontSize: "13px", fontWeight: 400, color: "#9CA3AF", lineHeight: 1 }}
      >
        {label}
      </Typography>
    </Box>
  );
}

export default function MappingsTableFooter({
  total,
  complete,
  partial,
  draft,
  page,
  rowsPerPage,
  filteredCount,
  onPageChange,
  onRowsPerPageChange,
}: MappingsTableFooterProps) {
  return (
    <Box
      sx={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
        px: 2,
        py: 1.25,
        borderTop: "1px solid #E5E7EB",
        backgroundColor: "#FAFBFC",
        borderBottomLeftRadius: MAPPINGS_BORDER_RADIUS,
        borderBottomRightRadius: MAPPINGS_BORDER_RADIUS,
      }}
    >
      <Box className="flex flex-wrap items-center gap-5">
        <SummaryItem value={total} label="Total" />
        <SummaryItem value={complete} label="Complete" valueColor="#16A34A" />
        <SummaryItem value={partial} label="Partial" valueColor="#EA580C" />
        <SummaryItem value={draft} label="Draft" />
      </Box>

      <TablePagination
        component="div"
        count={filteredCount}
        page={page}
        onPageChange={(_, nextPage) => onPageChange(nextPage)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(event) => {
          onRowsPerPageChange(Number.parseInt(event.target.value, 10));
          onPageChange(0);
        }}
        rowsPerPageOptions={[5, 10, 25]}
        sx={{
          m: 0,
          ml: "auto",
          ".MuiTablePagination-toolbar": {
            minHeight: 32,
            px: 0,
          },
          ".MuiTablePagination-selectLabel, .MuiTablePagination-displayedRows": {
            fontSize: "12px",
            color: "#64748B",
            m: 0,
          },
          ".MuiTablePagination-select": {
            fontSize: "12px",
          },
          ".MuiTablePagination-actions .MuiIconButton-root": {
            p: 0.5,
          },
        }}
      />
    </Box>
  );
}
