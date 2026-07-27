import type { WorkbookExportRequest } from "@/types/api-contract";

export function buildMockWorkbookBlob(payload: WorkbookExportRequest): Blob {
  const projectName = payload.project_name ?? "Mock STTM Project";
  const targetTable = payload.target_table
    ? `${payload.target_table.database}.${payload.target_table.schema}.${payload.target_table.table}`
    : "N/A";
  const mappingCount = payload.mappings?.length ?? 0;

  const content = [
    "Mock STTM Workbook Export",
    `Project: ${projectName}`,
    `Target: ${targetTable}`,
    `Mappings: ${mappingCount}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "This file is a placeholder for local mock mode.",
    "Enable the real backend to download the Excel workbook.",
  ].join("\n");

  return new Blob([content], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
