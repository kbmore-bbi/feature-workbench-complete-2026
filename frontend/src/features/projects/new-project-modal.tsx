"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckRoundedIcon,
  CloseOutlinedIcon,
  FolderOutlinedIcon,
} from "@/utils/icons";
import {
  Box,
  Button,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  DEFAULT_PROJECT_COLOR_ID,
  PROJECT_COLOR_OPTIONS,
  getProjectColorById,
} from "./project-color-options";
import type { ProjectItem } from "./projects-data";
import { createProjectItem } from "./project-utils";

type NewProjectModalProps = {
  open: boolean;
  onClose: () => void;
  onCreate: (project: ProjectItem) => void;
};

const fieldLabelSx = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  color: "#94A3B8",
  mb: 0.75,
} as const;

const inputSx = {
  "& .MuiOutlinedInput-root": {
    borderRadius: "10px",
    fontSize: 14,
    color: "#111827",
    backgroundColor: "#FFFFFF",
    "& fieldset": {
      borderColor: "#E5E7EB",
    },
    "&:hover fieldset": {
      borderColor: "#C7D2FE",
    },
    "&.Mui-focused fieldset": {
      borderColor: "#818CF8",
      borderWidth: "1px",
    },
  },
  "& .MuiInputBase-input::placeholder": {
    color: "#94A3B8",
    opacity: 1,
  },
} as const;

export default function NewProjectModal({ open, onClose, onCreate }: NewProjectModalProps) {
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedColorId, setSelectedColorId] = useState(DEFAULT_PROJECT_COLOR_ID);

  useEffect(() => {
    if (!open) {
      return;
    }
    setProjectName("");
    setDescription("");
    setSelectedColorId(DEFAULT_PROJECT_COLOR_ID);
  }, [open]);

  const selectedColor = useMemo(
    () => getProjectColorById(selectedColorId),
    [selectedColorId],
  );

  const canCreate = projectName.trim().length > 0;
  const previewName = projectName.trim() || "Project Name";
  const previewDescription = description.trim() || "No description yet";

  const handleClose = () => {
    onClose();
  };

  const handleCreate = () => {
    if (!canCreate) {
      return;
    }

    onCreate(
      createProjectItem({
        name: projectName,
        description,
        color: selectedColor,
      }),
    );
    onClose();
  };

  if (!open) {
    return null;
  }

  return (
    <Box
      role="dialog"
      aria-modal="true"
      aria-label="New Project"
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
      <Box
        onClick={(event) => event.stopPropagation()}
        sx={{
          width: "100%",
          maxWidth: 520,
          borderRadius: "16px",
          border: "1px solid rgba(15, 23, 42, 0.08)",
          boxShadow: "0 30px 60px rgba(15, 23, 42, 0.18)",
          overflow: "hidden",
          backgroundColor: "#FFFFFF",
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
            borderBottom: "1px solid #EEF2F7",
          }}
        >
          <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: "10px",
                bgcolor: "#FFEDD5",
                color: "#EA580C",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <FolderOutlinedIcon sx={{ fontSize: 18 }} />
            </Box>
            <Box>
              <Typography sx={{ fontSize: 16, fontWeight: 700, color: "#111827", lineHeight: 1.2 }}>
                New Project
              </Typography>
              <Typography sx={{ fontSize: 12, color: "#64748B", mt: 0.35, lineHeight: 1.35 }}>
                Create a new project folder to organise your mappings
              </Typography>
            </Box>
          </Stack>

          <IconButton
            onClick={handleClose}
            aria-label="Close"
            sx={{
              width: 32,
              height: 32,
              border: "1px solid #E2E8F0",
              color: "#64748B",
              bgcolor: "#FFFFFF",
              "&:hover": { bgcolor: "#F8FAFC" },
            }}
          >
            <CloseOutlinedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>

        <Box sx={{ px: 2.5, py: 2.25 }}>
          <Box sx={{ mb: 2 }}>
            <Typography sx={fieldLabelSx}>
              PROJECT NAME{" "}
              <Box component="span" sx={{ color: "#EF4444" }}>
                *
              </Box>
            </Typography>
            <TextField
              fullWidth
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="e.g. Marketing Analytics"
              sx={inputSx}
            />
          </Box>

          <Box sx={{ mb: 2 }}>
            <Typography sx={fieldLabelSx}>DESCRIPTION (optional)</Typography>
            <TextField
              fullWidth
              multiline
              minRows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Brief description of what this project covers..."
              sx={inputSx}
            />
          </Box>

          <Box sx={{ mb: 2 }}>
            <Typography sx={fieldLabelSx}>PROJECT COLOUR</Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.1 }}>
              {PROJECT_COLOR_OPTIONS.map((color) => {
                const selected = selectedColorId === color.id;

                return (
                  <IconButton
                    key={color.id}
                    aria-label={color.label}
                    aria-pressed={selected}
                    onClick={() => setSelectedColorId(color.id)}
                    sx={{
                      width: 28,
                      height: 28,
                      p: 0,
                      bgcolor: color.color,
                      border: selected ? `2px solid ${color.color}` : "2px solid transparent",
                      boxShadow: selected
                        ? `0 0 0 2px #FFFFFF, 0 0 0 4px ${color.color}`
                        : "none",
                      "&:hover": {
                        bgcolor: color.color,
                        opacity: 0.92,
                      },
                    }}
                  >
                    {selected ? <CheckRoundedIcon sx={{ fontSize: 14, color: "#FFFFFF" }} /> : null}
                  </IconButton>
                );
              })}
            </Box>
          </Box>

          <Box
            sx={{
              borderRadius: "12px",
              border: "1px solid #E5E7EB",
              borderTop: `4px solid ${selectedColor.color}`,
              overflow: "hidden",
              bgcolor: "#FFFFFF",
            }}
          >
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.25, p: 1.5 }}>
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: "10px",
                  bgcolor: selectedColor.bg,
                  color: selectedColor.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <FolderOutlinedIcon sx={{ fontSize: 18 }} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  sx={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: projectName.trim() ? "#111827" : "#64748B",
                    lineHeight: 1.25,
                  }}
                >
                  {previewName}
                </Typography>
                <Typography sx={{ mt: 0.35, fontSize: 12, color: "#94A3B8", lineHeight: 1.4 }}>
                  {previewDescription}
                </Typography>
              </Box>
            </Box>
          </Box>
        </Box>

        <Box
          sx={{
            px: 2.5,
            py: 1.75,
            borderTop: "1px solid #EEF2F7",
            display: "flex",
            justifyContent: "flex-end",
            gap: 1,
            backgroundColor: "#FFFFFF",
          }}
        >
          <Button
            variant="outlined"
            onClick={handleClose}
            sx={{
              minWidth: 96,
              height: 38,
              borderRadius: "10px",
              borderColor: "#E5E7EB",
              color: "#374151",
              fontSize: 13,
              fontWeight: 600,
              textTransform: "none",
              "&:hover": {
                borderColor: "#D1D5DB",
                bgcolor: "#F9FAFB",
              },
            }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={!canCreate}
            onClick={handleCreate}
            sx={{
              minWidth: 132,
              height: 38,
              borderRadius: "10px",
              textTransform: "none",
              fontSize: 13,
              fontWeight: 700,
              boxShadow: "none",
              bgcolor: canCreate ? "#111827" : "#E5E7EB",
              color: canCreate ? "#FFFFFF" : "#94A3B8",
              border: canCreate ? "1px solid #111827" : "1px solid #E5E7EB",
              "&:hover": {
                bgcolor: canCreate ? "#1F2937" : "#E5E7EB",
                boxShadow: "none",
              },
              "&.Mui-disabled": {
                bgcolor: "#E5E7EB",
                color: "#94A3B8",
                borderColor: "#E5E7EB",
              },
            }}
          >
            Create Project
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
