"use client";

import { Box, Paper } from "@mui/material";
import AppHeader from "@/components/layout/AppHeader";
import DashboardSidebar from "./DashboardSidebar";
import DashboardStats from "./DashboardStats";
import QuickStatsPanel from "./QuickStatsPanel";
import RecentMappingsPanel from "./RecentMappingsPanel";
import DashboardHeader from "./DashboardHeader";

export default function DashboardPage() {
    return (
        <Box className="h-screen overflow-hidden bg-[#F7F8FA]">
            <Paper
                elevation={0}
                className="mx-auto flex min-h-[calc(100vh-32px)] max-w-[1600px] flex-col overflow-hidden rounded-[24px] border border-[#E8ECF4] bg-white"
            >
                <AppHeader />

                <Box className="flex min-h-0 flex-1">
                    <DashboardSidebar />

                    <Box className="flex min-w-0 flex-1 flex-col px-6 py-5">
                        <DashboardHeader />

                        <Box className="mt-6">
                            <DashboardStats />
                        </Box>

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
