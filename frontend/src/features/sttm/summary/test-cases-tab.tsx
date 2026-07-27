"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { AiaButton } from "@/components/ui";
import { dbService } from "@/services/dbService";
import type {
  TestCaseDocumentItem,
  TestCaseGenerationRequest,
  TestCaseGenerationResponse,
} from "@/types/api-contract";
import {
  AutoAwesomeRoundedIcon,
  BoltIcon,
  CheckRoundedIcon,
  CloseRoundedIcon,
  GridOnRoundedIcon,
  KeyboardArrowDownRoundedIcon,
  KeyboardDoubleArrowLeftRoundedIcon,
  KeyboardDoubleArrowRightRoundedIcon,
  ScienceOutlinedIcon,
  TableRowsRoundedIcon,
} from "@/utils/icons";
import { TOUR_TARGETS } from "@/features/tour/constants/tour-targets";
import {
  MAPPING_TABLE_CONTAINER_SX,
  MAPPING_TABLE_HEADER_CELL_SX,
  MAPPING_TABLE_ROW_SX,
  scrollableMappingTableSx,
} from "@/features/sttm/mapping/mapping-table-styles";
import {
  SAMPLE_DATA_COLUMNS,
  SAMPLE_DATA_META,
  SAMPLE_DATA_ROWS,
  TEST_CASE_RECOMMENDATIONS,
  TEST_SUITE_LABELS,
  type SttmTestCase,
  type TestCaseConfidence,
  type TestSuiteKey,
} from "./test-cases-data";

const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, monospace";

const PANEL_WIDTH = 224;
const PANEL_COLLAPSED_WIDTH = 44;

type SuiteFilter = "all" | TestSuiteKey;

type PanelView = "test-cases" | "sample-data";

export type CachedTestCaseGeneration = {
  result: TestCaseGenerationResponse;
  generatedAt: string;
};

const completedTestCaseGenerationCache = new Map<string, CachedTestCaseGeneration>();
const testCaseGenerationRequests = new Map<string, Promise<TestCaseGenerationResponse>>();

function requestKey(payload: TestCaseGenerationRequest | null) {
  return payload ? JSON.stringify(payload) : null;
}

export function getCachedTestCaseGeneration(
  payload: TestCaseGenerationRequest | null,
): CachedTestCaseGeneration | null {
  const key = requestKey(payload);
  return key ? completedTestCaseGenerationCache.get(key) ?? null : null;
}

function normalizeConfidence(value?: string | null): TestCaseConfidence {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "high") return "High";
  if (normalized === "low") return "Low";
  return "Medium";
}

function normalizeSuite(value: string): TestSuiteKey {
  const normalized = value.toLowerCase();
  if (normalized.includes("null") || normalized.includes("required")) return "null-checks";
  if (normalized.includes("range") || normalized.includes("boundary")) return "range-validations";
  if (
    normalized.includes("referential") ||
    normalized.includes("relationship") ||
    normalized.includes("join") ||
    normalized.includes("unique")
  ) {
    return "referential-integrity";
  }
  return "transformation-rules";
}

function toUiTestCase(item: TestCaseDocumentItem): SttmTestCase {
  const negative = item.test_type.trim().toLowerCase().includes("negative");
  return {
    id: item.test_case_id,
    name: `${item.target_attribute}: ${item.group}`,
    targetAttribute: item.target_attribute,
    sourceColumn: item.source_columns,
    mappingRule: item.mapping_rule
      .split(/\s*\|\s*/)
      .map((rule) => rule.trim())
      .filter(Boolean),
    description: item.test_case_description,
    testType: negative ? "Negative" : "Positive",
    sampleSourceInput: item.sample_source_input,
    expectedTargetValue: item.expected_target_value,
    confidence: normalizeConfidence(item.confidence),
    suite: normalizeSuite(item.group),
  };
}

const COLUMN_WIDTH = {
  id: 92,
  name: 180,
  targetAttribute: 140,
  sourceColumn: 132,
  mappingRule: 132,
  description: 200,
  testType: 108,
  sampleSourceInput: 132,
  expectedTargetValue: 172,
  confidence: 96,
} as const;

const TABLE_MIN_WIDTH = Object.values(COLUMN_WIDTH).reduce(
  (total, width) => total + width,
  0,
);

const CONFIDENCE_COLOR: Record<TestCaseConfidence, string> = {
  High: "#059669",
  Medium: "#D97706",
  Low: "#DC2626",
};

const sidebarSectionLabelSx = {
  fontSize: "0.62rem",
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  color: "#94a3b8",
};

function csvEscape(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function downloadBlob(content: string, mimeType: string, filename: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildTestCasesCsv(rows: SttmTestCase[]) {
  const header = [
    "Test Case ID",
    "Test Case Name",
    "Target Attribute",
    "Source Column",
    "Mapping Rule",
    "Description",
    "Test Type",
    "Sample Source Input",
    "Expected Target Value",
    "Confidence",
    "Suite",
  ];
  const lines = rows.map((row) =>
    [
      row.id,
      row.name,
      row.targetAttribute,
      row.sourceColumn,
      row.mappingRule.join(" "),
      row.description,
      row.testType,
      row.sampleSourceInput,
      row.expectedTargetValue,
      row.confidence,
      TEST_SUITE_LABELS[row.suite],
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function TestTypeChip({ type }: { type: SttmTestCase["testType"] }) {
  const negative = type === "Negative";
  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.4,
        px: 0.75,
        py: 0.25,
        borderRadius: "999px",
        backgroundColor: negative ? "#FFF7ED" : "#ECFDF5",
        border: `1px solid ${negative ? "#FED7AA" : "#BBF7D0"}`,
      }}
    >
      {negative ? (
        <CloseRoundedIcon sx={{ fontSize: 11, color: "#C2410C" }} />
      ) : (
        <CheckRoundedIcon sx={{ fontSize: 11, color: "#047857" }} />
      )}
      <Typography
        sx={{
          fontSize: "0.68rem",
          fontWeight: 700,
          color: negative ? "#9A3412" : "#065F46",
        }}
      >
        {type}
      </Typography>
    </Box>
  );
}

function MappingRuleChips({ rules }: { rules: string[] }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0.4 }}>
      {rules.map((rule) => (
        <Box
          key={rule}
          sx={{
            px: 0.7,
            py: 0.2,
            borderRadius: "4px",
            backgroundColor: "#EEF2FF",
            border: "1px solid #E0E7FF",
            fontFamily: MONO_FONT,
            fontSize: "0.64rem",
            fontWeight: 600,
            color: "#4F46E5",
            whiteSpace: "nowrap",
          }}
        >
          {rule}
        </Box>
      ))}
    </Box>
  );
}

function SampleDataView() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          px: 2,
          py: 1.25,
          borderBottom: "1px solid #e5e7eb",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <Box
          sx={{
            width: 30,
            height: 30,
            borderRadius: "8px",
            backgroundColor: "#f1f5f9",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <GridOnRoundedIcon sx={{ fontSize: 16, color: "#475569" }} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: "0.82rem", fontWeight: 700, color: "#0f172a", lineHeight: 1.3 }}>
            Source Sample Data
          </Typography>
          <Typography sx={{ fontSize: "0.7rem", color: "#64748b", lineHeight: 1.3 }}>
            {SAMPLE_DATA_META.sourceTable} · {SAMPLE_DATA_META.sampleRows} sample rows ·{" "}
            {SAMPLE_DATA_META.mappedColumns} mapped columns shown
          </Typography>
        </Box>
        <Box
          sx={{
            ml: "auto",
            px: 1.1,
            py: 0.35,
            borderRadius: "999px",
            backgroundColor: "#FFFBEB",
            border: "1px solid #FDE68A",
            flexShrink: 0,
          }}
        >
          <Typography sx={{ fontSize: "0.68rem", fontWeight: 700, color: "#B45309" }}>
            Sample only — not live data
          </Typography>
        </Box>
      </Box>

      <TableContainer component={Paper} elevation={0} sx={MAPPING_TABLE_CONTAINER_SX}>
        <Table stickyHeader size="small" sx={scrollableMappingTableSx(840)}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ ...MAPPING_TABLE_HEADER_CELL_SX, width: 48 }}>#</TableCell>
              {SAMPLE_DATA_COLUMNS.map((column) => (
                <TableCell key={column.key} sx={MAPPING_TABLE_HEADER_CELL_SX}>
                  <Typography
                    sx={{
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      color: "#0f172a",
                      fontFamily: MONO_FONT,
                      lineHeight: 1.4,
                    }}
                  >
                    {column.source}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: "0.62rem",
                      fontWeight: 500,
                      color: "#94a3b8",
                      fontFamily: MONO_FONT,
                      lineHeight: 1.4,
                      textTransform: "none",
                    }}
                  >
                    → {column.target}
                  </Typography>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {SAMPLE_DATA_ROWS.map((row, index) => (
              <TableRow key={`sample-row-${index}`} sx={MAPPING_TABLE_ROW_SX}>
                <TableCell>
                  <Typography sx={{ fontSize: "0.72rem", color: "#94a3b8" }}>{index + 1}</Typography>
                </TableCell>
                {SAMPLE_DATA_COLUMNS.map((column) => {
                  const cell = row[column.key];
                  return (
                    <TableCell key={column.key}>
                      <Typography sx={{ fontSize: "0.72rem", color: "#0f172a", fontFamily: MONO_FONT, lineHeight: 1.45 }}>
                        {cell?.raw ?? ""}
                      </Typography>
                      {cell?.transformed ? (
                        <Typography sx={{ fontSize: "0.66rem", color: "#7C3AED", fontFamily: MONO_FONT, lineHeight: 1.45 }}>
                          {cell.transformed}
                        </Typography>
                      ) : null}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

type TestCasesTabProps = {
  active: boolean;
  requestPayload: TestCaseGenerationRequest | null;
  workbookLoading?: boolean;
  onDownloadWorkbook?: () => void;
  onCompleted?: (cached: CachedTestCaseGeneration) => void;
};

export function TestCasesTab({
  active,
  requestPayload,
  workbookLoading = false,
  onDownloadWorkbook,
  onCompleted,
}: TestCasesTabProps) {
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [panelView, setPanelView] = useState<PanelView>("test-cases");
  const [suiteFilter, setSuiteFilter] = useState<SuiteFilter>("all");
  const [downloadAnchor, setDownloadAnchor] = useState<null | HTMLElement>(null);
  const [result, setResult] = useState<TestCaseGenerationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const payloadKey = useMemo(() => requestKey(requestPayload), [requestPayload]);

  useEffect(() => {
    const cached = getCachedTestCaseGeneration(requestPayload);
    setResult(cached?.result ?? null);
    setErrorMessage(null);
  }, [payloadKey, requestPayload]);

  const generate = useCallback(
    async (force = false) => {
      if (!requestPayload || !payloadKey) {
        setErrorMessage("A target table and valid generated SQL are required before test cases can be generated.");
        return;
      }
      if (!force) {
        const cached = completedTestCaseGenerationCache.get(payloadKey);
        if (cached) {
          setResult(cached.result);
          return;
        }
      }

      setLoading(true);
      setErrorMessage(null);
      try {
        let pending = !force ? testCaseGenerationRequests.get(payloadKey) : undefined;
        if (!pending) {
          pending = dbService.generateTestCases(requestPayload);
          testCaseGenerationRequests.set(payloadKey, pending);
        }
        const generated = await pending;
        if (generated.status.toLowerCase() === "failed") {
          throw new Error("The test-case generation agent reported a failed result.");
        }
        const cached = { result: generated, generatedAt: new Date().toISOString() };
        completedTestCaseGenerationCache.set(payloadKey, cached);
        setResult(generated);
        onCompleted?.(cached);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Unable to generate test cases.");
      } finally {
        testCaseGenerationRequests.delete(payloadKey);
        setLoading(false);
      }
    },
    [onCompleted, payloadKey, requestPayload],
  );

  useEffect(() => {
    if (requestPayload && payloadKey && !result && !loading && !errorMessage) {
      void generate(false);
    }
  }, [errorMessage, generate, loading, payloadKey, requestPayload, result]);

  const testCases = useMemo(
    () => (result?.test_case_document ?? []).map(toUiTestCase),
    [result],
  );

  const stats = useMemo(() => {
    const positive = testCases.filter((row) => row.testType === "Positive").length;
    const negative = testCases.filter((row) => row.testType === "Negative").length;
    const highConfidence = testCases.filter((row) => row.confidence === "High").length;
    return { positive, negative, highConfidence, total: testCases.length };
  }, [testCases]);

  const suiteCounts = useMemo(() => {
    const counts = new Map<TestSuiteKey, number>();
    testCases.forEach((row) => {
      counts.set(row.suite, (counts.get(row.suite) ?? 0) + 1);
    });
    return counts;
  }, [testCases]);

  const filteredRows = useMemo(
    () =>
      suiteFilter === "all"
        ? testCases
        : testCases.filter((row) => row.suite === suiteFilter),
    [suiteFilter, testCases],
  );

  const suiteItems: Array<{ key: SuiteFilter; label: string; count: number }> = [
    { key: "all", label: "All Tests", count: testCases.length },
    ...(Object.keys(TEST_SUITE_LABELS) as TestSuiteKey[]).map((key) => ({
      key: key as SuiteFilter,
      label: TEST_SUITE_LABELS[key],
      count: suiteCounts.get(key) ?? 0,
    })),
  ];

  const handleDownloadCsv = () => {
    downloadBlob(buildTestCasesCsv(filteredRows), "text/csv;charset=utf-8", "test_cases.csv");
    setDownloadAnchor(null);
  };

  const handleDownloadJson = () => {
    downloadBlob(
      JSON.stringify(filteredRows, null, 2),
      "application/json;charset=utf-8",
      "test_cases.json",
    );
    setDownloadAnchor(null);
  };

  const activeSuiteLabel =
    suiteFilter === "all" ? "All Suites" : TEST_SUITE_LABELS[suiteFilter as TestSuiteKey];

  return (
    <Box
      data-tour={TOUR_TARGETS.sttmTestCasesPanel}
      sx={{ display: active ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden", bgcolor: "#fff" }}
    >
      {/* AI banner */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          px: 2,
          py: 1,
          backgroundColor: "#ECFDF5",
          borderBottom: "1px solid #D1FAE5",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <Box
          sx={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            backgroundColor: "#10B981",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <AutoAwesomeRoundedIcon sx={{ fontSize: 14, color: "#fff" }} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: "0.8rem", fontWeight: 700, color: "#065F46", lineHeight: 1.3 }}>
            {loading
              ? "AI agent is generating test cases"
              : result
                ? `${result.agent_name} generated ${stats.total} test cases`
                : "Generate test cases from the current mapping"}
          </Typography>
          <Typography sx={{ fontSize: "0.7rem", color: "#047857", lineHeight: 1.3 }}>
            {loading
              ? "Using the validated SQL, mappings, semantic context, relationships, and derived sources."
              : `${stats.positive} positive · ${stats.negative} negative · ${stats.highConfidence} high confidence`}
          </Typography>
        </Box>

        <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 1.25, flexShrink: 0 }}>
          {loading ? <CircularProgress size={18} thickness={5} /> : null}
          <Typography sx={{ fontSize: "0.72rem", fontWeight: 600, color: "#047857" }}>
            {stats.total} tests
          </Typography>
          <AiaButton
            variant="outlined"
            color="primary"
            size="small"
            disabled={loading || !requestPayload}
            onClick={() => void generate(Boolean(result))}
            sx={{ height: 30, px: 1.5, fontSize: "0.74rem", fontWeight: 700 }}
          >
            {result ? "Regenerate" : errorMessage ? "Retry" : "Generate"}
          </AiaButton>
          <AiaButton
            variant="contained"
            color="primary"
            size="small"
            disabled={loading || stats.total === 0}
            onClick={(event) => setDownloadAnchor(event.currentTarget)}
            endIcon={<KeyboardArrowDownRoundedIcon sx={{ fontSize: 15 }} />}
            sx={{
              height: 30,
              px: 1.5,
              fontSize: "0.74rem",
              fontWeight: 700,
            }}
          >
            Download
          </AiaButton>
          <Menu
            anchorEl={downloadAnchor}
            open={Boolean(downloadAnchor)}
            onClose={() => setDownloadAnchor(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
          >
            <MenuItem onClick={handleDownloadCsv} sx={{ fontSize: "0.78rem" }}>
              Download as CSV
            </MenuItem>
            <MenuItem onClick={handleDownloadJson} sx={{ fontSize: "0.78rem" }}>
              Download as JSON
            </MenuItem>
          </Menu>
          {onDownloadWorkbook ? (
            <AiaButton
              variant="outlined"
              color="primary"
              size="small"
              disabled={workbookLoading || stats.total === 0}
              onClick={onDownloadWorkbook}
              sx={{ height: 30, px: 1.5, fontSize: "0.74rem", fontWeight: 700 }}
            >
              {workbookLoading ? "Preparing..." : "Excel"}
            </AiaButton>
          ) : null}
        </Box>
      </Box>

      {errorMessage ? (
        <Alert severity="error" sx={{ mx: 2, mt: 1, flexShrink: 0 }}>
          {errorMessage}
        </Alert>
      ) : null}

      {/* Stats strip */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          px: 2,
          py: 0.75,
          borderBottom: "1px solid #e5e7eb",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        {[
          { label: `${stats.positive} positive`, color: "#10B981" },
          { label: `${stats.negative} negative`, color: "#F97316" },
          { label: `${stats.highConfidence} high confidence`, color: "#8B5CF6" },
        ].map((item) => (
          <Box key={item.label} sx={{ display: "inline-flex", alignItems: "center", gap: 0.6 }}>
            <Box sx={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: item.color }} />
            <Typography sx={{ fontSize: "0.72rem", fontWeight: 600, color: "#334155" }}>
              {item.label}
            </Typography>
          </Box>
        ))}
        <Typography sx={{ ml: "auto", fontSize: "0.72rem", color: "#94a3b8" }}>
          {panelView === "sample-data"
            ? `Sample Data · ${SAMPLE_DATA_META.sourceTable}`
            : `${activeSuiteLabel} · ${filteredRows.length} tests`}
        </Typography>
      </Box>

      <Box sx={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
        {/* Left suites panel */}
        <Box
          sx={{
            width: panelCollapsed ? PANEL_COLLAPSED_WIDTH : PANEL_WIDTH,
            flexShrink: 0,
            borderRight: "1px solid #e5e7eb",
            backgroundColor: "#fafafa",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {panelCollapsed ? (
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", pt: 1 }}>
              <IconButton
                size="small"
                aria-label="Expand test suites panel"
                onClick={() => setPanelCollapsed(false)}
                sx={{ color: "#475569" }}
              >
                <KeyboardDoubleArrowRightRoundedIcon sx={{ fontSize: 18 }} />
              </IconButton>
              <ScienceOutlinedIcon sx={{ mt: 1, fontSize: 17, color: "#94a3b8" }} />
            </Box>
          ) : (
            <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 1.25, py: 1.25 }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
                <Typography sx={sidebarSectionLabelSx}>Test Suites</Typography>
                <IconButton
                  size="small"
                  aria-label="Collapse test suites panel"
                  onClick={() => setPanelCollapsed(true)}
                  sx={{ p: 0.25, color: "#94a3b8" }}
                >
                  <KeyboardDoubleArrowLeftRoundedIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>

              {[
                { key: "test-cases" as PanelView, label: "Test Cases", dot: "#10B981", icon: <ScienceOutlinedIcon sx={{ fontSize: 15 }} /> },
                { key: "sample-data" as PanelView, label: "Sample Data", dot: "#F97316", icon: <TableRowsRoundedIcon sx={{ fontSize: 15 }} /> },
              ].map((item) => {
                const selected = panelView === item.key;
                return (
                  <Box
                    key={item.key}
                    onClick={() => setPanelView(item.key)}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.75,
                      px: 1,
                      py: 0.65,
                      mb: 0.25,
                      borderRadius: "8px",
                      cursor: "pointer",
                      backgroundColor: selected ? "#eef2f7" : "transparent",
                      color: selected ? "#0f172a" : "#475569",
                      "&:hover": { backgroundColor: selected ? "#eef2f7" : "#f1f5f9" },
                    }}
                  >
                    <Box sx={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: item.dot, flexShrink: 0 }} />
                    <Typography sx={{ fontSize: "0.76rem", fontWeight: selected ? 700 : 500 }}>
                      {item.label}
                    </Typography>
                  </Box>
                );
              })}

              <Typography sx={{ ...sidebarSectionLabelSx, mt: 1.75, mb: 0.75 }}>Suites</Typography>
              {suiteItems.map((item) => {
                const selected = suiteFilter === item.key;
                return (
                  <Box
                    key={item.key}
                    onClick={() => setSuiteFilter(item.key)}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 0.75,
                      px: 1,
                      py: 0.6,
                      mb: 0.25,
                      borderRadius: "8px",
                      cursor: "pointer",
                      backgroundColor: selected ? "#eef2f7" : "transparent",
                      "&:hover": { backgroundColor: selected ? "#eef2f7" : "#f1f5f9" },
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: "0.74rem",
                        fontWeight: selected ? 700 : 500,
                        color: selected ? "#0f172a" : "#475569",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {item.label}
                    </Typography>
                    <Box
                      sx={{
                        px: 0.7,
                        py: 0.1,
                        borderRadius: "999px",
                        backgroundColor: selected ? "var(--color-primary)" : "#e2e8f0",
                        color: selected ? "#fff" : "#475569",
                        fontSize: "0.64rem",
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {item.count}
                    </Box>
                  </Box>
                );
              })}

              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 1.75, mb: 0.75 }}>
                <BoltIcon sx={{ fontSize: 13, color: "#F59E0B" }} />
                <Typography sx={sidebarSectionLabelSx}>Recommendations</Typography>
              </Box>
              {TEST_CASE_RECOMMENDATIONS.map((text) => (
                <Box key={text} sx={{ display: "flex", gap: 0.6, px: 1, py: 0.35 }}>
                  <Typography sx={{ fontSize: "0.68rem", color: "#94a3b8", lineHeight: 1.5 }}>•</Typography>
                  <Typography sx={{ fontSize: "0.68rem", color: "#64748b", lineHeight: 1.5 }}>
                    {text}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </Box>

        {/* Main content */}
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {panelView === "sample-data" ? (
            <SampleDataView />
          ) : (
            <TableContainer component={Paper} elevation={0} sx={MAPPING_TABLE_CONTAINER_SX}>
              <Table stickyHeader size="small" sx={scrollableMappingTableSx(TABLE_MIN_WIDTH)}>
                <colgroup>
                  {Object.values(COLUMN_WIDTH).map((width, index) => (
                    <col key={`test-case-col-${index}`} style={{ width }} />
                  ))}
                </colgroup>
                <TableHead>
                  <TableRow>
                    <TableCell sx={MAPPING_TABLE_HEADER_CELL_SX}>Test Case ID</TableCell>
                    <TableCell sx={MAPPING_TABLE_HEADER_CELL_SX}>Test Case Name</TableCell>
                    <TableCell sx={MAPPING_TABLE_HEADER_CELL_SX}>Target Attribute</TableCell>
                    <TableCell sx={MAPPING_TABLE_HEADER_CELL_SX}>Source Column</TableCell>
                    <TableCell sx={MAPPING_TABLE_HEADER_CELL_SX}>Mapping Rule</TableCell>
                    <TableCell sx={MAPPING_TABLE_HEADER_CELL_SX}>Description</TableCell>
                    <TableCell sx={MAPPING_TABLE_HEADER_CELL_SX}>Test Type</TableCell>
                    <TableCell sx={MAPPING_TABLE_HEADER_CELL_SX}>Sample Source Input</TableCell>
                    <TableCell sx={MAPPING_TABLE_HEADER_CELL_SX}>Expected Target Value</TableCell>
                    <TableCell sx={MAPPING_TABLE_HEADER_CELL_SX}>Confidence</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredRows.map((row) => (
                    <TableRow key={row.id} sx={MAPPING_TABLE_ROW_SX}>
                      <TableCell>
                        <Box
                          sx={{
                            display: "inline-flex",
                            px: 0.7,
                            py: 0.2,
                            borderRadius: "4px",
                            backgroundColor: "#EEF2FF",
                            border: "1px solid #C7D2FE",
                            fontFamily: MONO_FONT,
                            fontSize: "0.66rem",
                            fontWeight: 700,
                            color: "#4338CA",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {row.id}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography sx={{ fontSize: "0.74rem", fontWeight: 600, color: "#0f172a", lineHeight: 1.4 }}>
                          {row.name}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography sx={{ fontSize: "0.72rem", fontWeight: 700, color: "#0f172a", fontFamily: MONO_FONT }}>
                          {row.targetAttribute}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.6 }}>
                          <Box sx={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: "#10B981", flexShrink: 0 }} />
                          <Typography sx={{ fontSize: "0.72rem", color: "#334155", fontFamily: MONO_FONT }}>
                            {row.sourceColumn}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <MappingRuleChips rules={row.mappingRule} />
                      </TableCell>
                      <TableCell>
                        <Typography
                          sx={{
                            fontSize: "0.72rem",
                            color: "#64748b",
                            lineHeight: 1.45,
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {row.description}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <TestTypeChip type={row.testType} />
                      </TableCell>
                      <TableCell>
                        <Typography sx={{ fontSize: "0.72rem", color: "#0f172a", fontFamily: MONO_FONT }}>
                          {row.sampleSourceInput}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography sx={{ fontSize: "0.72rem", color: "#059669", fontFamily: MONO_FONT, lineHeight: 1.45 }}>
                          {row.expectedTargetValue}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography sx={{ fontSize: "0.72rem", fontWeight: 700, color: CONFIDENCE_COLOR[row.confidence] }}>
                          {row.confidence}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!filteredRows.length ? (
                    <TableRow>
                      <TableCell colSpan={10} sx={{ py: 4, textAlign: "center" }}>
                        {loading ? (
                          <Box sx={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
                            <CircularProgress size={18} />
                            <Typography sx={{ fontSize: "0.82rem", color: "#64748b" }}>
                              Generating test cases from the current mapping...
                            </Typography>
                          </Box>
                        ) : (
                          <Typography sx={{ fontSize: "0.82rem", color: "#64748b" }}>
                            {result
                              ? "No test cases in this suite."
                              : requestPayload
                                ? "Open this tab to generate test cases, or select Generate."
                                : "Complete the target selection and generated SQL before creating test cases."}
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      </Box>
    </Box>
  );
}
