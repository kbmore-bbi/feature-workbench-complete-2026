"use client";
import { AiaBox, AiaIcon } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import { KeyboardArrowRightRoundedIcon } from '@/utils/icons';
import { TOUR_TARGETS } from "@/features/tour/constants/tour-targets";

export type BuilderStepId = 1 | 2 | 3;

export const BUILDER_STEPS: Array<{ id: BuilderStepId; label: string }> = [
  { id: 1, label: "Select Tables" },
  { id: 2, label: "Map · Transform · Validate" },
  { id: 3, label: "Final Mapping & Summary" },
];

type BuilderStepNavProps = {
  currentStep: BuilderStepId;
  onStepChange?: (step: BuilderStepId) => void;
  tone?: "default" | "header";
};

const STEP_CIRCLE_SIZE = 20;
const STEP_TEXT_COLOR = "#64748b";
const STEP_NUMBER_BORDER = "#64748b";
const STEP_NUMBER_BACKGROUND = "#64748b26";
const STEP_NUMBER_ACTIVE_BORDER = "#64748b00";
const STEP_NUMBER_ACTIVE_BACKGROUND = "#64748b6e";
const STEP_SEPARATOR_SIZE = 22;

function StepSeparator({ tone }: { tone: "default" | "header" }) {
  return (
    <AiaBox
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
      <AiaIcon
        component={KeyboardArrowRightRoundedIcon}
        inheritViewBox
        sx={{
          fontSize: STEP_SEPARATOR_SIZE,
          width: STEP_SEPARATOR_SIZE,
          height: STEP_SEPARATOR_SIZE,
          color: tone === "header" ? "var(--color-header-text)" : STEP_TEXT_COLOR,
          opacity: tone === "header" ? 0.55 : 1,
        }}
      />
    </AiaBox>
  );
}

function StepNumberCircle({
  stepId,
  active,
  completed,
  tone,
}: {
  stepId: number;
  active: boolean;
  completed: boolean;
  tone: "default" | "header";
}) {
  const headerText = "var(--color-header-text)";

  return (
    <AiaBox
      sx={{
        width: STEP_CIRCLE_SIZE,
        height: STEP_CIRCLE_SIZE,
        borderRadius: "999px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        border:
          tone === "header"
            ? active
              ? "1px solid rgba(255,255,255,0.45)"
              : "1px solid rgba(255,255,255,0.28)"
            : active
              ? `1px solid ${STEP_NUMBER_ACTIVE_BORDER}`
              : `1px solid ${STEP_NUMBER_BORDER}`,
        backgroundColor:
          tone === "header"
            ? active
              ? "rgba(255,255,255,0.18)"
              : "rgba(255,255,255,0.08)"
            : active
              ? STEP_NUMBER_ACTIVE_BACKGROUND
              : STEP_NUMBER_BACKGROUND,
        color:
          tone === "header"
            ? headerText
            : active
              ? "#ffffff"
              : completed
                ? "#475569"
                : STEP_TEXT_COLOR,
        opacity: tone === "header" && !active && !completed ? 0.72 : 1,
      }}
    >
      <AiaText
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
      </AiaText>
    </AiaBox>
  );
}

export function BuilderStepNav({
  currentStep,
  onStepChange,
  tone = "default",
}: BuilderStepNavProps) {
  const headerText = "var(--color-header-text)";

  return (
    <AiaBox
      data-tour={TOUR_TARGETS.sttmStepper}
      sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}
    >
      {BUILDER_STEPS.map((step, index) => {
        const active = currentStep === step.id;
        const completed = currentStep > step.id;

        return (
          <AiaBox key={step.id} sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
            {index > 0 ? <StepSeparator tone={tone} /> : null}
            <AiaBox
              onClick={() => onStepChange?.(step.id)}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.85,
                px: active ? 1.5 : 0,
                py: active ? 0.7 : 0,
                borderRadius: "999px",
                backgroundColor:
                  tone === "header"
                    ? active
                      ? "rgba(255,255,255,0.14)"
                      : "transparent"
                    : active
                      ? "#0f172a"
                      : "transparent",
                cursor: onStepChange ? "pointer" : "default",
                minWidth: 0,
              }}
            >
              <StepNumberCircle
                stepId={step.id}
                active={active}
                completed={completed}
                tone={tone}
              />
              <AiaText
                sx={{
                  fontSize: "13px",
                  fontWeight: active ? 600 : 400,
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                  color:
                    tone === "header"
                      ? headerText
                      : active
                        ? "#ffffff"
                        : completed
                          ? "#475569"
                          : "#64748b",
                  opacity: tone === "header" && !active ? 0.82 : 1,
                }}
              >
                {step.label}
              </AiaText>
            </AiaBox>
          </AiaBox>
        );
      })}
    </AiaBox>
  );
}
