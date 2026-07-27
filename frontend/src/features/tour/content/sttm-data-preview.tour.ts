import type { TourDefinition } from "../types/tour.types";
import { TOUR_TARGETS, tourSelector } from "../constants/tour-targets";

export const sttmDataPreviewTour: TourDefinition = {
  id: "sttm-data-preview",
  label: "STTM — Data Preview",
  description: "Preview sample output data from the current mappings.",
  routes: ["/sttm/builder/new/mapping"],
  steps: [
    {
      id: "sttm-data-preview-intro",
      screen: "Data Preview tab",
      title: "Data Preview",
      body: "See actual data flowing from source to target, based on your current mapping rules.",
      target: tourSelector(TOUR_TARGETS.sttmDataPreviewTab),
      placement: "bottom",
      route: "/sttm/builder/new/mapping",
    },
  ],
};
