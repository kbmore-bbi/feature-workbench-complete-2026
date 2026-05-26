"use client";

import { useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import GridOnRoundedIcon from "@mui/icons-material/GridOnRounded";
import TerminalRoundedIcon from "@mui/icons-material/TerminalRounded";
import ViewKanbanRoundedIcon from "@mui/icons-material/ViewKanbanRounded";

type MappingCreationMode = "sql" | "excel" | "manual" | null;

type NewMappingDialogProps = {
  open: boolean;
  onClose: () => void;
  onBuildManually: () => void;
};

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
  onBuildManually,
}: NewMappingDialogProps) {
  const [selectedMode, setSelectedMode] = useState<MappingCreationMode>(null);
  const sqlInputRef = useRef<HTMLInputElement | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);

  const selectedOption = useMemo(
    () => OPTIONS.find((option) => option.id === selectedMode) ?? null,
    [selectedMode],
  );

  const handleClose = () => {
    setSelectedMode(null);
    onClose();
  };

  const handleUploadSelection = (input: HTMLInputElement | null) => {
    if (!input) {
      return;
    }
    input.value = "";
    input.click();
  };

  const handleProceed = () => {
    if (!selectedMode) {
      return;
    }

    if (selectedMode === "manual") {
      setSelectedMode(null);
      onBuildManually();
      return;
    }

    handleUploadSelection(selectedMode === "sql" ? sqlInputRef.current : excelInputRef.current);
  };

  if (!open) {
    return (
      <>
        <input
          ref={sqlInputRef}
          type="file"
          accept=".sql,text/sql,application/sql"
          hidden
          onChange={() => {
            setSelectedMode(null);
            onClose();
          }}
        />
        <input
          ref={excelInputRef}
          type="file"
          accept=".xlsx,.xls,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          hidden
          onChange={() => {
            setSelectedMode(null);
            onClose();
          }}
        />
      </>
    );
  }

  return (
    <>
      <Box
        role="dialog"
        aria-modal="true"
        aria-label="New Mapping"
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
            maxWidth: 728,
            borderRadius: "24px",
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
              gap: 2,
              px: 4,
              py: 3.25,
              borderBottom: "1px solid #edf2f7",
            }}
          >
            <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: "14px",
                  bgcolor: "#0f172a",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 12px 24px rgba(15, 23, 42, 0.18)",
                }}
              >
                <AddRoundedIcon sx={{ fontSize: 28 }} />
              </Box>
              <Box>
                <Typography sx={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
                  New Mapping
                </Typography>
                <Typography sx={{ fontSize: 14, color: "#64748b", mt: 0.5 }}>
                  Choose how you&apos;d like to create this mapping
                </Typography>
              </Box>
            </Stack>

            <IconButton
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
            </IconButton>
          </Box>

          <Box sx={{ px: 4, py: 3.5 }}>
            <Stack spacing={2}>
              {OPTIONS.map((option) => {
                const selected = selectedMode === option.id;

                return (
                  <Button
                    key={option.id}
                    variant="text"
                    onClick={() => setSelectedMode(option.id)}
                    sx={{
                      width: "100%",
                      textTransform: "none",
                      display: "block",
                      px: 0,
                      py: 0,
                      borderRadius: "18px",
                      border: selected ? "1px solid #003D59" : "1px solid #dbe2ea",
                      boxShadow: selected
                        ? "0 10px 24px rgba(0, 61, 89, 0.12)"
                        : "0 2px 8px rgba(15, 23, 42, 0.06)",
                      backgroundColor: "#fff",
                      "&:hover": {
                        backgroundColor: "#fff",
                        borderColor: selected ? "#003D59" : "#cbd5e1",
                      },
                    }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 2,
                        px: 2.25,
                        py: 2.1,
                        textAlign: "left",
                      }}
                    >
                      <Box
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
                      </Box>

                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Stack
                          direction="row"
                          spacing={1}
                          useFlexGap
                          sx={{ alignItems: "center", flexWrap: "wrap" }}
                        >
                          <Typography sx={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>
                            {option.label}
                          </Typography>
                          {option.badge ? (
                            <Box
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
                            </Box>
                          ) : null}
                        </Stack>
                        <Typography
                          sx={{
                            mt: 0.85,
                            fontSize: 13.5,
                            lineHeight: 1.55,
                            color: "#64748b",
                            maxWidth: 460,
                          }}
                        >
                          {option.description}
                        </Typography>
                      </Box>

                      <Box
                        aria-hidden
                        sx={{
                          width: 26,
                          height: 26,
                          borderRadius: "50%",
                          border: selected ? "7px solid #003D59" : "2px solid #cbd5e1",
                          backgroundColor: selected ? "#fff" : "transparent",
                          boxShadow: selected ? "0 0 0 4px rgba(0, 61, 89, 0.12)" : "none",
                          flexShrink: 0,
                        }}
                      />
                    </Box>
                  </Button>
                );
              })}
            </Stack>
          </Box>

          <Box
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
            <Typography sx={{ fontSize: 13.5, color: "#94a3b8", fontWeight: 500 }}>
              {selectedOption
                ? selectedOption.description
                : "Select an option above to continue"}
            </Typography>

            <Stack direction="row" spacing={1.25}>
              <Button
                variant="outlined"
                onClick={handleClose}
                sx={{
                  minWidth: 108,
                  height: 44,
                  borderRadius: "14px",
                  borderColor: "#dbe2ea",
                  color: "#334155",
                  fontSize: 14,
                  fontWeight: 700,
                  textTransform: "none",
                }}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                endIcon={<ArrowForwardRoundedIcon sx={{ fontSize: 16 }} />}
                disabled={!selectedMode}
                onClick={handleProceed}
                sx={{
                  minWidth: 156,
                  height: 44,
                  borderRadius: "14px",
                  backgroundColor: "#003D59",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 800,
                  textTransform: "none",
                  boxShadow: "none",
                  "&:hover": {
                    backgroundColor: "#012c3f",
                    boxShadow: "none",
                  },
                  "&.Mui-disabled": {
                    backgroundColor: "#e5e7eb",
                    color: "#94a3b8",
                  },
                }}
              >
                {selectedMode === "manual" ? "Proceed" : "Choose File"}
              </Button>
            </Stack>
          </Box>
        </Box>
      </Box>

      <input
        ref={sqlInputRef}
        type="file"
        accept=".sql,text/sql,application/sql"
        hidden
        onChange={() => {
          setSelectedMode(null);
          onClose();
        }}
      />
      <input
        ref={excelInputRef}
        type="file"
        accept=".xlsx,.xls,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        hidden
        onChange={() => {
          setSelectedMode(null);
          onClose();
        }}
      />
    </>
  );
}
