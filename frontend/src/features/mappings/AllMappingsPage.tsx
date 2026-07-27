"use client";
import { AiaBox, AiaButton, AiaMenu, AiaMenuItem, AiaPaper } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import { useEffect, useMemo, useState } from "react";
import CircularProgress from "@mui/material/CircularProgress";
import { AddRoundedIcon, KeyboardArrowDownRoundedIcon } from "@/utils/icons";
import NewMappingDialog from "@/features/dashboard/NewMappingDialog";

import { useRouter, useSearchParams } from "next/navigation";
import { AiaSearchbox } from "@/components/ui/aia-searchbox";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  getAllProjectsSummary,
  createProjectSttm,
  type ProjectRecord,
  type STTMRecord,
} from "@/services/projectService";
import {
  clearOpenSttmNavigation,
  openSttmFromBackend,
  resetBuilderForNewMapping,
} from "@/features/sttm/store/sttm-builder-slice";
import { markExplicitNewDraftIntent } from "@/features/sttm/context/sttm-session-intent";
import AllMappingsTable from "./all-mappings-table";
import {
  SORT_OPTIONS,
  STATUS_FILTERS,
  buildMappingStatusSummary,
  filterMappings,
  sortMappings,
  type AllMappingListItem,
  type MappingSortOption,
  type MappingStatusFilter,
} from "./all-mappings-data";
import { openMappingInBuilder } from "./load-mapping-workspace";
import MappingsTableFooter from "./mappings-table-footer";
import {
  PROJECT_FILTER_ALL,
  buildMappingsUrl,
  type ProjectFilterOption,
} from "./mappings-project-filter";
import {
  MAPPINGS_BORDER_RADIUS,
  MAPPINGS_FONT_SIZE,
  mappingsFilterButtonSx,
} from "./mappings-ui-styles";
import { SECTION_TITLE_SX, SECONDARY_TEXT_SX } from '@/config/typography-tokens';

const DEFAULT_ROWS_PER_PAGE = 5;
const DEFAULT_PROJECT_FILTER_OPTIONS: ProjectFilterOption[] = [
  { value: PROJECT_FILTER_ALL, label: "All Projects" },
];

function initialsFor(name?: string | null) {
  const value = (name || "AI Workbench").trim();
  const parts = value.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : value.slice(0, 2)).toUpperCase();
}

function formatCreatedAt(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })} · ${date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function relativeTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  const deltaMs = Date.now() - date.getTime();
  if (Number.isNaN(deltaMs)) return "—";
  const minutes = Math.max(0, Math.floor(deltaMs / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusForSttm(record: STTMRecord) {
  const normalized = record.status?.toUpperCase();
  if (normalized === "COMPLETE" || normalized === "COMPLETED" || normalized === "PUBLISHED") {
    return "Complete" as const;
  }
  if (normalized === "DRAFT" && !record.mapped_count) {
    return "Draft" as const;
  }
  return "Partial" as const;
}

function mappingItemFromSttm(
  record: STTMRecord,
  project: ProjectRecord,
  index: number,
): AllMappingListItem {
  const metadata = record.metadata ?? {};
  const sourceSummary =
    typeof metadata.source_summary === "string" ? metadata.source_summary : null;
  const target = record.target_table || "Target not selected";
  const mapped = `${record.mapped_count ?? 0}/${record.mapping_count ?? 0}`;

  return {
    id: record.sttm_id,
    index,
    name: record.sttm_name || target,
    qualifiedName: target,
    status: statusForSttm(record),
    projectId: project.project_id,
    projectName: project.project_name,
    aiSummary:
      sourceSummary ||
      `STTM draft for ${target}. ${mapped} mapped row${record.mapping_count === 1 ? "" : "s"}; latest semantic bundle ${
        record.semantic_bundle_id ? "is linked" : "has not been linked yet"
      }.`,
    createdBy: {
      initials: initialsFor(project.created_by),
      name: project.created_by || "AI Workbench",
    },
    createdAt: formatCreatedAt(record.updated_at ?? record.created_at),
    relativeTime: relativeTime(record.updated_at ?? record.created_at),
  };
}

export default function AllMappingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dispatch = useAppDispatch();
  const openSttmStatus = useAppSelector((s) => s.sttmBuilder.openSttmStatus);
  const openSttmTargetPage = useAppSelector((s) => s.sttmBuilder.openSttmTargetPage);
  const [isOpening, setIsOpening] = useState(false);
  const [isNewMappingOpen, setIsNewMappingOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<MappingStatusFilter>("all");
  const [projectFilter, setProjectFilter] = useState(() => {
    const projectParam = searchParams.get("project");
    return projectParam && projectParam !== PROJECT_FILTER_ALL
      ? projectParam
      : PROJECT_FILTER_ALL;
  });
  const [sortBy, setSortBy] = useState<MappingSortOption>("latest-first");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortAnchor, setSortAnchor] = useState<null | HTMLElement>(null);
  const [projectAnchor, setProjectAnchor] = useState<null | HTMLElement>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);
  const [mappingRows, setMappingRows] = useState<AllMappingListItem[]>([]);
  const [isLoadingMappings, setIsLoadingMappings] = useState(true);
  const [projectOptions, setProjectOptions] =
    useState<ProjectFilterOption[]>(DEFAULT_PROJECT_FILTER_OPTIONS);

  useEffect(() => {
    dispatch(clearOpenSttmNavigation());
  }, [dispatch]);

  useEffect(() => {
    let cancelled = false;

    async function loadMappingsFromBackend() {
      const { projects, sttms } = await getAllProjectsSummary();
      if (cancelled) return;

      const projectById = new Map<string, ProjectRecord>(
        projects.map((project) => [project.project_id, project]),
      );

      setProjectOptions([
        { value: PROJECT_FILTER_ALL, label: "All Projects" },
        ...projects.map((project) => ({
          value: project.project_id,
          label: project.project_name,
        })),
      ]);

      const rows = sttms
        .map((record) => {
          const project = projectById.get(record.project_id);
          return project ? { project, record } : null;
        })
        .filter((item): item is { project: ProjectRecord; record: STTMRecord } => item !== null)
        .sort((a, b) => {
          const aTime = new Date(a.record.updated_at ?? a.record.created_at ?? 0).getTime();
          const bTime = new Date(b.record.updated_at ?? b.record.created_at ?? 0).getTime();
          return bTime - aTime;
        })
        .map(({ project, record }, index) => mappingItemFromSttm(record, project, index + 1));

      setMappingRows(rows);
      setIsLoadingMappings(false);
    }

    loadMappingsFromBackend().catch((error) => {
      if (process.env.NODE_ENV === "development") {
        console.warn("Project/STTM metadata is unavailable; showing no saved mappings.", error);
      }
      if (!cancelled) {
        setMappingRows([]);
        setProjectOptions(DEFAULT_PROJECT_FILTER_OPTIONS);
        setIsLoadingMappings(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredRows = useMemo(() => {
    const filtered = filterMappings(
      mappingRows,
      statusFilter,
      searchQuery,
      projectFilter,
    );
    return sortMappings(filtered, sortBy);
  }, [mappingRows, projectFilter, searchQuery, sortBy, statusFilter]);

  const filteredSummary = useMemo(
    () => buildMappingStatusSummary(filteredRows),
    [filteredRows],
  );

  const maxPage = Math.max(0, Math.ceil(filteredRows.length / rowsPerPage) - 1);
  const visiblePage = Math.min(page, maxPage);

  const paginatedRows = useMemo(() => {
    const start = visiblePage * rowsPerPage;
    return filteredRows.slice(start, start + rowsPerPage);
  }, [filteredRows, rowsPerPage, visiblePage]);

  useEffect(() => {
    if (!isOpening) return;
    if (openSttmStatus === "success" && openSttmTargetPage) {
      const targetPage = openSttmTargetPage;
      dispatch(clearOpenSttmNavigation());
      router.push(targetPage);
      setIsOpening(false);
    } else if (openSttmStatus === "error") {
      setIsOpening(false);
    }
  }, [dispatch, isOpening, openSttmStatus, openSttmTargetPage, router]);

  const selectedSortLabel =
    SORT_OPTIONS.find((option) => option.value === sortBy)?.label ??
    SORT_OPTIONS[0].label;

  const selectedProjectLabel =
    projectOptions.find((option) => option.value === projectFilter)?.label ??
    DEFAULT_PROJECT_FILTER_OPTIONS[0].label;

  const selectedProjectName =
    projectFilter === PROJECT_FILTER_ALL ? undefined : selectedProjectLabel;

  const handleProjectFilterChange = (nextProjectFilter: string) => {
    setProjectFilter(nextProjectFilter);
    setPage(0);
    setProjectAnchor(null);
    router.replace(buildMappingsUrl(nextProjectFilter), { scroll: false });
  };

  const handleOpenMapping = (item: AllMappingListItem) => {
    setIsOpening(true);
    openMappingInBuilder(dispatch, { sttmId: item.id, projectId: item.projectId });
  };

  const handleBuildManually = async (details?: {
    name: string;
    description: string;
    linkedMappingIds: string[];
  }) => {
    if (projectFilter !== PROJECT_FILTER_ALL) {
      if (!details?.name) return;
      setIsNewMappingOpen(false);
      setIsOpening(true);
      try {
        const sttm = await createProjectSttm(projectFilter, {
          sttm_name: details.name,
          description: details.description || null,
          precedent_links: details.linkedMappingIds.map((sttmId, index) => ({
            precedent_sttm_id: sttmId,
            priority: Math.max(1, 100 - index),
            knowledge_categories: [
              'column_mapping',
              'relationship',
              'transformation',
              'query_shaping',
              'derived_lineage',
            ],
            allow_project_specific_values: false,
          })),
        });
        dispatch(openSttmFromBackend({ sttmId: sttm.sttm_id, projectId: projectFilter }));
      } catch (err) {
        if (process.env.NODE_ENV === "development") {
          console.warn("Failed to create STTM.", err);
        }
        setIsOpening(false);
      }
    } else {
      setIsNewMappingOpen(false);
      markExplicitNewDraftIntent();
      dispatch(resetBuilderForNewMapping());
      router.push("/sttm/builder/new");
    }
  };

  return (
    <AiaBox
      sx={{
        display: "flex",
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        flexDirection: "column",
        overflow: "hidden",
        bgcolor: "#F7F8FA",
      }}
    >
      <AiaBox sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <AiaBox className="px-5 py-4">
          <AiaBox
            sx={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 2,
              flexWrap: "wrap",
            }}
          >
            <AiaBox>
              <AiaText sx={{ ...SECTION_TITLE_SX, letterSpacing: "-0.02em" }}>
                All Mappings
              </AiaText>
              <AiaText sx={{ ...SECONDARY_TEXT_SX, mt: 0.5 }}>
                {isLoadingMappings
                  ? "Loading mappings..."
                  : `${filteredSummary.total} mapping${filteredSummary.total === 1 ? "" : "s"}${
                      selectedProjectName ? ` in ${selectedProjectName}` : ""
                    }`}
              </AiaText>
            </AiaBox>

            <AiaButton
              variant="contained"
              size="medium"
              startIcon={<AddRoundedIcon sx={{ fontSize: 18 }} />}
              onClick={() => setIsNewMappingOpen(true)}
              sx={{
                textTransform: "none",
                fontWeight: 700,
                fontSize: 14,
                borderRadius: "12px",
                px: 2.5,
                height: 40,
                flexShrink: 0,
              }}
            >
              New Mapping
            </AiaButton>
          </AiaBox>

          <AiaBox className="mt-4 flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((filter) => (
              <AiaButton
                key={filter.value}
              onClick={() => {
                setStatusFilter(filter.value);
                setPage(0);
              }}
                sx={mappingsFilterButtonSx(statusFilter === filter.value)}
              >
                {filter.label}
              </AiaButton>
            ))}

            <AiaButton
              onClick={(event) => setSortAnchor(event.currentTarget)}
              endIcon={<KeyboardArrowDownRoundedIcon sx={{ fontSize: 14 }} />}
              sx={{
                ...mappingsFilterButtonSx(false),
                minWidth: 160,
                justifyContent: "space-between",
              }}
            >
              {selectedSortLabel}
            </AiaButton>

            <AiaMenu
              anchorEl={sortAnchor}
              open={Boolean(sortAnchor)}
              onClose={() => setSortAnchor(null)}
              anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
              transformOrigin={{ vertical: "top", horizontal: "left" }}
            >
              {SORT_OPTIONS.map((option) => (
                <AiaMenuItem
                  key={option.value}
                  selected={sortBy === option.value}
                  onClick={() => {
                    setSortBy(option.value);
                    setPage(0);
                    setSortAnchor(null);
                  }}
                  sx={{ fontSize: MAPPINGS_FONT_SIZE }}
                >
                  {option.label}
                </AiaMenuItem>
              ))}
            </AiaMenu>

            <AiaButton
              onClick={(event) => setProjectAnchor(event.currentTarget)}
              endIcon={<KeyboardArrowDownRoundedIcon sx={{ fontSize: 14 }} />}
              sx={{
                ...mappingsFilterButtonSx(projectFilter !== PROJECT_FILTER_ALL),
                minWidth: 170,
                justifyContent: "space-between",
              }}
            >
              {selectedProjectLabel}
            </AiaButton>

            <AiaMenu
              anchorEl={projectAnchor}
              open={Boolean(projectAnchor)}
              onClose={() => setProjectAnchor(null)}
              anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
              transformOrigin={{ vertical: "top", horizontal: "left" }}
            >
              {projectOptions.map((option) => (
                <AiaMenuItem
                  key={option.value}
                  selected={projectFilter === option.value}
                  onClick={() => handleProjectFilterChange(option.value)}
                  sx={{ fontSize: MAPPINGS_FONT_SIZE }}
                >
                  {option.label}
                </AiaMenuItem>
              ))}
            </AiaMenu>

            <AiaBox sx={{ width: { xs: "100%", sm: 220 } }}>
              <AiaSearchbox
                value={searchQuery}
                onChange={(value) => {
                  setSearchQuery(value);
                  setPage(0);
                }}
                placeholder="Search mappings..."
                fullWidth
                sx={{
                  height: 34,
                  borderRadius: MAPPINGS_BORDER_RADIUS,
                  backgroundColor: "#FFFFFF",
                }}
                inputSx={{
                  "& .MuiInputBase-input": {
                    fontSize: MAPPINGS_FONT_SIZE,
                  },
                }}
              />
            </AiaBox>
          </AiaBox>
        </AiaBox>

        <AiaBox className="min-w-0 px-5 pb-5">
          <AiaPaper
            elevation={0}
            sx={{
              border: "1px solid #E5E7EB",
              borderRadius: MAPPINGS_BORDER_RADIUS,
              overflow: "hidden",
              backgroundColor: "#FFFFFF",
            }}
          >
            <AllMappingsTable
              rows={paginatedRows}
              onOpen={handleOpenMapping}
              isLoading={isLoadingMappings}
            />

            {!isLoadingMappings && <MappingsTableFooter
              total={filteredSummary.total}
              complete={filteredSummary.complete}
              partial={filteredSummary.partial}
              draft={filteredSummary.draft}
              page={visiblePage}
              rowsPerPage={rowsPerPage}
              filteredCount={filteredRows.length}
              onPageChange={setPage}
              onRowsPerPageChange={(value) => {
                setRowsPerPage(value);
                setPage(0);
              }}
            />}
          </AiaPaper>
        </AiaBox>
      </AiaBox>

      {isOpening && openSttmStatus !== "error" && (
        <AiaBox
          sx={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "rgba(0,0,0,0.25)",
            zIndex: 9999,
          }}
        >
          <AiaPaper
            elevation={3}
            sx={{
              p: 3,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              borderRadius: 2,
            }}
          >
            <CircularProgress size={28} />
            <AiaText sx={{ fontSize: 14, color: "#374151" }}>
              Loading mapping...
            </AiaText>
          </AiaPaper>
        </AiaBox>
      )}

      <NewMappingDialog
        open={isNewMappingOpen}
        onClose={() => setIsNewMappingOpen(false)}
        onBuildManually={handleBuildManually}
        projectId={projectFilter !== PROJECT_FILTER_ALL ? projectFilter : undefined}
        precedentMappings={mappingRows
          .filter((mapping) => mapping.status === "Complete")
          .map((mapping) => ({
            id: mapping.id,
            name: mapping.name,
            projectName: mapping.projectName,
          }))}
      />
    </AiaBox>
  );
}
