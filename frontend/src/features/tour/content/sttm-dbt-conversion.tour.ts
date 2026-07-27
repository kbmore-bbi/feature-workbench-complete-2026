import type { TourDefinition } from "../types/tour.types";
import { TOUR_TARGETS, tourSelector } from "../constants/tour-targets";

export const sttmDbtConversionTour: TourDefinition = {
  id: "sttm-dbt-conversion",
  label: "STTM — DBT Conversion",
  description: "Transform the finalized mapping into ready-to-use DBT code.",
  routes: ["/sttm/builder/new/summary"],
  steps: [
    {
      id: "sttm-dbt-conversion-intro",
      screen: "DBT Conversion tab",
      title: "DBT Conversion",
      body: "The DBT Conversion tab transforms the finalized mapping into ready-to-use DBT code. This screen shows the auto-generated DBT project structure, including the sources.yml file that documents the source schema, tables, and column descriptions used in the mapping.",
      target: tourSelector(TOUR_TARGETS.sttmDbtConversionPanel),
      placement: "top",
      route: "/sttm/builder/new/summary",
    },
    {
      id: "sttm-dbt-push-to-git",
      screen: "DBT Conversion tab",
      title: "Push to Git",
      body: "Pushes the generated DBT code (models, YAML, macros) directly to the connected Git repository. This is the key action for operationalizing the mapping into a DBT project.",
      target: tourSelector(TOUR_TARGETS.sttmSummaryPushToGit),
      placement: "bottom",
      route: "/sttm/builder/new/summary",
    },
  ],
};
