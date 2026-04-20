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
      <Box className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl border border-[#DCE3EC] bg-white text-[#111827]">
        {icon}
      </Box>

      <Typography className="text-[14px] font-medium text-[#4B5563]">
        {label}
      </Typography>

      <Typography className="mt-1 text-[42px] font-semibold leading-none text-[#111827]">
        {value}
      </Typography>
    </Paper>
  );
}