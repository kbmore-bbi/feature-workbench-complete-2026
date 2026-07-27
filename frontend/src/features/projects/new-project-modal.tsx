"use client";
import { AiaBox, AiaButton, AiaIconButton, AiaSelect, AiaStack, AiaInput } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import { useMemo, useState } from "react";
import {
  CheckRoundedIcon,
  CloseOutlinedIcon,
  FolderOutlinedIcon,
} from "@/utils/icons";

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
  availableProjects?: ProjectItem[];
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

export default function NewProjectModal({ open, onClose, onCreate, availableProjects = [] }: NewProjectModalProps) {
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [domain, setDomain] = useState("");
  const [intendedOutcome, setIntendedOutcome] = useState("");
  const [businessProcess, setBusinessProcess] = useState("");
  const [owner, setOwner] = useState("");
  const [linkedProjectIds, setLinkedProjectIds] = useState<string[]>([]);
  const [selectedColorId, setSelectedColorId] = useState(DEFAULT_PROJECT_COLOR_ID);

  const resetForm = () => {
    setProjectName("");
    setDescription("");
    setDomain("");
    setIntendedOutcome("");
    setBusinessProcess("");
    setOwner("");
    setLinkedProjectIds([]);
    setSelectedColorId(DEFAULT_PROJECT_COLOR_ID);
  };

  const selectedColor = useMemo(
    () => getProjectColorById(selectedColorId),
    [selectedColorId],
  );

  const canCreate = Boolean(
    projectName.trim()
    && description.trim()
    && domain.trim()
    && intendedOutcome.trim()
    && businessProcess.trim()
  );
  const previewName = projectName.trim() || "Project Name";
  const previewDescription = description.trim() || "No description yet";

  const handleClose = () => {
    onClose();
    resetForm();
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
        domain,
        intendedOutcome,
        businessProcess,
        owner,
        linkedProjectIds,
      }),
    );
    onClose();
    resetForm();
  };

  if (!open) {
    return null;
  }

  return (
    <AiaBox
      role="dialog"
      aria-modal="true"
      aria-label="New Project"
      onClick={(event) => {
        // MUI Select menus render through a React portal. Portal click events
        // still bubble through this component tree, so an unconditional close
        // resets linkedProjectIds immediately after the user selects precedent.
        if (event.target === event.currentTarget) {
          handleClose();
        }
      }}
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
          maxWidth: 520,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: "16px",
          border: "1px solid rgba(15, 23, 42, 0.08)",
          boxShadow: "0 30px 60px rgba(15, 23, 42, 0.18)",
          overflow: "hidden",
          backgroundColor: "#FFFFFF",
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
            borderBottom: "1px solid #EEF2F7",
          }}
        >
          <AiaStack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
            <AiaBox
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
            </AiaBox>
            <AiaBox>
              <AiaText sx={{ fontSize: 16, fontWeight: 700, color: "#111827", lineHeight: 1.2 }}>
                New Project
              </AiaText>
              <AiaText sx={{ fontSize: 12, color: "#64748B", mt: 0.35, lineHeight: 1.35 }}>
                Create a new project folder to organise your mappings
              </AiaText>
            </AiaBox>
          </AiaStack>

          <AiaIconButton
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
          </AiaIconButton>
        </AiaBox>

        <AiaBox sx={{ px: 2.5, py: 2.25, overflowY: "auto", minHeight: 0, flex: 1 }}>
          <AiaBox sx={{ mb: 2 }}>
            <AiaText sx={fieldLabelSx}>
              PROJECT NAME{" "}
              <AiaBox component="span" sx={{ color: "#EF4444" }}>
                *
              </AiaBox>
            </AiaText>
            <AiaInput
              fullWidth
              value={projectName}
              onChange={setProjectName}
              placeholder="e.g. Customer 360 Migration"
              sx={inputSx}
            />
          </AiaBox>

          <AiaBox sx={{ mb: 2 }}>
            <AiaText sx={fieldLabelSx}>DESCRIPTION *</AiaText>
            <AiaInput
              fullWidth
              multiline
              minRows={3}
              value={description}
              onChange={setDescription}
              placeholder="e.g. Consolidate CRM and billing data into a trusted customer model"
              sx={inputSx}
            />
          </AiaBox>

          <AiaBox sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5, mb: 2 }}>
            <AiaBox>
              <AiaText sx={fieldLabelSx}>BUSINESS DOMAIN *</AiaText>
              <AiaInput
                fullWidth
                value={domain}
                onChange={setDomain}
                placeholder="e.g. Retail banking"
                sx={inputSx}
              />
            </AiaBox>
            <AiaBox>
              <AiaText sx={fieldLabelSx}>OWNER (optional)</AiaText>
              <AiaInput
                fullWidth
                value={owner}
                onChange={setOwner}
                placeholder="e.g. Customer Data Office"
                sx={inputSx}
              />
            </AiaBox>
          </AiaBox>

          <AiaBox sx={{ mb: 2 }}>
            <AiaText sx={fieldLabelSx}>INTENDED OUTCOME *</AiaText>
            <AiaInput
              fullWidth
              value={intendedOutcome}
              onChange={setIntendedOutcome}
              placeholder="e.g. A publish-ready customer mapping for analytics and operations"
              sx={inputSx}
            />
          </AiaBox>

          <AiaBox sx={{ mb: 2 }}>
            <AiaText sx={fieldLabelSx}>IMPORTANT BUSINESS PROCESS *</AiaText>
            <AiaInput
              fullWidth
              value={businessProcess}
              onChange={setBusinessProcess}
              placeholder="e.g. Customer onboarding and account servicing"
              sx={inputSx}
            />
          </AiaBox>

          {availableProjects.length ? (
            <AiaBox sx={{ mb: 2 }}>
              <AiaText sx={fieldLabelSx}>REUSE KNOWLEDGE FROM (optional)</AiaText>
              <AiaSelect
                multiple
                value={linkedProjectIds}
                options={availableProjects.map((project) => ({
                  value: project.id,
                  label: project.name,
                }))}
                placeholder="Select precedent projects"
                onChange={(value) => setLinkedProjectIds(Array.isArray(value) ? value : [])}
              />
              <AiaText sx={{ mt: 0.75, fontSize: 11, color: '#94A3B8', lineHeight: 1.45 }}>
                Validated mappings, joins, transformations, and derived-source patterns from selected projects may be reused. Project-specific values remain excluded.
              </AiaText>
            </AiaBox>
          ) : null}

          <AiaBox sx={{ mb: 2 }}>
            <AiaText sx={fieldLabelSx}>PROJECT COLOUR</AiaText>
            <AiaBox sx={{ display: "flex", flexWrap: "wrap", gap: 1.1 }}>
              {PROJECT_COLOR_OPTIONS.map((color) => {
                const selected = selectedColorId === color.id;

                return (
                  <AiaIconButton
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
                  </AiaIconButton>
                );
              })}
            </AiaBox>
          </AiaBox>

          <AiaBox
            sx={{
              borderRadius: "12px",
              border: "1px solid #E5E7EB",
              borderTop: `4px solid ${selectedColor.color}`,
              overflow: "hidden",
              bgcolor: "#FFFFFF",
            }}
          >
            <AiaBox sx={{ display: "flex", alignItems: "flex-start", gap: 1.25, p: 1.5 }}>
              <AiaBox
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
              </AiaBox>
              <AiaBox sx={{ minWidth: 0 }}>
                <AiaText
                  sx={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: projectName.trim() ? "#111827" : "#64748B",
                    lineHeight: 1.25,
                  }}
                >
                  {previewName}
                </AiaText>
                <AiaText sx={{ mt: 0.35, fontSize: 12, color: "#94A3B8", lineHeight: 1.4 }}>
                  {previewDescription}
                </AiaText>
              </AiaBox>
            </AiaBox>
          </AiaBox>
        </AiaBox>

        <AiaBox
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
          <AiaButton
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
          </AiaButton>
          <AiaButton
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
          </AiaButton>
        </AiaBox>
      </AiaBox>
    </AiaBox>
  );
}
