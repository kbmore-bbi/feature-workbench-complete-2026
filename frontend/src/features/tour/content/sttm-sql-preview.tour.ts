import type { TourDefinition } from "../types/tour.types";
import { TOUR_TARGETS, tourSelector } from "../constants/tour-targets";

export const sttmSqlPreviewTour: TourDefinition = {
  id: "sttm-sql-preview",
  label: "STTM — SQL Preview",
  description: "View and copy the generated SQL from current mappings.",
  routes: ["/sttm/builder/new/mapping", "/sttm/builder/new/summary"],
  steps: [
    {
      id: "sttm-sql-preview-intro",
      screen: "SQL Preview tab",
      title: "SQL Preview Tab",
      body: "The SQL Preview tab shows the complete SQL generated from the current mapping configuration. This query is built in real time from the source-to-target mappings, joins, filters, and transformation rules defined by the user.",
      target: tourSelector(TOUR_TARGETS.sttmSqlPreviewPanel),
      placement: "top",
    },
    {
      id: "sttm-copy-sql",
      screen: "SQL Preview tab",
      title: "Copy SQL",
      body: "Copies the entire generated SQL statement to the clipboard. Useful for pasting into an external SQL editor or documentation.",
      target: tourSelector(TOUR_TARGETS.sttmCopySql),
      placement: "bottom",
    },
  ],
};
