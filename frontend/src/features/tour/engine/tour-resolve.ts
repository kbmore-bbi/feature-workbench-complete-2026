import { getTourById, resolveTourForPath } from "../registry";
import type { TourId } from "../types/tour.types";

export function hasVisibleTourAnchor(dataTourValue: string) {
  if (typeof document === "undefined") return false;
  const el = document.querySelector(`[data-tour="${dataTourValue}"]`);
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function resolveActiveTabTourId(): TourId | null {
  if (hasVisibleTourAnchor("sttm-sql-preview-panel")) return "sttm-sql-preview";
  if (hasVisibleTourAnchor("sttm-data-preview-panel")) return "sttm-data-preview";
  if (hasVisibleTourAnchor("sttm-data-lineage-panel")) return "sttm-data-lineage";
  return null;
}

/**
 * Primary page tour for auto-launch — one per route, ignoring tabs/modals/contextual UI.
 * Ensures revisiting a page does not pick a different unseen contextual tour id.
 */
export function resolvePrimaryTourIdForPath(effectivePath: string): TourId | null {
  const normalized = effectivePath.replace(/\/$/, "") || "/";

  if (normalized.startsWith("/sttm/builder/new/mapping")) return "sttm-mapping";
  if (normalized.startsWith("/sttm/builder/new/summary")) return "sttm-summary";
  if (normalized.startsWith("/sttm/builder/new")) return "sttm-table-selection";

  return resolveTourForPath(normalized)?.id ?? null;
}

/** Pick the best tour for the current route, open tab, modal, or contextual UI state. */
export function resolveTourIdForContext(
  effectivePath: string,
  modalTourId: TourId | null,
): TourId | null {
  if (modalTourId) return modalTourId;

  const resolved = resolveTourForPath(effectivePath);
  if (!resolved) return null;

  if (effectivePath.startsWith("/sttm/builder/new/mapping")) {
    const tabTourId = resolveActiveTabTourId();
    if (tabTourId) return tabTourId;
    if (hasVisibleTourAnchor("sttm-row-selection-bar")) return "sttm-publish";
    if (hasVisibleTourAnchor("sttm-confidence-score")) {
      return "sttm-mapping-automap";
    }
    return "sttm-mapping";
  }

  if (effectivePath.startsWith("/sttm/builder/new/summary")) {
    const tabTourId = resolveActiveTabTourId();
    if (tabTourId) return tabTourId;
    if (hasVisibleTourAnchor("sttm-dbt-conversion-panel")) return "sttm-dbt-conversion";
    if (hasVisibleTourAnchor("sttm-test-cases-panel")) return "sttm-test-cases";
    return "sttm-summary";
  }

  return resolved.id;
}

/** Contextual tour (row selection, automap, tabs) — differs from the primary page tour. */
export function resolveContextualTourIdForPath(effectivePath: string): TourId | null {
  const primary = resolvePrimaryTourIdForPath(effectivePath);
  const contextual = resolveTourIdForContext(effectivePath, null);
  if (!contextual || contextual === primary) return null;
  return contextual;
}

export function isTourStepReady(tourId: TourId, stepIndex = 0) {
  const step = getTourById(tourId).steps[stepIndex];
  if (!step?.target) return true;
  try {
    const el = document.querySelector(step.target);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  } catch {
    return false;
  }
}
