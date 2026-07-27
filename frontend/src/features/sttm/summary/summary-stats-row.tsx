"use client";
import { AiaBox } from '@/components/ui';


import type { SummaryMetrics } from "./summary-utils";
import { SummaryInlineStats, SummaryTargetLabel } from "./summary-inline-stats";

type SummaryStatsRowProps = {
  metrics: SummaryMetrics;
  targetQualifiedName?: string | null;
};

export function SummaryStatsRow({ metrics, targetQualifiedName }: SummaryStatsRowProps) {
  return (
    <AiaBox
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
        px: 2,
        py: 0.85,
        borderBottom: "1px solid #e5e7eb",
        backgroundColor: "#fafafa",
        minWidth: 0,
        flexShrink: 0,
      }}
    >
      <SummaryInlineStats metrics={metrics} />
      <SummaryTargetLabel targetQualifiedName={targetQualifiedName} />
    </AiaBox>
  );
}
