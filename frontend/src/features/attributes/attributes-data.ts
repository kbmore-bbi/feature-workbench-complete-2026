export const ATTRIBUTE_NAME_MAX_LENGTH = 255;

/** SQL-style identifier: starts with letter/underscore, then letters, digits, underscores. */
export const ATTRIBUTE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function getAttributeNameValidationError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return "Attribute name is required.";
  }
  if (trimmed.length > ATTRIBUTE_NAME_MAX_LENGTH) {
    return `Attribute name must be ${ATTRIBUTE_NAME_MAX_LENGTH} characters or fewer.`;
  }
  if (/\s/.test(name)) {
    return "Attribute name cannot contain spaces. Use underscores instead.";
  }
  if (/^\d/.test(trimmed)) {
    return "Attribute name must start with a letter or underscore.";
  }
  if (!ATTRIBUTE_NAME_PATTERN.test(trimmed)) {
    return "Use only letters, numbers, and underscores.";
  }
  return null;
}

export function isValidAttributeName(name: string): boolean {
  return getAttributeNameValidationError(name) === null;
}

export const ATTRIBUTE_TYPE_OPTIONS = [
  { value: "VARCHAR", label: "VARCHAR" },
  { value: "CHAR", label: "CHAR" },
  { value: "INT", label: "INT" },
  { value: "BIGINT", label: "BIGINT" },
  { value: "NUMBER", label: "NUMBER" },
  { value: "DECIMAL", label: "DECIMAL" },
  { value: "FLOAT", label: "FLOAT" },
  { value: "DOUBLE", label: "DOUBLE" },
  { value: "BOOLEAN", label: "BOOLEAN" },
  { value: "DATE", label: "DATE" },
  { value: "TIME", label: "TIME" },
  { value: "TIMESTAMP", label: "TIMESTAMP" },
  { value: "TIMESTAMP_NTZ", label: "TIMESTAMP_NTZ" },
  { value: "TIMESTAMP_LTZ", label: "TIMESTAMP_LTZ" },
  { value: "TIMESTAMP_TZ", label: "TIMESTAMP_TZ" },
  { value: "VARIANT", label: "VARIANT" },
  { value: "OBJECT", label: "OBJECT" },
  { value: "ARRAY", label: "ARRAY" },
] as const;

export type AttributeType = (typeof ATTRIBUTE_TYPE_OPTIONS)[number]["value"];

export type HardcodedAttribute = {
  id: string;
  attributeName: string;
  attributeType: AttributeType;
  projectId: string;
  projectName: string;
  /** Source project when imported; omit/null for attributes created in the current project. Shown as Imported Attribute. */
  importProjectName?: string | null;
  attributeValue: string;
};

export type NewAttributeFormValues = {
  attributeName: string;
  attributeType: AttributeType;
  projectName: string;
  attributeValue: string;
};

export type AttributeProjectOption = {
  id: string;
  name: string;
};

/** Sample hardcoded attributes across projects for import / landing demos. */
export const MOCK_HARDCODED_ATTRIBUTES: HardcodedAttribute[] = [
  {
    id: "attr-en-001",
    attributeName: "ENV_BASE_URL",
    attributeType: "VARCHAR",
    projectId: "1101",
    projectName: "EverNest Mapping Intelligence V2 Acceptance 2026-07-20",
    attributeValue: "http://localhost:3000",
  },
  {
    id: "attr-en-002",
    attributeName: "BATCH_SIZE",
    attributeType: "INT",
    projectId: "1101",
    projectName: "EverNest Mapping Intelligence V2 Acceptance 2026-07-20",
    attributeValue: "500",
  },
  {
    id: "attr-en-003",
    attributeName: "ACCEPTANCE_WINDOW_START",
    attributeType: "DATE",
    projectId: "1101",
    projectName: "EverNest Mapping Intelligence V2 Acceptance 2026-07-20",
    attributeValue: "2026-07-20",
  },
  {
    id: "attr-hh-001",
    attributeName: "AGENT_REBUILD_FLAG",
    attributeType: "BOOLEAN",
    projectId: "hh-rebuild",
    projectName: "EverNest Household Agent Rebuild Evaluation 2026-07-20",
    attributeValue: "true",
  },
  {
    id: "attr-hh-002",
    attributeName: "EVALUATION_RUN_ID",
    attributeType: "VARCHAR",
    projectId: "hh-rebuild",
    projectName: "EverNest Household Agent Rebuild Evaluation 2026-07-20",
    attributeValue: "HH-EVAL-2026-07",
  },
  {
    id: "attr-fir-001",
    attributeName: "FIR_VALIDATION_MODE",
    attributeType: "VARCHAR",
    projectId: "hh-fir",
    projectName: "EverNest Household FIR Validation",
    attributeValue: "STRICT",
  },
  {
    id: "attr-fir-002",
    attributeName: "FIR_SCORE_THRESHOLD",
    attributeType: "DECIMAL",
    projectId: "hh-fir",
    projectName: "EverNest Household FIR Validation",
    attributeValue: "0.85",
  },
  {
    id: "attr-np-001",
    attributeName: "DEFAULT_OWNER",
    attributeType: "VARCHAR",
    projectId: "new-project",
    projectName: "New project",
    attributeValue: "ANKURS",
  },
  {
    id: "attr-vi-001",
    attributeName: "INCOME_SOURCE_SYSTEM",
    attributeType: "VARCHAR",
    projectId: "verified-income",
    projectName: "Verified Income Migration",
    attributeValue: "INCOME_HUB",
  },
  {
    id: "attr-vi-002",
    attributeName: "VERIFICATION_CUTOFF",
    attributeType: "TIMESTAMP",
    projectId: "verified-income",
    projectName: "Verified Income Migration",
    attributeValue: "2026-07-01 00:00:00",
  },
  {
    id: "attr-sttm-001",
    attributeName: "PREVIEW_SCHEMA",
    attributeType: "VARCHAR",
    projectId: "sttm-preview",
    projectName: "STTM Preview Demo",
    attributeValue: "STTM_PREVIEW",
  },
  {
    id: "attr-sttm-002",
    attributeName: "DEMO_ROW_LIMIT",
    attributeType: "INT",
    projectId: "sttm-preview",
    projectName: "STTM Preview Demo",
    attributeValue: "100",
  },
];

function buildDemoAttributesForProject(project: AttributeProjectOption): HardcodedAttribute[] {
  const slug = project.name
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 24) || "PROJECT";
  return [
    {
      id: `attr-demo-${project.id}-1`,
      attributeName: `${slug}_DEFAULT_FLAG`,
      attributeType: "BOOLEAN",
      projectId: project.id,
      projectName: project.name,
      attributeValue: "true",
    },
    {
      id: `attr-demo-${project.id}-2`,
      attributeName: `${slug}_ENV`,
      attributeType: "VARCHAR",
      projectId: project.id,
      projectName: project.name,
      attributeValue: "ACCEPTANCE",
    },
  ];
}

export function filterImportableProjects(
  projects: AttributeProjectOption[],
  currentProjectId: string,
  currentProjectName?: string,
): AttributeProjectOption[] {
  const currentName = currentProjectName?.trim().toLowerCase() || "";
  return projects
    .filter((project) => {
      if (project.id === currentProjectId) {
        return false;
      }
      if (currentName && project.name.trim().toLowerCase() === currentName) {
        return false;
      }
      return Boolean(project.name.trim());
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Hardcoded attributes owned by a single project (empty when no project). */
export function getAttributesForProject(
  projectId: string | null | undefined,
  projectName?: string | null,
): HardcodedAttribute[] {
  if (!projectId) {
    return [];
  }

  const normalizedName = projectName?.trim().toLowerCase() || "";
  return MOCK_HARDCODED_ATTRIBUTES.filter(
    (item) =>
      item.projectId === projectId
      || (normalizedName && item.projectName.trim().toLowerCase() === normalizedName),
  ).map((item) => ({
    ...item,
    projectId,
    projectName: projectName?.trim() || item.projectName,
  }));
}

/**
 * Resolve attributes for selected API projects.
 * Matches mock rows by project id or name, then remaps to the live project identity.
 * Falls back to generated demo rows when no mock data exists for a project.
 */
export function getAttributesForSelectedProjects(
  selectedProjectIds: string[],
  projects: AttributeProjectOption[],
): HardcodedAttribute[] {
  if (selectedProjectIds.length === 0) {
    return [];
  }

  const selectedProjects = projects.filter((project) =>
    selectedProjectIds.includes(project.id),
  );
  const rows: HardcodedAttribute[] = [];

  for (const project of selectedProjects) {
    const matches = MOCK_HARDCODED_ATTRIBUTES.filter(
      (item) =>
        item.projectId === project.id ||
        item.projectName.trim().toLowerCase() === project.name.trim().toLowerCase(),
    );

    if (matches.length > 0) {
      rows.push(
        ...matches.map((item) => ({
          ...item,
          projectId: project.id,
          projectName: project.name,
        })),
      );
    } else {
      rows.push(...buildDemoAttributesForProject(project));
    }
  }

  return rows;
}
