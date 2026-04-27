"use client";

import { useState } from "react";
import { Box, Button, LinearProgress, Paper, Typography } from "@mui/material";

type MappingQualityPanelProps = {
  mappedCount?: number;
  totalCount?: number;
  onRunValidation?: () => void;
};

type TabKey = "validate" | "preview" | "sql";

export default function MappingQualityPanel({
  mappedCount = 6,
  totalCount = 10,
  onRunValidation,
}: MappingQualityPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("validate");

  const progressValue = totalCount > 0 ? (mappedCount / totalCount) * 100 : 0;

  return (
    <Paper
      elevation={0}
      sx={{
        height: "100%",
        border: "1px solid var(--color-soft-border)",
        borderRadius: "12px",
        backgroundColor: "var(--color-surface)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <Box sx={{ px: 2, py: 2, borderBottom: "1px solid var(--color-soft-border)" }}>
        <Typography
          sx={{
            fontSize: "13px",
            fontWeight: 700,
            color: "var(--color-title)",
          }}
        >
          Mapping Quality
        </Typography>

        <Typography
          sx={{
            mt: 1,
            mb: 0.75,
            fontSize: "11px",
            fontWeight: 600,
            color: "var(--color-text)",
          }}
        >
          {mappedCount}/{totalCount}
        </Typography>

        <LinearProgress
          variant="determinate"
          value={progressValue}
          sx={{
            height: 6,
            borderRadius: "999px",
            backgroundColor: "var(--color-surface-muted)",
            "& .MuiLinearProgress-bar": {
              backgroundColor: "var(--color-primary-save)",
              borderRadius: "999px",
            },
          }}
        />
      </Box>

      <Box
        sx={{
          display: "flex",
          gap: 0.75,
          px: 2,
          py: 1.5,
          borderBottom: "1px solid var(--color-soft-border)",
        }}
      >
        {[
          { key: "validate", label: "Validate" },
          { key: "preview", label: "Preview" },
          { key: "sql", label: "SQL" },
        ].map((tab) => {
          const selected = activeTab === tab.key;

          return (
            <Box
              key={tab.key}
              onClick={() => setActiveTab(tab.key as TabKey)}
              sx={{
                px: 1.25,
                py: 0.75,
                borderRadius: "6px",
                cursor: "pointer",
                backgroundColor: selected
                  ? "var(--color-header-bg)"
                  : "transparent",
                color: selected ? "#ffffff" : "var(--color-muted)",
                border: selected
                  ? "1px solid var(--color-header-bg)"
                  : "1px solid transparent",
                fontSize: "11px",
                fontWeight: 700,
                lineHeight: 1,
              }}
            >
              {tab.label}
            </Box>
          );
        })}
      </Box>

      <Box sx={{ p: 2, flex: 1 }}>
        {activeTab === "validate" && (
          <Box>
            <Typography
              sx={{
                fontSize: "11px",
                color: "var(--color-muted)",
                mb: 1.5,
              }}
            >
              Run validation to check mapping completeness and rule status.
            </Typography>

            <Button
              variant="contained"
              fullWidth
              onClick={onRunValidation}
              sx={{
                height: 32,
                borderRadius: "4px",
                backgroundColor: "var(--color-primary-save)",
                border: "1px solid var(--color-primary-save)",
                color: "#ffffff",
                fontSize: "12px",
                fontWeight: 600,
                textTransform: "none",
                boxShadow: "none",
                "&:hover": {
                  backgroundColor: "var(--color-primary-hover)",
                  borderColor: "var(--color-primary-hover)",
                  boxShadow: "none",
                },
              }}
            >
              Run Validation
            </Button>
          </Box>
        )}

        {activeTab === "preview" && (
          <Box>
            <Typography
              sx={{
                fontSize: "11px",
                color: "var(--color-muted)",
              }}
            >
              Preview content will appear here.
            </Typography>
          </Box>
        )}

        {activeTab === "sql" && (
          <Box>
            <Typography
              sx={{
                fontSize: "11px",
                color: "var(--color-muted)",
              }}
            >
              SQL content will appear here.
            </Typography>
          </Box>
        )}
      </Box>
    </Paper>
  );
}