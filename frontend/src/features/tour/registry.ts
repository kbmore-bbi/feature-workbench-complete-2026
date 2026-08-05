import type { TourDefinition, TourId, TourStep } from "./types/tour.types";
import { landingTour } from "./content/landing.tour";
import { dashboardTour } from "./content/dashboard.tour";
import { projectsTour } from "./content/projects.tour";
import { mappingsTour } from "./content/mappings.tour";
import { administrationUserManagementTour } from "./content/administration-user-management.tour";
import { newMappingTour } from "./content/new-mapping.tour";
import { sttmTableSelectionTour } from "./content/sttm-table-selection.tour";
import { sttmTablesSelectedTour } from "./content/sttm-tables-selected.tour";
import { sttmDerivedTableTour } from "./content/sttm-derived-table.tour";
import { sttmMappingTour } from "./content/sttm-mapping.tour";
import { sttmMappingAutomapTour } from "./content/sttm-mapping-automap.tour";
import { sttmDataPreviewTour } from "./content/sttm-data-preview.tour";
import { sttmDataLineageTour } from "./content/sttm-data-lineage.tour";
import { sttmPreprocessTour } from "./content/sttm-preprocess.tour";
import { sttmPublishTour } from "./content/sttm-publish.tour";
import { sttmSqlPreviewTour } from "./content/sttm-sql-preview.tour";
import { sttmSummaryTour } from "./content/sttm-summary.tour";
import { sttmDbtConversionTour } from "./content/sttm-dbt-conversion.tour";
import { sttmTestCasesTour } from "./content/sttm-test-cases.tour";

/** All tour definitions keyed by id. */
export const TOUR_REGISTRY: Record<TourId, TourDefinition> = {
  landing: landingTour,
  dashboard: dashboardTour,
  projects: projectsTour,
  mappings: mappingsTour,
  "administration-user-management": administrationUserManagementTour,
  "new-mapping": newMappingTour,
  "sttm-table-selection": sttmTableSelectionTour,
  "sttm-tables-selected": sttmTablesSelectedTour,
  "sttm-derived-table": sttmDerivedTableTour,
  "sttm-mapping": sttmMappingTour,
  "sttm-mapping-automap": sttmMappingAutomapTour,
  "sttm-data-preview": sttmDataPreviewTour,
  "sttm-data-lineage": sttmDataLineageTour,
  "sttm-preprocess": sttmPreprocessTour,
  "sttm-publish": sttmPublishTour,
  "sttm-sql-preview": sttmSqlPreviewTour,
  "sttm-summary": sttmSummaryTour,
  "sttm-dbt-conversion": sttmDbtConversionTour,
  "sttm-test-cases": sttmTestCasesTour,
};

/** Ordered segments for the full STTM Builder end-to-end tour. */
export const STTM_FULL_TOUR_SEQUENCE: TourId[] = [
  "sttm-table-selection",
  "sttm-tables-selected",
  "sttm-derived-table",
  "sttm-mapping",
  "sttm-mapping-automap",
  "sttm-preprocess",
  "sttm-publish",
  "sttm-sql-preview",
];

/** App onboarding flow from landing through dashboard. */
export const APP_ONBOARDING_SEQUENCE: TourId[] = [
  "landing",
  "dashboard",
  "new-mapping",
];

export function getTourById(id: TourId): TourDefinition {
  return TOUR_REGISTRY[id];
}

export function getAllTours(): TourDefinition[] {
  return Object.values(TOUR_REGISTRY);
}

/**
 * Tab, modal, and state-specific tours share routes with page tours.
 * Exclude them from path-based defaults so STTM Sheet resolves to sttm-summary,
 * not sttm-data-lineage / sttm-sql-preview, etc.
 */
export const CONTEXTUAL_TOUR_IDS = new Set<TourId>([
  "new-mapping",
  "sttm-tables-selected",
  "sttm-derived-table",
  "sttm-mapping-automap",
  "sttm-data-preview",
  "sttm-data-lineage",
  "sttm-sql-preview",
  "sttm-dbt-conversion",
  "sttm-test-cases",
  "sttm-preprocess",
  "sttm-publish",
]);

/** Resolve the primary tour for a given pathname (prefers the most specific route). */
export function resolveTourForPath(pathname: string): TourDefinition | undefined {
  const normalized = pathname.replace(/\/$/, "") || "/";

  let bestMatch: { tour: TourDefinition; routeLength: number } | undefined;

  for (const tour of getAllTours()) {
    if (CONTEXTUAL_TOUR_IDS.has(tour.id)) continue;

    for (const route of tour.routes) {
      const normalizedRoute = route.replace(/\/$/, "") || "/";
      const isMatch =
        normalized === normalizedRoute ||
        normalized.startsWith(`${normalizedRoute}/`);

      if (!isMatch) continue;

      if (!bestMatch || normalizedRoute.length > bestMatch.routeLength) {
        bestMatch = { tour, routeLength: normalizedRoute.length };
      }
    }
  }

  return bestMatch?.tour;
}

/** Flatten multiple tour segments into one continuous step list (for full-flow tours). */
export function buildCombinedTourSteps(tourIds: TourId[]): TourStep[] {
  return tourIds.flatMap((id) => TOUR_REGISTRY[id].steps);
}

/** Total step count for a tour or combined sequence. */
export function getTourStepCount(tourIds: TourId | TourId[]): number {
  const ids = Array.isArray(tourIds) ? tourIds : [tourIds];
  return buildCombinedTourSteps(ids).length;
}
