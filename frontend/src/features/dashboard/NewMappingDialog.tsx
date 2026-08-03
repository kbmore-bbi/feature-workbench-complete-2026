"use client";
import { AiaBox, AiaButton, AiaIconButton, AiaSelect, AiaStack } from '@/components/ui';
import { AiaInput } from '@/components/ui/aia-input';
import { AiaText } from '@/components/ui/aia-text';
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AddRoundedIcon,
  ArrowForwardRoundedIcon,
  CloseRoundedIcon,
  GridOnRoundedIcon,
  TerminalRoundedIcon,
  ViewKanbanRoundedIcon,
} from "@/utils/icons";
import { TOUR_TARGETS } from "@/features/tour/constants/tour-targets";
import { useTour } from "@/features/tour/engine/tour-context";
import { API_ROUTES } from "@/api/routes";
import { useRouter } from "next/navigation";
import { useAppDispatch } from "@/store/hooks";
import {
  openSttmFromBackend,
} from "@/features/sttm/store/sttm-builder-slice";
import { buildSqlUploadWorkspace } from "@/features/sttm/mapping/sql-upload-workspace";
import type { ParsedSqlWorkspaceApplyPayload } from "@/features/sttm/types/sttm.types";
import {
  SqlBundleReviewPanel,
  type SqlUploadResult as UploadResult,
} from "@/features/sttm/mapping/sql-bundle-review-panel";
import { resolveApiBaseUrl } from "@/api/axiosInstance";
import {
  createProjectAttribute,
  createProjectSttm,
  getAllProjectsSummary,
  listProjectAttributes,
} from "@/services/projectService";

type MappingCreationMode = "sql" | "excel" | "manual" | null;

export type NewMappingManualDetails = {
  name: string;
  description: string;
  linkedMappingIds: string[];
  projectId?: string;
};

export type NewMappingProjectOption = {
  value: string;
  label: string;
};

type NewMappingDialogProps = {
  open: boolean;
  onClose: () => void;
  projectId?: string;
  projectOptions?: NewMappingProjectOption[];
  precedentMappings?: Array<{ id: string; name: string; projectName: string }>;
};

function tableRefFromQualifiedName(qualifiedName: string | null | undefined) {
  const [database, schema, table] = String(qualifiedName ?? "").split(".", 3);
  return database && schema && table ? { database, schema, table } : null;
}

function uploadWorkspaceSnapshot(workspace: ParsedSqlWorkspaceApplyPayload) {
  return {
    page: workspace.targetTableFqn ? "mapping" : "builder",
    source_tables: workspace.sourceTableFqns
      .map(tableRefFromQualifiedName)
      .filter(Boolean),
    target_table: tableRefFromQualifiedName(workspace.targetTableFqn),
    mapping_rows: workspace.mappings.map((mapping) => ({
      id: mapping.id,
      target_column: mapping.targetColumn,
      target_type: mapping.targetType,
      source_columns: mapping.sourceColumns ?? [],
      mapping_mode: mapping.mappingMode ?? "source",
      constant_value: mapping.constantValue ?? null,
      attribute_name: mapping.attributeName ?? null,
      expression: mapping.expression ?? null,
      rule: mapping.rule,
      status: mapping.status,
    })),
    relationships: workspace.relationships.map((relationship) => ({
      id: relationship.id,
      left_table: relationship.leftTableId,
      right_table: relationship.rightTableId,
      join_type: relationship.joinType,
      source: relationship.source,
      conditions: (relationship.conditions ?? []).map((condition) => ({
        left_column: condition.leftColumn,
        operator: condition.operator,
        right_column: condition.rightColumn,
      })),
    })),
    derived_sources: workspace.derivedSources.map((source, index) => ({
      id: `upload-derived:${source.name}:${index}`,
      name: source.name,
      sql_text: source.sqlText,
      table_ids: source.inputTables,
      output_columns: source.outputColumns ?? [],
      purpose: source.purpose ?? null,
    })),
    filters: { filter_sql: workspace.filterSql },
    raw_mapping_sql: workspace.sql,
  };
}

type MappingOption = {
  id: Exclude<MappingCreationMode, null>;
  label: string;
  badge?: string;
  badgeBg: string;
  badgeFg: string;
  description: string;
  icon: React.ReactNode;
};

const OPTIONS: MappingOption[] = [
  {
    id: "sql",
    label: "SQL Upload",
    badge: "AUTO-GENERATE",
    badgeBg: "#ede9fe",
    badgeFg: "#7c3aed",
    description: "Upload a SQL file and auto-generate the source-to-target mapping from your query.",
    icon: <TerminalRoundedIcon sx={{ fontSize: 24, color: "#64748b" }} />,
  },
  {
    id: "excel",
    label: "Upload Excel File",
    badge: "IMPORT",
    badgeBg: "#dcfce7",
    badgeFg: "#059669",
    description: "Import an existing mapping spreadsheet to populate the STTM grid automatically.",
    icon: <GridOnRoundedIcon sx={{ fontSize: 24, color: "#64748b" }} />,
  },
  {
    id: "manual",
    label: "Build Mapping Manually",
    badgeBg: "transparent",
    badgeFg: "#0f172a",
    description: "Select source tables, define joins, and map columns step by step through the guided workflow.",
    icon: <ViewKanbanRoundedIcon sx={{ fontSize: 24, color: "#64748b" }} />,
  },
];

export default function NewMappingDialog({
  open,
  onClose,
  projectId,
  projectOptions: projectOptionsProp,
  precedentMappings = [],
}: NewMappingDialogProps) {
  const dispatch = useAppDispatch();
  const { registerModalTour, startTour } = useTour();
  const [selectedMode, setSelectedMode] = useState<MappingCreationMode>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [mappingName, setMappingName] = useState("");
  const [mappingDescription, setMappingDescription] = useState("");
  const [sourceTableHints, setSourceTableHints] = useState("");
  const [targetTableHint, setTargetTableHint] = useState("");
  const [linkedMappingIds, setLinkedMappingIds] = useState<string[]>([]);
  const [loadedProjectOptions, setLoadedProjectOptions] = useState<NewMappingProjectOption[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const sqlInputRef = useRef<HTMLInputElement | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      registerModalTour(null);
      return;
    }
    registerModalTour("new-mapping");
    return () => registerModalTour(null);
  }, [open, registerModalTour]);

  useEffect(() => {
    if (open) {
      setSelectedProjectId(projectId?.trim() || "");
    }
  }, [open, projectId]);

  useEffect(() => {
    if (!open || (projectOptionsProp && projectOptionsProp.length > 0)) return;
    let cancelled = false;
    setIsLoadingProjects(true);
    getAllProjectsSummary()
      .then(({ projects }) => {
        if (!cancelled) {
          setLoadedProjectOptions(projects.map((project) => ({
            value: project.project_id,
            label: project.project_name,
          })));
        }
      })
      .catch(() => {
        if (!cancelled) setLoadedProjectOptions([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingProjects(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectOptionsProp]);

  const projectOptions = useMemo(
    () => projectOptionsProp?.length ? projectOptionsProp : loadedProjectOptions,
    [loadedProjectOptions, projectOptionsProp],
  );

  const selectedOption = useMemo(
    () => OPTIONS.find((option) => option.id === selectedMode) ?? null,
    [selectedMode],
  );
  const canSubmitManual = Boolean(
    selectedProjectId.trim() && mappingName.trim() && mappingDescription.trim(),
  );

  const handleClose = () => {
    setSelectedMode(null);
    setSelectedProjectId(projectId?.trim() || "");
    setMappingName("");
    setMappingDescription("");
    setSourceTableHints("");
    setTargetTableHint("");
    setLinkedMappingIds([]);
    setUploadResult(null);
    setSelectedProjectValueNames([]);
    setLearningComplete(false);
    onClose();
  };

  const handleUploadSelection = (input: HTMLInputElement | null) => {
    if (!input) {
      return;
    }
    input.value = "";
    input.click();
  };

  const handleProceed = async () => {
    if (!selectedMode) {
      return;
    }

    if (selectedMode === "manual") {
      if (!canSubmitManual) return;
      const details: NewMappingManualDetails = {
        name: mappingName.trim(),
        description: mappingDescription.trim(),
        linkedMappingIds,
        projectId: selectedProjectId.trim(),
      };
      setUploading(true);
      try {
        const sttm = await createProjectSttm(details.projectId ?? "", {
          sttm_name: details.name,
          description: details.description || null,
          precedent_links: details.linkedMappingIds.map((sttmId, index) => ({
            precedent_sttm_id: sttmId,
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
        });
        await dispatch(openSttmFromBackend({
          sttmId: sttm.sttm_id,
          projectId: details.projectId ?? "",
        })).unwrap();
        setSelectedMode(null);
        setMappingName("");
        setMappingDescription("");
        setLinkedMappingIds([]);
        onClose();
        router.push("/sttm/builder/new");
      } catch (error) {
        alert(error instanceof Error ? error.message : "Unable to create mapping.");
      } finally {
        setUploading(false);
      }
      return;
    }

    handleUploadSelection(selectedMode === "sql" ? sqlInputRef.current : excelInputRef.current);
  };

  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [learningInProgress, setLearningInProgress] = useState(false);
  const [learningComplete, setLearningComplete] = useState(false);
  const [selectedProjectValueNames, setSelectedProjectValueNames] = useState<string[]>([]);

  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    type: "sql" | "excel"
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert("File exceeds 5MB limit");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("project_id", selectedProjectId || projectId || "default");
      formData.append("mode", "auto_populate");
      formData.append("source_table_hints", sourceTableHints.trim());
      formData.append("target_table_hint", targetTableHint.trim());

      const endpoint = type === "sql" ? API_ROUTES.upload.sql : API_ROUTES.upload.excel;
      const response = await fetch(`${resolveApiBaseUrl()}${endpoint}`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const raw = await response.text();
        let detail = raw;
        try {
          const parsed = JSON.parse(raw);
          detail = typeof parsed?.detail === "string"
            ? parsed.detail
            : JSON.stringify(parsed?.detail ?? parsed);
        } catch {
          // Keep the backend text response.
        }
        alert(detail || `Upload failed (${response.status})`);
        return;
      }

      const result = await response.json() as UploadResult;
      const uploaded = { ...result, filename: file.name };
      setUploadResult(uploaded);
      const bindings = uploaded.import_preview?.project_value_candidates
        ?? uploaded.parsed_summary?.variable_bindings
        ?? [];
      setSelectedProjectValueNames(
        bindings
          .filter((item) => item.project_value_candidate)
          .map((item) => item.name),
      );
    } catch {
      alert("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const handleContinueEditing = async () => {
    if (!uploadResult) return;
    const selectedProject = selectedProjectId || projectId || "";
    if (!selectedProject) return;
    setUploading(true);
    try {
      const workspace = buildSqlUploadWorkspace(uploadResult, {
        approvedProjectValueNames: selectedProjectValueNames,
      });
      const existingAttributes = await listProjectAttributes(selectedProject);
      const attributesByName = new Map(
        existingAttributes.map((attribute) => [attribute.attribute_name.toUpperCase(), attribute]),
      );
      const parsedBindings = uploadResult.import_preview?.project_value_candidates
        ?? uploadResult.parsed_summary?.variable_bindings
        ?? [];
      const selectedKeys = new Set(selectedProjectValueNames.map((name) => name.toUpperCase()));
      for (const binding of parsedBindings) {
        if (!binding.project_value_candidate || !selectedKeys.has(binding.name.toUpperCase())) continue;
        if (binding.resolved_value === null || binding.resolved_value === undefined) continue;
        const key = binding.name.toUpperCase();
        const existing = attributesByName.get(key);
        if (existing) {
          if (existing.attribute_value !== String(binding.resolved_value)) {
            throw new Error(
              `Project Value ${binding.name} already exists with a different value. Review it in Hardcoded Values before applying this SQL preview.`,
            );
          }
          continue;
        }
        const created = await createProjectAttribute(selectedProject, {
          attribute_name: binding.name,
          attribute_type: String(binding.inferred_type || "VARCHAR").toUpperCase(),
          attribute_value: String(binding.resolved_value),
        });
        attributesByName.set(key, created);
      }
      for (const mapping of workspace.mappings) {
        if (mapping.mappingMode !== "attribute" || !mapping.attributeName) continue;
        const key = mapping.attributeName.toUpperCase();
        const existing = attributesByName.get(key);
        if (existing) {
          mapping.constantValue = existing.attribute_value;
          continue;
        }
        const created = await createProjectAttribute(selectedProject, {
          attribute_name: mapping.attributeName,
          attribute_type:
            !mapping.targetType || mapping.targetType.toUpperCase() === "TEXT"
              ? "VARCHAR"
              : mapping.targetType,
          attribute_value: String(mapping.constantValue ?? ""),
        });
        attributesByName.set(key, created);
        mapping.constantValue = created.attribute_value;
      }
      const filename = uploadResult.filename || "SQL mapping";
      const sttm = await createProjectSttm(selectedProject, {
        sttm_name: filename.replace(/\.[^.]+$/, ""),
        description: `Imported from ${filename}`,
        target_table: tableRefFromQualifiedName(workspace.targetTableFqn),
        workspace_snapshot: uploadWorkspaceSnapshot(workspace),
      });
      await dispatch(openSttmFromBackend({
        sttmId: sttm.sttm_id,
        projectId: selectedProject,
      })).unwrap();
      sessionStorage.removeItem("upload_parsed_data");
      setUploadResult(null);
      setSelectedMode(null);
      onClose();
      router.push(
        workspace.targetTableFqn
          ? "/sttm/builder/new/mapping?source=upload"
          : "/sttm/builder/new?source=upload",
      );
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unable to create mapping from SQL.");
    } finally {
      setUploading(false);
    }
  };

  const handleUseAsLearning = async () => {
    if (!uploadResult?.asset_id) return;
    setLearningInProgress(true);
    try {
      const formData = new FormData();
      formData.append("asset_id", uploadResult.asset_id);
      formData.append("project_id", selectedProjectId || projectId || "default");
      formData.append("approved_project_values", JSON.stringify(selectedProjectValueNames));
      const response = await fetch(
        `${resolveApiBaseUrl()}${API_ROUTES.upload.triggerLearning}`,
        {
        method: "POST",
        body: formData,
        },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: "Learning failed" }));
        alert(err.detail || "Failed to create learnings.");
        return;
      }
      const queued = await response.json().catch(() => ({}));
      const jobId = String(
        queued?.learning_job_id
        ?? uploadResult.learning_job_id
        ?? "",
      );
      if (jobId) {
        let status = String(queued?.learning_job?.status ?? "running");
        let attempts = 0;
        while (!["completed", "failed"].includes(status) && attempts < 20) {
          attempts += 1;
          const resume = await fetch(
            `${resolveApiBaseUrl()}${API_ROUTES.workbench.firJobResume(jobId)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ max_items: 10 }),
            },
          );
          if (!resume.ok) break;
          const envelope = await resume.json().catch(() => ({}));
          status = String(envelope?.data?.status ?? "running");
        }
      }
      setLearningComplete(true);
    } catch {
      alert("Failed to create learnings. Please try again.");
    } finally {
      setLearningInProgress(false);
    }
  };

  const handleLearningDone = () => {
    setUploadResult(null);
    setSelectedProjectValueNames([]);
    setLearningComplete(false);
    setSelectedMode(null);
    onClose();
  };

  if (!open) {
    return (
      <>
        <input
          ref={sqlInputRef}
          type="file"
          accept=".sql,text/sql,application/sql"
          hidden
          onChange={(e) => handleFileUpload(e, "sql")}
        />
        <input
          ref={excelInputRef}
          type="file"
          accept=".xlsx,.xls,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          hidden
          onChange={(e) => handleFileUpload(e, "excel")}
        />
      </>
    );
  }

  return (
    <>
      <AiaBox
        role="dialog"
        aria-modal="true"
        aria-label="New Mapping"
        onClick={(event) => {
          // The precedent multi-select uses a portal. Its option clicks bubble
          // through the React tree and must not close/reset the mapping form.
          if (event.target === event.currentTarget) {
            handleClose();
          }
        }}
        sx={{
          position: "fixed",
          inset: 0,
          zIndex: 1400,
          px: { xs: 1, sm: 2 },
          py: { xs: 1, sm: 2 },
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(15, 23, 42, 0.42)",
          backdropFilter: "blur(4px)",
        }}
      >
        <AiaBox
          data-tour={TOUR_TARGETS.newMappingModal}
          onClick={(event) => event.stopPropagation()}
          sx={{
            width: "100%",
            maxWidth: 728,
            maxHeight: "calc(100dvh - 16px)",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            borderRadius: "24px",
            border: "1px solid rgba(15, 23, 42, 0.08)",
            boxShadow: "0 30px 60px rgba(15, 23, 42, 0.18)",
            overflow: "hidden",
            backgroundColor: "#fff",
          }}
        >
          <AiaBox
            sx={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 2,
              px: 4,
              py: 3.25,
              flexShrink: 0,
              borderBottom: "1px solid #edf2f7",
            }}
          >
            <AiaStack direction="row" spacing={2} sx={{ alignItems: "center" }}>
              <AiaBox
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: "14px",
                  bgcolor: "var(--aia-button-color)",
                  color: "var(--aia-button-text-color)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <AddRoundedIcon sx={{ fontSize: 28 }} />
              </AiaBox>
              <AiaBox>
                <AiaText sx={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
                  New Mapping
                </AiaText>
                <AiaText sx={{ fontSize: 14, color: "#64748b", mt: 0.5 }}>
                  Choose how you&apos;d like to create this mapping
                </AiaText>
              </AiaBox>
            </AiaStack>

            <AiaStack direction="row" spacing={1} sx={{ alignItems: "center", flexShrink: 0 }}>
              <AiaButton
                variant="contained"
                size="small"
                onClick={() => startTour("new-mapping")}
                aria-label="Start New Mapping tour guide"
                sx={{
                  textTransform: "none",
                  fontWeight: 700,
                  fontSize: 13,
                  borderRadius: "10px",
                  px: 1.5,
                  py: 0.6,
                  minHeight: 34,
                  backgroundColor: "var(--aia-primary-bg-color)",
                  color: "var(--aia-primary-bg-text-color)",
                  boxShadow: "none",
                  "&:hover": {
                    backgroundColor: "var(--aia-primary-bg-hover-color)",
                  },
                }}
              >
                Tour Guide
              </AiaButton>
              <AiaIconButton
                onClick={handleClose}
              sx={{
                border: "1px solid #e2e8f0",
                color: "#64748b",
                bgcolor: "#fff",
                "&:hover": {
                  bgcolor: "#f8fafc",
                },
              }}
            >
              <CloseRoundedIcon sx={{ fontSize: 18 }} />
            </AiaIconButton>
            </AiaStack>
          </AiaBox>

          <AiaBox sx={{ minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
          {uploadResult ? (
            <AiaBox sx={{ px: { xs: 2, sm: 4 }, py: { xs: 2, sm: 3.5 }, minWidth: 0 }}>
              {learningComplete ? (
                <AiaStack spacing={2} sx={{ alignItems: "center", py: 2 }}>
                  <AiaBox sx={{ width: 56, height: 56, borderRadius: "50%", bgcolor: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <AiaText sx={{ fontSize: 28 }}>&#10003;</AiaText>
                  </AiaBox>
                  <AiaText sx={{ fontSize: 16, fontWeight: 700, color: "#0f172a", textAlign: "center" }}>
                    Document Queued for Learning
                  </AiaText>
                  <AiaText sx={{ fontSize: 13.5, color: "#64748b", textAlign: "center" }}>
                    FIR will resolve the referenced tables and prepare evidence, inferences, and recommendations offline.
                  </AiaText>
                  <AiaButton variant="contained" color="primary" rounded="lg" size="medium" onClick={handleLearningDone} sx={{ mt: 1, borderRadius: "14px", fontWeight: 700 }}>
                    Done
                  </AiaButton>
                </AiaStack>
              ) : learningInProgress ? (
                <AiaStack spacing={2} sx={{ alignItems: "center", py: 3 }}>
                  <AiaBox sx={{ width: 48, height: 48, borderRadius: "50%", border: "3px solid #e2e8f0", borderTopColor: "var(--aia-button-color)", animation: "spin 1s linear infinite", "@keyframes spin": { from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } } }} />
                  <AiaText sx={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>
                    Queueing Document...
                  </AiaText>
                  <AiaText sx={{ fontSize: 13, color: "#64748b", textAlign: "center" }}>
                    Saving this document for the next offline FIR cycle.
                  </AiaText>
                </AiaStack>
              ) : (
                <AiaStack spacing={2.5}>
                  <AiaBox sx={{ p: 2, borderRadius: "12px", bgcolor: "#f8fafc", border: "1px solid #e2e8f0" }}>
                    <AiaText sx={{ fontSize: 13, fontWeight: 700, color: "#334155", mb: 0.5 }}>
                      File uploaded: {uploadResult.filename || "document"}
                    </AiaText>
                    {uploadResult.parsed_summary && (
                      <AiaText sx={{ fontSize: 12.5, color: "#64748b" }}>
                        {uploadResult.parsed_summary.source_tables?.length ?? 0} source table(s)
                        {uploadResult.parsed_summary.target_table ? " • target bound" : " • target needs review"}
                        {uploadResult.parsed_summary.column_mappings?.length
                          ? ` • ${uploadResult.parsed_summary.column_mappings.length} columns`
                          : ""}
                      </AiaText>
                    )}
                  </AiaBox>
                  {uploadResult.import_preview ? (
                    <SqlBundleReviewPanel
                      result={uploadResult}
                      onApplyDraft={handleContinueEditing}
                      selectedProjectValueNames={selectedProjectValueNames}
                      onProjectValueSelectionChange={setSelectedProjectValueNames}
                    />
                  ) : null}
                  <AiaText sx={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>
                    What would you like to do with this file?
                  </AiaText>
                  <AiaButton
                    variant="text"
                    onClick={handleContinueEditing}
                    sx={{ width: "100%", minWidth: 0, overflow: "hidden", textTransform: "none", display: "block", px: 2.25, py: 2, borderRadius: "14px", border: "1px solid #dbe2ea", textAlign: "left", "&:hover": { borderColor: "var(--aia-button-color)", bgcolor: "#fafbff" } }}
                  >
                    <AiaText sx={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
                      {buildSqlUploadWorkspace(uploadResult).targetTableFqn
                        ? "Continue Editing"
                        : "Continue to Target Selection"}
                    </AiaText>
                    <AiaText sx={{ display: "block", maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word", fontSize: 12.5, lineHeight: 1.5, color: "#64748b", mt: 0.5 }}>
                      {buildSqlUploadWorkspace(uploadResult).targetTableFqn
                        ? "Auto-populate the mapping builder with parsed tables and columns from this file."
                        : "Keep the parsed sources, joins, CTE candidates, and columns, then choose the target table before mapping."}
                    </AiaText>
                  </AiaButton>
                  <AiaButton
                    variant="text"
                    onClick={handleUseAsLearning}
                    sx={{ width: "100%", minWidth: 0, overflow: "hidden", textTransform: "none", display: "block", px: 2.25, py: 2, borderRadius: "14px", border: "1px solid #dbe2ea", textAlign: "left", "&:hover": { borderColor: "var(--aia-button-color)", bgcolor: "#fafbff" } }}
                  >
                    <AiaText sx={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>Submit for Offline Learning</AiaText>
                    <AiaText sx={{ display: "block", maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word", fontSize: 12.5, lineHeight: 1.5, color: "#64748b", mt: 0.5 }}>FIR will combine this document with resolved table semantics and existing evidence before generating guidance.</AiaText>
                  </AiaButton>
                </AiaStack>
              )}
            </AiaBox>
          ) : (
          <AiaBox sx={{ px: 4, py: 3.5 }}>
            <AiaStack spacing={2}>
              {OPTIONS.map((option) => {
                const selected = selectedMode === option.id;

                return (
                  <AiaButton
                    key={option.id}
                    variant="text"
                    onClick={() => setSelectedMode(option.id)}
                    data-tour={
                      option.id === "sql"
                        ? TOUR_TARGETS.newMappingSqlUpload
                        : option.id === "excel"
                          ? TOUR_TARGETS.newMappingExcelUpload
                          : TOUR_TARGETS.newMappingManual
                    }
                    sx={{
                      width: "100%",
                      textTransform: "none",
                      display: "block",
                      px: 0,
                      py: 0,
                      borderRadius: "18px",
                      border: selected
                        ? "1px solid var(--aia-button-color)"
                        : "1px solid #dbe2ea",
                      boxShadow: selected ? "none" : "0 2px 8px rgba(15, 23, 42, 0.06)",
                      backgroundColor: "#fff",
                      "&:hover": {
                        backgroundColor: "#fff",
                        borderColor: selected ? "var(--aia-button-color)" : "#cbd5e1",
                      },
                    }}
                  >
                    <AiaBox
                      sx={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 2,
                        px: 2.25,
                        py: 2.1,
                        textAlign: "left",
                        width: "100%",
                      }}
                    >
                      <AiaBox
                        sx={{
                          width: 54,
                          height: 54,
                          borderRadius: "16px",
                          border: "1px solid #e5e7eb",
                          backgroundColor: "#f8fafc",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        {option.icon}
                      </AiaBox>

                      <AiaBox sx={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                        <AiaStack
                          direction="row"
                          spacing={1}
                          useFlexGap
                          sx={{ alignItems: "center", flexWrap: "wrap" }}
                        >
                          <AiaText sx={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>
                            {option.label}
                          </AiaText>
                          {option.badge ? (
                            <AiaBox
                              component="span"
                              sx={{
                                px: 1,
                                py: 0.35,
                                borderRadius: "999px",
                                backgroundColor: option.badgeBg,
                                color: option.badgeFg,
                                fontSize: 11,
                                fontWeight: 800,
                                letterSpacing: "0.02em",
                              }}
                            >
                              {option.badge}
                            </AiaBox>
                          ) : null}
                        </AiaStack>
                        <AiaText
                          sx={{
                            mt: 0.85,
                            fontSize: 13.5,
                            lineHeight: 1.55,
                            color: "#64748b",
                            display: "block",
                            overflowWrap: "anywhere",
                            wordBreak: "break-word",
                          }}
                        >
                          {option.description}
                        </AiaText>
                      </AiaBox>

                      <AiaBox
                        aria-hidden
                        sx={{
                          width: 26,
                          height: 26,
                          borderRadius: "50%",
                          border: selected
                            ? "7px solid var(--aia-button-color)"
                            : "2px solid #cbd5e1",
                          backgroundColor: selected ? "#fff" : "transparent",
                          boxShadow: selected ? "0 0 0 4px var(--aia-button-color)" : "none",
                          flexShrink: 0,
                          alignSelf: "center",
                          ml: 0.5,
                        }}
                      />
                    </AiaBox>
                  </AiaButton>
                );
              })}
              {(selectedMode === "sql" || selectedMode === "excel") && (
                <AiaBox sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5, pt: 0.5 }}>
                  <AiaBox>
                    <AiaText sx={{ fontSize: 11, fontWeight: 700, color: "#64748B", mb: 0.75 }}>
                      SOURCE TABLES (optional)
                    </AiaText>
                    <AiaInput
                      value={sourceTableHints}
                      onChange={setSourceTableHints}
                      placeholder="e.g. DB.SCHEMA.CUSTOMERS, ORDERS"
                      fullWidth
                    />
                  </AiaBox>
                  <AiaBox>
                    <AiaText sx={{ fontSize: 11, fontWeight: 700, color: "#64748B", mb: 0.75 }}>
                      TARGET TABLE (optional)
                    </AiaText>
                    <AiaInput
                      value={targetTableHint}
                      onChange={setTargetTableHint}
                      placeholder="e.g. DB.SCHEMA.CUSTOMER_360"
                      fullWidth
                    />
                  </AiaBox>
                  <AiaText sx={{ gridColumn: { sm: "1 / -1" }, fontSize: 12, color: "#94A3B8" }}>
                    FIR discovers table references from the file first. Add hints only for aliases, unqualified names, or missing targets.
                  </AiaText>
                </AiaBox>
              )}
            </AiaStack>
          </AiaBox>
          )}

          {selectedMode && !uploadResult && (
            <AiaBox sx={{ px: 4, pb: selectedMode === "manual" ? 0 : 3 }}>
              <AiaText sx={{ fontSize: 11, fontWeight: 700, color: "#64748B", mb: 0.75 }}>
                PROJECT NAME
              </AiaText>
              <AiaSelect
                value={selectedProjectId}
                options={projectOptions}
                placeholder={isLoadingProjects ? "Loading projects..." : "Select a project"}
                disabled={isLoadingProjects && projectOptions.length === 0}
                onChange={(value) => setSelectedProjectId(
                  typeof value === "string" ? value : "",
                )}
              />
            </AiaBox>
          )}

          {selectedMode === "manual" && !uploadResult && (
            <AiaBox
              sx={{
                px: 4,
                pb: 3,
                pt: 2,
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <AiaInput
                label="Mapping Name"
                value={mappingName}
                onChange={setMappingName}
                placeholder="e.g. Customer Orders → DW_ORDERS"
                fullWidth
              />
              <AiaInput
                label="Mapping Description"
                value={mappingDescription}
                onChange={setMappingDescription}
                placeholder="Briefly describe the purpose of this mapping"
                multiline
                minRows={2}
                maxRows={4}
                fullWidth
              />
              {precedentMappings.length ? (
                <AiaBox>
                  <AiaText sx={{ fontSize: 11, fontWeight: 700, color: '#64748B', mb: 0.75 }}>
                    REUSE PRECEDENT MAPPINGS (optional)
                  </AiaText>
                  <AiaSelect
                    multiple
                    value={linkedMappingIds}
                    options={precedentMappings.map((mapping) => ({
                      value: mapping.id,
                      label: `${mapping.name} · ${mapping.projectName}`,
                    }))}
                    placeholder="Select precedent mappings"
                    onChange={(value) => setLinkedMappingIds(Array.isArray(value) ? value : [])}
                  />
                  <AiaText sx={{ mt: 0.75, fontSize: 11, color: '#94A3B8', lineHeight: 1.45 }}>
                    These precedents are retrieved before fuzzy search and are passed to source mapping, transformation, and builder agents.
                  </AiaText>
                </AiaBox>
              ) : (
                <AiaBox
                  sx={{
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    bgcolor: "#f8fafc",
                    px: 1.5,
                    py: 1.25,
                  }}
                >
                  <AiaText sx={{ fontSize: 11, fontWeight: 700, color: "#64748B" }}>
                    REUSE PRECEDENT MAPPINGS
                  </AiaText>
                  <AiaText sx={{ mt: 0.6, fontSize: 11.5, color: "#64748b", lineHeight: 1.45 }}>
                    No published mappings are available to link explicitly. FIR knowledge learned from scripts and documents is still retrieved automatically. Import and publish a mapping to make it selectable here.
                  </AiaText>
                </AiaBox>
              )}
            </AiaBox>
          )}

          {!uploadResult && (
          <AiaBox
            sx={{
              px: 4,
              py: 2.25,
              borderTop: "1px solid #edf2f7",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2,
              backgroundColor: "#fff",
            }}
          >
            <AiaText
              sx={{
                fontSize: 13.5,
                color: "#94a3b8",
                fontWeight: 500,
                flex: 1,
                minWidth: 0,
                pr: 2,
                overflowWrap: "anywhere",
                wordBreak: "break-word",
              }}
            >
              {selectedOption
                ? selectedOption.description
                : "Select an option above to continue"}
            </AiaText>

            <AiaStack direction="row" spacing={1.25} sx={{ flexShrink: 0 }}>
              <AiaButton
                variant="outlined"
                rounded="lg"
                size="medium"
                onClick={handleClose}
                data-tour={TOUR_TARGETS.newMappingCancel}
                sx={{
                  minWidth: 108,
                  height: 44,
                  borderRadius: "14px",
                  color: "#334155",
                  borderColor: "#dbe2ea",
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                Cancel
              </AiaButton>
              <AiaButton
                variant="contained"
                color="primary"
                rounded="lg"
                size="medium"
                endIcon={<ArrowForwardRoundedIcon sx={{ fontSize: 16 }} />}
                disabled={
                  uploading ||
                  !selectedMode ||
                  !selectedProjectId.trim() ||
                  (selectedMode === "manual" && !canSubmitManual)
                }
                onClick={handleProceed}
                sx={{
                  minWidth: 156,
                  height: 44,
                  borderRadius: "14px",
                  fontSize: 14,
                  fontWeight: 800,
                }}
              >
                {uploading
                  ? "Uploading…"
                  : selectedMode === "manual"
                    ? "Build Mapping"
                    : "Choose File"}
              </AiaButton>
            </AiaStack>
          </AiaBox>
          )}
          </AiaBox>
        </AiaBox>
      </AiaBox>

      <input
        ref={sqlInputRef}
        type="file"
        accept=".sql,text/sql,application/sql"
        hidden
        onChange={(e) => handleFileUpload(e, "sql")}
      />
      <input
        ref={excelInputRef}
        type="file"
        accept=".xlsx,.xls,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        hidden
        onChange={(e) => handleFileUpload(e, "excel")}
      />
    </>
  );
}
