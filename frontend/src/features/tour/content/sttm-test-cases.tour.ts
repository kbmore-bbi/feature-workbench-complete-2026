import type { TourDefinition } from "../types/tour.types";
import { TOUR_TARGETS, tourSelector } from "../constants/tour-targets";

export const sttmTestCasesTour: TourDefinition = {
  id: "sttm-test-cases",
  label: "STTM — Test Cases",
  description: "AI-generated validation test cases for the completed mapping.",
  routes: ["/sttm/builder/new/summary"],
  steps: [
    {
      id: "sttm-test-cases-intro",
      screen: "Test Cases tab",
      title: "Test Cases",
      body: "The Test Cases tab is where AI Agent automatically generates validation test cases based on the completed mapping.",
      target: tourSelector(TOUR_TARGETS.sttmTestCasesPanel),
      placement: "top",
      route: "/sttm/builder/new/summary",
    },
  ],
};
