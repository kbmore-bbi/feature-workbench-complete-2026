"use client";

import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import { Box, InputBase, Paper, Typography } from "@mui/material";

export default function DashboardHeader() {
    return (
        <Box className="flex h-[84px] items-center justify-between border-b border-[#E8ECF4] px-6">
            <Box>
                <Typography className="text-[30px] font-semibold leading-none text-[#111827]">
                    Dashboard
                </Typography>
                <Typography className="mt-2 text-[14px] text-[#6B7280]">
                    Source-to-Target Mapping overview for all projects
                </Typography>
            </Box>

            <Paper
                elevation={0}
                className="flex h-[42px] w-[240px] items-center gap-2 rounded-full bg-[#F5F7FA] px-4"
            >
               
            </Paper>
        </Box>
    );
}