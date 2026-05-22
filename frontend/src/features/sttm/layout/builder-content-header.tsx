"use client";

import EastRoundedIcon from "@mui/icons-material/EastRounded";
import PublishRoundedIcon from "@mui/icons-material/PublishRounded";
import VerifiedRoundedIcon from "@mui/icons-material/VerifiedRounded";
import { Box, Button, Typography } from "@mui/material";

type BuilderContentHeaderProps = {
  currentStep: 1 | 2;
  tableCount?: number;
  mappingCount?: number;
  onProceed?: () => void;
  onRunValidation?: () => void;
  onPublish?: () => void;
  onStepChange?: (step: 1 | 2) => void;
  embedded?: boolean;
  proceedDisabled?: boolean;
};

const steps = [
  { id: 1 as const, label: "Select Tables" },
  { id: 2 as const, label: "Map - Transform - Validate" },
];

export default function BuilderContentHeader({
  currentStep,
  tableCount = 2,
  mappingCount = 0,
  onProceed,
  onRunValidation,
  onPublish,
  onStepChange,
  embedded = false,
  proceedDisabled = false,
}: BuilderContentHeaderProps) {
  return (
    <Box
      sx={{
        minHeight: embedded ? 40 : 54,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
        px: embedded ? 0 : 2,
        borderBottom: embedded ? "none" : "1px solid var(--color-soft-border)",
        backgroundColor: embedded ? "transparent" : "var(--color-surface)",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0 }}>
        {steps.map((step) => {
          const active = currentStep === step.id;
          const completed = currentStep > step.id;

          return (
            <Box
              key={step.id}
              onClick={() => onStepChange?.(step.id)}
              sx={{
                height: 30,
                px: 1.75,
                borderRadius: "999px",
                display: "flex",
                alignItems: "center",
                gap: 1,
                cursor: "pointer",
                backgroundColor: active
                  ? "var(--color-header-bg)"
                  : completed
                    ? "var(--color-surface-muted)"
                    : "transparent",
                color: active ? "#060505" : "#282323",
              }}
            >
              <Box
                sx={{
                  width: 16,
                  height: 16,
                  borderRadius: "999px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "10px",
                  fontWeight: 700,
                  backgroundColor: active
                    ? "var(--color-header-text)"
                    : completed
                      ? "var(--color-header-bg)"
                      : "var(--color-border)",
                  color: active ? "var(--color-header-bg)" : completed ? "#060505" : "#282323",
                  lineHeight: 1,
                }}
              >
                {step.id}
              </Box>

              <Typography
                sx={{
                  fontSize: "14px",
                  fontWeight: 600,
                  lineHeight: 1,
                  whiteSpace: "nowrap",
                }}
              >
                {step.label}
              </Typography>
            </Box>
          );
        })}
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
        <Typography sx={{ fontSize: "12px", fontWeight: 600, color: "var(--color-title)" }}>
          {tableCount} tables
        </Typography>

        <Typography sx={{ fontSize: "12px", fontWeight: 600, color: "var(--color-muted)" }}>
          {mappingCount} mappings
        </Typography>

        {currentStep === 1 ? (
          <Button
            variant="contained"
            endIcon={<EastRoundedIcon sx={{ fontSize: 14 }} />}
            onClick={onProceed}
            disabled={proceedDisabled}
            sx={{
              height: 30,
              minWidth: 136,
              px: 1.75,
              borderRadius: "4px",
              backgroundColor: "var(--aia-mapping-button-color)",
              border: "1px solid var(--aia-mapping-button-color)",
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: 600,
              whiteSpace: "nowrap",
              textTransform: "none",
              boxShadow: "none",
              opacity: proceedDisabled ? 0.55 : 1,
              "&:hover": {
                backgroundColor: "var(--aia-mapping-button-hoverColor)",
                borderColor: "var(--aia-mapping-button-hoverColor)",
                boxShadow: "none",
              },
              "&.Mui-disabled": {
                color: "#ffffff",
                backgroundColor: "var(--aia-mapping-button-color)",
                borderColor: "var(--aia-mapping-button-color)",
              },
            }}
          >
            Proceed to Mapping
          </Button>
        ) : (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Button
              variant="outlined"
              startIcon={<VerifiedRoundedIcon sx={{ fontSize: 14 }} />}
              onClick={onRunValidation}
              sx={{
                height: 30,
                minWidth: 124,
                px: 1.5,
                borderRadius: "4px",
                backgroundColor: "transparent",
                border: "1px solid var(--color-primary-save)",
                color: "var(--color-text)",
                fontSize: "12px",
                fontWeight: 600,
                whiteSpace: "nowrap",
                textTransform: "none",
                "&:hover": {
                  backgroundColor: "transparent",
                  borderColor: "var(--color-primary-hover)",
                },
              }}
            >
              Run Validation
            </Button>

            <Button
              variant="contained"
              startIcon={<PublishRoundedIcon sx={{ fontSize: 14 }} />}
              onClick={onPublish}
              sx={{
                height: 30,
                minWidth: 132,
                px: 1.5,
                borderRadius: "4px",
                backgroundColor: "var(--aia-mapping-button-color)",
                border: "1px solid var(--aia-mapping-button-color)",
                color: "#ffffff",
                fontSize: "12px",
                fontWeight: 600,
                whiteSpace: "nowrap",
                textTransform: "none",
                boxShadow: "none",
                "&:hover": {
                  backgroundColor: "var(--aia-mapping-button-hoverColor)",
                  borderColor: "var(--aia-mapping-button-hoverColor)",
                  boxShadow: "none",
                },
              }}
            >
              Publish Mapping
            </Button>
          </Box>
        )}
      </Box>
    </Box>
  );
}
