"use client";
import { AiaBox } from '@/components/ui';

import { AiaButton } from "@/components/ui/aia-button";
import { CLIENT_CONFIG as config } from "@/config/client.config";
import { EastRoundedIcon, PublishRoundedIcon } from '@/utils/icons';
import { BuilderHeaderStatsPill } from "./builder-header-stats-pill";
import { BuilderStepNav, type BuilderStepId } from "./builder-step-nav";
import { TOUR_TARGETS } from "@/features/tour/constants/tour-targets";

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

const headerActionStrokeColor = config.branding.colors.button.secondary;

export const builderHeaderActionStrokeColor = headerActionStrokeColor;

export const builderHeaderActionButtonSx = {
  minWidth: 0,
  gap: 0.5,
  flexShrink: 0,
  transition: "transform 0.15s ease",
  "&:hover:not(.Mui-disabled)": {
    transform: "scale(0.96)",
  },
} as const;

const nextButtonSx = builderHeaderActionButtonSx;

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
    <AiaBox
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
      <BuilderStepNav
        currentStep={currentStep}
        onStepChange={onStepChange}
        tone={embedded ? "header" : "default"}
      />

      <AiaBox
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
          <AiaButton
            data-tour={TOUR_TARGETS.sttmNextButton}
            variant="outlined"
            rounded="sm"
            size="large"
            customColor={headerActionStrokeColor}
            endIcon={<EastRoundedIcon sx={{ fontSize: 14 }} />}
            onClick={onNext}
            disabled={nextDisabled}
            sx={nextButtonSx}
          >
            Next
          </AiaButton>
        ) : currentStep === 2 ? (
          <AiaButton
            data-tour={TOUR_TARGETS.sttmNextButton}
            variant="outlined"
            rounded="sm"
            size="large"
            customColor={headerActionStrokeColor}
            endIcon={<EastRoundedIcon sx={{ fontSize: 14 }} />}
            onClick={onNext}
            sx={nextButtonSx}
          >
            Next
          </AiaButton>
        ) : (
          <AiaButton
            data-tour={TOUR_TARGETS.sttmSummaryPublishMapping}
            variant="outlined"
            rounded="sm"
            size="large"
            customColor={headerActionStrokeColor}
            endIcon={<PublishRoundedIcon sx={{ fontSize: 14 }} />}
            onClick={onPublish}
            sx={nextButtonSx}
          >
            Publish Mapping
          </AiaButton>
        )}
      </AiaBox>
    </AiaBox>
  );
}

export type { BuilderStepId };
