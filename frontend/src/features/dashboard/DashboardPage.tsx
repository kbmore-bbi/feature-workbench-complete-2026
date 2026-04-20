
"use client";

import { Box, Paper } from "@mui/material";
import DashboardSidebar from "./DashboardSidebar";
import DashboardHeader from "./DashboardHeader";
import DashboardStats from "./DashboardStats";
import QuickStatsPanel from "./QuickStatsPanel";
import RecentMappingsPanel from "./RecentMappingsPanel";

export default function DashboardPage() {
    return (
        <Box className="min-h-screen bg-[#F7F8FA] p-4 md:p-6">
            <Paper
                elevation={0}
                className="mx-auto flex min-h-[calc(100vh-32px)] max-w-[1600px] overflow-hidden rounded-[24px] border border-[#E8ECF4] bg-white"
            >
                <DashboardSidebar />

                <Box className="flex min-w-0 flex-1 flex-col">
                    <DashboardHeader />

                    <Box className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-5">
                        <DashboardStats />

                        <Box className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[1.25fr_0.9fr]">
                            <QuickStatsPanel />
                            <RecentMappingsPanel />
                        </Box>

                        <Box className="mt-auto pt-8">
                        </Box>
                    </Box>
                </Box>
            </Paper>
        </Box>
    );
}












