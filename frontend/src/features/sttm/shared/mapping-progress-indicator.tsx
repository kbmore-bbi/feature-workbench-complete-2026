"use client";
import { AiaBox, AiaLinearProgress } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { TOUR_TARGETS } from '@/features/tour/constants/tour-targets';

type MappingProgressIndicatorProps = {
  mappedCount: number;
  totalCount: number;
};

export function MappingProgressIndicator({ mappedCount, totalCount }: MappingProgressIndicatorProps) {
  const progressValue = totalCount > 0 ? (mappedCount / totalCount) * 100 : 0;

  return (
    <AiaBox
      data-tour={TOUR_TARGETS.sttmMappingProgress}
      sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0, flexShrink: 0 }}
    >
      <AiaText
        sx={{
          fontSize: "0.76rem",
          fontWeight: 700,
          color: "#111827",
          whiteSpace: "nowrap",
        }}
      >
        Mapping progress:
      </AiaText>
      <AiaBox sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        <AiaText
          sx={{
            fontSize: "0.76rem",
            color: "#64748b",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {mappedCount}/{totalCount} rows
        </AiaText>
        <AiaLinearProgress
          variant="determinate"
          value={progressValue}
          sx={{
            width: 120,
            height: 6,
            borderRadius: 999,
            backgroundColor: "#e5e7eb",
            "& .MuiLinearProgress-bar": {
              borderRadius: 999,
              backgroundColor: "#f59e0b",
            },
          }}
        />
        <AiaText sx={{ fontSize: "0.76rem", color: "#64748b", whiteSpace: "nowrap" }}>
          {totalCount > 0 ? `${Math.round(progressValue)}%` : "0%"}
        </AiaText>
      </AiaBox>
    </AiaBox>
  );
}
