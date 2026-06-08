"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import CodeRoundedIcon from "@mui/icons-material/CodeRounded";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import SourceRoundedIcon from "@mui/icons-material/SourceRounded";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import { SqlEditorSurface } from "@/components/sql/sql-editor-surface";
import { useSttmBuilderContext } from "@/features/sttm/context/sttm-builder-context";
import type {
  DbtConversionRequest,
  DbtConversionResponse,
  MappingSqlMappingItem,
  TableRef,
} from "@/types/api-contract";
import { dbService } from "@/services/dbService";

type DbtConversionTabProps = {
  active: boolean;
  validatedSql: string;
  generatedSql: string;
  sourceQuerySql: string;
  onCompleted?: (result: CachedDbtConversion) => void;
};

type ExplorerFile = {
  id: string;
  path: string;
  name: string;
  fileType: string;
  language: "sql" | "yaml" | "text";
  content: string;
  source: "generated" | "schema" | "source_update";
};

type ExplorerNode = {
  id: string;
  name: string;
  path: string;
  kind: "folder" | "file";
  file?: ExplorerFile;
  children?: ExplorerNode[];
};

type StepItem = {
  id: string;
  phase: string;
  message: string;
};

type StreamArtifacts = {
  generatedFiles: DbtConversionResponse["generated_files"];
  schemaFiles: DbtConversionResponse["schema_files"];
  sourceUpdate: DbtConversionResponse["source_update"];
};

export type CachedDbtConversion = {
  result: DbtConversionResponse;
  statusMessage: string;
  steps: StepItem[];
  streamArtifacts: StreamArtifacts;
  selectedFileId: string | null;
};

const completedDbtConversionCache = new Map<string, CachedDbtConversion>();

const CHECKLIST = [
  "File names should follow the standard release and project naming rules where applicable.",
  "Default DBT materialization should be incremental unless an explicit exception is required.",
  "DELETE statements must stay scoped to the exact impacted rows only.",
  "Use NULLIF for nullable string handling.",
  "Use MAX(datetime) logic for latest-row handling instead of max batch IDs.",
  "Add CT-table join columns when the source has extra join keys.",
  "Do not hardcode DBT values that belong in shared project config.",
  "Keep database and materialization defaults at the project level unless an override is truly needed.",
  "Use underscore-delimited, pluralized DBT model naming conventions.",
  "Use environment-driven database references only, never hardcoded environment values.",
];

function summarizeSignature(signature: string | null) {
  if (!signature) return "null";
  return `${signature.slice(0, 24)}... (${signature.length} chars)`;
}

function logDbtTelemetry(event: string, details: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const timestamp = new Date().toISOString();
  const entry = { timestamp, event, ...details };
  const telemetryWindow = window as Window & {
    __dbtConversionTelemetry?: Array<Record<string, unknown>>;
  };
  telemetryWindow.__dbtConversionTelemetry = [
    ...(telemetryWindow.__dbtConversionTelemetry ?? []).slice(-199),
    entry,
  ];
  console.info("[DBT Conversion]", entry);
}

function buildArtifactStepMessage(kind: string, filePath: string) {
  if (kind === "generated_file") {
    return `Generated file ready: ${filePath}`;
  }
  if (kind === "schema_file") {
    return `Schema file ready: ${filePath}`;
  }
  if (kind === "source_update") {
    return `Source YAML update ready: ${filePath}`;
  }
  return `Artifact ready: ${filePath}`;
}

function toSingleLineSummary(message: string | null | undefined) {
  const normalized = String(message ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "DBT conversion completed.";
  }
  return normalized;
}

function toTableRef(qualifiedName: string): TableRef | null {
  const [database, schema, table] = qualifiedName.split(".", 3);
  if (!database || !schema || !table) return null;
  return { database, schema, table };
}

function buildSelectedColumnsByTable(
  groups: Array<{ qualifiedName: string; columns: Array<{ name?: string }> }>,
): Record<string, string[]> {
  return groups.reduce<Record<string, string[]>>((acc, group) => {
    const selected = group.columns.map((column) => column.name).filter((value): value is string => Boolean(value));
    if (selected.length) {
      acc[group.qualifiedName] = selected;
    }
    return acc;
  }, {});
}

function mapSummaryMappings(
  mappings: Array<{
    targetColumn: string;
    targetType: string;
    sourceColumn: string | null;
    sourceColumns?: string[];
    expression: string | null;
    rule: string;
    status: string;
    nlRule?: string | null;
    description?: string | null;
  }>,
): MappingSqlMappingItem[] {
  return mappings.map((mapping) => ({
    target_column: mapping.targetColumn,
    target_type: mapping.targetType || null,
    source_column: mapping.sourceColumn ?? null,
    source_columns: mapping.sourceColumns ?? [],
    expression: mapping.expression ?? null,
    rule: mapping.rule ?? null,
    status: mapping.status ?? null,
    nl_rule: mapping.nlRule ?? null,
    description: mapping.description ?? null,
  }));
}

type DbtConversionRequestBuilderParams = {
  targets: Array<{ isSelected: boolean; qualifiedName: string }>;
  sources: Array<{ isSelected: boolean; qualifiedName: string }>;
  relationships: Array<{
    leftTableId?: string;
    rightTableId?: string;
    constraintName?: string | null;
    joinType?: string;
    source?: string | null;
    locked?: boolean;
    conditions?: Array<{
      leftColumn?: string;
      rightColumn?: string;
      operator?: string;
    }>;
  }>;
  derivedSources: Array<{ isSelected?: boolean; id: string }>;
  sourceAttributeGroups: Array<{ qualifiedName: string; columns: Array<{ name?: string }> }>;
  mappings: Array<{
    targetColumn: string;
    targetType: string;
    sourceColumn: string | null;
    sourceColumns?: string[];
    expression: string | null;
    rule: string;
    status: string;
    nlRule?: string | null;
    description?: string | null;
  }>;
  semanticBundleId?: string | null;
  semanticBundleLabel?: string | null;
  semanticViewName?: string | null;
  semanticContextItems?: DbtConversionRequest["semantic_context"] | null;
  semanticLineage?: DbtConversionRequest["derived_source_lineage"] | null;
  semanticDatahubContext?: DbtConversionRequest["datahub_context"];
  sourceQuerySql: string;
  validatedSql: string;
  generatedSql: string;
};

export function buildDbtConversionRequestPayload(
  params: DbtConversionRequestBuilderParams,
): DbtConversionRequest | null {
  const {
    targets,
    sources,
    relationships,
    derivedSources,
    sourceAttributeGroups,
    mappings,
    semanticBundleId,
    semanticBundleLabel,
    semanticViewName,
    semanticContextItems,
    semanticLineage,
    semanticDatahubContext,
    sourceQuerySql,
    validatedSql,
    generatedSql,
  } = params;

  const selectedTarget = targets.find((table) => table.isSelected);
  const targetTable = selectedTarget ? toTableRef(selectedTarget.qualifiedName) : null;
  if (!targetTable) return null;

  const sourceTables = sources
    .filter((table) => table.isSelected)
    .map((table) => toTableRef(table.qualifiedName))
    .filter((table): table is TableRef => Boolean(table));

  const relationshipPayload = relationships
    .filter((join) => join.leftTableId && join.rightTableId && join.conditions?.length)
    .map((join) => {
      const leftTable = toTableRef(String(join.leftTableId));
      const rightTable = toTableRef(String(join.rightTableId));
      if (!leftTable || !rightTable) return null;
      return {
        left_table: leftTable,
        right_table: rightTable,
        constraint_name: join.constraintName ?? null,
        join_type: join.joinType ?? "INNER",
        source: join.source ?? "USER_DEFINED",
        locked: join.locked ?? false,
        conditions: (join.conditions ?? [])
          .filter((condition) => condition.leftColumn && condition.rightColumn)
          .map((condition) => ({
            left_column: String(condition.leftColumn),
            right_column: String(condition.rightColumn),
            operator: condition.operator ?? "=",
          })),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const sourceSchemas = sourceTables.map((table) => table.schema);

  return {
    project_name: `${targetTable.table} DBT Conversion`,
    domain_name: deriveDomainName(targetTable.schema, sourceSchemas),
    target_layer: deriveLayer(targetTable.schema),
    materialization: deriveLayer(targetTable.schema) === "mart" ? "view" : "incremental",
    source_tables: sourceTables,
    target_table: targetTable,
    driving_table: null,
    selected_derived_sources: derivedSources.filter((source) => source.isSelected).map((source) => source.id),
    relationships: relationshipPayload,
    selected_columns_by_table: buildSelectedColumnsByTable(sourceAttributeGroups),
    semantic_bundle_id: semanticBundleId,
    semantic_bundle_label: semanticBundleLabel,
    semantic_view_name: semanticViewName,
    source_query_sql: sourceQuerySql || null,
    validated_sql: validatedSql,
    generated_sql: generatedSql || null,
    mappings: mapSummaryMappings(mappings.filter((mapping) => mapping.status === "MAPPED")),
    semantic_context: semanticContextItems ?? [],
    derived_source_lineage: semanticLineage ?? [],
    datahub_context: semanticDatahubContext ?? null,
    checklist: CHECKLIST,
  };
}

export function getCachedDbtConversion(
  requestPayload: DbtConversionRequest | null,
): CachedDbtConversion | null {
  if (!requestPayload) {
    return null;
  }
  return completedDbtConversionCache.get(JSON.stringify(requestPayload)) ?? null;
}

function deriveDomainName(targetSchema: string | null, sourceSchemas: string[]): string | null {
  for (const value of [targetSchema, ...sourceSchemas]) {
    if (!value) continue;
    const normalized = value.trim().toLowerCase();
    for (const prefix of ["curated_", "raw_", "mart_", "api_", "ds_"]) {
      if (normalized.startsWith(prefix)) {
        return normalized.slice(prefix.length);
      }
    }
    if (normalized.includes("_")) {
      return normalized.split("_").slice(1).join("_");
    }
    return normalized;
  }
  return null;
}

function deriveLayer(schemaName: string | null): "raw" | "curated" | "mart" {
  const normalized = (schemaName ?? "").trim().toLowerCase();
  if (normalized.startsWith("mart_")) return "mart";
  if (normalized.startsWith("raw_")) return "raw";
  return "curated";
}

function flattenFiles(result: DbtConversionResponse | null): ExplorerFile[] {
  if (!result) return [];

  const files: ExplorerFile[] = [
    ...result.generated_files.map((file) => ({
      id: `generated:${file.file_path}`,
      path: file.file_path,
      name: file.file_name,
      fileType: file.file_type,
      language: file.language,
      content: file.content,
      source: "generated" as const,
    })),
    ...result.schema_files.map((file) => ({
      id: `schema:${file.file_path}`,
      path: file.file_path,
      name: file.file_name,
      fileType: file.file_type,
      language: file.language,
      content: file.content,
      source: "schema" as const,
    })),
  ];

  if (result.source_update?.content?.trim()) {
    files.push({
      id: `source_update:${result.source_update.file_path}`,
      path: result.source_update.file_path,
      name: result.source_update.file_path.split("/").pop() ?? result.source_update.file_path,
      fileType: "SOURCE",
      language: result.source_update.language,
      content: result.source_update.content,
      source: "source_update",
    });
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function flattenStreamArtifacts(artifacts: StreamArtifacts): ExplorerFile[] {
  return flattenFiles({
    status: "running",
    action: null,
    message: null,
    generated_files: artifacts.generatedFiles,
    source_update: artifacts.sourceUpdate,
    schema_files: artifacts.schemaFiles,
    macros_used: [],
    materialization: null,
    materialization_reason: null,
    agent_name: "",
    domain_name: null,
    target_layer: null,
    branch: "main",
  });
}

function appendGeneratedFile(
  files: DbtConversionResponse["generated_files"],
  file: DbtConversionResponse["generated_files"][number],
) {
  if (files.some((item) => item.file_path === file.file_path && item.content === file.content)) {
    return files;
  }
  return [...files, file];
}

function buildTree(files: ExplorerFile[], parentPath = ""): ExplorerNode[] {
  const grouped = new Map<string, ExplorerFile[]>();
  const directFiles: ExplorerNode[] = [];

  for (const file of files) {
    const relativePath = parentPath ? file.path.slice(parentPath.length + 1) : file.path;
    const segments = relativePath.split("/").filter(Boolean);
    if (segments.length <= 1) {
      directFiles.push({
        id: file.id,
        name: segments[0] ?? file.name,
        path: file.path,
        kind: "file",
        file,
      });
      continue;
    }
    const folderName = segments[0];
    const folderPath = parentPath ? `${parentPath}/${folderName}` : folderName;
    const nextFile = { ...file, path: parentPath ? file.path : file.path };
    const bucket = grouped.get(folderPath) ?? [];
    bucket.push(nextFile);
    grouped.set(folderPath, bucket);
  }

  const folderNodes = Array.from(grouped.entries()).map(([folderPath, bucket]) => ({
    id: folderPath,
    name: folderPath.split("/").pop() ?? folderPath,
    path: folderPath,
    kind: "folder" as const,
    children: buildTree(bucket, folderPath),
  }));

  return [...folderNodes, ...directFiles].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

function FileTree({
  nodes,
  expanded,
  onToggle,
  selectedFileId,
  onSelectFile,
  depth = 0,
}: {
  nodes: ExplorerNode[];
  expanded: Set<string>;
  onToggle: (path: string) => void;
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
  depth?: number;
}) {
  return (
    <Stack spacing={0.35}>
      {nodes.map((node) => {
        if (node.kind === "folder") {
          const isExpanded = expanded.has(node.path);
          return (
            <Box key={node.path}>
              <Button
                fullWidth
                variant="text"
                onClick={() => onToggle(node.path)}
                sx={{
                  justifyContent: "flex-start",
                  textTransform: "none",
                  px: 1,
                  py: 0.7,
                  minHeight: 0,
                  borderRadius: 1.5,
                  color: "#334155",
                  pl: 1 + depth * 1.6,
                  "&:hover": { backgroundColor: "#eef2ff" },
                }}
              >
                {isExpanded ? (
                  <FolderOpenRoundedIcon sx={{ fontSize: 17, color: "#2563eb", mr: 0.8 }} />
                ) : (
                  <FolderRoundedIcon sx={{ fontSize: 17, color: "#64748b", mr: 0.8 }} />
                )}
                <Typography sx={{ fontSize: "0.78rem", fontWeight: 600, color: "inherit" }}>
                  {node.name}
                </Typography>
              </Button>
              {isExpanded && node.children?.length ? (
                <Box sx={{ mt: 0.3 }}>
                  <FileTree
                    nodes={node.children}
                    expanded={expanded}
                    onToggle={onToggle}
                    selectedFileId={selectedFileId}
                    onSelectFile={onSelectFile}
                    depth={depth + 1}
                  />
                </Box>
              ) : null}
            </Box>
          );
        }

        const selected = selectedFileId === node.file?.id;
        return (
          <Button
            key={node.path}
            fullWidth
            variant="text"
            onClick={() => node.file && onSelectFile(node.file.id)}
            sx={{
              justifyContent: "flex-start",
              textTransform: "none",
              px: 1,
              py: 0.75,
              minHeight: 0,
              borderRadius: 1.5,
              pl: 1 + depth * 1.6,
              bgcolor: selected ? "#e0f2fe" : "transparent",
              color: selected ? "#0f172a" : "#475569",
              border: selected ? "1px solid #bae6fd" : "1px solid transparent",
              "&:hover": {
                backgroundColor: selected ? "#e0f2fe" : "#f8fafc",
              },
            }}
          >
            {node.file?.source === "source_update" ? (
              <SourceRoundedIcon sx={{ fontSize: 16, mr: 0.8, color: "#0ea5e9" }} />
            ) : (
              <DescriptionOutlinedIcon sx={{ fontSize: 16, mr: 0.8, color: "#64748b" }} />
            )}
            <Typography
              sx={{
                fontSize: "0.77rem",
                fontWeight: selected ? 700 : 500,
                color: "inherit",
                textAlign: "left",
                wordBreak: "break-word",
              }}
            >
              {node.name}
            </Typography>
          </Button>
        );
      })}
    </Stack>
  );
}

export function DbtConversionTab({
  active,
  validatedSql,
  generatedSql,
  sourceQuerySql,
  onCompleted,
}: DbtConversionTabProps) {
  const {
    sources,
    targets,
    relationships,
    derivedSources,
    sourceAttributeGroups,
    mappings,
    semanticBundleId,
    semanticBundleLabel,
    semanticViewName,
    semanticContextItems,
    semanticLineage,
    semanticDatahubContext,
  } = useSttmBuilderContext();

  const [status, setStatus] = useState<"idle" | "running" | "completed" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("Preparing DBT conversion...");
  const [steps, setSteps] = useState<StepItem[]>([]);
  const [result, setResult] = useState<DbtConversionResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(["models"]));
  const [summaryDismissed, setSummaryDismissed] = useState(false);
  const [streamArtifacts, setStreamArtifacts] = useState<StreamArtifacts>({
    generatedFiles: [],
    schemaFiles: [],
    sourceUpdate: null,
  });
  const observedSignatureRef = useRef<string | null>(null);
  const requestPayloadRef = useRef<DbtConversionRequest | null>(null);
  const stepCounterRef = useRef(0);

  const requestPayload = useMemo<DbtConversionRequest | null>(
    () =>
      buildDbtConversionRequestPayload({
        targets,
        sources,
        relationships,
        derivedSources,
        sourceAttributeGroups,
        mappings,
        semanticBundleId,
        semanticBundleLabel,
        semanticViewName,
        semanticContextItems,
        semanticLineage,
        semanticDatahubContext,
        sourceQuerySql,
        validatedSql,
        generatedSql,
      }),
    [
      derivedSources,
      generatedSql,
      mappings,
      relationships,
      semanticBundleId,
      semanticBundleLabel,
      semanticContextItems,
      semanticDatahubContext,
      semanticLineage,
      semanticViewName,
      sourceAttributeGroups,
      sourceQuerySql,
      sources,
      targets,
      validatedSql,
    ],
  );

  const requestSignature = useMemo(
    () => (requestPayload ? JSON.stringify(requestPayload) : null),
    [requestPayload],
  );

  useEffect(() => {
    requestPayloadRef.current = requestPayload;
  }, [requestPayload]);

  useEffect(() => {
    if (!requestSignature) {
      return;
    }
    const cached = completedDbtConversionCache.get(requestSignature);
    if (!cached) {
      return;
    }
    setStatus("completed");
    setStatusMessage(cached.statusMessage);
    setSteps(cached.steps);
    setResult(cached.result);
    setErrorMessage(null);
    setStreamArtifacts(cached.streamArtifacts);
    setSelectedFileId(cached.selectedFileId);
    setSummaryDismissed(false);
  }, [requestSignature]);

  useEffect(() => {
    if (!requestSignature) return;
    if (observedSignatureRef.current === requestSignature) return;
    logDbtTelemetry("request_signature_changed", {
      previousSignature: summarizeSignature(observedSignatureRef.current),
      nextSignature: summarizeSignature(requestSignature),
    });
    observedSignatureRef.current = requestSignature;
  }, [requestSignature]);

  const fileEntries = useMemo(
    () => (result ? flattenFiles(result) : flattenStreamArtifacts(streamArtifacts)),
    [result, streamArtifacts],
  );
  const fileTree = useMemo(() => buildTree(fileEntries), [fileEntries]);
  const selectedFile = fileEntries.find((file) => file.id === selectedFileId) ?? fileEntries[0] ?? null;
  const showEmptyState = !requestPayload || !validatedSql.trim() || requestPayload.mappings.length === 0;
  const compactSummary = useMemo(() => {
    if (status === "running") {
      return statusMessage;
    }
    if (status === "completed") {
      return toSingleLineSummary(result?.message || statusMessage);
    }
    return statusMessage;
  }, [result?.message, status, statusMessage]);
  const showStatusBanner = !showEmptyState && (status !== "completed" || !summaryDismissed);

  useEffect(() => {
    if (!fileEntries.length) {
      setSelectedFileId(null);
      return;
    }
    if (!selectedFileId || !fileEntries.some((file) => file.id === selectedFileId)) {
      setSelectedFileId(fileEntries[0].id);
    }
  }, [fileEntries, selectedFileId]);

  useEffect(() => {
    const payload = requestPayloadRef.current;
    if (!payload || !requestSignature) return;
    if (!validatedSql.trim() || payload.mappings.length === 0) return;
    if (retryNonce === 0 && completedDbtConversionCache.has(requestSignature)) return;

    logDbtTelemetry("effect_start", {
      requestSignature: summarizeSignature(requestSignature),
      retryNonce,
      hasValidatedSql: Boolean(validatedSql.trim()),
      mappedCount: payload.mappings.length,
    });
    const abortController = new AbortController();
    let receivedFinal = false;
    let idleTimedOut = false;
    let idleTimer: number | null = null;

    const clearIdleTimer = () => {
      if (idleTimer !== null) {
        window.clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    const armIdleTimer = () => {
      clearIdleTimer();
      idleTimer = window.setTimeout(() => {
        idleTimedOut = true;
        abortController.abort("dbt_stream_idle_timeout");
      }, 150000);
    };

    const appendStep = (phase: string, message: string) => {
      setSteps((current) => {
        const trimmed = message.trim();
        if (!trimmed) return current;
        const last = current[current.length - 1];
        if (last?.message === trimmed) {
          return current;
        }
        return [
          ...current.slice(-9),
          {
            id: `step-${stepCounterRef.current++}`,
            phase,
            message: trimmed,
          },
        ];
      });
    };

    const run = async () => {
      setStatus("running");
      setStatusMessage("Starting DBT conversion from the summary SQL...");
      setSteps([
        {
          id: `boot-${stepCounterRef.current++}`,
          phase: "request_prepared",
          message: "Starting DBT conversion from the summary SQL.",
        },
      ]);
      setSummaryDismissed(false);
      setErrorMessage(null);
      setResult(null);
      setStreamArtifacts({
        generatedFiles: [],
        schemaFiles: [],
        sourceUpdate: null,
      });
      armIdleTimer();

      try {
        for await (const event of dbService.streamDbtConversion(payload, abortController.signal, {
          onEvent: (telemetryEvent) => {
            if (telemetryEvent.type === "fetch_begin") {
              logDbtTelemetry("fetch_begin", {
                requestSignature: summarizeSignature(requestSignature),
                url: telemetryEvent.url,
              });
              return;
            }
            if (telemetryEvent.type === "fetch_resolved") {
              logDbtTelemetry("fetch_resolved", {
                requestSignature: summarizeSignature(requestSignature),
                url: telemetryEvent.url,
                status: telemetryEvent.status,
                ok: telemetryEvent.ok,
                headers: telemetryEvent.headers,
              });
              return;
            }
            if (telemetryEvent.type === "first_chunk") {
              logDbtTelemetry("first_chunk", {
                requestSignature: summarizeSignature(requestSignature),
                byteLength: telemetryEvent.byteLength,
              });
              return;
            }
            if (telemetryEvent.type === "sse_event") {
              logDbtTelemetry("sse_event", {
                requestSignature: summarizeSignature(requestSignature),
                eventName: telemetryEvent.eventName,
              });
            }
          },
        })) {
          armIdleTimer();
          if (event.event === "status") {
            const phase = typeof event.data.phase === "string" ? event.data.phase : "agent_progress";
            const message =
              typeof event.data.message === "string"
                ? event.data.message
                : "AGT_DBT_CONVERSION is working on the request.";
            setStatusMessage(message);
            appendStep(phase, message);
            continue;
          }
          if (event.event === "artifact") {
            const kind = typeof event.data.kind === "string" ? event.data.kind : "";
            const file = event.data.file;
            if (!file || typeof file !== "object") {
              continue;
            }
            const filePath =
              typeof (file as { file_path?: unknown }).file_path === "string"
                ? String((file as { file_path?: unknown }).file_path)
                : "unknown";
            appendStep("file_ready", buildArtifactStepMessage(kind, filePath));
            if (kind === "generated_file") {
              setStreamArtifacts((current) => ({
                ...current,
                generatedFiles: appendGeneratedFile(
                  current.generatedFiles,
                  file as DbtConversionResponse["generated_files"][number],
                ),
              }));
              continue;
            }
            if (kind === "schema_file") {
              setStreamArtifacts((current) => ({
                ...current,
                schemaFiles: appendGeneratedFile(
                  current.schemaFiles,
                  file as DbtConversionResponse["schema_files"][number],
                ),
              }));
              continue;
            }
            if (kind === "source_update") {
              setStreamArtifacts((current) => ({
                ...current,
                sourceUpdate: file as NonNullable<DbtConversionResponse["source_update"]>,
              }));
            }
            continue;
          }
          if (event.event === "error") {
            throw new Error(event.data.message || "DBT conversion stream failed.");
          }
          if (event.event === "final") {
            receivedFinal = true;
            const envelope = event.data as {
              data?: DbtConversionResponse;
              error?: { detail?: string | null; title?: string | null } | null;
            };
            const finalData = envelope.data ?? null;
            if (!finalData) {
              throw new Error("DBT conversion finished without a result payload.");
            }
            setResult(finalData);
            if (envelope.error) {
              const detail = envelope.error.detail || envelope.error.title || "DBT conversion failed.";
              setStatus("error");
              setErrorMessage(detail);
              setStatusMessage(detail);
              appendStep("failed", detail);
            } else {
              setStatus("completed");
              setStatusMessage(finalData.message || "DBT conversion completed.");
              appendStep("completed", finalData.message || "DBT conversion completed.");
              const cachedResult: CachedDbtConversion = {
                result: finalData,
                statusMessage: finalData.message || "DBT conversion completed.",
                steps: [],
                streamArtifacts: {
                  generatedFiles: finalData.generated_files,
                  schemaFiles: finalData.schema_files,
                  sourceUpdate: finalData.source_update ?? null,
                },
                selectedFileId: null,
              };
              completedDbtConversionCache.set(requestSignature, cachedResult);
              onCompleted?.(cachedResult);
            }
          }
        }
        if (!receivedFinal) {
          const detail =
            "AGT_DBT_CONVERSION ended the stream before returning a final payload.";
          setStatus("error");
          setErrorMessage(detail);
          setStatusMessage(detail);
          appendStep("failed", detail);
        }
      } catch (error) {
        if (abortController.signal.aborted && idleTimedOut) {
          const detail =
            "AGT_DBT_CONVERSION stopped sending updates before the conversion finished. Please retry and check the latest stream step.";
          setStatus("error");
          setErrorMessage(detail);
          setStatusMessage(detail);
          appendStep("timeout", detail);
          return;
        }
        if (abortController.signal.aborted) {
          logDbtTelemetry("effect_aborted", {
            requestSignature: summarizeSignature(requestSignature),
            reason:
              typeof abortController.signal.reason === "string"
                ? abortController.signal.reason
                : "aborted",
          });
          return;
        }
        const detail =
          error instanceof Error ? error.message : "Unable to generate DBT conversion.";
        setStatus("error");
        setErrorMessage(detail);
        setStatusMessage(detail);
        appendStep("failed", detail);
      } finally {
        clearIdleTimer();
      }
    };

    void run();

    return () => {
      clearIdleTimer();
      logDbtTelemetry("effect_cleanup_abort", {
        requestSignature: summarizeSignature(requestSignature),
        reason: "effect_cleanup",
      });
      abortController.abort();
    };
  }, [onCompleted, requestSignature, retryNonce, validatedSql]);

  return (
    <Box
      sx={{
        display: active ? "flex" : "none",
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        overflow: "hidden",
        flexDirection: "column",
        bgcolor: "#ffffff",
      }}
    >
      <Box sx={{ px: 2, py: 1.5, borderBottom: "1px solid #e5e7eb", backgroundColor: "#ffffff" }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <AutoAwesomeRoundedIcon sx={{ fontSize: 18, color: "#2563eb" }} />
          <Typography sx={{ fontSize: "0.88rem", fontWeight: 700, color: "#111827" }}>
            DBT Conversion
          </Typography>
          {result?.action ? (
            <Chip
              label={result.action.replaceAll("_", " ")}
              size="small"
              sx={{ height: 22, fontSize: "0.68rem", fontWeight: 700, bgcolor: "#eff6ff", color: "#1d4ed8" }}
            />
          ) : null}
          {result?.materialization ? (
            <Chip
              label={`Materialization: ${result.materialization}`}
              size="small"
              sx={{ height: 22, fontSize: "0.68rem", fontWeight: 700, bgcolor: "#f8fafc", color: "#334155" }}
            />
          ) : null}
          {result?.source_update ? (
            <Chip
              label={`Sources YAML: ${result.source_update.action}`}
              size="small"
              sx={{ height: 22, fontSize: "0.68rem", fontWeight: 700, bgcolor: "#f0fdf4", color: "#166534" }}
            />
          ) : null}
        </Stack>
      </Box>

      <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
        {showEmptyState ? (
          <Alert severity="info" sx={{ borderRadius: 2 }}>
            Map at least one target column to start DBT conversion from the summary SQL.
          </Alert>
        ) : showStatusBanner ? (
          <Alert
            severity={status === "error" ? "error" : status === "completed" ? "success" : "info"}
            sx={{ borderRadius: 2, alignItems: "center", py: 0.25 }}
          >
            <Stack spacing={0.6} sx={{ width: "100%" }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                {status === "running" ? (
                  <CircularProgress size={16} sx={{ color: "#2563eb" }} />
                ) : status === "completed" ? (
                  <CheckCircleRoundedIcon sx={{ fontSize: 18, color: "#16a34a" }} />
                ) : status === "error" ? (
                  <ErrorOutlineRoundedIcon sx={{ fontSize: 18, color: "#dc2626" }} />
                ) : (
                  <CodeRoundedIcon sx={{ fontSize: 18, color: "#2563eb" }} />
                )}
                <Typography
                  sx={{
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    flex: 1,
                    minWidth: 0,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {compactSummary}
                </Typography>
                {status === "error" ? (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<RefreshRoundedIcon sx={{ fontSize: 16 }} />}
                    onClick={() => {
                      if (requestSignature) {
                        completedDbtConversionCache.delete(requestSignature);
                      }
                      setRetryNonce((current) => current + 1);
                    }}
                    sx={{ ml: "auto", textTransform: "none" }}
                  >
                    Retry
                  </Button>
                ) : null}
                {status === "completed" ? (
                  <IconButton
                    size="small"
                    onClick={() => setSummaryDismissed(true)}
                    sx={{ ml: "auto", color: "#64748b" }}
                  >
                    <CloseRoundedIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                ) : null}
              </Stack>
              {status === "running" ? (
                <LinearProgress
                  sx={{
                    height: 6,
                    borderRadius: 999,
                    bgcolor: "rgba(148,163,184,0.18)",
                  }}
                />
              ) : null}
              {status !== "running" && result?.materialization_reason ? (
                <Typography sx={{ fontSize: "0.75rem", color: "#64748b", lineHeight: 1.45 }}>
                  {result.materialization_reason}
                </Typography>
              ) : null}
            </Stack>
          </Alert>
        ) : null}
      </Box>

      <Box sx={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden", px: 2, pb: 2, gap: 2 }}>
        <Box
          sx={{
            width: 280,
            minWidth: 240,
            maxWidth: 320,
            border: "1px solid #e5e7eb",
            borderRadius: 2.5,
            backgroundColor: "#f8fafc",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <Box sx={{ px: 1.5, py: 1.25, borderBottom: "1px solid #e5e7eb", backgroundColor: "#ffffff" }}>
            <Typography sx={{ fontSize: "0.76rem", fontWeight: 700, color: "#0f172a" }}>
              Generated Files
            </Typography>
            <Typography sx={{ fontSize: "0.72rem", color: "#64748b", mt: 0.35 }}>
              {fileEntries.length
                ? `${fileEntries.length} file${fileEntries.length === 1 ? "" : "s"} available`
                : status === "running"
                  ? "Waiting for agent output..."
                  : "No files generated yet."}
            </Typography>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: 1 }}>
            {fileTree.length ? (
              <FileTree
                nodes={fileTree}
                expanded={expandedPaths}
                onToggle={(path) =>
                  setExpandedPaths((current) => {
                    const next = new Set(current);
                    if (next.has(path)) {
                      next.delete(path);
                    } else {
                      next.add(path);
                    }
                    return next;
                  })
                }
                selectedFileId={selectedFileId}
                onSelectFile={setSelectedFileId}
              />
            ) : (
              <Stack spacing={1}>
                <Typography sx={{ fontSize: "0.75rem", color: "#64748b", lineHeight: 1.6 }}>
                  {status === "running"
                    ? "Waiting for the first generated dbt file..."
                    : "No files generated yet."}
                </Typography>
                {errorMessage ? (
                  <Alert severity="error" sx={{ borderRadius: 2 }}>
                    {errorMessage}
                  </Alert>
                ) : null}
              </Stack>
            )}
          </Box>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              border: "1px solid #e5e7eb",
              borderRadius: 2.5,
              backgroundColor: "#0f172a",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <Box
              sx={{
                px: 2,
                py: 1.2,
                borderBottom: "1px solid rgba(148,163,184,0.18)",
                backgroundColor: "#111827",
                display: "flex",
                alignItems: "center",
                gap: 1,
                minWidth: 0,
              }}
            >
              <DescriptionOutlinedIcon sx={{ fontSize: 16, color: "#94a3b8" }} />
              <Typography
                sx={{
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  color: "#e2e8f0",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {selectedFile?.path ?? "No file selected"}
              </Typography>
              {selectedFile ? (
                <Chip
                  label={selectedFile.fileType}
                  size="small"
                  sx={{ ml: "auto", height: 20, fontSize: "0.65rem", bgcolor: "#1e293b", color: "#cbd5e1" }}
                />
              ) : null}
            </Box>

            {selectedFile ? (
              selectedFile.language === "sql" ? (
                <SqlEditorSurface
                  value={selectedFile.content}
                  readOnly
                  compact
                  emptyText="-- No SQL content to display."
                />
              ) : (
                <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 2, py: 1.5 }}>
                  <Typography
                    component="pre"
                    sx={{
                      m: 0,
                      color: "#e2e8f0",
                      fontFamily: `"SFMono-Regular", ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", monospace`,
                      fontSize: "13px",
                      lineHeight: 1.7,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {selectedFile.content}
                  </Typography>
                </Box>
              )
            ) : (
              <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", px: 3 }}>
                <Stack spacing={1.25} sx={{ alignItems: "center", textAlign: "center", maxWidth: 420 }}>
                  {status === "running" ? (
                    <CircularProgress size={26} sx={{ color: "#60a5fa" }} />
                  ) : (
                    <CodeRoundedIcon sx={{ fontSize: 28, color: "#94a3b8" }} />
                  )}
                  <Typography sx={{ fontSize: "0.9rem", fontWeight: 700, color: "#e2e8f0" }}>
                    {status === "running" ? "Generating dbt files..." : "No dbt file selected yet"}
                  </Typography>
                  <Typography sx={{ fontSize: "0.78rem", color: "#94a3b8", lineHeight: 1.6 }}>
                    {status === "running"
                      ? "The agent is loading repo context, checking matching models, and composing the final file set."
                      : "When the conversion finishes, choose a file from the left sidebar to inspect the generated SQL or YAML."}
                  </Typography>
                </Stack>
              </Box>
            )}
          </Box>

          {result?.macros_used?.length ? (
            <Box
              sx={{
                borderRadius: 2,
                border: "1px solid #e5e7eb",
                backgroundColor: "#ffffff",
                p: 1.5,
              }}
            >
              <Typography sx={{ fontSize: "0.76rem", fontWeight: 700, color: "#111827", mb: 0.9 }}>
                Macros Used
              </Typography>
              <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
                {result.macros_used.map((macro) => (
                  <Chip
                    key={macro}
                    label={macro}
                    size="small"
                    sx={{ height: 22, fontSize: "0.68rem", fontWeight: 700, bgcolor: "#eff6ff", color: "#1d4ed8" }}
                  />
                ))}
              </Stack>
            </Box>
          ) : null}
        </Box>
      </Box>
    </Box>
  );
}
