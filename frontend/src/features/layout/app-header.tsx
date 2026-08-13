"use client";
import { AiaAvatar, AiaBox, AiaButton, AiaMenu, AiaMenuItem, AiaSwitch } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  KeyboardArrowDownRoundedIcon,
  LogoutRoundedIcon,
  SettingsOutlinedIcon,
} from '@/utils/icons';

// import { useThemeMode } from "@/app/Providers";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authService } from "@/services/authService";
import type { UserSession } from "@/types/user";
import { CLIENT_CONFIG as config } from "@/config/client.config";
import { SUBTITLE_SX } from "@/config/typography-tokens";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { resolveBuilderSelectionState } from "@/features/sttm/shared/sttm-selection-utils";
import BuilderContentHeader, {
  builderHeaderActionButtonSx,
  builderHeaderActionStrokeColor,
} from "@/features/sttm/layout/builder-content-header";
import PublishMappingModal from "@/features/sttm/summary/publish-mapping-modal";
import { buildSummaryMetrics } from "@/features/sttm/summary/summary-utils";
import {
  evaluateFirRecommendations,
  updateAssistantPreferences as updateAssistantPreferencesThunk,
} from "@/features/sttm/store/sttm-builder-slice";
import { TOUR_TARGETS } from "@/features/tour/constants/tour-targets";
import { useTour } from "@/features/tour/engine";
import type { PublishMappingPayload } from "@/features/sttm/summary/publish-mapping-modal";
import type { PublishProjectItem } from "@/features/sttm/summary/publish-mapping-data";
import {
  createProject,
  createProjectSttm,
  listProjects,
  publishSttm,
  type ProjectRecord,
} from "@/services/projectService";
import {
  buildWorkbenchContextSnapshot,
  tableRefFromQualifiedName,
} from "@/features/sttm/context/workbench-context";

type AppHeaderProps = {
  userName?: string;
  role?: string;
};

function projectRecordToPublishOption(project: ProjectRecord): PublishProjectItem {
  const metadata = project.metadata ?? {};
  const folderColor =
    typeof metadata.theme_color === "string"
      ? metadata.theme_color
      : typeof metadata.theme_color_id === "string"
        ? metadata.theme_color_id
        : "#2563EB";

  return {
    id: project.project_id,
    name: project.project_name,
    mappingCount: project.sttm_count || project.total_mappings || 0,
    folderColor,
    folderBg: "rgba(37, 99, 235, 0.12)",
  };
}

type BuilderRouteState = {
  basePath: string;
  isBuilder: boolean;
  isMapping: boolean;
  isSummary: boolean;
};

function resolveBuilderRoute(pathname: string, activeSttmId?: string | null): BuilderRouteState {
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  const match = normalizedPath.match(
    /^\/sttm\/builder\/([^/]+)(?:\/(mapping|validate|summary))?$/,
  );

  if (!match) {
    return {
      basePath: "/sttm/builder/new",
      isBuilder: false,
      isMapping: false,
      isSummary: false,
    };
  }

  const routeIdentity = match[1];
  const routeStep = match[2];
  const durableRoutesEnabled = process.env.NEXT_PUBLIC_DURABLE_STTM_ROUTE_V1 !== "false";
  const resolvedIdentity =
    routeIdentity !== "new"
      ? routeIdentity
      : durableRoutesEnabled && activeSttmId
        ? encodeURIComponent(activeSttmId)
        : "new";

  return {
    basePath: `/sttm/builder/${resolvedIdentity}`,
    isBuilder: true,
    isMapping: routeStep === "mapping" || routeStep === "validate",
    isSummary: routeStep === "summary",
  };
}

export default function AppHeader({
  userName = "Shane Watson",
  role = "Publisher",
}: AppHeaderProps) {
  // const { mode, toggleMode } = useThemeMode();
  const [session, setSession] = useState<UserSession | null>(null);
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [settingsAnchorEl, setSettingsAnchorEl] = useState<HTMLElement | null>(null);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [publishProjectOptions, setPublishProjectOptions] = useState<PublishProjectItem[]>([]);
  const [isPublishing, setIsPublishing] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const tour = useTour();
  const {
    sources,
    targets,
    mappings,
    derivedSources,
    relationships,
    sourceDatabases,
    targetDatabases,
    assistantPreferences,
    semanticBundleId,
    semanticViewName,
    semanticBundleLabel,
    semanticLevel,
    semanticStatus,
    sourceAttributeGroups,
    drivingTableId,
    sourceFilterSql,
    sourceFilterGroups,
    sourceQuerySql,
    sourceGroupBySql,
    sourceOrderBySql,
    selectedMappingIds,
    activeMappingId,
    mappingSql,
    mappingPreviewSql,
    mappingIntent,
    activeProjectName,
    activeSttmId,
  } = useAppSelector((state) => state.sttmBuilder);
  const builderRoute = resolveBuilderRoute(pathname, activeSttmId);
  const builderRouteBase = builderRoute.basePath;
  const { resolvedSourceTables, selectedTargetTable, canProceedToMapping } =
    resolveBuilderSelectionState({
      sourceDatabases,
      targetDatabases,
      sources,
      targets,
      derivedSources,
    });

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

  useEffect(() => {
    if (!isPublishModalOpen) {
      return;
    }

    let cancelled = false;
    listProjects()
      .then((projects) => {
        if (!cancelled) {
          setPublishProjectOptions(projects.map(projectRecordToPublishOption));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setPublishProjectOptions([]);
        }
        if (process.env.NODE_ENV === "development") {
          console.warn("Project options unavailable; publish target list is empty until backend recovers.", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isPublishModalOpen]);

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

  const isMappingPage = builderRoute.isMapping;
  const isSummaryPage = builderRoute.isSummary;
  const currentAssistantPage: "builder" | "mapping" | "summary" = isSummaryPage
    ? "summary"
    : isMappingPage
      ? "mapping"
      : "builder";
  const currentAssistantSurface: "SOURCE_SELECTION" | "MAPPING" =
    currentAssistantPage === "mapping" ? "MAPPING" : "SOURCE_SELECTION";
  const isSttmBuilderHeader = builderRoute.isBuilder;
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
  const requestProceedToMapping = () => {
    if (!canProceedToMapping || isMappingPage || isSummaryPage) {
      return;
    }
    window.dispatchEvent(new CustomEvent("sttm:proceed-to-mapping"));
  };

  const handleOpenAssistantSettings = () => {
    const anchor = menuAnchorEl;
    setMenuAnchorEl(null);
    setSettingsAnchorEl(anchor);
  };

  const handleLogout = () => {
    setMenuAnchorEl(null);
    setSettingsAnchorEl(null);
    authService.logout();
  };

  const handlePublishMapping = async (payload: PublishMappingPayload) => {
    if (isPublishing) {
      return;
    }

    setIsPublishing(true);
    try {
      let projectId = payload.projectId;

      if (payload.saveTab === "new" || !projectId) {
        const projectName =
          payload.saveTab === "new"
            ? payload.projectName || `${payload.mappingName} Project`
            : "Unassigned STTMs";
        const existingProject = publishProjectOptions.find(
          (project) => project.name.toLowerCase() === projectName.toLowerCase(),
        );
        if (existingProject) {
          projectId = existingProject.id;
        } else {
          const createdProject = await createProject({
            project_name: projectName,
            description:
              payload.saveTab === "new"
                ? payload.projectDescription || `Project created while publishing ${payload.mappingName}.`
                : "Mappings saved without an explicit project selection.",
            theme_color_id: "blue",
            domain: payload.projectDomain,
            intended_outcome: payload.projectOutcome,
            business_process: payload.projectBusinessProcess,
            owner: payload.projectOwner,
          });
          projectId = createdProject.project_id;
          setPublishProjectOptions((items) => [
            projectRecordToPublishOption(createdProject),
            ...items,
          ]);
        }
      }

      if (!projectId) {
        throw new Error("A project is required before publishing the mapping.");
      }

      const targetTableRef = tableRefFromQualifiedName(selectedTargetTable?.qualifiedName);
      const snapshotInput = {
        page: currentAssistantPage,
        surface: currentAssistantSurface,
        sessionId: session ? String(session.user_id) : null,
        projectId,
        projectName: payload.projectName || activeProjectName,
        projectDescription: payload.projectDescription,
        projectDomain: payload.projectDomain,
        projectOutcome: payload.projectOutcome,
        sttmName: payload.mappingName,
        sttmDescription: payload.mappingDescription,
        mappingLifecycle: mappingIntent?.lifecycle ?? "new",
        businessGoal:
          payload.mappingDescription
          || mappingIntent?.business_goal
          || mappingIntent?.target_outcome
          || null,
        sourceTables: resolvedSourceTables,
        targetTable: selectedTargetTable,
        drivingTableId,
        sourceAttributeGroups,
        derivedSources,
        relationships,
        sourceFilterSql,
        sourceFilterGroups,
        sourceQuerySql,
        sourceGroupBySql,
        sourceOrderBySql,
        mappings,
        selectedMappingIds,
        activeMappingId,
        mappingSql,
        mappingPreviewSql,
        mappingIntent,
        semanticBundleId,
        semanticBundleLabel,
        semanticLevel,
        semanticStatus,
        semanticViewName,
      };
      const createSnapshot = buildWorkbenchContextSnapshot({
        ...snapshotInput,
        action: "mapping.created",
      });

      const sttm = await createProjectSttm(projectId, {
        sttm_name: payload.mappingName,
        description: payload.mappingDescription,
        target_table: targetTableRef,
        workspace_snapshot: createSnapshot,
        semantic_bundle_id: semanticBundleId,
        metadata: {
          source: "ui_publish_modal",
          semantic_view_name: semanticViewName,
        },
      });

      const publishSnapshot = buildWorkbenchContextSnapshot({
        ...snapshotInput,
        action: "sttm.published",
        milestone: "before_publish",
        sttmId: sttm.sttm_id,
      });

      await publishSttm(sttm.sttm_id, {
        revision_note: "Published from AIA Migration Workbench UI.",
        workspace_snapshot: publishSnapshot,
        semantic_bundle_id: semanticBundleId,
        metadata: {
          source: "ui_publish_modal",
          semantic_view_name: semanticViewName,
        },
      });

      await dispatch(
        evaluateFirRecommendations({
          checkpoint: "sttm_published",
          page: "summary",
          surface: "MAPPING",
          scopeType: "mapping",
          candidateAction: "review_published_mapping",
        }),
      );

      setIsPublishModalOpen(false);
    } catch (error) {
      console.error("Publish mapping failed", error);
      window.alert(error instanceof Error ? error.message : "Failed to publish mapping.");
    } finally {
      setIsPublishing(false);
    }
  };

  const menuOpen = Boolean(menuAnchorEl);
  const settingsOpen = Boolean(settingsAnchorEl);

  return (
    <AiaBox
      className="flex w-full shrink-0 items-center justify-between px-5"
      sx={{
        height: "var(--aia-header-height)",
        minHeight: "var(--aia-header-height)",
        backgroundColor: "var(--aia-header-bgColor)",
        borderBottom: "1px solid var(--aia-border-color)",
        color: "var(--color-header-text)",
      }}
    >
      <AiaBox className="flex shrink-0 items-center gap-3">
        <AiaBox className="flex h-15 w-15 items-center justify-center overflow-hidden rounded-sm ">
          <Link href="/home">
            <Image
              src={config.branding.logo.light}
              alt="STTM Builder Logo"
              width={50}
              height={50}
              className="object-contain"
            />
          </Link>
        </AiaBox>

        <AiaText
          sx={{
            ...SUBTITLE_SX,
            color: "inherit",
            display: "flex",
            alignItems: "center",
          }}
        >
          AIA Migration Workbench
        </AiaText>
      </AiaBox>

      {isSttmBuilderHeader ? (
        <AiaBox sx={{ mx: 4, flex: 1, minWidth: 0 }}>
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
                router.push(`${builderRouteBase}/summary`);
              }
            }}
            onPublish={() => {
              setIsPublishModalOpen(true);
              void dispatch(
                evaluateFirRecommendations({
                  checkpoint: "before_publish",
                  page: "summary",
                  surface: "MAPPING",
                  scopeType: "mapping",
                  candidateAction: "publish_mapping",
                }),
              );
            }}
            onStepChange={(step) => {
              if (step === 1) {
                router.push(builderRouteBase);
                return;
              }
              if (step === 2) {
                if (isMappingPage) {
                  return;
                }
                if (isSummaryPage) {
                  router.push(`${builderRouteBase}/mapping`);
                  return;
                }
                requestProceedToMapping();
                return;
              }
              if (!canProceedToMapping) {
                return;
              }
              router.push(`${builderRouteBase}/summary`);
            }}
            nextDisabled={currentStep === 1 ? !canProceedToMapping : false}
          />
        </AiaBox>
      ) : null}

      <AiaBox className="flex shrink-0 items-center gap-3">
        {/* Theme toggle — hidden for now
        <AiaTooltip title={mode === "light" ? "Switch to dark mode" : "Switch to light mode"}>
          <AiaIconButton
            onClick={toggleMode}
            aria-label="Toggle light and dark theme"
            sx={{
              width: 32,
              height: 32,
              borderRadius: "4px",
              color: "inherit",
              border: "1px solid rgba(255,255,255,0.28)",
              "&:hover": {
                backgroundColor: "rgba(255,255,255,0.08)",
              },
            }}
          >
            {mode === "light" ? (
              <DarkModeRoundedIcon sx={{ fontSize: 18 }} />
            ) : (
              <LightModeRoundedIcon sx={{ fontSize: 18 }} />
            )}
          </AiaIconButton>
        </AiaTooltip>
        */}

        <AiaButton
          variant="outlined"
          rounded="sm"
          size="large"
          customColor={builderHeaderActionStrokeColor}
          onClick={() => tour.startTourForPath(pathname)}
          aria-label="Start tour guide"
          sx={builderHeaderActionButtonSx}
        >
          Tour Guide
        </AiaButton>

        <AiaBox
          role="button"
          onClick={(event) => setMenuAnchorEl(event.currentTarget)}
          data-tour={TOUR_TARGETS.userProfile}
          sx={{ display: "flex", alignItems: "center", gap: 1.25, cursor: "pointer" }}
        >
          <AiaAvatar
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
          </AiaAvatar>

          <AiaBox className="leading-tight">
            <AiaText
              className="text-[12px] font-semibold"
              sx={{ fontFamily: "var(--font-body)" }}
            >
              {resolvedUserName}
            </AiaText>
            <AiaText
              className="text-[11px]/70"
              sx={{ fontFamily: "var(--font-body)" }}
            >
              {resolvedRole}
            </AiaText>
          </AiaBox>

          <KeyboardArrowDownRoundedIcon sx={{ fontSize: 18, color: "currentColor" }} />
        </AiaBox>

        <AiaMenu
          anchorEl={settingsAnchorEl}
          open={settingsOpen}
          onClose={() => setSettingsAnchorEl(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
        >
          <AiaBox sx={{ px: 2, pt: 1.5, pb: 1, minWidth: 320 }}>
            <AiaText sx={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>
              AI assistant settings
            </AiaText>
            <AiaText sx={{ fontSize: 12, color: "#64748b", mt: 0.35 }}>
              Control whether live business feedback and recommendations appear while you work.
            </AiaText>
          </AiaBox>
          <AiaMenuItem disableRipple sx={{ minWidth: 320, alignItems: "stretch", py: 1.25 }}>
            <AiaBox sx={{ display: "flex", width: "100%", alignItems: "center", gap: 2 }}>
              <AiaBox sx={{ flex: 1, minWidth: 0 }}>
                <AiaText sx={{ fontSize: 13, fontWeight: 700 }}>Live feedback</AiaText>
                <AiaText sx={{ fontSize: 12, color: "#64748b", lineHeight: 1.45 }}>
                  Ask business questions from table, join, and derived-source activity.
                </AiaText>
              </AiaBox>
              <AiaBox sx={{ display: "flex", alignItems: "center", minHeight: 40 }}>
                <AiaSwitch
                  checked={assistantPreferences.feedback_enabled}
                  onChange={(event) =>
                    dispatch(
                      updateAssistantPreferencesThunk({
                        ...assistantPreferences,
                        feedback_enabled: event.target.checked,
                      }),
                    )
                  }
                />
              </AiaBox>
            </AiaBox>
          </AiaMenuItem>
          <AiaMenuItem disableRipple sx={{ minWidth: 320, alignItems: "stretch", py: 1.25 }}>
            <AiaBox sx={{ display: "flex", width: "100%", alignItems: "center", gap: 2 }}>
              <AiaBox sx={{ flex: 1, minWidth: 0 }}>
                <AiaText sx={{ fontSize: 13, fontWeight: 700 }}>Live recommendations</AiaText>
                <AiaText sx={{ fontSize: 12, color: "#64748b", lineHeight: 1.45 }}>
                  Show proactive join, semantic, and mapping suggestions above the assistant.
                </AiaText>
              </AiaBox>
              <AiaBox sx={{ display: "flex", alignItems: "center", minHeight: 40 }}>
                <AiaSwitch
                  checked={assistantPreferences.recommendations_enabled}
                  onChange={(event) =>
                    dispatch(
                      updateAssistantPreferencesThunk({
                        ...assistantPreferences,
                        recommendations_enabled: event.target.checked,
                      }),
                    )
                  }
                />
              </AiaBox>
            </AiaBox>
          </AiaMenuItem>
        </AiaMenu>

        <AiaMenu
          anchorEl={menuAnchorEl}
          open={menuOpen}
          onClose={() => setMenuAnchorEl(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
        >
          {/* <AiaMenuItem disableRipple sx={{ cursor: "default", "&:hover": { backgroundColor: "transparent" } }}>
            {/* <AiaBox>
              <AiaText sx={{ fontSize: 13, fontWeight: 700 }}>{resolvedUserName}</AiaText>
              <AiaText sx={{ fontSize: 12, color: "#64748b" }}>{resolvedRole}</AiaText>
            </AiaBox> *
          </AiaMenuItem> */}
          {/* <AiaDivider /> */}
          <AiaMenuItem onClick={handleOpenAssistantSettings}>
            <AiaBox sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
              <SettingsOutlinedIcon sx={{ fontSize: 18, color: "#64748b" }} />
              <AiaText sx={{ fontSize: 13, fontWeight: 600 }}>Assistant Settings</AiaText>
            </AiaBox>
          </AiaMenuItem>
          <AiaMenuItem onClick={handleLogout}>
            <AiaBox sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
              <LogoutRoundedIcon sx={{ fontSize: 18, color: "#64748b" }} />
              <AiaText sx={{ fontSize: 13, fontWeight: 600 }}>Logout</AiaText>
            </AiaBox>
          </AiaMenuItem>
        </AiaMenu>
      </AiaBox>

      <PublishMappingModal
        open={isPublishModalOpen && isSummaryPage}
        onClose={() => setIsPublishModalOpen(false)}
        defaultMappingName={defaultMappingName}
        metrics={publishMetrics}
        projectOptions={publishProjectOptions.length ? publishProjectOptions : undefined}
        isPublishing={isPublishing}
        onPublish={handlePublishMapping}
      />
    </AiaBox>
  );
}
