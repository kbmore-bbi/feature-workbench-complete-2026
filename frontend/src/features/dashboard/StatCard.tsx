"use client";

import { Box, Paper, Typography } from "@mui/material";
import type { ReactNode } from "react";

type StatCardProps = {
  icon: ReactNode;
  label: string;
  value: string | number;
};

export default function StatCard({ icon, label, value }: StatCardProps) {
  return (
    <Paper
      elevation={0}
      className="rounded-[20px] border border-[#EEF2F7] bg-[#FAFBFC] px-5 py-4"
    >
      <Box className="flex items-center justify-between gap-3">
        <Typography
          sx={{
            fontSize: "48px",
            fontWeight: 600,
            lineHeight: 1,
            color: "#111827",
          }}
        >
          {value}
        </Typography>

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            p: 1.25,
            borderRadius: "12px",
            border: "1px solid #DCE3EC",
            bgcolor: "#FFFFFF",
            color: "#111827",
          }}
        >
          {icon}
        </Box>
      </Box>

      <Typography
        sx={{
          mt: 3,
          fontSize: "14px",
          fontWeight: 500,
          color: "#4B5563",
        }}
      >
        {label}
      </Typography>
    </Paper>
  );
}
