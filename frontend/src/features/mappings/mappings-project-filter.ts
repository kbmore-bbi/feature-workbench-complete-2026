import { INITIAL_PROJECT_ITEMS } from "@/features/projects/projects-data";

export const PROJECT_FILTER_ALL = "all";

export type ProjectFilterOption = {
  value: string;
  label: string;
};

export function getProjectFilterOptions(): ProjectFilterOption[] {
  return [
    { value: PROJECT_FILTER_ALL, label: "All Projects" },
    ...INITIAL_PROJECT_ITEMS.map((project) => ({
      value: project.id,
      label: project.name,
    })),
  ];
}

export function resolveProjectFilterFromParam(projectParam: string | null): string {
  if (!projectParam || projectParam === PROJECT_FILTER_ALL) {
    return PROJECT_FILTER_ALL;
  }

  const isKnownProject = INITIAL_PROJECT_ITEMS.some((project) => project.id === projectParam);
  return isKnownProject ? projectParam : PROJECT_FILTER_ALL;
}

export function getProjectNameById(projectId: string): string | undefined {
  return INITIAL_PROJECT_ITEMS.find((project) => project.id === projectId)?.name;
}

export function buildMappingsUrl(projectId?: string): string {
  if (!projectId || projectId === PROJECT_FILTER_ALL) {
    return "/mappings";
  }

  return `/mappings?project=${encodeURIComponent(projectId)}`;
}
