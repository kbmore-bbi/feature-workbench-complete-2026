"use client";

import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import UploadRoundedIcon from "@mui/icons-material/UploadRounded";
import CircularProgress from "@mui/material/CircularProgress";
import { Box, Button, Stack, Typography } from "@mui/material";
import { MappingProgressIndicator } from "@/features/sttm/shared/mapping-progress-indicator";

type SummaryExportActionsProps = {
  onExportExcel?: () => void;
  onExportSql?: () => void;
  onPushToGit?: () => void;
  mappedCount?: number;
  totalCount?: number;
  excelLoading?: boolean;
  excelLabel?: string;
  gitLoading?: boolean;
  gitLabel?: string;
  sqlLoading?: boolean;
  sqlLabel?: string;
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
  onPushToGit,
  mappedCount,
  totalCount,
  excelLoading = false,
  excelLabel = "Download Excel",
  gitLoading = false,
  gitLabel = "Push to Git",
  sqlLoading = false,
  sqlLabel = "Download SQL",
}: SummaryExportActionsProps) {
  const showProgress = mappedCount !== undefined && totalCount !== undefined;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, flexWrap: "nowrap" }}>
      <Stack direction="row" spacing={0.75} sx={{ flexShrink: 0 }}>
        <Button
          variant="outlined"
          startIcon={
            excelLoading ? (
              <CircularProgress size={14} sx={{ color: "#16a34a" }} />
            ) : (
              <DownloadRoundedIcon sx={{ fontSize: 16, color: "#16a34a" }} />
            )
          }
          onClick={onExportExcel}
          disabled={excelLoading || sqlLoading}
          sx={{
            ...exportButtonSx,
            color: "#166534",
          }}
        >
          {excelLabel}
        </Button>
        <Button
          variant="outlined"
          startIcon={
            sqlLoading ? (
              <CircularProgress size={14} sx={{ color: "#2563eb" }} />
            ) : (
              <DownloadRoundedIcon sx={{ fontSize: 16, color: "#2563eb" }} />
            )
          }
          onClick={onExportSql}
          disabled={excelLoading || sqlLoading}
          sx={{
            ...exportButtonSx,
            color: "#1d4ed8",
          }}
        >
          {sqlLabel}
        </Button>
        <Button
          variant="outlined"
          startIcon={
            gitLoading ? (
              <CircularProgress size={14} sx={{ color: "#7c3aed" }} />
            ) : (
              <UploadRoundedIcon sx={{ fontSize: 16, color: "#7c3aed" }} />
            )
          }
          onClick={onPushToGit}
          disabled={excelLoading || sqlLoading || gitLoading}
          sx={{
            ...exportButtonSx,
            color: "#6d28d9",
          }}
        >
          {gitLabel}
        </Button>
      </Stack>
      {excelLoading ? (
        <Typography sx={{ fontSize: "0.72rem", color: "#64748b", minWidth: 210 }}>
          Building workbook and preparing the download...
        </Typography>
      ) : null}
      {showProgress ? (
        <MappingProgressIndicator mappedCount={mappedCount} totalCount={totalCount} />
      ) : null}
    </Box>
  );
}
