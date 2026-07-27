/**
 * Stable `data-tour` attribute values for tour anchors.
 * Add matching attributes to UI components as tours are wired up.
 */
export const TOUR_TARGETS = {
  // Screen 1 — Landing
  landingWelcome: "landing-welcome",
  landingGetStarted: "landing-get-started",
  userProfile: "user-profile",

  // Screen 2 — Dashboard & sidebar
  sidebar: "app-sidebar",
  sidebarDashboard: "sidebar-dashboard",
  sidebarProjects: "sidebar-projects",
  sidebarMappings: "sidebar-mappings",
  newMappingButton: "new-mapping-button",

  // Screen 3 — New Mapping modal
  newMappingModal: "new-mapping-modal",
  newMappingSqlUpload: "new-mapping-sql-upload",
  newMappingExcelUpload: "new-mapping-excel-upload",
  newMappingManual: "new-mapping-manual",
  newMappingCancel: "new-mapping-cancel",

  // Screen 4–5 — STTM table selection
  sttmHeader: "sttm-header",
  sttmStepper: "sttm-stepper",
  sttmSourceSelection: "sttm-source-selection",
  sttmTargetSelection: "sttm-target-selection",
  sttmDerivedSources: "sttm-derived-sources",
  sttmAddDerived: "sttm-add-derived",
  sttmNextButton: "sttm-next-button",
  sttmAddJoin: "sttm-add-join",
  sttmAddGroup: "sttm-add-group",
  sttmAiAssistant: "sttm-ai-assistant",
  sttmDrivingBadge: "sttm-driving-badge",
  sttmSelectedSourceTable: "sttm-selected-source-table",
  sttmClearAllSource: "sttm-clear-all-source",
  sttmClearAllTarget: "sttm-clear-all-target",

  // Screen 6 — Add Derived Table modal
  derivedSourceName: "derived-source-name",
  derivedAvailableTables: "derived-available-tables",
  derivedSqlViewTab: "derived-sql-view-tab",
  derivedColumnsPreviewTab: "derived-columns-preview-tab",
  derivedFunctionLibrary: "derived-function-library",
  derivedFunctionPanel: "derived-function-panel",
  derivedValidateSql: "derived-validate-sql",
  derivedAddTable: "derived-add-table",

  // Screen 7–8 — Mapping
  sttmSourceColumnsPanel: "sttm-source-columns-panel",
  sttmMappingGrid: "sttm-mapping-grid",
  sttmTargetColumn: "sttm-target-column",
  sttmSqlPreviewTab: "sttm-sql-preview-tab",
  sttmDataPreviewTab: "sttm-data-preview-tab",
  sttmDataLineageTab: "sttm-data-lineage-tab",
  sttmAutoMapButton: "sttm-auto-map-button",
  sttmMappingProgress: "sttm-mapping-progress",
  sttmConfidenceScore: "sttm-confidence-score",
  sttmPreprocessButton: "sttm-preprocess-button",
  sttmDescriptionAi: "sttm-description-ai",
  sttmMappedStatus: "sttm-mapped-status",

  // Pre-processing modal
  preprocessSourceTables: "preprocess-source-tables",
  preprocessSqlEditor: "preprocess-sql-editor",
  preprocessFunctionLibrary: "preprocess-function-library",
  preprocessFunctionTabs: "preprocess-function-tabs",
  preprocessApplyRule: "preprocess-apply-rule",
  preprocessCancel: "preprocess-cancel",

  // Screen 10 — Publish actions
  sttmRowSelectionBar: "sttm-row-selection-bar",
  sttmMarkMapped: "sttm-mark-mapped",
  sttmSetDirect: "sttm-set-direct",
  sttmPublishRowMapping: "sttm-publish-row-mapping",

  // Screen 11 — SQL Preview
  sttmCopySql: "sttm-copy-sql",
  sttmSqlPreviewPanel: "sttm-sql-preview-panel",

  // Mapping tabs — Data Preview / Data Lineage (tab-specific tours)
  sttmDataPreviewPanel: "sttm-data-preview-panel",
  sttmDataLineagePanel: "sttm-data-lineage-panel",

  // Step 3 — Final Mapping & Summary
  sttmSummaryAiSummary: "sttm-summary-ai-summary",
  sttmSummaryExcel: "sttm-summary-excel",
  sttmSummarySql: "sttm-summary-sql",
  sttmSummaryPublishMapping: "sttm-summary-publish-mapping",
  sttmDbtConversionPanel: "sttm-dbt-conversion-panel",
  sttmSummaryPushToGit: "sttm-summary-push-to-git",
  sttmTestCasesPanel: "sttm-test-cases-panel",
} as const;

export type TourTarget = (typeof TOUR_TARGETS)[keyof typeof TOUR_TARGETS];

export function tourSelector(target: TourTarget): string {
  return `[data-tour="${target}"]`;
}
