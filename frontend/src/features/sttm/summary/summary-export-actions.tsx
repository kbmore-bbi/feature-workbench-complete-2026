"use client";
import { Box, Button, Stack } from "@mui/material";
import { MappingProgressIndicator } from "@/features/sttm/shared/mapping-progress-indicator";
import { CodeRoundedIcon, TableChartOutlinedIcon } from '@/utils/icons';

type SummaryExportActionsProps = {
  onExportExcel?: () => void;
  onExportSql?: () => void;
  mappedCount?: number;
  totalCount?: number;
};

const exportButtonSx = {
  height: 30,
  minWidth: 0,
  px: 1.25,
  borderRadius: "8px",
  textTransform: "none",
  fontSize: "0.76rem",
  fontWeight: 600,
  backgroundColor: "#ffffff",
  border: "1px solid #e5e7eb",
  boxShadow: "none",
  "&:hover": {
    backgroundColor: "#f8fafc",
    borderColor: "#dbe2ea",
    boxShadow: "none",
  },
} as const;

export function SummaryExportActions({
  onExportExcel,
  onExportSql,
  mappedCount,
  totalCount,
}: SummaryExportActionsProps) {
  const showProgress = mappedCount !== undefined && totalCount !== undefined;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, flexWrap: "nowrap" }}>
      <Stack direction="row" spacing={0.75} sx={{ flexShrink: 0 }}>
        <Button
          variant="outlined"
          startIcon={<TableChartOutlinedIcon sx={{ fontSize: 16, color: "#16a34a" }} />}
          onClick={onExportExcel}
          sx={{
            ...exportButtonSx,
            color: "#166534",
          }}
        >
          Excel
        </Button>
        <Button
          variant="outlined"
          startIcon={<CodeRoundedIcon sx={{ fontSize: 16, color: "#2563eb" }} />}
          onClick={onExportSql}
          sx={{
            ...exportButtonSx,
            color: "#1d4ed8",
          }}
        >
          SQL
        </Button>
      </Stack>
      {showProgress ? (
        <MappingProgressIndicator mappedCount={mappedCount} totalCount={totalCount} />
      ) : null}
    </Box>
  );
}
