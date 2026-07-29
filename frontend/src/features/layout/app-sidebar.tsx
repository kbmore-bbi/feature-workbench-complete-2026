"use client";
import { AiaBox, AiaIconButton, AiaTooltip } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AccountTreeRoundedIcon,
  AdminPanelSettingsRoundedIcon,
  DashboardRoundedIcon,
  FolderRoundedIcon,
  KeyboardDoubleArrowLeftRoundedIcon,
  KeyboardDoubleArrowRightRoundedIcon,
} from "@/utils/icons";
import NewMappingDialog from "@/features/dashboard/NewMappingDialog";
import type { AppNavItem } from "./app-sidebar-types";
import { APP_NAV_ROUTES, resolveAppNavItem } from "./app-sidebar-types";
import { useAppSidebar } from "./app-sidebar-context";
import { SIDEBAR_NAV_TOKENS } from "@/config/sidebar-nav-tokens";
import { TOUR_TARGETS } from "@/features/tour/constants/tour-targets";
import { useAppDispatch } from "@/store/hooks";
import { resetBuilderForNewMapping } from "@/features/sttm/store/sttm-builder-slice";
import { markExplicitNewDraftIntent } from "@/features/sttm/context/sttm-session-intent";

export const EXPANDED_APP_SIDEBAR_WIDTH = 260;
export const COLLAPSED_APP_SIDEBAR_WIDTH = 70;

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
    label: "Administration",
    href: APP_NAV_ROUTES.Administration,
    icon: AdminPanelSettingsRoundedIcon,
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
    <AiaBox
      className={`flex w-full items-center rounded-xl ${
        collapsed ? "justify-center px-0" : ""
      }`}
      sx={{
        height: "var(--aia-sidebar-nav-item-height)",
        px: collapsed ? 0 : "var(--aia-sidebar-nav-padding-x)",
        backgroundColor: isActive ? "#F8FAFC" : "transparent",
        "&:hover": {
          backgroundColor: isActive ? "#F8FAFC" : "#F9FAFB",
        },
      }}
    >
      <AiaBox
        className={`flex min-w-0 items-center ${collapsed ? "justify-center" : ""}`}
        sx={{ gap: collapsed ? 0 : "var(--aia-sidebar-nav-icon-gap)" }}
      >
        <Icon
          sx={{
            fontSize: "var(--aia-sidebar-nav-icon-size)",
            color: isActive
              ? "var(--aia-sidebar-nav-active-icon-color)"
              : "var(--aia-sidebar-nav-icon-color)",
          }}
        />
        {!collapsed ? (
          <AiaText
            sx={{
              fontSize: "var(--aia-sidebar-nav-font-size)",
              fontWeight: SIDEBAR_NAV_TOKENS.fontWeight,
              lineHeight: "var(--aia-sidebar-nav-line-height)",
              color: isActive
                ? "var(--aia-sidebar-nav-active-text-color)"
                : "var(--aia-sidebar-nav-text-color)",
            }}
          >
            {label}
          </AiaText>
        ) : null}
      </AiaBox>
    </AiaBox>
  );

  const dataTour =
    label === "Dashboard"
      ? TOUR_TARGETS.sidebarDashboard
      : label === "Projects"
        ? TOUR_TARGETS.sidebarProjects
        : TOUR_TARGETS.sidebarMappings;

  const link = (
    <Link
      href={href}
      data-tour={dataTour}
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
    <AiaTooltip title={label} placement="right" arrow>
      <AiaBox component="span" sx={{ display: "inline-flex", width: "100%" }}>
        {link}
      </AiaBox>
    </AiaTooltip>
  );
}

export default function AppSidebar({
  activeNav,
  initialNewMappingOpen = false,
}: AppSidebarProps) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const pathname = usePathname();
  const { collapsed, setCollapsed, hydrated } = useAppSidebar();
  const [isNewMappingOpen, setIsNewMappingOpen] = useState(initialNewMappingOpen);

  const currentNav = activeNav ?? resolveAppNavItem(pathname);
  const sidebarWidth = collapsed ? COLLAPSED_APP_SIDEBAR_WIDTH : EXPANDED_APP_SIDEBAR_WIDTH;

  return (
    <>
      <AiaBox
        data-tour={TOUR_TARGETS.sidebar}
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
        <AiaBox
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: collapsed ? "center" : "stretch",
            px: collapsed ? 0 : 2.5,
            py: collapsed ? 2 : 3,
            overflow: "hidden",
            width: "100%",
          }}
        >
          <AiaBox className="flex flex-col gap-1">
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
          </AiaBox>

        </AiaBox>

        <AiaBox
          sx={{
            px: collapsed ? 0 : 1.5,
            py: 1,
            display: "flex",
            justifyContent: collapsed ? "center" : "flex-start",
            width: "100%",
            alignItems: "center",
            flexShrink: 0,
            borderTop: "1px solid #EEF2F7",
            backgroundColor: "#FFFFFF",
          }}
        >
          {collapsed ? (
            <AiaTooltip title="Expand sidebar" placement="right" arrow>
              <AiaIconButton
                aria-label="Expand sidebar"
                onClick={() => setCollapsed(false)}
                sx={sidebarToggleButtonSx}
              >
                <KeyboardDoubleArrowRightRoundedIcon sx={{ fontSize: 18 }} />
              </AiaIconButton>
            </AiaTooltip>
          ) : (
            <AiaIconButton
              aria-label="Collapse sidebar"
              onClick={() => setCollapsed(true)}
              sx={sidebarToggleButtonSx}
            >
              <KeyboardDoubleArrowLeftRoundedIcon sx={{ fontSize: 18 }} />
            </AiaIconButton>
          )}
        </AiaBox>
      </AiaBox>

      <NewMappingDialog
        open={isNewMappingOpen}
        onClose={() => {
          setIsNewMappingOpen(false);
          if (initialNewMappingOpen) {
            router.replace(APP_NAV_ROUTES.Dashboard);
          }
        }}
        onBuildManually={(details) => {
          setIsNewMappingOpen(false);
          markExplicitNewDraftIntent();
          dispatch(resetBuilderForNewMapping());
          const query = details.projectId
            ? `?project_id=${encodeURIComponent(details.projectId)}`
            : "";
          router.push(`/sttm/builder/new${query}`);
        }}
      />
    </>
  );
}
