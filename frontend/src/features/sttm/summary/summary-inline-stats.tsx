"use client";

import { Box, Typography } from "@mui/material";
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
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.65,
        lineHeight: 1,
      }}
    >
      <Box
        sx={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          bgcolor: color,
          flexShrink: 0,
        }}
      />
      <Typography
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
      </Typography>
    </Box>
  );
}

export function SummaryInlineStats({ metrics }: { metrics: SummaryMetrics }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.75, flexWrap: "wrap" }}>
      <StatDot color="#22c55e" count={metrics.mappedCount} suffix="mapped" />
      <StatDot color="#f59e0b" count={metrics.unmappedCount} suffix="unmapped" />
      <StatDot color="#3b82f6" count={metrics.totalCount} suffix="total columns" />
    </Box>
  );
}

export function SummaryTargetLabel({ targetQualifiedName }: { targetQualifiedName?: string | null }) {
  if (!targetQualifiedName) {
    return null;
  }

  return (
    <Typography sx={{ fontSize: "0.76rem", color: "#64748b", whiteSpace: "nowrap" }}>
      <Box component="span" sx={{ fontWeight: 500 }}>
        Target:
      </Box>{" "}
      {targetQualifiedName}
    </Typography>
  );
}
