"use client";
import { AiaBox, AiaButton, AiaIconButton, AiaStack } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import { useState } from "react";
import {
  CheckCircleOutlinedIcon,
  CloseOutlinedIcon,
  CreateNewFolderOutlinedIcon,
  FolderOutlinedIcon,
  PublishOutlinedIcon,
  PushPinOutlinedIcon,
} from '@/utils/icons';

import { AiaInput } from "@/components/ui/aia-input";
import type { SummaryMetrics } from "./summary-utils";
import { summaryStatusLabel } from "./summary-utils";
import {
  PUBLISH_PROJECT_OPTIONS,
  type PublishProjectItem,
  type PublishSaveTab,
} from "./publish-mapping-data";
import type { AssistantSignal } from "@/types/api-contract";

export type PublishMappingPayload = {
  mappingName: string;
  mappingDescription: string;
  saveTab: PublishSaveTab;
  projectId?: string;
  projectName?: string;
  projectDescription?: string;
  projectDomain?: string;
  projectOutcome?: string;
  projectBusinessProcess?: string;
  projectOwner?: string;
};

type PublishMappingModalProps = {
  open: boolean;
  onClose: () => void;
  onPublish: (payload: PublishMappingPayload) => void;
  defaultMappingName: string;
  metrics: SummaryMetrics;
  projectOptions?: PublishProjectItem[];
  isPublishing?: boolean;
  checkpointQuestions?: AssistantSignal[];
  onAnswerQuestion?: (signalId: string, option: string, comment?: string) => void;
};

const STATUS_STYLES = {
  Complete: { color: "#166534", bg: "#ECFDF5", border: "#BBF7D0" },
  Partial: { color: "#9A3412", bg: "#FFF7ED", border: "#FED7AA" },
  "Not started": { color: "#475569", bg: "#F8FAFC", border: "#E2E8F0" },
} as const;

function getStatusStyle(status: string) {
  return STATUS_STYLES[status as keyof typeof STATUS_STYLES] ?? STATUS_STYLES.Partial;
}

export default function PublishMappingModal({
  open,
  onClose,
  onPublish,
  defaultMappingName,
  metrics,
  projectOptions = PUBLISH_PROJECT_OPTIONS,
  isPublishing = false,
  checkpointQuestions = [],
  onAnswerQuestion,
}: PublishMappingModalProps) {
  const [mappingName, setMappingName] = useState(defaultMappingName);
  const [mappingDescription, setMappingDescription] = useState("");
  const [saveTab, setSaveTab] = useState<PublishSaveTab>("existing");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectDomain, setProjectDomain] = useState("");
  const [projectOutcome, setProjectOutcome] = useState("");
  const [projectBusinessProcess, setProjectBusinessProcess] = useState("");
  const [projectOwner, setProjectOwner] = useState("");
  const [questionComments, setQuestionComments] = useState<Record<string, string>>({});

  const resetForm = () => {
    setMappingName(defaultMappingName);
    setMappingDescription("");
    setSaveTab("existing");
    setSelectedProjectId(null);
    setNewProjectName("");
    setProjectDescription("");
    setProjectDomain("");
    setProjectOutcome("");
    setProjectBusinessProcess("");
    setProjectOwner("");
    setQuestionComments({});
  };

  const handleClose = () => {
    onClose();
    resetForm();
  };

  const status = summaryStatusLabel(metrics);
  const statusStyle = getStatusStyle(status);
  const progressColor = status === "Complete" ? "#22C55E" : "#F97316";
  const visibleQuestions = checkpointQuestions.slice(0, 3);
  const hasBlockingQuestion = visibleQuestions.some((question) =>
    ["conflicting", "unsafe", "steward_review"].includes(
      String(question.attributes?.validation_status || "").toLowerCase(),
    ),
  );

  const canPublish = (() => {
    if (!mappingName.trim() || !mappingDescription.trim() || hasBlockingQuestion) {
      return false;
    }
    if (saveTab === "existing") {
      return Boolean(selectedProjectId);
    }
    if (saveTab === "new") {
      return Boolean(
        newProjectName.trim()
        && projectDescription.trim()
        && projectDomain.trim()
        && projectOutcome.trim()
        && projectBusinessProcess.trim()
      );
    }
    return true;
  })();

  const handlePublish = () => {
    if (!canPublish) {
      return;
    }

    const selectedProject = projectOptions.find(
      (project) => project.id === selectedProjectId,
    );

    onPublish({
      mappingName: mappingName.trim(),
      mappingDescription: mappingDescription.trim(),
      saveTab,
      projectId: saveTab === "existing" ? selectedProjectId ?? undefined : undefined,
      projectName:
        saveTab === "new"
          ? newProjectName.trim()
          : saveTab === "existing"
            ? selectedProject?.name
            : undefined,
      projectDescription: saveTab === "new" ? projectDescription.trim() : undefined,
      projectDomain: saveTab === "new" ? projectDomain.trim() : undefined,
      projectOutcome: saveTab === "new" ? projectOutcome.trim() : undefined,
      projectBusinessProcess: saveTab === "new" ? projectBusinessProcess.trim() : undefined,
      projectOwner: saveTab === "new" ? projectOwner.trim() || undefined : undefined,
    });
    resetForm();
  };

  if (!open) {
    return null;
  }

  return (
    <AiaBox
      role="dialog"
      aria-modal="true"
      aria-label="Publish Mapping"
      onClick={handleClose}
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 1400,
        px: 2,
        py: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(15, 23, 42, 0.42)",
        backdropFilter: "blur(4px)",
      }}
    >
      <AiaBox
        onClick={(event) => event.stopPropagation()}
        sx={{
          width: "100%",
          maxWidth: 560,
          maxHeight: "90vh",
          borderRadius: "16px",
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
            gap: 1.5,
            px: 2.5,
            py: 2,
            borderBottom: "1px solid #edf2f7",
          }}
        >
          <AiaStack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
            <AiaBox
              sx={{
                width: 36,
                height: 36,
                borderRadius: "10px",
                border: "1px solid var(--color-primary)",
                bgcolor: "#fff",
                color: "var(--color-primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <PublishOutlinedIcon sx={{ fontSize: 18 }} />
            </AiaBox>
            <AiaBox>
              <AiaText sx={{ fontSize: 16, fontWeight: 700, color: "#0f172a", lineHeight: 1.2 }}>
                Publish Mapping
              </AiaText>
              <AiaText sx={{ fontSize: 12, color: "#64748b", mt: 0.25, lineHeight: 1.3 }}>
                Save as complete to a project
              </AiaText>
            </AiaBox>
          </AiaStack>

          <AiaIconButton
            onClick={handleClose}
            sx={{
              border: "1px solid #e2e8f0",
              color: "#64748b",
              bgcolor: "#fff",
              width: 32,
              height: 32,
              "&:hover": { bgcolor: "#f8fafc" },
            }}
          >
            <CloseOutlinedIcon sx={{ fontSize: 18 }} />
          </AiaIconButton>
        </AiaBox>

        <AiaBox sx={{ px: 2.5, py: 2, overflowY: "auto", maxHeight: "calc(90vh - 145px)" }}>
          <AiaText
            sx={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "#94a3b8",
              mb: 0.75,
            }}
          >
            MAPPING NAME
          </AiaText>
          <AiaInput
            value={mappingName}
            onChange={setMappingName}
            sx={{
              "& .MuiOutlinedInput-root": {
                borderRadius: "10px",
                fontSize: 14,
                fontWeight: 700,
                color: "#0f172a",
              },
            }}
          />

          {visibleQuestions.length ? (
            <AiaBox sx={{ mt: 1.5, borderTop: "1px solid #e5e7eb", pt: 1.5 }}>
              <AiaText sx={{ fontSize: 11, fontWeight: 700, color: "#64748b", mb: 1 }}>
                CURRENT UNDERSTANDING
              </AiaText>
              <AiaStack spacing={1.25}>
                {visibleQuestions.map((question) => (
                  <AiaBox key={question.signal_id} sx={{ borderLeft: "3px solid #2563eb", pl: 1.25 }}>
                    <AiaText sx={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                      {question.title}
                    </AiaText>
                    <AiaText sx={{ fontSize: 12, color: "#475569", mt: 0.25, lineHeight: 1.45 }}>
                      {String(question.attributes?.current_understanding || question.message)}
                    </AiaText>
                    <AiaBox sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 0.75 }}>
                      {question.options.slice(0, 3).map((option) => (
                        <AiaButton
                          key={option}
                          size="small"
                          variant="outlined"
                          onClick={() => onAnswerQuestion?.(question.signal_id, option)}
                          sx={{ textTransform: "none", fontSize: 11 }}
                        >
                          {option}
                        </AiaButton>
                      ))}
                    </AiaBox>
                    {question.allow_free_text ? (
                      <AiaBox sx={{ display: "flex", gap: 0.75, mt: 0.75 }}>
                        <AiaInput
                          value={questionComments[question.signal_id] || ""}
                          onChange={(value) => setQuestionComments((current) => ({ ...current, [question.signal_id]: value }))}
                          placeholder="Correct our understanding"
                        />
                        <AiaButton
                          variant="contained"
                          disabled={!questionComments[question.signal_id]?.trim()}
                          onClick={() => onAnswerQuestion?.(
                            question.signal_id,
                            "Needs correction",
                            questionComments[question.signal_id]?.trim(),
                          )}
                        >
                          Save
                        </AiaButton>
                      </AiaBox>
                    ) : null}
                  </AiaBox>
                ))}
              </AiaStack>
            </AiaBox>
          ) : null}
          <AiaInput
            value={mappingDescription}
            onChange={setMappingDescription}
            placeholder="Why is this mapping needed, and what should it produce?"
            multiline
            minRows={2}
            maxRows={3}
            sx={{ mt: 1 }}
          />

          <AiaBox
            sx={{
              mt: 1.5,
              p: 1.5,
              borderRadius: "10px",
              border: "1px solid #e5e7eb",
              backgroundColor: "#fafafa",
            }}
          >
            <AiaBox sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5 }}>
              <AiaText sx={{ fontSize: 13, color: "#64748b" }}>Column coverage</AiaText>
              <AiaBox sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <AiaText sx={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                  {metrics.mappedCount}/{metrics.totalCount} · {metrics.progressPercent}%
                </AiaText>
                <AiaBox
                  sx={{
                    px: 0.875,
                    py: 0.125,
                    borderRadius: "999px",
                    fontSize: 11,
                    fontWeight: 700,
                    color: statusStyle.color,
                    bgcolor: statusStyle.bg,
                    border: `1px solid ${statusStyle.border}`,
                  }}
                >
                  {status}
                </AiaBox>
              </AiaBox>
            </AiaBox>
            <AiaBox
              sx={{
                mt: 0.875,
                height: 5,
                borderRadius: "999px",
                bgcolor: "#e5e7eb",
                overflow: "hidden",
              }}
            >
              <AiaBox
                sx={{
                  width: `${metrics.progressPercent}%`,
                  height: "100%",
                  borderRadius: "999px",
                  bgcolor: progressColor,
                }}
              />
            </AiaBox>
          </AiaBox>

          <AiaText
            sx={{
              mt: 1.5,
              mb: 0.75,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "#94a3b8",
            }}
          >
            SAVE TO
          </AiaText>

          <AiaBox sx={{ display: "flex", alignItems: "center", gap: 1.5, borderBottom: "1px solid #e5e7eb" }}>
            {(
              [
                { id: "existing" as const, label: "Existing Project", icon: <FolderOutlinedIcon sx={{ fontSize: 16 }} /> },
                { id: "new" as const, label: "New Project", icon: <CreateNewFolderOutlinedIcon sx={{ fontSize: 16 }} /> },
                { id: "none" as const, label: "No Project", icon: <PushPinOutlinedIcon sx={{ fontSize: 16 }} /> },
              ] as const
            ).map((tab) => {
              const active = saveTab === tab.id;
              return (
                <AiaButton
                  key={tab.id}
                  variant="text"
                  onClick={() => setSaveTab(tab.id)}
                  startIcon={tab.icon}
                  sx={{
                    minWidth: 0,
                    px: 0.25,
                    py: 0.875,
                    borderRadius: 0,
                    textTransform: "none",
                    fontSize: 13,
                    fontWeight: active ? 700 : 500,
                    color: active ? "var(--color-primary)" : "#64748b",
                    borderBottom: active ? "2px solid var(--color-primary)" : "2px solid transparent",
                    "& .MuiButton-startIcon": { mr: 0.5 },
                    "& .MuiSvgIcon-root": { color: "inherit" },
                  }}
                >
                  {tab.label}
                </AiaButton>
              );
            })}
          </AiaBox>

          <AiaBox sx={{ mt: 1.25, minHeight: 148 }}>
            {saveTab === "existing" ? (
              <AiaBox
                sx={{
                  maxHeight: 148,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 0.75,
                  pr: 0.5,
                }}
              >
                {projectOptions.map((project) => {
                  const selected = selectedProjectId === project.id;
                  return (
                    <AiaButton
                      key={project.id}
                      variant="text"
                      onClick={() => setSelectedProjectId(project.id)}
                      sx={{
                        width: "100%",
                        justifyContent: "space-between",
                        textTransform: "none",
                        px: 1.25,
                        py: 1,
                        borderRadius: "10px",
                        border: selected ? "1px solid #0f172a" : "1px solid #e5e7eb",
                        bgcolor: selected ? "#f8fafc" : "#fff",
                        "&:hover": { bgcolor: "#f8fafc" },
                      }}
                    >
                      <AiaBox sx={{ display: "flex", alignItems: "center", minWidth: 0 }}>
                        <AiaBox
                          sx={{
                            width: 30,
                            height: 30,
                            borderRadius: "8px",
                            bgcolor: project.folderBg,
                            color: project.folderColor,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            mr: 1.25,
                            flexShrink: 0,
                          }}
                        >
                          <FolderOutlinedIcon sx={{ fontSize: 17 }} />
                        </AiaBox>
                        <AiaBox sx={{ textAlign: "left" }}>
                          <AiaText sx={{ fontSize: 14, fontWeight: 700, color: "#0f172a", lineHeight: 1.25 }}>
                            {project.name}
                          </AiaText>
                          <AiaText sx={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.25 }}>
                            {project.mappingCount} mappings
                          </AiaText>
                        </AiaBox>
                      </AiaBox>
                      {selected ? (
                        <CheckCircleOutlinedIcon sx={{ fontSize: 20, color: "#0f172a", flexShrink: 0 }} />
                      ) : null}
                    </AiaButton>
                  );
                })}
              </AiaBox>
            ) : null}

            {saveTab === "new" ? (
              <AiaStack spacing={1}>
                <AiaInput value={newProjectName} onChange={setNewProjectName} placeholder="Project name" />
                <AiaInput value={projectDescription} onChange={setProjectDescription} placeholder="What is this project about?" multiline minRows={2} maxRows={3} />
                <AiaBox sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
                  <AiaInput value={projectDomain} onChange={setProjectDomain} placeholder="Business domain" />
                  <AiaInput value={projectOwner} onChange={setProjectOwner} placeholder="Owner (optional)" />
                </AiaBox>
                <AiaInput value={projectOutcome} onChange={setProjectOutcome} placeholder="What business outcome should this enable?" />
                <AiaInput value={projectBusinessProcess} onChange={setProjectBusinessProcess} placeholder="Which business process does it support?" />
              </AiaStack>
            ) : null}

            {saveTab === "none" ? (
              <AiaBox
                sx={{
                  p: 1.5,
                  borderRadius: "10px",
                  border: "1px solid #e5e7eb",
                  bgcolor: "#f8fafc",
                  display: "flex",
                  gap: 1,
                  alignItems: "flex-start",
                }}
              >
                <PushPinOutlinedIcon sx={{ fontSize: 18, color: "#64748b", mt: "1px", flexShrink: 0 }} />
                <AiaText sx={{ fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>
                  This mapping will be saved{" "}
                  <AiaBox component="span" sx={{ fontWeight: 700, color: "#334155" }}>
                    without a project
                  </AiaBox>
                  . You can assign it to a project later from the Mappings screen.
                </AiaText>
              </AiaBox>
            ) : null}
          </AiaBox>
        </AiaBox>

        <AiaBox
          sx={{
            px: 2.5,
            py: 1.5,
            borderTop: "1px solid #edf2f7",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1.5,
          }}
        >
          <AiaButton
            variant="outlined"
            onClick={handleClose}
            sx={{
              minWidth: 96,
              height: 38,
              borderRadius: "10px",
              borderColor: "#dbe2ea",
              color: "#334155",
              fontSize: 14,
              fontWeight: 600,
              textTransform: "none",
            }}
          >
            Cancel
          </AiaButton>
          <AiaButton
            variant="contained"
            color="primary"
            disabled={!canPublish || isPublishing}
            onClick={handlePublish}
            sx={{
              minWidth: 160,
              height: 38,
              borderRadius: "10px",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {isPublishing ? "Publishing..." : "Publish to Project"}
          </AiaButton>
        </AiaBox>
      </AiaBox>
    </AiaBox>
  );
}
