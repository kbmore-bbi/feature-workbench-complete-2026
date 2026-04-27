"use client";

import { Box, Paper, Typography } from "@mui/material";

const quickStats = [
    { label: "Completion Rate", value: 48, color: "#6B7280" },
    { label: "Published", value: 62, color: "#6B7280" },
    { label: "In Progress", value: 23, color: "#F97316" },
];

export default function QuickStatsPanel() {
    return (
        <Paper
            elevation={0}
            className="rounded-[20px] border border-[#EEF2F7] bg-white p-5"
        >
            <Typography className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
                Quick Stats
            </Typography>

            <Box className="mt-5 flex flex-col gap-5">
                {quickStats.map((item) => (
                    <Box key={item.label}>
                        <Box className="mb-2 flex items-center justify-between">
                            <Typography className="text-[13px] font-medium text-[#4B5563]">
                                {item.label}
                            </Typography>
                            <Typography className="text-[12px] font-semibold text-[#111827]">
                                {item.value}%
                            </Typography>
                        </Box>

                        <Box className="h-[6px] rounded-full bg-[#ECEFF3]">
                            <Box
                                className="h-[6px] rounded-full"
                                sx={{
                                    width: `${item.value}%`,
                                    backgroundColor: item.color,
                                }}
                            />
                        </Box>
                    </Box>
                ))}
            </Box>
        </Paper>
    );
}