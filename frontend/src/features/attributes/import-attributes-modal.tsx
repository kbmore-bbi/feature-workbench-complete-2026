"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AiaAutocomplete,
  AiaBox,
  AiaButton,
  AiaIconButton,
  AiaStack,
} from "@/components/ui";
import { AiaText } from "@/components/ui/aia-text";
import { CloseOutlinedIcon, FileUploadOutlinedIcon } from "@/utils/icons";
import { getAllProjectsSummary } from "@/services/projectService";

import AttributesTable from "./attributes-table";
import {
  filterImportableProjects,
  getAttributesForSelectedProjects,
  type AttributeProjectOption,
  type HardcodedAttribute,
} from "./attributes-data";

type ImportAttributesModalProps = {
  open: boolean;
  currentProjectId: string;
  currentProjectName?: string;
  onClose: () => void;
  onImport: (rows: HardcodedAttribute[]) => void;
};

const fieldLabelSx = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  color: "#94A3B8",
  mb: 0.75,
} as const;

export default function ImportAttributesModal({
  open,
  currentProjectId,
  currentProjectName = "",
  onClose,
  onImport,
}: ImportAttributesModalProps) {
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [selectedAttributeIds, setSelectedAttributeIds] = useState<string[]>([]);
  const [projects, setProjects] = useState<AttributeProjectOption[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const importableProjects = useMemo(
    () => filterImportableProjects(projects, currentProjectId, currentProjectName),
    [projects, currentProjectId, currentProjectName],
  );

  const projectOptions = useMemo(
    () =>
      importableProjects.map((project) => ({
        value: project.id,
        label: project.name,
      })),
    [importableProjects],
  );

  const tableRows = useMemo(
    () => getAttributesForSelectedProjects(selectedProjectIds, importableProjects),
    [selectedProjectIds, importableProjects],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    setSelectedProjectIds([]);
    setSelectedAttributeIds([]);
    setProjectsError(null);
    setIsLoadingProjects(true);

    let cancelled = false;
    getAllProjectsSummary()
      .then(({ projects: records }) => {
        if (cancelled) {
          return;
        }
        setProjects(
          records.map((record) => ({
            id: record.project_id,
            name: record.project_name,
          })),
        );
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (process.env.NODE_ENV === "development") {
          console.warn("Failed to load projects for import attributes.", error);
        }
        setProjects([]);
        setProjectsError("Unable to load projects. Check that the backend API is available.");
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingProjects(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    const visibleIds = new Set(tableRows.map((row) => row.id));
    setSelectedAttributeIds((current) => current.filter((id) => visibleIds.has(id)));
  }, [tableRows]);

  const handleClose = () => {
    onClose();
  };

  const handleToggleRow = (row: HardcodedAttribute, checked: boolean) => {
    setSelectedAttributeIds((current) => {
      if (checked) {
        return current.includes(row.id) ? current : [...current, row.id];
      }
      return current.filter((id) => id !== row.id);
    });
  };

  const handleToggleAll = (checked: boolean) => {
    if (checked) {
      setSelectedAttributeIds(tableRows.map((row) => row.id));
      return;
    }
    setSelectedAttributeIds([]);
  };

  const handleImport = () => {
    const selectedSet = new Set(selectedAttributeIds);
    const selectedRows = tableRows.filter((row) => selectedSet.has(row.id));
    if (selectedRows.length === 0) {
      return;
    }
    onImport(selectedRows);
    onClose();
  };

  if (!open) {
    return null;
  }

  const canImport = selectedAttributeIds.length > 0;

  return (
    <AiaBox
      role="dialog"
      aria-modal="true"
      aria-label="Import Attributes"
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 1400,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 2,
      }}
    >
      <AiaBox
        onClick={handleClose}
        sx={{
          position: "absolute",
          inset: 0,
          bgcolor: "rgba(15, 23, 42, 0.45)",
        }}
      />

      <AiaBox
        sx={{
          position: "relative",
          width: "100%",
          maxWidth: 960,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: "16px",
          bgcolor: "#FFFFFF",
          border: "1px solid #E5E7EB",
          boxShadow: "0 24px 60px rgba(15, 23, 42, 0.18)",
          overflow: "hidden",
        }}
      >
        <AiaBox
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1.5,
            px: 2.5,
            py: 2,
            borderBottom: "1px solid #F1F5F9",
            flexShrink: 0,
          }}
        >
          <AiaStack direction="row" spacing={1.25} sx={{ alignItems: "center", minWidth: 0 }}>
            <AiaBox
              sx={{
                width: 36,
                height: 36,
                borderRadius: "10px",
                bgcolor: "#F1F5F9",
                color: "#475569",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <FileUploadOutlinedIcon sx={{ fontSize: 18 }} />
            </AiaBox>
            <AiaText sx={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>
              Import Attributes
            </AiaText>
          </AiaStack>
          <AiaIconButton
            aria-label="Close import attributes dialog"
            onClick={handleClose}
            sx={{
              width: 32,
              height: 32,
              color: "#64748B",
              border: "1px solid #E5E7EB",
              borderRadius: "8px",
            }}
          >
            <CloseOutlinedIcon sx={{ fontSize: 18 }} />
          </AiaIconButton>
        </AiaBox>

        <AiaBox
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            px: 2.5,
            py: 2.25,
          }}
        >
          <AiaBox sx={{ mb: 2.25 }}>
            <AiaText sx={fieldLabelSx}>PROJECTS *</AiaText>
            <AiaAutocomplete
              multiple
              hideLabel
              disabled={isLoadingProjects}
              value={selectedProjectIds}
              options={projectOptions}
              placeholder={
                isLoadingProjects
                  ? "Loading projects..."
                  : selectedProjectIds.length === 0
                    ? "Select one or more projects"
                    : ""
              }
              onChange={(value) =>
                setSelectedProjectIds(Array.isArray(value) ? value : [])
              }
              sx={{
                "& .MuiOutlinedInput-root": {
                  borderRadius: "10px",
                  fontSize: 14,
                  backgroundColor: "#FFFFFF",
                  alignItems: "center",
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
              }}
            />
            {projectsError ? (
              <AiaText sx={{ fontSize: 11, color: "#DC2626", mt: 0.75, lineHeight: 1.4 }}>
                {projectsError}
              </AiaText>
            ) : (
              <AiaText sx={{ fontSize: 11, color: "#94A3B8", mt: 0.75, lineHeight: 1.4 }}>
                Options come from the Projects API. Current project is excluded. Selected
                projects appear as chips and can be removed with the × icon.
              </AiaText>
            )}
          </AiaBox>

          <AttributesTable
            variant="import"
            rows={tableRows}
            selectedIds={selectedAttributeIds}
            onToggleRow={handleToggleRow}
            onToggleAll={handleToggleAll}
            maxHeight={360}
            emptyMessage={
              selectedProjectIds.length === 0
                ? "Select a project to view its attributes."
                : "No attributes found for the selected project(s)."
            }
          />
        </AiaBox>

        <AiaBox
          sx={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 1.25,
            px: 2.5,
            py: 2,
            borderTop: "1px solid #F1F5F9",
            bgcolor: "#FAFBFC",
            flexShrink: 0,
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
            disabled={!canImport}
            onClick={handleImport}
            sx={{
              minWidth: 120,
              height: 38,
              borderRadius: "10px",
              textTransform: "none",
              fontSize: 13,
              fontWeight: 700,
              boxShadow: "none",
              bgcolor: canImport ? "#111827" : "#E5E7EB",
              color: canImport ? "#FFFFFF" : "#94A3B8",
              border: canImport ? "1px solid #111827" : "1px solid #E5E7EB",
              "&:hover": {
                bgcolor: canImport ? "#1F2937" : "#E5E7EB",
                boxShadow: "none",
              },
            }}
          >
            Import{canImport ? ` (${selectedAttributeIds.length})` : ""}
          </AiaButton>
        </AiaBox>
      </AiaBox>
    </AiaBox>
  );
}
