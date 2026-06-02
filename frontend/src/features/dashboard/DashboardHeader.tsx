"use client";

import { Box, Typography } from "@mui/material";

export default function DashboardHeader() {
  return (
    <Box>
      <Typography
        className="font-semibold leading-[1.05] tracking-[-0.02em] text-[#111827]"
        sx={{ fontSize: "1.5rem" }}
      >
        Dashboard
      </Typography>
      <Typography className="mt-2 text-[15px] text-[#6B7280]">
        Source-to-Target Mapping overview for all projects
      </Typography>
    </Box>
  );
}
