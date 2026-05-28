"use client";

import { Box, LinearProgress, Typography } from "@mui/material";

type MappingProgressIndicatorProps = {
  mappedCount: number;
  totalCount: number;
};

export function MappingProgressIndicator({ mappedCount, totalCount }: MappingProgressIndicatorProps) {
  const progressValue = totalCount > 0 ? (mappedCount / totalCount) * 100 : 0;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0, flexShrink: 0 }}>
      <Typography
        sx={{
          fontSize: "0.76rem",
          fontWeight: 700,
          color: "#111827",
          whiteSpace: "nowrap",
        }}
      >
        Mapping progress:
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        <Typography
          sx={{
            fontSize: "0.76rem",
            color: "#64748b",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {mappedCount}/{totalCount}
        </Typography>
        <LinearProgress
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
        <Typography sx={{ fontSize: "0.76rem", color: "#64748b", whiteSpace: "nowrap" }}>
          {totalCount > 0 ? `${Math.round(progressValue)}%` : "0%"}
        </Typography>
      </Box>
    </Box>
  );
}
