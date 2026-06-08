"use client";

import { Box, Typography } from "@mui/material";

type BuilderHeaderStat = {
  value: number;
  label: string;
};

type BuilderHeaderStatsPillProps = {
  items: [BuilderHeaderStat, BuilderHeaderStat];
};

function StatSegment({ value, label }: BuilderHeaderStat) {
  return (
    <Typography
      component="span"
      sx={{ fontSize: "12px", whiteSpace: "nowrap", color: "#64748b", lineHeight: 1.2 }}
    >
      <Box component="span" sx={{ fontWeight: 700, color: "#111827" }}>
        {value}
      </Box>{" "}
      {label}
    </Typography>
  );
}

export function BuilderHeaderStatsPill({ items }: BuilderHeaderStatsPillProps) {
  return (
    <Box
      sx={{
        px: 1.5,
        py: 0.75,
        borderRadius: "999px",
        border: "1px solid #e5e7eb",
        backgroundColor: "#ffffff",
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        flexShrink: 0,
      }}
    >
      <StatSegment value={items[0].value} label={items[0].label} />
      <Typography component="span" sx={{ fontSize: "12px", color: "#cbd5e1", lineHeight: 1 }}>
        ·
      </Typography>
      <StatSegment value={items[1].value} label={items[1].label} />
    </Box>
  );
}
