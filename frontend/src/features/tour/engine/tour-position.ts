import type { TourStepPlacement } from "../types/tour.types";

export type Rect = { top: number; left: number; width: number; height: number };

export type PopoverLayout = {
  top: number;
  left: number;
  width: number;
  placement: TourStepPlacement;
  caretLeft: number;
};

const POPOVER_WIDTH = 400;
const GAP = 12;
const VIEWPORT_PADDING = 16;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function getRectForElement(element: Element | null): Rect | null {
  if (!element) return null;
  const r = element.getBoundingClientRect();
  if (r.width <= 0 && r.height <= 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function fitsInViewport(
  top: number,
  left: number,
  width: number,
  height: number,
  vw: number,
  vh: number,
) {
  return (
    top >= VIEWPORT_PADDING &&
    left >= VIEWPORT_PADDING &&
    top + height <= vh - VIEWPORT_PADDING &&
    left + width <= vw - VIEWPORT_PADDING
  );
}

export function computePopoverLayout(
  targetRect: Rect | null,
  preferredPlacement: TourStepPlacement | undefined,
  popoverHeight: number,
  vw: number,
  vh: number,
): PopoverLayout {
  const width = POPOVER_WIDTH;

  if (!targetRect || preferredPlacement === "center") {
    return {
      top: Math.round(vh / 2 - popoverHeight / 2),
      left: Math.round(vw / 2 - width / 2),
      width,
      placement: "center",
      caretLeft: width / 2,
    };
  }

  const placements: TourStepPlacement[] = [
    preferredPlacement ?? "bottom",
    "bottom",
    "top",
    "right",
    "left",
  ];

  const uniquePlacements = [...new Set(placements)];

  const targetCenterX = targetRect.left + targetRect.width / 2;
  const targetCenterY = targetRect.top + targetRect.height / 2;

  for (const placement of uniquePlacements) {
    let top = 0;
    let left = 0;

    if (placement === "bottom") {
      top = targetRect.top + targetRect.height + GAP;
      left = targetCenterX - width / 2;
    } else if (placement === "top") {
      top = targetRect.top - GAP - popoverHeight;
      left = targetCenterX - width / 2;
    } else if (placement === "right") {
      top = targetCenterY - popoverHeight / 2;
      left = targetRect.left + targetRect.width + GAP;
    } else if (placement === "left") {
      top = targetCenterY - popoverHeight / 2;
      left = targetRect.left - GAP - width;
    }

    const clampedTop = clamp(Math.round(top), VIEWPORT_PADDING, vh - VIEWPORT_PADDING - popoverHeight);
    const clampedLeft = clamp(Math.round(left), VIEWPORT_PADDING, vw - VIEWPORT_PADDING - width);

    if (fitsInViewport(clampedTop, clampedLeft, width, popoverHeight, vw, vh)) {
      const caretLeft = clamp(
        Math.round(targetCenterX - clampedLeft),
        20,
        width - 20,
      );

      return {
        top: clampedTop,
        left: clampedLeft,
        width,
        placement,
        caretLeft,
      };
    }
  }

  // Fallback: place below target, clamped.
  const fallbackTop = clamp(
    Math.round(targetRect.top + targetRect.height + GAP),
    VIEWPORT_PADDING,
    vh - VIEWPORT_PADDING - popoverHeight,
  );
  const fallbackLeft = clamp(
    Math.round(targetCenterX - width / 2),
    VIEWPORT_PADDING,
    vw - VIEWPORT_PADDING - width,
  );

  return {
    top: fallbackTop,
    left: fallbackLeft,
    width,
    placement: preferredPlacement ?? "bottom",
    caretLeft: clamp(Math.round(targetCenterX - fallbackLeft), 20, width - 20),
  };
}
