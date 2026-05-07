"use client";

import React from "react";
import SourceTargetList from "./source-target-list";
import { Box, Typography, Paper, InputBase, Button, Stack } from "@mui/material";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import FilterListRoundedIcon from "@mui/icons-material/FilterListRounded";
import AddIcon from "@mui/icons-material/Add";
import { useSttmBuilderContext } from "@/features/sttm/context/sttm-builder-context";
import { FocusButton } from "@/components/ui/focus-button";
import { AddDerivedModal } from "./add-derived-modal";

/** Shared with search field + Filters control */
const fieldChrome = {
  borderRadius: "8px",
  backgroundColor: "#f3f4f6",
  border: "1px solid #e5e7eb",
  minHeight: 40,
} as const;

const fieldChromeActive = {
  backgroundColor: "#ffffff",
  borderColor: "#d1d5db",
  boxShadow: "0 0 0 1px rgba(15, 23, 42, 0.06)",
} as const;

const searchFieldSx = {
  display: "flex",
  alignItems: "center",
  gap: 1,
  px: 1.5,
  py: 0.75,
  flex: 1,
  ...fieldChrome,
  "&:focus-within": fieldChromeActive,
} as const;

const filtersControlSx = {
  display: "inline-flex",
  alignItems: "center",
  gap: 0.75,
  px: 1.5,
  py: 0.75,
  flexShrink: 0,
  ...fieldChrome,
  fontSize: 14,
  fontWeight: 600,
  color: "#374151",
  textTransform: "none" as const,
  boxShadow: "none",
  "&:hover": fieldChromeActive,
} as const;

export default function SourceTargetPanel({ type }: { type: "source" | "target" }) {
  const { clearSources, clearTargets, fullData, drivingTableId, addDerivedSource } = useSttmBuilderContext();
  const [isDerivedModalOpen, setIsDerivedModalOpen] = React.useState(false);

  const title = type === "source" ? "SOURCE TABLES" : "TARGET TABLES";
  const selectedCount = React.useMemo(() => {
    const branch = type === "source" ? fullData?.sources : fullData?.targets;
    let count = 0;
    for (const db of branch ?? []) {
      for (const sch of db.schemas ?? []) {
        for (const tbl of sch.tables ?? []) {
          if (tbl.isSelected) count += 1;
        }
      }
    }
    return count;
  }, [fullData, type]);

  const drivingTableDetails = React.useMemo(() => {
    if (type !== 'source' || !fullData?.sources || !drivingTableId) return null;
    for (const db of fullData.sources) {
      for (const sch of db.schemas ?? []) {
        for (const tbl of sch.tables ?? []) {
          if (tbl.tableId === drivingTableId) {
            return { dbName: db.dbName, schemaName: sch.schemaName, tableName: tbl.tableName };
          }
        }
      }
    }
    return null;
  }, [fullData, drivingTableId, type]);

  const onClear = () => {
    if (type === "source") clearSources();
    else clearTargets();
  };

  return (
    <Box
      sx={{
        width: "100%",
        maxWidth: "100%",
        height: "100%",
        backgroundColor: "transparent",
        p: 2,
      }}
    >
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mt: -2,
          mx: -2,
          pt: 2,
          pb: 1.5,
          px: 2,
          mb: 1.5,
          borderBottom: "1px solid #e5e7eb",
          gap: 2,
        }}
      >
        <Typography
          sx={{
            fontSize: 12,
            fontWeight: 800,
            color: "#374151",
            letterSpacing: "0.06em",
            lineHeight: 1.2,
          }}
        >
          {title}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, flexShrink: 0 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>
            {selectedCount} selected
          </Typography>
          <Button
            variant="text"
            size="small"
            onClick={onClear}
            sx={{
              minWidth: 0,
              px: 0.75,
              py: 0.25,
              fontSize: 12,
              fontWeight: 600,
              color: "#2563eb",
              textTransform: "none",
              backgroundColor: "transparent",
              "&:hover": {
                backgroundColor: "rgba(37, 99, 235, 0.06)",
                color: "#1d4ed8",
              },
            }}
          >
            Clear all
          </Button>
        </Box>
      </Box>

      <Box
        sx={{
          display: "flex",
          alignItems: "stretch",
          gap: 1,
          mb: 1.25,
        }}
      >
        <Paper elevation={0} sx={{ ...searchFieldSx, mb: 0, flex: 1 }}>
          <SearchRoundedIcon sx={{ color: "#9ca3af", fontSize: 20, flexShrink: 0 }} />
          <InputBase
            placeholder="Search tables, schemas, or tags..."
            fullWidth
            sx={{
              fontSize: 14,
              color: "#111827",
              "& .MuiInputBase-input::placeholder": {
                color: "#9ca3af",
                opacity: 1,
              },
            }}
          />
        </Paper>

        <Button
          variant="text"
          size="small"
          startIcon={<FilterListRoundedIcon sx={{ fontSize: 18, color: "#6b7280" }} />}
          sx={filtersControlSx}
        >
          Filters
        </Button>
      </Box>

      {type === "source" && (
        <Box sx={{ mx: -2, borderBottom: "1px solid #eef2f7", mb: 1.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 1.5, px: 2, flexWrap: "wrap", gap: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Typography
                sx={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#94a3b8",
                  letterSpacing: "0.08em",
                }}
              >
                ADD SOURCE:
              </Typography>
              <FocusButton
                size="small"
                variant="outlined"
                rounded="full"
                startIcon={<AddIcon sx={{ fontSize: 18 }} />}
                customBorderColor="#22c55e"
                customColor="#15803d"
                customBackgroundColor="transparent"
                customHoverBackgroundColor="rgba(34, 197, 94, 0.08)"
                onClick={() => setIsDerivedModalOpen(true)}
              >
                Add Derived
              </FocusButton>
            </Box>
            {drivingTableDetails && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.05em", textTransform: 'uppercase' }}>
                  Driving Table:
                </Typography>
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: "#1e293b", backgroundColor: '#f1f5f9', px: 1, py: 0.25, borderRadius: '4px' }}>
                  {drivingTableDetails.dbName} &bull; {drivingTableDetails.schemaName} &bull; {drivingTableDetails.tableName}
                </Typography>
              </Box>
            )}
          </Box>

        </Box>
      )}

      <Box>
        <Stack spacing={0.5}>
          <SourceTargetList type={type} />
        </Stack>
      </Box>

      {type === "source" && (
        <AddDerivedModal
          isOpen={isDerivedModalOpen}
          onClose={() => setIsDerivedModalOpen(false)}
          onConfirm={(source) => {
            addDerivedSource(source);
            setIsDerivedModalOpen(false);
          }}
        />
      )}
    </Box>
  );
}
