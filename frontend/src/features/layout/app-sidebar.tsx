"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AccountTreeRoundedIcon,
  AddRoundedIcon,
  DashboardRoundedIcon,
  FolderRoundedIcon,
  KeyboardArrowDownRoundedIcon,
  KeyboardDoubleArrowLeftRoundedIcon,
  KeyboardDoubleArrowRightRoundedIcon,
} from "@/utils/icons";
import { Box, Button, IconButton, Tooltip, Typography } from "@mui/material";
import NewMappingDialog from "@/features/dashboard/NewMappingDialog";
import type { AppNavItem } from "./app-sidebar-types";
import { APP_NAV_ROUTES, resolveAppNavItem } from "./app-sidebar-types";
import { useAppSidebar } from "./app-sidebar-context";

export const EXPANDED_APP_SIDEBAR_WIDTH = 260;
export const COLLAPSED_APP_SIDEBAR_WIDTH = 54;

const navItems: Array<{
  label: AppNavItem;
  href: string;
  icon: typeof DashboardRoundedIcon;
}> = [
  {
    label: "Dashboard",
    href: APP_NAV_ROUTES.Dashboard,
    icon: DashboardRoundedIcon,
  },
  {
    label: "Projects",
    href: APP_NAV_ROUTES.Projects,
    icon: FolderRoundedIcon,
  },
  {
    label: "Mappings",
    href: APP_NAV_ROUTES.Mappings,
    icon: AccountTreeRoundedIcon,
  },
];

type AppSidebarProps = {
  activeNav?: AppNavItem;
  initialNewMappingOpen?: boolean;
};

const sidebarToggleButtonSx = {
  width: 32,
  height: 32,
  p: 0,
  color: "#64748B",
  border: "1px solid #DBE2EA",
  borderRadius: "50%",
  backgroundColor: "#FFFFFF",
  "&:hover": {
    backgroundColor: "#F8FAFC",
  },
} as const;

type SidebarNavItemProps = {
  href: string;
  label: AppNavItem;
  icon: typeof DashboardRoundedIcon;
  isActive: boolean;
  collapsed: boolean;
};

function SidebarNavItem({ href, label, icon: Icon, isActive, collapsed }: SidebarNavItemProps) {
  const linkBody = (
    <Box
      className={`flex h-[42px] w-full items-center rounded-xl ${
        collapsed ? "justify-center px-0" : "px-3"
      }`}
      sx={{
        backgroundColor: isActive ? "#F8FAFC" : "transparent",
        "&:hover": {
          backgroundColor: isActive ? "#F8FAFC" : "#F9FAFB",
        },
      }}
    >
      <Box className={`flex min-w-0 items-center ${collapsed ? "justify-center" : "gap-3"}`}>
        <Icon
          sx={{
            fontSize: 18,
            color: isActive ? "#111827" : "#6B7280",
          }}
        />
        {!collapsed ? (
          <Typography
            className={`text-[14px] ${
              isActive ? "font-semibold text-[#111827]" : "font-medium text-[#374151]"
            }`}
          >
            {label}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );

  const link = (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      style={{
        textDecoration: "none",
        color: "inherit",
        display: "flex",
        width: "100%",
      }}
    >
      {linkBody}
    </Link>
  );

  if (!collapsed) {
    return link;
  }

  return (
    <Tooltip title={label} placement="right">
      <Box component="span" sx={{ display: "inline-flex", width: "100%" }}>
        {link}
      </Box>
    </Tooltip>
  );
}

export default function AppSidebar({
  activeNav,
  initialNewMappingOpen = false,
}: AppSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { collapsed, setCollapsed, hydrated } = useAppSidebar();
  const [isNewMappingOpen, setIsNewMappingOpen] = useState(initialNewMappingOpen);

  const currentNav = activeNav ?? resolveAppNavItem(pathname);
  const sidebarWidth = collapsed ? COLLAPSED_APP_SIDEBAR_WIDTH : EXPANDED_APP_SIDEBAR_WIDTH;

  return (
    <>
      <Box
        sx={{
          display: "flex",
          width: hydrated ? sidebarWidth : EXPANDED_APP_SIDEBAR_WIDTH,
          minWidth: hydrated ? sidebarWidth : EXPANDED_APP_SIDEBAR_WIDTH,
          flexShrink: 0,
          flexDirection: "column",
          height: "100%",
          minHeight: 0,
          borderRight: "1px solid #E8ECF4",
          backgroundColor: "#FFFFFF",
          transition: hydrated ? "width 160ms ease, min-width 160ms ease" : "none",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            px: collapsed ? 1 : 2.5,
            py: collapsed ? 2 : 3,
            overflow: "hidden",
          }}
        >
          {!collapsed ? (
            <Box className="flex h-[38px] items-center justify-between rounded-full bg-[#F3F4F6] px-4">
              <Typography className="text-[13px] font-medium text-[#111827]">Cortex</Typography>
              <KeyboardArrowDownRoundedIcon sx={{ fontSize: 18, color: "#4B5563" }} />
            </Box>
          ) : null}

          <Box className="flex flex-col gap-1" sx={{ mt: collapsed ? 0 : 4 }}>
            {navItems.map((item) => (
              <SidebarNavItem
                key={item.label}
                href={item.href}
                label={item.label}
                icon={item.icon}
                isActive={currentNav === item.label}
                collapsed={collapsed}
              />
            ))}
          </Box>

          <Box sx={{ mt: 2, display: "flex", justifyContent: collapsed ? "center" : "stretch" }}>
            {collapsed ? (
              <Tooltip title="New Mapping" placement="right">
                <IconButton
                  aria-label="New Mapping"
                  onClick={() => setIsNewMappingOpen(true)}
                  sx={{
                    width: 36,
                    height: 36,
                    bgcolor: "#111827",
                    color: "#FFFFFF",
                    border: "1px solid #111827",
                    "&:hover": {
                      bgcolor: "#1F2937",
                      borderColor: "#1F2937",
                    },
                  }}
                >
                  <AddRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            ) : (
              <Button
                variant="contained"
                fullWidth
                startIcon={<AddRoundedIcon sx={{ fontSize: 18, color: "#FFFFFF" }} />}
                onClick={() => setIsNewMappingOpen(true)}
                sx={{
                  bgcolor: "#111827",
                  color: "#FFFFFF",
                  border: "1px solid #111827",
                  textTransform: "none",
                  py: 1.25,
                  borderRadius: "10px",
                  fontWeight: 700,
                  fontSize: "0.875rem",
                  boxShadow: "none",
                  "&:hover": {
                    bgcolor: "#1F2937",
                    borderColor: "#1F2937",
                    boxShadow: "none",
                  },
                }}
              >
                New Mapping
              </Button>
            )}
          </Box>
        </Box>

        <Box
          sx={{
            px: collapsed ? 1 : 1.5,
            py: 1,
            display: "flex",
            justifyContent: collapsed ? "center" : "flex-start",
            alignItems: "center",
            flexShrink: 0,
            borderTop: "1px solid #EEF2F7",
            backgroundColor: "#FFFFFF",
          }}
        >
          {collapsed ? (
            <Tooltip title="Expand sidebar" placement="right">
              <IconButton
                aria-label="Expand sidebar"
                onClick={() => setCollapsed(false)}
                sx={sidebarToggleButtonSx}
              >
                <KeyboardDoubleArrowRightRoundedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          ) : (
            <IconButton
              aria-label="Collapse sidebar"
              onClick={() => setCollapsed(true)}
              sx={sidebarToggleButtonSx}
            >
              <KeyboardDoubleArrowLeftRoundedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          )}
        </Box>
      </Box>

      <NewMappingDialog
        open={isNewMappingOpen}
        onClose={() => {
          setIsNewMappingOpen(false);
          if (initialNewMappingOpen) {
            router.replace(APP_NAV_ROUTES.Dashboard);
          }
        }}
        onBuildManually={() => {
          setIsNewMappingOpen(false);
          router.push("/sttm/builder/new");
        }}
      />
    </>
  );
}
