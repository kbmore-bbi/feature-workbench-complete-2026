"use client";

import { useState } from "react";
import { Box, Typography } from "@mui/material";
import { AiaSearchbox } from "@/components/ui/aia-searchbox";

export default function DashboardHeader() {
    const [searchTerm, setSearchTerm] = useState("");

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

            <AiaSearchbox
                value={searchTerm}
                onChange={setSearchTerm}
                placeholder="Search projects..."
                fullWidth={false}
                sx={{
                    width: 240,
                    borderRadius: "999px",
                    backgroundColor: "#F5F7FA",
                    border: "1px solid transparent",
                    "&:focus-within": {
                        backgroundColor: "#ffffff",
                        borderColor: "#d1d5db",
                        boxShadow: "none",
                    },
                }}
            />
        </Box>
    );
}
