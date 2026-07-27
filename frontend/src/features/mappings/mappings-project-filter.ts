export const PROJECT_FILTER_ALL = "all";

export type ProjectFilterOption = {
  value: string;
  label: string;
};

export function getProjectFilterOptions(): ProjectFilterOption[] {
  return [{ value: PROJECT_FILTER_ALL, label: "All Projects" }];
}

export function resolveProjectFilterFromParam(projectParam: string | null): string {
  if (!projectParam || projectParam === PROJECT_FILTER_ALL) {
    return PROJECT_FILTER_ALL;
  }

  return projectParam;
}

export function getProjectNameById(projectId: string): string | undefined {
  void projectId;
  return undefined;
}

export function buildMappingsUrl(projectId?: string): string {
  if (!projectId || projectId === PROJECT_FILTER_ALL) {
    return "/mappings";
  }

  return `/mappings?project=${encodeURIComponent(projectId)}`;
}
