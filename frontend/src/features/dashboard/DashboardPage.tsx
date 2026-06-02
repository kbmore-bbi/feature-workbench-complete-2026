"use client";

import { Box } from "@mui/material";
import DashboardStats from "./DashboardStats";
import QuickStatsPanel from "./QuickStatsPanel";
import RecentMappingsPanel from "./RecentMappingsPanel";
import DashboardHeader from "./DashboardHeader";

type DashboardPageProps = {
  initialNewMappingOpen?: boolean;
};

export default function DashboardPage(_props: DashboardPageProps) {
  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        px: 3,
        py: 2.5,
      }}
    >
      <DashboardHeader />

      <Box className="mt-6">
        <DashboardStats />
      </Box>

      <Box className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_1fr]">
        <QuickStatsPanel />
        <RecentMappingsPanel />
      </Box>
    </Box>
  );
}
