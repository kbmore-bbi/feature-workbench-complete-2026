"use client";
import { Box, Paper, Typography } from "@mui/material";
import { AccountTreeRoundedIcon } from '@/utils/icons';

const mappings = [
    {
        title: "Salesforce Mapping v1",
        subtitle: "Created by data team",
    },
    {
        title: "CRM Migration Mapping v2",
        subtitle: "Updated 10 mins ago",
    },
    {
        title: "API Mapping v3",
        subtitle: "Created for review workflow",
    },
    {
        title: "API Mapping v4",
        subtitle: "Created to review workflow",
    },
];

export default function RecentMappingsPanel() {
    return (
        <Paper
            elevation={0}
            className="rounded-[20px] border border-[#EEF2F7] bg-white p-5"
        >
            <Typography className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
                Recent Mappings
            </Typography>

            <Box className="mt-4 flex flex-col gap-4">
                {mappings.map((item) => (
                    <Box key={item.title} className="flex items-start gap-3">
                        <Box className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border border-[#E5E7EB] bg-[#FAFBFC] text-[#111827]">
                            <AccountTreeRoundedIcon sx={{ fontSize: 16 }} />
                        </Box>

                        <Box className="min-w-0">
                            <Typography className="truncate text-[13px] font-medium text-[#111827]">
                                {item.title}
                            </Typography>
                            <Typography className="text-[11px] text-[#6B7280]">
                                {item.subtitle}
                            </Typography>
                        </Box>
                    </Box>
                ))}
            </Box>
        </Paper>
    );
}