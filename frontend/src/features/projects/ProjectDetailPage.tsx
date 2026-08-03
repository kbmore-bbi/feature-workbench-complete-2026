"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Navigation and pagination state follow external route/filter state. */
import { AiaBox, AiaButton, AiaMenu, AiaMenuItem, AiaPaper, AiaStack } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { useEffect, useMemo, useState } from "react";
import CircularProgress from "@mui/material/CircularProgress";
import {
  AddRoundedIcon,
  ArrowBackRoundedIcon,
  KeyboardArrowDownRoundedIcon,
} from "@/utils/icons";
import { useRouter } from "next/navigation";
import { AiaSearchbox } from "@/components/ui/aia-searchbox";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  getAllProjectsSummary,
  type ProjectRecord,
  type STTMRecord,
} from "@/services/projectService";
import AllMappingsTable from "@/features/mappings/all-mappings-table";
import {
  SORT_OPTIONS,
  STATUS_FILTERS,
  buildMappingStatusSummary,
  filterMappings,
  sortMappings,
  type AllMappingListItem,
  type MappingSortOption,
  type MappingStatusFilter,
} from "@/features/mappings/all-mappings-data";
import { openMappingInBuilder } from "@/features/mappings/load-mapping-workspace";
import {
  clearOpenSttmNavigation,
} from "@/features/sttm/store/sttm-builder-slice";
import NewMappingDialog from "@/features/dashboard/NewMappingDialog";
import MappingsTableFooter from "@/features/mappings/mappings-table-footer";
import {
  MAPPINGS_BORDER_RADIUS,
  MAPPINGS_FONT_SIZE,
  mappingsFilterButtonSx,
} from "@/features/mappings/mappings-ui-styles";
import { SECTION_TITLE_SX, SECONDARY_TEXT_SX } from '@/config/typography-tokens';

const DEFAULT_ROWS_PER_PAGE = 5;

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

type ProjectDetailPageProps = {
  projectId: string;
};

export default function ProjectDetailPage({ projectId }: ProjectDetailPageProps) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const openSttmStatus = useAppSelector((s) => s.sttmBuilder.openSttmStatus);
  const openSttmTargetPage = useAppSelector((s) => s.sttmBuilder.openSttmTargetPage);

  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [mappingRows, setMappingRows] = useState<AllMappingListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpening, setIsOpening] = useState(false);
  const [isNewMappingOpen, setIsNewMappingOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<MappingStatusFilter>("all");
  const [sortBy, setSortBy] = useState<MappingSortOption>("latest-first");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortAnchor, setSortAnchor] = useState<null | HTMLElement>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);

  useEffect(() => {
    dispatch(clearOpenSttmNavigation());
  }, [dispatch]);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setIsLoading(true);
      const { projects, sttms } = await getAllProjectsSummary();
      if (cancelled) return;

      const found = projects.find((p) => p.project_id === projectId) ?? null;
      const projectSttms = sttms.filter((s) => s.project_id === projectId);

      setProject(found);

      if (found) {
        const rows = projectSttms
          .sort((a, b) => {
            const aTime = new Date(a.updated_at ?? a.created_at ?? 0).getTime();
            const bTime = new Date(b.updated_at ?? b.created_at ?? 0).getTime();
            return bTime - aTime;
          })
          .map((record, index) => mappingItemFromSttm(record, found, index + 1));
        setMappingRows(rows);
      }

      setIsLoading(false);
    }

    loadData().catch((error) => {
      if (process.env.NODE_ENV === "development") {
        console.warn("Failed to load project data.", error);
      }
      if (!cancelled) {
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

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

  const filteredRows = useMemo(() => {
    const filtered = filterMappings(mappingRows, statusFilter, searchQuery, "all");
    return sortMappings(filtered, sortBy);
  }, [mappingRows, searchQuery, sortBy, statusFilter]);

  const filteredSummary = useMemo(
    () => buildMappingStatusSummary(filteredRows),
    [filteredRows],
  );

  const paginatedRows = useMemo(() => {
    const start = page * rowsPerPage;
    return filteredRows.slice(start, start + rowsPerPage);
  }, [filteredRows, page, rowsPerPage]);

  useEffect(() => {
    setPage(0);
  }, [statusFilter, sortBy, searchQuery, rowsPerPage]);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(filteredRows.length / rowsPerPage) - 1);
    if (page > maxPage) {
      setPage(maxPage);
    }
  }, [filteredRows.length, page, rowsPerPage]);

  const selectedSortLabel =
    SORT_OPTIONS.find((option) => option.value === sortBy)?.label ??
    SORT_OPTIONS[0].label;

  const handleOpenMapping = (item: AllMappingListItem) => {
    setIsOpening(true);
    openMappingInBuilder(dispatch, { sttmId: item.id, projectId: item.projectId });
  };

  const coveragePercent = project ? Math.round(project.coverage_percent || 0) : 0;

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
          {/* Back navigation */}
          <AiaButton
            variant="text"
            size="small"
            startIcon={<ArrowBackRoundedIcon sx={{ fontSize: 16 }} />}
            onClick={() => router.push("/projects")}
            sx={{
              textTransform: "none",
              fontSize: 13,
              fontWeight: 600,
              color: "#64748b",
              px: 0,
              mb: 2,
              "&:hover": { bgcolor: "transparent", color: "#334155" },
            }}
          >
            All Projects
          </AiaButton>

          {/* Project header */}
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
              {isLoading ? (
                <AiaBox sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                  <CircularProgress size={18} />
                  <AiaText sx={{ ...SECONDARY_TEXT_SX }}>Loading project…</AiaText>
                </AiaBox>
              ) : project ? (
                <>
                  <AiaText sx={{ ...SECTION_TITLE_SX, letterSpacing: "-0.02em" }}>
                    {project.project_name}
                  </AiaText>
                  {project.description && (
                    <AiaText sx={{ ...SECONDARY_TEXT_SX, mt: 0.5 }}>
                      {project.description}
                    </AiaText>
                  )}
                  <AiaStack direction="row" spacing={2} sx={{ mt: 1.5, flexWrap: "wrap", gap: 1 }}>
                    <AiaBox
                      sx={{
                        px: 1.5,
                        py: 0.4,
                        borderRadius: "999px",
                        bgcolor: "#f0fdf4",
                        border: "1px solid #bbf7d0",
                      }}
                    >
                      <AiaText sx={{ fontSize: 12, fontWeight: 700, color: "#059669" }}>
                        {coveragePercent}% coverage
                      </AiaText>
                    </AiaBox>
                    <AiaText sx={{ ...SECONDARY_TEXT_SX, fontSize: 13 }}>
                      {project.sttm_count} mapping{project.sttm_count === 1 ? "" : "s"}
                      {project.complete_count > 0 ? ` · ${project.complete_count} complete` : ""}
                      {project.partial_count > 0 ? ` · ${project.partial_count} partial` : ""}
                      {project.draft_count > 0 ? ` · ${project.draft_count} draft` : ""}
                    </AiaText>
                  </AiaStack>
                </>
              ) : (
                <AiaText sx={{ ...SECONDARY_TEXT_SX }}>Project not found.</AiaText>
              )}
            </AiaBox>

            <AiaButton
              variant="contained"
              size="medium"
              startIcon={<AddRoundedIcon sx={{ fontSize: 18 }} />}
              onClick={() => setIsNewMappingOpen(true)}
              disabled={!project}
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

          {/* Filter bar */}
          <AiaBox className="mt-4 flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((filter) => (
              <AiaButton
                key={filter.value}
                onClick={() => setStatusFilter(filter.value)}
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
                    setSortAnchor(null);
                  }}
                  sx={{ fontSize: MAPPINGS_FONT_SIZE }}
                >
                  {option.label}
                </AiaMenuItem>
              ))}
            </AiaMenu>

            <AiaBox sx={{ width: { xs: "100%", sm: 220 } }}>
              <AiaSearchbox
                value={searchQuery}
                onChange={setSearchQuery}
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
            <AllMappingsTable rows={paginatedRows} onOpen={handleOpenMapping} />

            <MappingsTableFooter
              total={filteredSummary.total}
              complete={filteredSummary.complete}
              partial={filteredSummary.partial}
              draft={filteredSummary.draft}
              page={page}
              rowsPerPage={rowsPerPage}
              filteredCount={filteredRows.length}
              onPageChange={setPage}
              onRowsPerPageChange={setRowsPerPage}
            />
          </AiaPaper>
        </AiaBox>
      </AiaBox>

      {isOpening && (
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
              Opening mapping…
            </AiaText>
          </AiaPaper>
        </AiaBox>
      )}

      <NewMappingDialog
        open={isNewMappingOpen}
        onClose={() => setIsNewMappingOpen(false)}
        projectId={projectId}
      />
    </AiaBox>
  );
}
