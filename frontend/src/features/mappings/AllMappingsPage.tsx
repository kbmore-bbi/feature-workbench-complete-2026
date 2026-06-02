"use client";

import { useEffect, useMemo, useState } from "react";
import { KeyboardArrowDownRoundedIcon } from "@/utils/icons";
import { Box, Button, Menu, MenuItem, Paper, Typography } from "@mui/material";
import { useRouter, useSearchParams } from "next/navigation";
import { AiaSearchbox } from "@/components/ui/aia-searchbox";
import { useAppDispatch } from "@/store/hooks";
import AllMappingsTable from "./all-mappings-table";
import {
  ALL_MAPPINGS,
  SORT_OPTIONS,
  STATUS_FILTERS,
  buildMappingStatusSummary,
  filterMappings,
  sortMappings,
  type MappingSortOption,
  type MappingStatusFilter,
} from "./all-mappings-data";
import { openMappingInBuilder } from "./load-mapping-workspace";
import MappingsTableFooter from "./mappings-table-footer";
import {
  PROJECT_FILTER_ALL,
  buildMappingsUrl,
  getProjectFilterOptions,
  getProjectNameById,
  resolveProjectFilterFromParam,
} from "./mappings-project-filter";
import {
  MAPPINGS_BORDER_RADIUS,
  MAPPINGS_FONT_SIZE,
} from "./mappings-ui-styles";

const filterButtonSx = (active: boolean) => ({
  minWidth: 0,
  px: 1.5,
  py: 0.65,
  borderRadius: MAPPINGS_BORDER_RADIUS,
  textTransform: "none" as const,
  fontSize: MAPPINGS_FONT_SIZE,
  fontWeight: 600,
  boxShadow: "none",
  border: active ? "1px solid #111827" : "1px solid #E5E7EB",
  bgcolor: active ? "#111827" : "#FFFFFF",
  color: active ? "#FFFFFF" : "#374151",
  "&:hover": {
    bgcolor: active ? "#1F2937" : "#F9FAFB",
    borderColor: active ? "#1F2937" : "#D1D5DB",
    boxShadow: "none",
  },
});

const DEFAULT_ROWS_PER_PAGE = 5;
const PROJECT_FILTER_OPTIONS = getProjectFilterOptions();

export default function AllMappingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dispatch = useAppDispatch();
  const [statusFilter, setStatusFilter] = useState<MappingStatusFilter>("all");
  const [projectFilter, setProjectFilter] = useState(PROJECT_FILTER_ALL);
  const [sortBy, setSortBy] = useState<MappingSortOption>("latest-first");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortAnchor, setSortAnchor] = useState<null | HTMLElement>(null);
  const [projectAnchor, setProjectAnchor] = useState<null | HTMLElement>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);

  useEffect(() => {
    setProjectFilter(resolveProjectFilterFromParam(searchParams.get("project")));
  }, [searchParams]);

  const filteredRows = useMemo(() => {
    const filtered = filterMappings(
      ALL_MAPPINGS,
      statusFilter,
      searchQuery,
      projectFilter,
    );
    return sortMappings(filtered, sortBy);
  }, [projectFilter, searchQuery, sortBy, statusFilter]);

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
  }, [statusFilter, projectFilter, sortBy, searchQuery, rowsPerPage]);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(filteredRows.length / rowsPerPage) - 1);
    if (page > maxPage) {
      setPage(maxPage);
    }
  }, [filteredRows.length, page, rowsPerPage]);

  const selectedSortLabel =
    SORT_OPTIONS.find((option) => option.value === sortBy)?.label ??
    SORT_OPTIONS[0].label;

  const selectedProjectLabel =
    PROJECT_FILTER_OPTIONS.find((option) => option.value === projectFilter)?.label ??
    PROJECT_FILTER_OPTIONS[0].label;

  const selectedProjectName =
    projectFilter === PROJECT_FILTER_ALL ? undefined : getProjectNameById(projectFilter);

  const handleProjectFilterChange = (nextProjectFilter: string) => {
    setProjectFilter(nextProjectFilter);
    setProjectAnchor(null);
    router.replace(buildMappingsUrl(nextProjectFilter), { scroll: false });
  };

  const handleOpenMapping = () => {
    openMappingInBuilder(dispatch);
    router.push("/sttm/builder/new/summary");
  };

  return (
    <Box
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
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <Box className="px-5 py-4">
          <Box>
            <Typography
              className="font-semibold leading-[1.05] tracking-[-0.02em] text-[#111827]"
              sx={{ fontSize: "1.5rem" }}
            >
              All Mappings
            </Typography>
            <Typography className="mt-1 text-[14px] text-[#6B7280]">
              {filteredSummary.total} mapping{filteredSummary.total === 1 ? "" : "s"}
              {selectedProjectName ? ` in ${selectedProjectName}` : ""}
            </Typography>
          </Box>

          <Box className="mt-4 flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((filter) => (
              <Button
                key={filter.value}
                onClick={() => setStatusFilter(filter.value)}
                sx={filterButtonSx(statusFilter === filter.value)}
              >
                {filter.label}
              </Button>
            ))}

            <Button
              onClick={(event) => setSortAnchor(event.currentTarget)}
              endIcon={<KeyboardArrowDownRoundedIcon sx={{ fontSize: 14 }} />}
              sx={{
                ...filterButtonSx(false),
                minWidth: 160,
                justifyContent: "space-between",
              }}
            >
              {selectedSortLabel}
            </Button>

            <Menu
              anchorEl={sortAnchor}
              open={Boolean(sortAnchor)}
              onClose={() => setSortAnchor(null)}
              anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
              transformOrigin={{ vertical: "top", horizontal: "left" }}
            >
              {SORT_OPTIONS.map((option) => (
                <MenuItem
                  key={option.value}
                  selected={sortBy === option.value}
                  onClick={() => {
                    setSortBy(option.value);
                    setSortAnchor(null);
                  }}
                  sx={{ fontSize: MAPPINGS_FONT_SIZE }}
                >
                  {option.label}
                </MenuItem>
              ))}
            </Menu>

            <Button
              onClick={(event) => setProjectAnchor(event.currentTarget)}
              endIcon={<KeyboardArrowDownRoundedIcon sx={{ fontSize: 14 }} />}
              sx={{
                ...filterButtonSx(projectFilter !== PROJECT_FILTER_ALL),
                minWidth: 170,
                justifyContent: "space-between",
              }}
            >
              {selectedProjectLabel}
            </Button>

            <Menu
              anchorEl={projectAnchor}
              open={Boolean(projectAnchor)}
              onClose={() => setProjectAnchor(null)}
              anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
              transformOrigin={{ vertical: "top", horizontal: "left" }}
            >
              {PROJECT_FILTER_OPTIONS.map((option) => (
                <MenuItem
                  key={option.value}
                  selected={projectFilter === option.value}
                  onClick={() => handleProjectFilterChange(option.value)}
                  sx={{ fontSize: MAPPINGS_FONT_SIZE }}
                >
                  {option.label}
                </MenuItem>
              ))}
            </Menu>

            <Box sx={{ width: { xs: "100%", sm: 220 } }}>
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
            </Box>
          </Box>
        </Box>

        <Box className="min-w-0 px-5 pb-5">
          <Paper
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
          </Paper>
        </Box>
      </Box>
    </Box>
  );
}
