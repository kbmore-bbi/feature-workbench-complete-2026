import { buildApiEnvelope, createRequestId } from "@/api/axiosInstance";
import type {
  DbtConversionGeneratedFile,
  DbtConversionRequest,
  DbtConversionResponse,
} from "@/types/api-contract";
import { mockSleep } from "@/services/mock/mockConfig";

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function buildMockDbtFiles(payload: DbtConversionRequest): {
  generatedFiles: DbtConversionGeneratedFile[];
  schemaFiles: DbtConversionGeneratedFile[];
} {
  const modelName = slugify(payload.target_table.table);
  const domain = slugify(payload.domain_name ?? payload.project_name ?? "sales_core");
  const sql = payload.validated_sql?.trim() || payload.generated_sql?.trim() || "SELECT 1";

  const generatedFiles: DbtConversionGeneratedFile[] = [
    {
      file_name: `${modelName}.sql`,
      file_path: `models/${domain}/${modelName}.sql`,
      file_type: "model",
      language: "sql",
      content: [
        "-- Mock dbt model generated for local development",
        `{{ config(materialized='${payload.materialization ?? "incremental"}') }}`,
        "",
        sql,
      ].join("\n"),
    },
  ];

  const schemaFiles: DbtConversionGeneratedFile[] = [
    {
      file_name: `${modelName}.yml`,
      file_path: `models/${domain}/${modelName}.yml`,
      file_type: "schema",
      language: "yaml",
      content: [
        "version: 2",
        "models:",
        `  - name: ${modelName}`,
        `    description: Mock schema for ${payload.target_table.table}`,
        "    columns:",
        ...payload.mappings.slice(0, 8).map((mapping) => [
          `      - name: ${mapping.target_column}`,
          `        description: Mock column mapping for ${mapping.target_column}`,
        ].join("\n")),
      ].join("\n"),
    },
  ];

  return { generatedFiles, schemaFiles };
}

export function buildMockDbtConversion(
  payload: DbtConversionRequest,
): DbtConversionResponse {
  const { generatedFiles, schemaFiles } = buildMockDbtFiles(payload);

  return {
    status: "completed",
    action: "CREATE_NEW",
    message: "Mock dbt conversion completed using local development data.",
    generated_files: generatedFiles,
    schema_files: schemaFiles,
    source_update: {
      file_path: "models/sources.yml",
      action: "NO_CHANGE",
      content: null,
      language: "yaml",
    },
    macros_used: ["mock_generate_surrogate_key"],
    materialization: payload.materialization ?? "incremental",
    materialization_reason: "Mock materialization selected for local preview.",
    agent_name: "MOCK_DBT_CONVERSION_AGENT",
    domain_name: payload.domain_name ?? domainFromPayload(payload),
    target_layer: payload.target_layer ?? "curated",
    branch: "feature/mock-dbt-conversion",
  };
}

function domainFromPayload(payload: DbtConversionRequest) {
  return slugify(payload.domain_name ?? payload.target_table.schema ?? "sales_core");
}

function buildMockDbtFinalEnvelope(payload: DbtConversionRequest) {
  const result = buildMockDbtConversion(payload);
  return buildApiEnvelope("dbt_conversion.generate", result, {
    target_table: payload.target_table,
    source_tables: payload.source_tables,
    driving_table: payload.driving_table ?? null,
    relationships: payload.relationships ?? [],
    semantic_bundle_id: payload.semantic_bundle_id ?? null,
    semantic_view_name: payload.semantic_view_name ?? null,
    thread_id: `mock-dbt-${createRequestId().slice(0, 8)}`,
  });
}

export async function* mockStreamDbtConversion(
  payload: DbtConversionRequest,
): AsyncGenerator<
  | { event: "status"; data: Record<string, unknown> }
  | { event: "artifact"; data: Record<string, unknown> }
  | { event: "final"; data: Record<string, unknown> }
  | { event: "error"; data: { message?: string; code?: string } }
> {
  yield {
    event: "status",
    data: {
      phase: "agent_progress",
      message: "AGT_DBT_CONVERSION is reviewing the final SQL and loading dbt project context.",
    },
  };
  await mockSleep(250);

  const { generatedFiles, schemaFiles } = buildMockDbtFiles(payload);

  for (const file of generatedFiles) {
    yield {
      event: "status",
      data: {
        phase: "file_ready",
        message: `Generated ${file.file_path}.`,
      },
    };
    yield {
      event: "artifact",
      data: {
        kind: "generated_file",
        file,
      },
    };
    await mockSleep(120);
  }

  for (const file of schemaFiles) {
    yield {
      event: "status",
      data: {
        phase: "file_ready",
        message: `Prepared ${file.file_path}.`,
      },
    };
    yield {
      event: "artifact",
      data: {
        kind: "schema_file",
        file,
      },
    };
    await mockSleep(120);
  }

  const finalEnvelope = buildMockDbtFinalEnvelope(payload);
  yield {
    event: "final",
    data: finalEnvelope as unknown as Record<string, unknown>,
  };
}
