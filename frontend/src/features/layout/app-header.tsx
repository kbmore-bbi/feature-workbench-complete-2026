"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import { Avatar, Box, IconButton, Menu, MenuItem, Switch, Tooltip, Typography } from "@mui/material";
import { useThemeMode } from "@/app/Providers";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authService } from "@/services/authService";
import type { UserSession } from "@/types/user";
import { CLIENT_CONFIG as config } from "@/config/client.config";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import BuilderContentHeader from "@/features/sttm/layout/builder-content-header";
import {
  evaluateAssistantSignals,
  updateAssistantPreferences as updateAssistantPreferencesThunk,
} from "@/features/sttm/store/sttm-builder-slice";

type AppHeaderProps = {
  userName?: string;
  role?: string;
};

export default function AppHeader({
  userName = "Shane Watson",
  role = "Publisher",
}: AppHeaderProps) {
  const { mode, toggleMode } = useThemeMode();
  const [session, setSession] = useState<UserSession | null>(null);
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [settingsAnchorEl, setSettingsAnchorEl] = useState<HTMLElement | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { sources, targets, mappings, derivedSources, relationships, assistantPreferences } = useAppSelector((state) => state.sttmBuilder);

  useEffect(() => {
    let cancelled = false;

    authService
      .getSession()
      .then((response) => {
        if (!cancelled) {
          setSession(response);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSession(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const resolvedUserName = session?.display_name?.trim() || session?.email || userName;
  const resolvedRole = session?.app_persona
    ? `${session.app_persona.charAt(0)}${session.app_persona.slice(1).toLowerCase()}`
    : role;

  const initials = resolvedUserName
    .split(" ")
    .map((item) => item[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const isMappingPage = pathname.includes("/mapping");
  const isSummaryPage = pathname.includes("/summary");
  const currentAssistantPage: "builder" | "mapping" | "summary" = isSummaryPage
    ? "summary"
    : isMappingPage
      ? "mapping"
      : "builder";
  const currentAssistantSurface: "SOURCE_SELECTION" | "MAPPING" =
    currentAssistantPage === "mapping" ? "MAPPING" : "SOURCE_SELECTION";
  const isSttmBuilderHeader =
    pathname === "/sttm/builder/new" || isMappingPage || isSummaryPage;
  const currentStep: 1 | 2 | 3 = isSummaryPage ? 3 : isMappingPage ? 2 : 1;
  const sourceTableCount =
    sources.filter((table) => table.isSelected).length +
    derivedSources.filter((source) => source.isSelected).length;
  const joinCount = relationships.filter(
    (join) => join.leftTableId && join.rightTableId && join.conditions?.length,
  ).length;
  const tableCount =
    sourceTableCount + (targets.some((table) => table.isSelected) ? 1 : 0);
  const mappedCount = mappings.filter((mapping) => mapping.status === "MAPPED").length;
  const canProceedToMapping =
    (sources.some((table) => table.isSelected) || derivedSources.some((source) => source.isSelected)) &&
    targets.some((table) => table.isSelected);

  const requestProceedToMapping = () => {
    if (!canProceedToMapping || isMappingPage || isSummaryPage) {
      return;
    }
    window.dispatchEvent(new CustomEvent("sttm:proceed-to-mapping"));
  };

  const menuOpen = Boolean(menuAnchorEl);
  const settingsOpen = Boolean(settingsAnchorEl);

  return (
    <Box
      className="flex h-[60px] w-full shrink-0 items-center justify-between px-5"
      sx={{
        backgroundColor: "var(--aia-header-bgColor)",
        borderBottom: "1px solid var(--aia-border-color)",
        color: "var(--color-header-text)",
      }}
    >
      <Box className="flex shrink-0 items-center gap-3">
        <Box className="flex h-15 w-15 items-center justify-center overflow-hidden rounded-sm ">
          <Link href="/home">
            <Image
              src={config.branding.logo.light}
              alt="STTM Builder Logo"
              width={50}
              height={50}
              className="object-contain"
            />
          </Link>
        </Box>

        <Typography
          className="text-[16px] font-semibold pt-2"
          sx={{ fontFamily: "var(--font-body)" }}
        >
          AIA Migration Workbench
        </Typography>
      </Box>

      {isSttmBuilderHeader ? (
        <Box sx={{ mx: 4, flex: 1, minWidth: 0 }}>
          <BuilderContentHeader
            embedded
            currentStep={currentStep}
            sourceTableCount={sourceTableCount}
            joinCount={joinCount}
            tableCount={tableCount}
            mappingCount={mappedCount}
            onNext={() => {
              if (currentStep === 1) {
                requestProceedToMapping();
                return;
              }
              if (currentStep === 2) {
                router.push("/sttm/builder/new/summary");
              }
            }}
            onPublish={() => console.log("publish mapping")}
            onStepChange={(step) => {
              if (step === 1) {
                router.push("/sttm/builder/new");
                return;
              }
              if (step === 2) {
                if (isMappingPage) {
                  return;
                }
                if (isSummaryPage) {
                  router.push("/sttm/builder/new/mapping");
                  return;
                }
                requestProceedToMapping();
                return;
              }
              if (!canProceedToMapping) {
                return;
              }
              router.push("/sttm/builder/new/summary");
            }}
            nextDisabled={currentStep === 1 ? !canProceedToMapping : false}
          />
        </Box>
      ) : null}

      <Box className="flex shrink-0 items-center gap-3">
        <Tooltip title={mode === "light" ? "Switch to dark mode" : "Switch to light mode"}>
          <IconButton
            onClick={toggleMode}
            aria-label="Toggle light and dark theme"
            sx={{
              width: 32,
              height: 32,
              borderRadius: "4px",
              border: "1px solid rgba(255,255,255,0.28)",
              "&:hover": {
                backgroundColor: "rgba(115, 109, 109, 0.08)",
              },
            }}
          >
            {mode === "light" ? (
              <DarkModeRoundedIcon sx={{ fontSize: 18 }} />
            ) : (
              <LightModeRoundedIcon sx={{ fontSize: 18 }} />
            )}
          </IconButton>
        </Tooltip>

        <Tooltip title="Assistant settings">
          <IconButton
            onClick={(event) => setSettingsAnchorEl(event.currentTarget)}
            aria-label="Open assistant settings"
            sx={{
              width: 32,
              height: 32,
              borderRadius: "4px",
              border: "1px solid rgba(255,255,255,0.28)",
              "&:hover": {
                backgroundColor: "rgba(115, 109, 109, 0.08)",
              },
            }}
          >
            <SettingsOutlinedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>

        <Box
          role="button"
          onClick={(event) => setMenuAnchorEl(event.currentTarget)}
          sx={{ display: "flex", alignItems: "center", gap: 1.25, cursor: "pointer" }}
        >
          <Avatar
            sx={{
              width: 28,
              height: 28,
              bgcolor: "var(--aia-avatar-bg)",
              color: "var(--aia-avatar-textColor)",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {initials}
          </Avatar>

          <Box className="leading-tight">
            <Typography
              className="text-[12px] font-semibold"
              sx={{ fontFamily: "var(--font-body)" }}
            >
              {resolvedUserName}
            </Typography>
            <Typography
              className="text-[11px]/70"
              sx={{ fontFamily: "var(--font-body)" }}
            >
              {resolvedRole}
            </Typography>
          </Box>

          <KeyboardArrowDownRoundedIcon sx={{ fontSize: 18, color: "#ffffff" }} />
        </Box>

        <Menu
          anchorEl={settingsAnchorEl}
          open={settingsOpen}
          onClose={() => setSettingsAnchorEl(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
        >
          <Box sx={{ px: 2, pt: 1.5, pb: 1, minWidth: 320 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>
              AI assistant settings
            </Typography>
            <Typography sx={{ fontSize: 12, color: "#64748b", mt: 0.35 }}>
              Control whether live business feedback and recommendations appear while you work.
            </Typography>
          </Box>
          <MenuItem disableRipple sx={{ minWidth: 320, alignItems: "stretch", py: 1.25 }}>
            <Box sx={{ display: "flex", width: "100%", alignItems: "center", gap: 2 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700 }}>Live feedback</Typography>
                <Typography sx={{ fontSize: 12, color: "#64748b", lineHeight: 1.45 }}>
                  Ask business questions from table, join, and derived-source activity.
                </Typography>
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", minHeight: 40 }}>
                <Switch
                  checked={assistantPreferences.feedback_enabled}
                  onChange={(event) =>
                    dispatch(
                      updateAssistantPreferencesThunk({
                        ...assistantPreferences,
                        feedback_enabled: event.target.checked,
                      }),
                    ).then(() => {
                      dispatch(
                        evaluateAssistantSignals({
                          page: currentAssistantPage,
                          surface: currentAssistantSurface,
                          activityType: "settings_changed",
                        }),
                      );
                    })
                  }
                />
              </Box>
            </Box>
          </MenuItem>
          <MenuItem disableRipple sx={{ minWidth: 320, alignItems: "stretch", py: 1.25 }}>
            <Box sx={{ display: "flex", width: "100%", alignItems: "center", gap: 2 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700 }}>Live recommendations</Typography>
                <Typography sx={{ fontSize: 12, color: "#64748b", lineHeight: 1.45 }}>
                  Show proactive join, semantic, and mapping suggestions above the assistant.
                </Typography>
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", minHeight: 40 }}>
                <Switch
                  checked={assistantPreferences.recommendations_enabled}
                  onChange={(event) =>
                    dispatch(
                      updateAssistantPreferencesThunk({
                        ...assistantPreferences,
                        recommendations_enabled: event.target.checked,
                      }),
                    ).then(() => {
                      dispatch(
                        evaluateAssistantSignals({
                          page: currentAssistantPage,
                          surface: currentAssistantSurface,
                          activityType: "settings_changed",
                        }),
                      );
                    })
                  }
                />
              </Box>
            </Box>
          </MenuItem>
        </Menu>

        <Menu
          anchorEl={menuAnchorEl}
          open={menuOpen}
          onClose={() => setMenuAnchorEl(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
        >
          <MenuItem disableRipple>
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{resolvedUserName}</Typography>
              <Typography sx={{ fontSize: 12, color: "#64748b" }}>{resolvedRole}</Typography>
            </Box>
          </MenuItem>
        </Menu>
      </Box>
    </Box>
  );
}
