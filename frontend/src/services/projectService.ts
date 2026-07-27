import { API_ROUTES } from "@/api/routes";
import { buildApiEnvelope, getApiData, postEnvelopeData } from "@/api/axiosInstance";
import { getProjectColorById, PROJECT_COLOR_OPTIONS } from "@/features/projects/project-color-options";
import type { ProjectItem, ProjectPerson } from "@/features/projects/projects-data";

type JsonRecord = Record<string, unknown>;

export type ProjectRecord = {
  project_id: string;
  project_name: string;
  description?: string | null;
  status: string;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  sttm_count: number;
  complete_count: number;
  partial_count: number;
  draft_count: number;
  total_mappings: number;
  mapped_count: number;
  coverage_percent: number;
  metadata?: JsonRecord | null;
  linked_project_ids?: string[];
};

export type STTMRecord = {
  sttm_id: string;
  project_id: string;
  sttm_name?: string | null;
  description?: string | null;
  target_table?: string | null;
  current_version: number;
  has_unpublished_draft: boolean;
  status: string;
  semantic_bundle_id?: string | null;
  semantic_bundle_hash?: string | null;
  last_snapshot_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  mapping_count: number;
  mapped_count: number;
  coverage_percent: number;
  metadata?: JsonRecord | null;
  linked_mapping_ids?: string[];
};

export type STTMDetail = {
  project?: ProjectRecord | null;
  sttm: STTMRecord;
  latest_snapshot?: JsonRecord | null;
  sources: JsonRecord[];
  mapping_rows: JsonRecord[];
  versions: JsonRecord[];
  agent_artifacts: JsonRecord[];
};

export type STTMAutosavePayload = {
  workspace_snapshot: JsonRecord;
  action?: string;
  session_id?: string | null;
  thread_id?: string | null;
  semantic_bundle_id?: string | null;
  semantic_bundle_hash?: string | null;
  mapping_version?: string | null;
  agent_artifacts?: JsonRecord[];
  fir_events?: JsonRecord[];
  metadata?: JsonRecord;
};

export type STTMPublishPayload = {
  revision_note?: string | null;
  workspace_snapshot?: JsonRecord | null;
  session_id?: string | null;
  thread_id?: string | null;
  semantic_bundle_id?: string | null;
  semantic_bundle_hash?: string | null;
  mapping_version?: string | null;
  metadata?: JsonRecord;
};

export type ProjectsSummary = {
  projects: ProjectRecord[];
  sttms: STTMRecord[];
};

const PROJECT_METADATA_CACHE_TTL_MS = 30_000;
const PROJECTS_SESSION_CACHE_KEY = "aia-workbench:projects:list:v2";
const PROJECT_SUMMARY_SESSION_CACHE_KEY = "aia-workbench:projects:summary:v2";

let projectsCache: { data: ProjectRecord[]; expiresAt: number } | null = null;
let projectsInFlight: Promise<ProjectRecord[]> | null = null;
let summaryCache: { data: ProjectsSummary; expiresAt: number } | null = null;
let summaryInFlight: Promise<ProjectsSummary> | null = null;
const sttmDetailBySnapshotId = new Map<string, STTMDetail>();
const sttmLatestPointers = new Map<string, { snapshotId: string; expiresAt: number }>();
const sttmDetailRequests = new Map<string, Promise<STTMDetail>>();

function isFresh<T>(entry: { data: T; expiresAt: number } | null): entry is { data: T; expiresAt: number } {
  return Boolean(entry && entry.expiresAt > Date.now());
}

function readSessionCache<T>(key: string): { data: T; expiresAt: number } | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { data?: T; expiresAt?: number };
    if (!parsed || typeof parsed.expiresAt !== "number" || parsed.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return { data: parsed.data as T, expiresAt: parsed.expiresAt };
  } catch {
    window.sessionStorage.removeItem(key);
    return null;
  }
}

function writeSessionCache<T>(key: string, entry: { data: T; expiresAt: number }) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Session storage is an optimization only. Ignore quota/security failures.
  }
}

function clearSessionProjectCaches() {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.removeItem(PROJECTS_SESSION_CACHE_KEY);
  window.sessionStorage.removeItem(PROJECT_SUMMARY_SESSION_CACHE_KEY);
}

export function invalidateProjectMetadataCache() {
  projectsCache = null;
  projectsInFlight = null;
  summaryCache = null;
  summaryInFlight = null;
  clearSessionProjectCaches();
}

function initialsFor(name?: string | null) {
  const value = (name || "AI Workbench").trim();
  const parts = value.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : value.slice(0, 2)).toUpperCase();
}

function formatTimestamp(value?: string | null) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  const day = date.getDate().toString().padStart(2, "0");
  const month = date.toLocaleString("en-GB", { month: "short" });
  const year = date.getFullYear();
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${day} ${month} ${year} · ${hours}:${minutes}`;
}

function personFor(name?: string | null, timestamp?: string | null): ProjectPerson {
  return {
    initials: initialsFor(name),
    name: name || "AI Workbench",
    timestamp: formatTimestamp(timestamp),
  };
}

function colorForRecord(record: ProjectRecord) {
  const metadata = record.metadata ?? {};
  const configuredId = typeof metadata.theme_color_id === "string" ? metadata.theme_color_id : "";
  if (configuredId) {
    return getProjectColorById(configuredId);
  }
  const index = Math.abs(
    Array.from(record.project_id || record.project_name).reduce(
      (hash, char) => (hash * 31 + char.charCodeAt(0)) | 0,
      0,
    ),
  ) % PROJECT_COLOR_OPTIONS.length;
  return PROJECT_COLOR_OPTIONS[index];
}

export function projectRecordToItem(record: ProjectRecord): ProjectItem {
  const color = colorForRecord(record);
  const createdBy = personFor(record.created_by, record.created_at);
  const modifiedBy = personFor(record.created_by, record.updated_at ?? record.created_at);

  return {
    id: record.project_id,
    name: record.project_name,
    description: record.description || "No description yet.",
    themeColor: color.color,
    themeBg: color.bg,
    themeBorder: color.color,
    coveragePercent: Math.round(record.coverage_percent || 0),
    coverageBarColor: color.color,
    totalMappings: record.total_mappings || record.sttm_count || 0,
    completeCount: record.complete_count || 0,
    partialCount: record.partial_count || 0,
    draftCount: record.draft_count || 0,
    createdBy,
    lastModifiedBy: modifiedBy,
    domain: typeof record.metadata?.domain === "string" ? record.metadata.domain : undefined,
    intendedOutcome: typeof record.metadata?.intended_outcome === "string" ? record.metadata.intended_outcome : undefined,
    businessProcess: typeof record.metadata?.business_process === "string" ? record.metadata.business_process : undefined,
    owner: typeof record.metadata?.owner === "string" ? record.metadata.owner : undefined,
    linkedProjectIds: record.linked_project_ids ?? [],
  };
}

export async function listProjects(): Promise<ProjectRecord[]> {
  if (isFresh(projectsCache)) {
    return projectsCache.data;
  }
  if (isFresh(summaryCache)) {
    projectsCache = {
      data: summaryCache.data.projects,
      expiresAt: Date.now() + PROJECT_METADATA_CACHE_TTL_MS,
    };
    return projectsCache.data;
  }
  const cachedSummary = readSessionCache<ProjectsSummary>(PROJECT_SUMMARY_SESSION_CACHE_KEY);
  if (isFresh(cachedSummary)) {
    summaryCache = cachedSummary;
    projectsCache = {
      data: cachedSummary.data.projects,
      expiresAt: cachedSummary.expiresAt,
    };
    return projectsCache.data;
  }
  const cachedProjects = readSessionCache<ProjectRecord[]>(PROJECTS_SESSION_CACHE_KEY);
  if (isFresh(cachedProjects)) {
    projectsCache = cachedProjects;
    return cachedProjects.data;
  }
  if (projectsInFlight) {
    return projectsInFlight;
  }
  projectsInFlight = getApiData<ProjectRecord[]>(API_ROUTES.projects.list, {
    skipGlobalError: true,
    timeout: 25000,
  })
    .then((projects) => {
      projectsCache = {
        data: projects,
        expiresAt: Date.now() + PROJECT_METADATA_CACHE_TTL_MS,
      };
      writeSessionCache(PROJECTS_SESSION_CACHE_KEY, projectsCache);
      return projects;
    })
    .finally(() => {
      projectsInFlight = null;
    });
  return projectsInFlight;
}

export async function createProject(params: {
  project_name: string;
  description?: string | null;
  theme_color_id?: string;
  domain?: string | null;
  intended_outcome?: string | null;
  business_process?: string | null;
  owner?: string | null;
  linked_project_ids?: string[];
}): Promise<ProjectRecord> {
  const project = await postEnvelopeData<ProjectRecord>(
    API_ROUTES.projects.create,
    buildApiEnvelope(
      "projects.create",
      {
        project_name: params.project_name,
        description: params.description ?? "",
        metadata: {
          theme_color_id: params.theme_color_id,
          domain: params.domain,
          intended_outcome: params.intended_outcome,
          business_process: params.business_process,
          owner: params.owner,
        },
        precedent_links: (params.linked_project_ids ?? []).map((projectId, index) => ({
          precedent_project_id: projectId,
          priority: Math.max(1, 100 - index),
          knowledge_categories: [
            "column_mapping",
            "relationship",
            "transformation",
            "query_shaping",
            "derived_lineage",
          ],
          allow_project_specific_values: false,
        })),
      },
      {},
    ),
    { timeout: 90000 },
  );
  invalidateProjectMetadataCache();
  return project;
}

export async function listProjectSttms(projectId: string): Promise<STTMRecord[]> {
  return getApiData<STTMRecord[]>(API_ROUTES.projects.sttms(projectId), {
    skipGlobalError: true,
    timeout: 15000,
  });
}

/**
 * Fetch all projects and all STTMs in a single request.
 * Avoids the N+1 pattern of listing projects then fetching per-project STTMs.
 * The caller groups STTMs by project_id client-side.
 */
export async function getAllProjectsSummary(): Promise<ProjectsSummary> {
  if (isFresh(summaryCache)) {
    return summaryCache.data;
  }
  const cachedSummary = readSessionCache<ProjectsSummary>(PROJECT_SUMMARY_SESSION_CACHE_KEY);
  if (isFresh(cachedSummary)) {
    summaryCache = cachedSummary;
    projectsCache = {
      data: cachedSummary.data.projects,
      expiresAt: cachedSummary.expiresAt,
    };
    return cachedSummary.data;
  }
  if (summaryInFlight) {
    return summaryInFlight;
  }
  summaryInFlight = getApiData<ProjectsSummary>(API_ROUTES.projects.summary, {
    skipGlobalError: true,
    timeout: 45000,
  })
    .then((summary) => {
      summaryCache = {
        data: summary,
        expiresAt: Date.now() + PROJECT_METADATA_CACHE_TTL_MS,
      };
      projectsCache = {
        data: summary.projects,
        expiresAt: Date.now() + PROJECT_METADATA_CACHE_TTL_MS,
      };
      writeSessionCache(PROJECT_SUMMARY_SESSION_CACHE_KEY, summaryCache);
      writeSessionCache(PROJECTS_SESSION_CACHE_KEY, projectsCache);
      return summary;
    })
    .finally(() => {
      summaryInFlight = null;
    });
  return summaryInFlight;
}

export async function createProjectSttm(
  projectId: string,
  payload: JsonRecord,
): Promise<STTMRecord> {
  const sttm = await postEnvelopeData<STTMRecord>(
    API_ROUTES.projects.sttms(projectId),
    buildApiEnvelope("projects.sttms.create", payload, { project_id: projectId }),
    { timeout: 90000 },
  );
  invalidateProjectMetadataCache();
  return sttm;
}

export async function getSttm(sttmId: string): Promise<STTMDetail> {
  const pointer = sttmLatestPointers.get(sttmId);
  if (pointer && pointer.expiresAt > Date.now()) {
    const immutableSnapshot = sttmDetailBySnapshotId.get(pointer.snapshotId);
    if (immutableSnapshot) return immutableSnapshot;
  }
  const pending = sttmDetailRequests.get(sttmId);
  if (pending) return pending;
  const request = getApiData<STTMDetail>(API_ROUTES.sttms.get(sttmId))
    .then((detail) => {
      const snapshot = detail.latest_snapshot ?? {};
      const snapshotId = String(
        detail.sttm.last_snapshot_id ?? snapshot.snapshot_id ?? `draft:${sttmId}`,
      );
      sttmDetailBySnapshotId.set(snapshotId, detail);
      sttmLatestPointers.set(sttmId, {
        snapshotId,
        expiresAt: Date.now() + PROJECT_METADATA_CACHE_TTL_MS,
      });
      if (sttmDetailBySnapshotId.size > 50) {
        const oldestSnapshotId = sttmDetailBySnapshotId.keys().next().value;
        if (oldestSnapshotId) sttmDetailBySnapshotId.delete(oldestSnapshotId);
      }
      return detail;
    })
    .finally(() => sttmDetailRequests.delete(sttmId));
  sttmDetailRequests.set(sttmId, request);
  return request;
}

export async function autosaveSttm(
  sttmId: string,
  payload: STTMAutosavePayload,
): Promise<JsonRecord> {
  const result = await postEnvelopeData<JsonRecord>(
    API_ROUTES.sttms.autosave(sttmId),
    buildApiEnvelope("sttms.autosave", payload, { sttm_id: sttmId }),
    // Snowflake-backed autosaves update the durable snapshot plus normalized
    // source/mapping/FIR projections. Allow that write to finish instead of
    // reporting a false failure at the global 30-second request limit.
    { skipGlobalError: true, timeout: 120_000 },
  );
  invalidateProjectMetadataCache();
  sttmLatestPointers.delete(sttmId);
  return result;
}

export async function publishSttm(
  sttmId: string,
  payload: STTMPublishPayload,
): Promise<JsonRecord> {
  const result = await postEnvelopeData<JsonRecord>(
    API_ROUTES.sttms.publish(sttmId),
    buildApiEnvelope("sttms.publish", payload, { sttm_id: sttmId }),
  );
  invalidateProjectMetadataCache();
  sttmLatestPointers.delete(sttmId);
  return result;
}
