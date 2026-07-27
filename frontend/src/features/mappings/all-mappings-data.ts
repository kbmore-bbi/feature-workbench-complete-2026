export type MappingListStatus = "Complete" | "Partial" | "Draft";

export type AllMappingListItem = {
  id: string;
  index: number;
  name: string;
  qualifiedName: string;
  status: MappingListStatus;
  projectId: string;
  projectName: string;
  aiSummary: string;
  createdBy: {
    initials: string;
    name: string;
  };
  createdAt: string;
  relativeTime: string;
};

export type MappingSortOption = "latest-first" | "name-asc" | "status";

export type MappingStatusFilter = "all" | "complete" | "partial" | "draft";

export const MAPPING_STATUS_SUMMARY = {
  total: 0,
  complete: 0,
  partial: 0,
  draft: 0,
};

export const SORT_OPTIONS: { value: MappingSortOption; label: string }[] = [
  { value: "latest-first", label: "Sort: Latest first" },
  { value: "name-asc", label: "Sort: Name A-Z" },
  { value: "status", label: "Sort: Status" },
];

export const STATUS_FILTERS: { value: MappingStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "complete", label: "Complete" },
  { value: "partial", label: "Partial" },
  { value: "draft", label: "Draft" },
];

const STATUS_ORDER: Record<MappingListStatus, number> = {
  Complete: 0,
  Partial: 1,
  Draft: 2,
};

export function buildMappingStatusSummary(items: AllMappingListItem[]) {
  return {
    total: items.length,
    complete: items.filter((item) => item.status === "Complete").length,
    partial: items.filter((item) => item.status === "Partial").length,
    draft: items.filter((item) => item.status === "Draft").length,
  };
}

export function filterMappings(
  items: AllMappingListItem[],
  statusFilter: MappingStatusFilter,
  searchQuery: string,
  projectFilter = "all",
): AllMappingListItem[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();

  return items.filter((item) => {
    const matchesProject =
      projectFilter === "all" || item.projectId === projectFilter;

    if (!matchesProject) {
      return false;
    }

    const matchesStatus =
      statusFilter === "all" || item.status.toLowerCase() === statusFilter;

    if (!matchesStatus) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const haystack = [
      item.name,
      item.qualifiedName,
      item.projectName,
      item.aiSummary,
      item.createdBy.name,
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}

export function sortMappings(
  items: AllMappingListItem[],
  sortBy: MappingSortOption,
): AllMappingListItem[] {
  const sorted = [...items];

  if (sortBy === "name-asc") {
    return sorted.sort((a, b) => a.name.localeCompare(b.name));
  }

  if (sortBy === "status") {
    return sorted.sort(
      (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
    );
  }

  return sorted.sort((a, b) => a.index - b.index);
}
