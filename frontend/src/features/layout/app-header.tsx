"use client";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { DarkModeRoundedIcon, KeyboardArrowDownRoundedIcon, LightModeRoundedIcon } from '@/utils/icons';



import { Avatar, Box, IconButton, Tooltip, Typography } from "@mui/material";
import { useThemeMode } from "@/app/Providers";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authService } from "@/services/authService";
import type { UserSession } from "@/types/user";
import { CLIENT_CONFIG as config } from "@/config/client.config";
import { useAppSelector } from "@/store/hooks";
import {
  getSelectedSourceTables,
  getSelectedTargetTable,
} from "@/features/sttm/shared/sttm-selection-utils";
import BuilderContentHeader from "@/features/sttm/layout/builder-content-header";
import PublishMappingModal from "@/features/sttm/summary/publish-mapping-modal";
import { buildSummaryMetrics } from "@/features/sttm/summary/summary-utils";

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
  const pathname = usePathname();
  const router = useRouter();
  const { sources, targets, mappings, derivedSources, relationships, sourceDatabases, targetDatabases } =
    useAppSelector((state) => state.sttmBuilder);
  const selectedSourceTables = getSelectedSourceTables(sourceDatabases);
  const selectedTargetTable =
    getSelectedTargetTable(targetDatabases) ?? targets.find((table) => table.isSelected);
  const resolvedSourceTables =
    selectedSourceTables.length > 0
      ? selectedSourceTables
      : sources.filter((table) => table.isSelected);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);

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

  const isMappingPage = pathname === "/sttm/builder/new/mapping";
  const isSummaryPage = pathname === "/sttm/builder/new/summary";
  const isSttmBuilderHeader =
    pathname === "/sttm/builder/new" || isMappingPage || isSummaryPage;
  const currentStep: 1 | 2 | 3 = isSummaryPage ? 3 : isMappingPage ? 2 : 1;
  const sourceTableCount =
    resolvedSourceTables.length +
    derivedSources.filter((source) => source.isSelected).length;
  const joinCount = relationships.filter(
    (join) => join.leftTableId && join.rightTableId && join.conditions?.length,
  ).length;
  const tableCount = sourceTableCount + (selectedTargetTable ? 1 : 0);
  const mappedCount = mappings.filter((mapping) => mapping.status === "MAPPED").length;
  const publishMetrics = useMemo(
    () =>
      buildSummaryMetrics({
        mappings,
        sources: resolvedSourceTables,
        joinCount,
      }),
    [joinCount, mappings, resolvedSourceTables],
  );
  const defaultMappingName =
    selectedTargetTable?.tableName?.toUpperCase() ?? "FACT_SALES_UNIFIED";
  const canProceedToMapping =
    (resolvedSourceTables.length > 0 || derivedSources.some((source) => source.isSelected)) &&
    Boolean(selectedTargetTable);

  const requestProceedToMapping = () => {
    if (!canProceedToMapping || isMappingPage || isSummaryPage) {
      return;
    }
    window.dispatchEvent(new CustomEvent("sttm:proceed-to-mapping"));
  };

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
            onPublish={() => setIsPublishModalOpen(true)}
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
        <Box sx={{ display: "none" }}>
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
        </Box>

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

      <PublishMappingModal
        open={isPublishModalOpen && isSummaryPage}
        onClose={() => setIsPublishModalOpen(false)}
        defaultMappingName={defaultMappingName}
        metrics={publishMetrics}
        onPublish={(payload) => {
          console.log("Publish mapping", payload);
          setIsPublishModalOpen(false);
        }}
      />
    </Box>
  );
}
