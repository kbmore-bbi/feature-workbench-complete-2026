"use client";
import { AiaBox, AiaButton, AiaCircularProgress, AiaStack } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import {
  CodeRoundedIcon,
  FileUploadOutlinedIcon,
  TableChartOutlinedIcon,
} from "@/utils/icons";
import { MappingProgressIndicator } from "@/features/sttm/shared/mapping-progress-indicator";
import { TOUR_TARGETS } from "@/features/tour/constants/tour-targets";

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

const SUCCESS_OUTLINED_BUTTON_PROPS = {
  customBorderColor: "var(--aia-state-success-color)",
  customColor: "var(--aia-state-success-color)",
  customHoverBackgroundColor: "var(--aia-state-success-hover-bg)",
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
    <AiaBox sx={{ display: "flex", alignItems: "center", gap: 1.25, flexWrap: "nowrap" }}>
      <AiaStack direction="row" spacing={0.75} sx={{ flexShrink: 0 }}>
        <AiaButton
          data-tour={TOUR_TARGETS.sttmSummaryExcel}
          variant="outlined"
          size="small"
          {...SUCCESS_OUTLINED_BUTTON_PROPS}
          startIcon={
            excelLoading ? (
              <AiaCircularProgress size={14} color="inherit" />
            ) : (
              <TableChartOutlinedIcon />
            )
          }
          onClick={onExportExcel}
          disabled={excelLoading || sqlLoading}
        >
          {excelLabel}
        </AiaButton>
        <AiaButton
          data-tour={TOUR_TARGETS.sttmSummarySql}
          variant="outlined"
          size="small"
          {...SUCCESS_OUTLINED_BUTTON_PROPS}
          startIcon={
            sqlLoading ? (
              <AiaCircularProgress size={14} color="inherit" />
            ) : (
              <CodeRoundedIcon />
            )
          }
          onClick={onExportSql}
          disabled={excelLoading || sqlLoading}
        >
          {sqlLabel}
        </AiaButton>
        <AiaButton
          data-tour={TOUR_TARGETS.sttmSummaryPushToGit}
          variant="outlined"
          size="small"
          {...SUCCESS_OUTLINED_BUTTON_PROPS}
          startIcon={
            gitLoading ? (
              <AiaCircularProgress size={14} color="inherit" />
            ) : (
              <FileUploadOutlinedIcon />
            )
          }
          onClick={onPushToGit}
          disabled={excelLoading || sqlLoading || gitLoading}
        >
          {gitLabel}
        </AiaButton>
      </AiaStack>
      {excelLoading ? (
        <AiaText sx={{ fontSize: "0.72rem", color: "#64748b", minWidth: 210 }}>
          Building workbook and preparing the download...
        </AiaText>
      ) : null}
      {showProgress ? (
        <MappingProgressIndicator mappedCount={mappedCount} totalCount={totalCount} />
      ) : null}
    </AiaBox>
  );
}
