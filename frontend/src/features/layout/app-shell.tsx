"use client";

import { Box } from "@mui/material";
import AppSidebar from "./app-sidebar";
import type { AppNavItem } from "./app-sidebar-types";

type AppShellProps = {
  activeNav?: AppNavItem;
  initialNewMappingOpen?: boolean;
  children: React.ReactNode;
};

export default function AppShell({
  activeNav,
  initialNewMappingOpen = false,
  children,
}: AppShellProps) {
  return (
    <Box
      sx={{
        display: "flex",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
        bgcolor: "#F7F8FA",
      }}
    >
      <AppSidebar activeNav={activeNav} initialNewMappingOpen={initialNewMappingOpen} />
      <Box
        component="main"
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
