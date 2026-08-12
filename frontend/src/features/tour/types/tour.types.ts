export type TourId =
  | "landing"
  | "dashboard"
  | "projects"
  | "mappings"
  | "administration-user-management"
  | "new-mapping"
  | "sttm-table-selection"
  | "sttm-tables-selected"
  | "sttm-derived-table"
  | "sttm-mapping"
  | "sttm-mapping-automap"
  | "sttm-data-preview"
  | "sttm-data-lineage"
  | "sttm-summary"
  | "sttm-dbt-conversion"
  | "sttm-test-cases"
  | "sttm-preprocess"
  | "sttm-publish"
  | "sttm-sql-preview";

export type TourStepPlacement = "top" | "bottom" | "left" | "right" | "center";

/** Optional state guard — tour engine checks before showing a step. */
export type TourStepRequiresState =
  | "modal-open"
  | "tables-selected"
  | "mapping-complete"
  | "rows-selected"
  | "sql-preview-tab";

export type TourStep = {
  id: string;
  /** Step heading shown in the tour popover body. */
  title: string;
  /** Instructional copy from the user guide. */
  body: string;
  /** CSS selector, typically `[data-tour="..."]`. Omit for centered welcome steps. */
  target?: string;
  placement?: TourStepPlacement;
  /** Route the user should be on (or navigate to) before this step. */
  route?: string;
  /** Word doc screen reference, e.g. "Screen 4". */
  screen?: string;
  /** When true, step targets a modal overlay and may need higher z-index. */
  isModal?: boolean;
  requiresState?: TourStepRequiresState;
};

export type TourDefinition = {
  id: TourId;
  label: string;
  description: string;
  steps: TourStep[];
  /** Routes where this tour can be started from the global Help menu. */
  routes: string[];
};
