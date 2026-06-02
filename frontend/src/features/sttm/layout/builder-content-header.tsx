"use client";
import { Box, Button } from "@mui/material";
import { BuilderHeaderStatsPill } from "./builder-header-stats-pill";
import { BuilderStepNav, type BuilderStepId } from "./builder-step-nav";
import { EastRoundedIcon, PublishRoundedIcon } from '@/utils/icons';

type BuilderContentHeaderProps = {
  currentStep: BuilderStepId;
  sourceTableCount?: number;
  joinCount?: number;
  tableCount?: number;
  mappingCount?: number;
  onNext?: () => void;
  onPublish?: () => void;
  onStepChange?: (step: BuilderStepId) => void;
  embedded?: boolean;
  nextDisabled?: boolean;
};

const nextButtonSx = {
  height: 36,
  minWidth: 0,
  px: 2,
  borderRadius: "5px",
  backgroundColor: "#0f172a",
  border: "1px solid #0f172a",
  color: "#ffffff",
  fontSize: "12px",
  fontWeight: 700,
  whiteSpace: "nowrap",
  textTransform: "none",
  boxShadow: "none",
  gap: 0.5,
  flexShrink: 0,
  "&:hover": {
    backgroundColor: "#1e293b",
    borderColor: "#1e293b",
    boxShadow: "none",
  },
  "&.Mui-disabled": {
    color: "#ffffff",
    backgroundColor: "#64748b",
    borderColor: "#64748b",
    opacity: 0.7,
  },
} as const;

export default function BuilderContentHeader({
  currentStep,
  sourceTableCount = 0,
  joinCount = 0,
  tableCount = 0,
  mappingCount = 0,
  onNext,
  onPublish,
  onStepChange,
  embedded = false,
  nextDisabled = false,
}: BuilderContentHeaderProps) {
  const statsPill =
    currentStep === 1 ? (
      <BuilderHeaderStatsPill
        items={[
          { value: sourceTableCount, label: "tables" },
          { value: joinCount, label: "joins" },
        ]}
      />
    ) : (
      <BuilderHeaderStatsPill
        items={[
          { value: tableCount, label: "tables" },
          { value: mappingCount, label: "mappings" },
        ]}
      />
    );

  return (
    <Box
      sx={{
        width: "100%",
        minHeight: embedded ? 44 : 54,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
        px: embedded ? 0 : 2,
        borderBottom: embedded ? "none" : "1px solid var(--color-soft-border)",
        backgroundColor: embedded ? "transparent" : "var(--color-surface)",
      }}
    >
      <BuilderStepNav currentStep={currentStep} onStepChange={onStepChange} />

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 1.25,
          flexShrink: 0,
          ml: 2,
        }}
      >
        {statsPill}
        {currentStep === 1 ? (
          <Button
            variant="contained"
            endIcon={<EastRoundedIcon sx={{ fontSize: 14 }} />}
            onClick={onNext}
            disabled={nextDisabled}
            sx={nextButtonSx}
          >
            Next
          </Button>
        ) : currentStep === 2 ? (
          <Button
            variant="contained"
            endIcon={<EastRoundedIcon sx={{ fontSize: 14 }} />}
            onClick={onNext}
            sx={nextButtonSx}
          >
            Next
          </Button>
        ) : (
          <Button
            variant="contained"
            endIcon={<PublishRoundedIcon sx={{ fontSize: 14 }} />}
            onClick={onPublish}
            sx={nextButtonSx}
          >
            Publish Mapping
          </Button>
        )}
      </Box>
    </Box>
  );
}

export type { BuilderStepId };
