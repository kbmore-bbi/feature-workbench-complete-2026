import type { ProjectColorOption } from "./project-color-options";
import type { ProjectItem, ProjectPerson } from "./projects-data";

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function formatProjectTimestamp(date: Date): string {
  const day = date.getDate().toString().padStart(2, "0");
  const month = date.toLocaleString("en-GB", { month: "short" });
  const year = date.getFullYear();
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");

  return `${day} ${month} ${year} · ${hours}:${minutes}`;
}

export function buildProjectsSummary(items: ProjectItem[]) {
  return {
    projectCount: items.length,
    totalMappings: items.reduce((sum, project) => sum + project.totalMappings, 0),
    complete: items.reduce((sum, project) => sum + project.completeCount, 0),
    inProgress: items.reduce(
      (sum, project) => sum + project.partialCount + project.draftCount,
      0,
    ),
  };
}

export function createProjectItem(params: {
  name: string;
  description: string;
  color: ProjectColorOption;
  createdBy?: ProjectPerson;
  domain?: string;
  intendedOutcome?: string;
  businessProcess?: string;
  owner?: string;
  linkedProjectIds?: string[];
}): ProjectItem {
  const timestamp = formatProjectTimestamp(new Date());
  const person =
    params.createdBy ??
    ({
      initials: "SW",
      name: "Shane Watson",
      timestamp,
    } satisfies ProjectPerson);

  const trimmedName = params.name.trim();
  const trimmedDescription = params.description.trim();

  return {
    id: `${slugify(trimmedName) || "project"}-${Date.now()}`,
    name: trimmedName,
    description: trimmedDescription || "No description yet.",
    themeColor: params.color.color,
    themeBg: params.color.bg,
    themeBorder: params.color.color,
    coveragePercent: 0,
    coverageBarColor: params.color.color,
    totalMappings: 0,
    completeCount: 0,
    partialCount: 0,
    draftCount: 0,
    createdBy: person,
    lastModifiedBy: person,
    domain: params.domain?.trim() || undefined,
    intendedOutcome: params.intendedOutcome?.trim() || undefined,
    businessProcess: params.businessProcess?.trim() || undefined,
    owner: params.owner?.trim() || undefined,
    linkedProjectIds: params.linkedProjectIds ?? [],
  };
}
