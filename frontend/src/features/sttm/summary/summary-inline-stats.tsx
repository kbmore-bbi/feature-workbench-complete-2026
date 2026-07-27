"use client";
import { AiaBox } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import type { SummaryMetrics } from "./summary-utils";

function StatDot({
  color,
  count,
  suffix,
}: {
  color: string;
  count: number;
  suffix: string;
}) {
  return (
    <AiaBox
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.65,
        lineHeight: 1,
      }}
    >
      <AiaBox
        sx={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          bgcolor: color,
          flexShrink: 0,
        }}
      />
      <AiaText
        component="span"
        sx={{
          fontSize: "0.76rem",
          fontWeight: 500,
          whiteSpace: "nowrap",
          lineHeight: 1,
          color,
        }}
      >
        {count} {suffix}
      </AiaText>
    </AiaBox>
  );
}

export function SummaryInlineStats({ metrics }: { metrics: SummaryMetrics }) {
  return (
    <AiaBox sx={{ display: "flex", alignItems: "center", gap: 1.75, flexWrap: "wrap" }}>
      <StatDot color="#22c55e" count={metrics.mappedCount} suffix="mapped" />
      <StatDot color="#f59e0b" count={metrics.unmappedCount} suffix="unmapped" />
      <StatDot color="#3b82f6" count={metrics.totalCount} suffix="total columns" />
    </AiaBox>
  );
}

export function SummaryTargetLabel({ targetQualifiedName }: { targetQualifiedName?: string | null }) {
  if (!targetQualifiedName) {
    return null;
  }

  return (
    <AiaText sx={{ fontSize: "0.76rem", color: "#64748b", whiteSpace: "nowrap" }}>
      <AiaBox component="span" sx={{ fontWeight: 500 }}>
        Target:
      </AiaBox>{" "}
      {targetQualifiedName}
    </AiaText>
  );
}
