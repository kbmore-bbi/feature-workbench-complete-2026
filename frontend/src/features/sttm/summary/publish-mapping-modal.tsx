"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AddCircleOutlineRoundedIcon,
  CheckCircleOutlinedIcon,
  CloseOutlinedIcon,
  CreateNewFolderOutlinedIcon,
  FolderOutlinedIcon,
  PublishOutlinedIcon,
  PushPinOutlinedIcon,
} from '@/utils/icons';
import {
  Box,
  Button,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import { AiaInput } from "@/components/ui/aia-input";
import type { SummaryMetrics } from "./summary-utils";
import { summaryStatusLabel } from "./summary-utils";
import {
  PUBLISH_PROJECT_OPTIONS,
  type PublishSaveTab,
} from "./publish-mapping-data";

export type PublishMappingPayload = {
  mappingName: string;
  saveTab: PublishSaveTab;
  projectId?: string;
  projectName?: string;
};

type PublishMappingModalProps = {
  open: boolean;
  onClose: () => void;
  onPublish: (payload: PublishMappingPayload) => void;
  defaultMappingName: string;
  metrics: SummaryMetrics;
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
}: PublishMappingModalProps) {
  const [mappingName, setMappingName] = useState(defaultMappingName);
  const [saveTab, setSaveTab] = useState<PublishSaveTab>("existing");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    setMappingName(defaultMappingName);
    setSaveTab("existing");
    setSelectedProjectId(null);
    setNewProjectName("");
  }, [defaultMappingName, open]);

  const status = summaryStatusLabel(metrics);
  const statusStyle = getStatusStyle(status);
  const progressColor = status === "Complete" ? "#22C55E" : "#F97316";

  const canPublish = useMemo(() => {
    if (!mappingName.trim()) {
      return false;
    }
    if (saveTab === "existing") {
      return Boolean(selectedProjectId);
    }
    if (saveTab === "new") {
      return newProjectName.trim().length > 0;
    }
    return true;
  }, [mappingName, newProjectName, saveTab, selectedProjectId]);

  const handlePublish = () => {
    if (!canPublish) {
      return;
    }

    const selectedProject = PUBLISH_PROJECT_OPTIONS.find(
      (project) => project.id === selectedProjectId,
    );

    onPublish({
      mappingName: mappingName.trim(),
      saveTab,
      projectId: saveTab === "existing" ? selectedProjectId ?? undefined : undefined,
      projectName:
        saveTab === "new"
          ? newProjectName.trim()
          : saveTab === "existing"
            ? selectedProject?.name
            : undefined,
    });
  };

  if (!open) {
    return null;
  }

  return (
    <Box
      role="dialog"
      aria-modal="true"
      aria-label="Publish Mapping"
      onClick={onClose}
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
      <Box
        onClick={(event) => event.stopPropagation()}
        sx={{
          width: "100%",
          maxWidth: 560,
          borderRadius: "16px",
          border: "1px solid rgba(15, 23, 42, 0.08)",
          boxShadow: "0 30px 60px rgba(15, 23, 42, 0.18)",
          overflow: "hidden",
          backgroundColor: "#fff",
        }}
      >
        <Box
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
          <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: "10px",
                border: "1px solid #0f172a",
                bgcolor: "#fff",
                color: "#0f172a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <PublishOutlinedIcon sx={{ fontSize: 18 }} />
            </Box>
            <Box>
              <Typography sx={{ fontSize: 16, fontWeight: 700, color: "#0f172a", lineHeight: 1.2 }}>
                Publish Mapping
              </Typography>
              <Typography sx={{ fontSize: 12, color: "#64748b", mt: 0.25, lineHeight: 1.3 }}>
                Save as complete to a project
              </Typography>
            </Box>
          </Stack>

          <IconButton
            onClick={onClose}
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
          </IconButton>
        </Box>

        <Box sx={{ px: 2.5, py: 2 }}>
          <Typography
            sx={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "#94a3b8",
              mb: 0.75,
            }}
          >
            MAPPING NAME
          </Typography>
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

          <Box
            sx={{
              mt: 1.5,
              p: 1.5,
              borderRadius: "10px",
              border: "1px solid #e5e7eb",
              backgroundColor: "#fafafa",
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5 }}>
              <Typography sx={{ fontSize: 13, color: "#64748b" }}>Column coverage</Typography>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                  {metrics.mappedCount}/{metrics.totalCount} · {metrics.progressPercent}%
                </Typography>
                <Box
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
                </Box>
              </Box>
            </Box>
            <Box
              sx={{
                mt: 0.875,
                height: 5,
                borderRadius: "999px",
                bgcolor: "#e5e7eb",
                overflow: "hidden",
              }}
            >
              <Box
                sx={{
                  width: `${metrics.progressPercent}%`,
                  height: "100%",
                  borderRadius: "999px",
                  bgcolor: progressColor,
                }}
              />
            </Box>
          </Box>

          <Typography
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
          </Typography>

          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, borderBottom: "1px solid #e5e7eb" }}>
            {(
              [
                { id: "existing" as const, label: "Existing Project", icon: <FolderOutlinedIcon sx={{ fontSize: 16 }} /> },
                { id: "new" as const, label: "New Project", icon: <CreateNewFolderOutlinedIcon sx={{ fontSize: 16 }} /> },
                { id: "none" as const, label: "No Project", icon: <PushPinOutlinedIcon sx={{ fontSize: 16 }} /> },
              ] as const
            ).map((tab) => {
              const active = saveTab === tab.id;
              return (
                <Button
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
                    color: active ? "#0f172a" : "#64748b",
                    borderBottom: active ? "2px solid #0f172a" : "2px solid transparent",
                    "& .MuiButton-startIcon": { mr: 0.5 },
                  }}
                >
                  {tab.label}
                </Button>
              );
            })}
          </Box>

          <Box sx={{ mt: 1.25, minHeight: 148 }}>
            {saveTab === "existing" ? (
              <Box
                sx={{
                  maxHeight: 148,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 0.75,
                  pr: 0.5,
                }}
              >
                {PUBLISH_PROJECT_OPTIONS.map((project) => {
                  const selected = selectedProjectId === project.id;
                  return (
                    <Button
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
                      <Box sx={{ display: "flex", alignItems: "center", minWidth: 0 }}>
                        <Box
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
                        </Box>
                        <Box sx={{ textAlign: "left" }}>
                          <Typography sx={{ fontSize: 14, fontWeight: 700, color: "#0f172a", lineHeight: 1.25 }}>
                            {project.name}
                          </Typography>
                          <Typography sx={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.25 }}>
                            {project.mappingCount} mappings
                          </Typography>
                        </Box>
                      </Box>
                      {selected ? (
                        <CheckCircleOutlinedIcon sx={{ fontSize: 20, color: "#0f172a", flexShrink: 0 }} />
                      ) : null}
                    </Button>
                  );
                })}
              </Box>
            ) : null}

            {saveTab === "new" ? (
              <AiaInput
                value={newProjectName}
                onChange={setNewProjectName}
                placeholder="e.g. Marketing Analytics"
                sx={{
                  "& .MuiOutlinedInput-root": {
                    borderRadius: "10px",
                    fontSize: 14,
                  },
                }}
              />
            ) : null}

            {saveTab === "none" ? (
              <Box
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
                <Typography sx={{ fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>
                  This mapping will be saved{" "}
                  <Box component="span" sx={{ fontWeight: 700, color: "#334155" }}>
                    without a project
                  </Box>
                  . You can assign it to a project later from the Mappings screen.
                </Typography>
              </Box>
            ) : null}
          </Box>
        </Box>

        <Box
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
          <Button
            variant="outlined"
            onClick={onClose}
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
          </Button>
          <Button
            variant="contained"
            disabled={!canPublish}
            onClick={handlePublish}
            sx={{
              minWidth: 160,
              height: 38,
              borderRadius: "10px",
              backgroundColor: "#0f172a",
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              textTransform: "none",
              boxShadow: "none",
              "&:hover": {
                backgroundColor: "#1e293b",
                boxShadow: "none",
              },
              "&.Mui-disabled": {
                backgroundColor: "#e5e7eb",
                color: "#94a3b8",
              },
            }}
          >
            Publish to Project
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
