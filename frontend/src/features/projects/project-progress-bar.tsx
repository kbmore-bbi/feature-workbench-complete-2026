"use client";

import { Box, Typography } from "@mui/material";

type ProjectProgressBarProps = {
  label?: string;
  percent: number;
  barColor: string;
};

export default function ProjectProgressBar({
  label = "Avg. mapping coverage",
  percent,
  barColor,
}: ProjectProgressBarProps) {
  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.75 }}>
        <Typography sx={{ fontSize: 11, color: "#94A3B8" }}>{label}</Typography>
        <Typography sx={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>{percent}%</Typography>
      </Box>
      <Box
        sx={{
          height: 5,
          borderRadius: "999px",
          bgcolor: "#E5E7EB",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            width: `${percent}%`,
            height: "100%",
            borderRadius: "999px",
            bgcolor: barColor,
          }}
        />
      </Box>
    </Box>
  );
}
