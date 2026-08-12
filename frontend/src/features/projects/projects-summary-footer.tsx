"use client";
import { AiaBox } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { TOUR_TARGETS } from '@/features/tour/constants/tour-targets';

type ProjectsSummaryFooterProps = {
  projectCount: number;
  totalMappings: number;
  complete: number;
  inProgress: number;
};

type SummaryItemProps = {
  value: number;
  label: string;
};

function SummaryItem({ value, label }: SummaryItemProps) {
  return (
    <AiaBox sx={{ display: "flex", alignItems: "baseline", gap: 0.75 }}>
      <AiaText
        component="span"
        sx={{ fontSize: 13, fontWeight: 700, color: "#111827", lineHeight: 1 }}
      >
        {value}
      </AiaText>
      <AiaText
        component="span"
        sx={{ fontSize: 13, fontWeight: 400, color: "#9CA3AF", lineHeight: 1 }}
      >
        {label}
      </AiaText>
    </AiaBox>
  );
}

export default function ProjectsSummaryFooter({
  projectCount,
  totalMappings,
  complete,
  inProgress,
}: ProjectsSummaryFooterProps) {
  return (
    <AiaBox
      data-tour={TOUR_TARGETS.projectsSummaryFooter}
      sx={{
        mt: "auto",
        px: { xs: 2.5, md: 3.5 },
        py: 1.5,
        borderTop: "1px solid #E5E7EB",
        bgcolor: "#FFFFFF",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 4,
      }}
    >
      <SummaryItem value={projectCount} label="Projects" />
      <SummaryItem value={totalMappings} label="Total Mappings" />
      <SummaryItem value={complete} label="Complete" />
      <SummaryItem value={inProgress} label="In Progress" />
    </AiaBox>
  );
}
