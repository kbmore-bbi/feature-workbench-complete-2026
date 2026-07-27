"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { AiaBox, AiaButton, AiaCheckbox, AiaIconButton } from "@/components/ui";
import { AiaText } from "@/components/ui/aia-text";
import { CloseRoundedIcon, EastRoundedIcon } from "@/utils/icons";

import { useTour } from "./tour-context";
import { computePopoverLayout, getRectForElement } from "./tour-position";

const TOUR_HEADER_BG = "var(--aia-header-bgColor)";
const TOUR_HEADER_TEXT = "var(--color-header-text)";
const TOUR_PRIMARY_BUTTON_SX = {
  textTransform: "none",
  fontWeight: 800,
  fontSize: 13,
  borderRadius: "10px",
  backgroundColor: "var(--aia-primary-bg-color)",
  color: "var(--aia-primary-bg-text-color)",
  boxShadow: "none",
  "&:hover": {
    backgroundColor: "var(--aia-primary-bg-hover-color)",
  },
} as const;

export function TourOverlay() {
  const {
    isOpen,
    activeTour,
    currentStep,
    stepIndex,
    stepCount,
    next,
    back,
    skip,
    close,
    autoLaunchEnabled,
    setAutoLaunchEnabled,
  } = useTour();
  const [mounted, setMounted] = useState(false);
  const [targetEl, setTargetEl] = useState<Element | null>(null);
  const [popoverHeight, setPopoverHeight] = useState(300);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const selector = isOpen ? currentStep?.target : undefined;
    if (!selector) {
      setTargetEl(null);
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    let attempts = 0;

    const resolve = () => {
      if (cancelled) return;

      try {
        const el = document.querySelector(selector);
        if (el) {
          setTargetEl(el);
          el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
          return;
        }
      } catch {
        setTargetEl(null);
        return;
      }

      attempts += 1;
      if (attempts < 12) {
        timer = window.setTimeout(resolve, 200);
      } else {
        setTargetEl(null);
      }
    };

    resolve();

    const onLayoutChange = () => resolve();
    window.addEventListener("resize", onLayoutChange);
    window.addEventListener("scroll", onLayoutChange, true);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("resize", onLayoutChange);
      window.removeEventListener("scroll", onLayoutChange, true);
    };
  }, [currentStep?.id, currentStep?.target, isOpen]);

  useLayoutEffect(() => {
    if (!popoverRef.current) return;
    const height = popoverRef.current.getBoundingClientRect().height;
    if (height > 0) {
      setPopoverHeight(height);
    }
  }, [currentStep?.id, stepIndex, isOpen]);

  const targetRect = useMemo(() => getRectForElement(targetEl), [targetEl]);

  const layout = useMemo(() => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    return computePopoverLayout(
      targetRect,
      currentStep?.placement,
      popoverHeight,
      vw,
      vh,
    );
  }, [currentStep?.placement, popoverHeight, targetRect]);

  if (!mounted || !isOpen || !activeTour || !currentStep) return null;

  const showCaret = layout.placement !== "center" && targetRect !== null;
  const missingTarget = Boolean(currentStep.target && !targetEl);
  const isLastStep = stepIndex === stepCount - 1;
  const overlayZIndex = currentStep.isModal ? 3500 : 2000;

  const overlay = (
    <AiaBox
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: overlayZIndex,
        pointerEvents: "auto",
      }}
    >
      <AiaBox
        onClick={close}
        sx={{
          position: "absolute",
          inset: 0,
          backgroundColor: "rgba(17, 24, 39, 0.55)",
        }}
      />

      {targetRect ? (
        <AiaBox
          sx={{
            position: "absolute",
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
            borderRadius: 12,
            boxShadow: `0 0 0 2px rgba(255,255,255,0.95), 0 0 0 6px rgba(79, 70, 229, 0.28)`,
            backgroundColor: "rgba(255,255,255,0.04)",
            pointerEvents: "none",
            transition: "top 0.2s ease, left 0.2s ease, width 0.2s ease, height 0.2s ease",
          }}
        />
      ) : null}

      {/* Position wrapper — caret sits outside the card so corners are not clipped */}
      <AiaBox
        sx={{
          position: "absolute",
          top: layout.top,
          left: layout.left,
          width: layout.width,
          transition: "top 0.2s ease, left 0.2s ease",
        }}
      >
        {showCaret ? (
          <AiaBox
            sx={{
              position: "absolute",
              width: 16,
              height: 16,
              backgroundColor: TOUR_HEADER_BG,
              transform: "rotate(45deg)",
              zIndex: 1,
              ...(layout.placement === "bottom"
                ? { top: -8, left: layout.caretLeft - 8 }
                : layout.placement === "top"
                  ? { bottom: -8, left: layout.caretLeft - 8 }
                  : layout.placement === "right"
                    ? { left: -8, top: popoverHeight / 2 - 8 }
                    : { right: -8, top: popoverHeight / 2 - 8 }),
            }}
          />
        ) : null}

        <AiaBox
          ref={popoverRef}
          sx={{
            position: "relative",
            width: "100%",
            borderRadius: "20px",
            overflow: "hidden",
            backgroundColor: "#ffffff",
            boxShadow: "0 28px 64px rgba(15, 23, 42, 0.32)",
            border: "1px solid rgba(15, 23, 42, 0.08)",
          }}
        >
          {/* Header */}
          <AiaBox
            sx={{
              px: 2.25,
              py: 1.5,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2,
              backgroundColor: TOUR_HEADER_BG,
            }}
          >
            <AiaBox sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0 }}>
              <AiaBox sx={{ minWidth: 0 }}>
                <AiaText sx={{ color: TOUR_HEADER_TEXT, fontWeight: 800, fontSize: 14, lineHeight: 1.2 }}>
                  Tour Guide
                </AiaText>
                <AiaText sx={{ color: TOUR_HEADER_TEXT, opacity: 0.72, fontSize: 12, lineHeight: 1.3 }}>
                  Step {stepIndex + 1} of {stepCount}
                </AiaText>
              </AiaBox>
            </AiaBox>

            <AiaIconButton
              onClick={close}
              aria-label="Close tour guide"
              sx={{
                width: 32,
                height: 32,
                color: TOUR_HEADER_TEXT,
                border: "1px solid rgba(255,255,255,0.18)",
                backgroundColor: "rgba(255,255,255,0.06)",
                "&:hover": { backgroundColor: "rgba(255,255,255,0.14)" },
              }}
            >
              <CloseRoundedIcon sx={{ fontSize: 18 }} />
            </AiaIconButton>
          </AiaBox>

          {/* Body */}
          <AiaBox sx={{ px: 2.5, py: 2.25, backgroundColor: "#ffffff" }}>
            <AiaText sx={{ fontWeight: 800, fontSize: 17, color: "#0f172a", lineHeight: 1.35 }}>
              {currentStep.title}
            </AiaText>
            <AiaText sx={{ mt: 1.1, fontSize: 13.5, lineHeight: 1.65, color: "#64748b" }}>
              {currentStep.body}
            </AiaText>

            {missingTarget ? (
              <AiaText sx={{ mt: 1.25, fontSize: 12, color: "#b45309", fontWeight: 600 }}>
                Highlight target is not visible on this screen yet. Use Next when you are ready.
              </AiaText>
            ) : null}

            <AiaBox sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1.5 }}>
              <AiaCheckbox
                checked={!autoLaunchEnabled}
                checkHandler={(checked) => setAutoLaunchEnabled(!checked)}
                uncheckedColor="#94a3b8"
                checkedColor="var(--aia-primary-bg-color)"
              />
              <AiaText sx={{ fontSize: 12.5, color: '#64748b' }}>
                Do not automatically start tours
              </AiaText>
            </AiaBox>

            {/* Progress dots */}
            <AiaBox sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 2.25 }}>
              {Array.from({ length: stepCount }).map((_, idx) => (
                <AiaBox
                  key={idx}
                  sx={{
                    width: idx === stepIndex ? 22 : 7,
                    height: 7,
                    borderRadius: 999,
                    backgroundColor: idx === stepIndex ? "var(--aia-primary-bg-color)" : "#e2e8f0",
                    transition: "width 0.2s ease, background-color 0.2s ease",
                  }}
                />
              ))}
            </AiaBox>
          </AiaBox>

          {/* Footer */}
          <AiaBox
            sx={{
              px: 2.5,
              py: 1.75,
              borderTop: "1px solid #eef2f7",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2,
              backgroundColor: "#ffffff",
            }}
          >
            <AiaButton
              variant="text"
              onClick={skip}
              sx={{
                textTransform: "none",
                fontWeight: 600,
                fontSize: 13,
                color: "#94a3b8",
                px: 0,
                minWidth: 0,
                "&:hover": { backgroundColor: "transparent", color: "#64748b" },
              }}
            >
              Skip tour
            </AiaButton>

            <AiaBox sx={{ display: "flex", gap: 1 }}>
              <AiaButton
                variant="outlined"
                onClick={back}
                disabled={stepIndex === 0}
                sx={{
                  textTransform: "none",
                  fontWeight: 700,
                  fontSize: 13,
                  borderRadius: "10px",
                  borderColor: "#e2e8f0",
                  color: "#334155",
                  px: 2,
                  minWidth: 80,
                }}
              >
                Back
              </AiaButton>
              <AiaButton
                variant="contained"
                onClick={isLastStep ? close : next}
                endIcon={isLastStep ? undefined : <EastRoundedIcon sx={{ fontSize: 16 }} />}
                sx={{
                  ...TOUR_PRIMARY_BUTTON_SX,
                  px: 2.25,
                  minWidth: 96,
                }}
              >
                {isLastStep ? "Done" : "Next"}
              </AiaButton>
            </AiaBox>
          </AiaBox>
        </AiaBox>
      </AiaBox>
    </AiaBox>
  );

  return createPortal(overlay, document.body);
}
