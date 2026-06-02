"use client";
import { Box, Icon, Typography } from "@mui/material";
import { KeyboardArrowRightRoundedIcon } from '@/utils/icons';

export type BuilderStepId = 1 | 2 | 3;

export const BUILDER_STEPS: Array<{ id: BuilderStepId; label: string }> = [
  { id: 1, label: "Select Tables" },
  { id: 2, label: "Map · Transform · Validate" },
  { id: 3, label: "Final Mapping & Summary" },
];

type BuilderStepNavProps = {
  currentStep: BuilderStepId;
  onStepChange?: (step: BuilderStepId) => void;
};

const STEP_CIRCLE_SIZE = 20;
const STEP_TEXT_COLOR = "#64748b";
const STEP_NUMBER_BORDER = "#64748b";
const STEP_NUMBER_BACKGROUND = "#64748b26";
const STEP_NUMBER_ACTIVE_BORDER = "#64748b00";
const STEP_NUMBER_ACTIVE_BACKGROUND = "#64748b6e";
const STEP_SEPARATOR_SIZE = 22;

function StepSeparator() {
  return (
    <Box
      aria-hidden
      sx={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: STEP_SEPARATOR_SIZE,
        height: STEP_SEPARATOR_SIZE,
        flexShrink: 0,
      }}
    >
      <Icon
        component={KeyboardArrowRightRoundedIcon}
        inheritViewBox
        sx={{
          fontSize: STEP_SEPARATOR_SIZE,
          width: STEP_SEPARATOR_SIZE,
          height: STEP_SEPARATOR_SIZE,
          color: STEP_TEXT_COLOR,
        }}
      />
    </Box>
  );
}

function StepNumberCircle({
  stepId,
  active,
  completed,
}: {
  stepId: number;
  active: boolean;
  completed: boolean;
}) {
  return (
    <Box
      sx={{
        width: STEP_CIRCLE_SIZE,
        height: STEP_CIRCLE_SIZE,
        borderRadius: "999px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        border: active
          ? `1px solid ${STEP_NUMBER_ACTIVE_BORDER}`
          : `1px solid ${STEP_NUMBER_BORDER}`,
        backgroundColor: active ? STEP_NUMBER_ACTIVE_BACKGROUND : STEP_NUMBER_BACKGROUND,
        color: active ? "#ffffff" : completed ? "#475569" : STEP_TEXT_COLOR,
      }}
    >
      <Typography
        component="span"
        sx={{
          fontSize: "10px",
          fontWeight: 600,
          lineHeight: 1,
          display: "block",
          transform: "translateY(0.5px)",
        }}
      >
        {stepId}
      </Typography>
    </Box>
  );
}

export function BuilderStepNav({ currentStep, onStepChange }: BuilderStepNavProps) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
      {BUILDER_STEPS.map((step, index) => {
        const active = currentStep === step.id;
        const completed = currentStep > step.id;

        return (
          <Box key={step.id} sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
            {index > 0 ? <StepSeparator /> : null}
            <Box
              onClick={() => onStepChange?.(step.id)}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.85,
                px: active ? 1.5 : 0,
                py: active ? 0.7 : 0,
                borderRadius: "999px",
                backgroundColor: active ? "#0f172a" : "transparent",
                cursor: onStepChange ? "pointer" : "default",
                minWidth: 0,
              }}
            >
              <StepNumberCircle stepId={step.id} active={active} completed={completed} />
              <Typography
                sx={{
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                  color: active ? "#ffffff" : completed ? "#475569" : "#64748b",
                }}
              >
                {step.label}
              </Typography>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
