import type { TourDefinition } from "../types/tour.types";
import { TOUR_TARGETS, tourSelector } from "../constants/tour-targets";

export const sttmDataLineageTour: TourDefinition = {
  id: "sttm-data-lineage",
  label: "STTM — Data Lineage",
  description: "Visualize how sources map to the target table.",
  routes: ["/sttm/builder/new/mapping", "/sttm/builder/new/summary"],
  steps: [
    {
      id: "sttm-data-lineage-intro",
      screen: "Data Lineage tab",
      title: "Data Lineage",
      body: "Visualize how source columns map to your target table. Click any card to expand it.",
      target: tourSelector(TOUR_TARGETS.sttmDataLineagePanel),
      placement: "top",
    },
  ],
};
