"use client";

import type { ReactNode } from "react";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import HubRoundedIcon from "@mui/icons-material/HubRounded";
import PercentRoundedIcon from "@mui/icons-material/PercentRounded";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import TrendingFlatRoundedIcon from "@mui/icons-material/TrendingFlatRounded";
import {
  Box,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import type { SummaryMetrics } from "./summary-utils";
import { summaryStatusLabel } from "./summary-utils";

type AiSummaryPanelProps = {
  metrics: SummaryMetrics;
  targetQualifiedName?: string | null;
  narrative: string;
};

function MetricCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string | number;
  tone: "green" | "amber" | "purple" | "blue";
  icon: ReactNode;
}) {
  const palette = {
    green: { bg: "#ecfdf5", border: "#bbf7d0", color: "#166534" },
    amber: { bg: "#fffbeb", border: "#fde68a", color: "#92400e" },
    purple: { bg: "#f5f3ff", border: "#ddd6fe", color: "#6d28d9" },
    blue: { bg: "#eff6ff", border: "#bfdbfe", color: "#1d4ed8" },
  }[tone];

  return (
    <Paper
      elevation={0}
      sx={{
        p: 1.1,
        borderRadius: "10px",
        border: `1px solid ${palette.border}`,
        backgroundColor: palette.bg,
        minWidth: 0,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 0.75 }}>
        <Typography sx={{ fontSize: "0.62rem", fontWeight: 700, color: palette.color, letterSpacing: "0.04em" }}>
          {label}
        </Typography>
        {icon}
      </Box>
      <Typography sx={{ fontSize: "1.1rem", fontWeight: 800, color: "#0f172a", mt: 0.35, lineHeight: 1 }}>
        {value}
      </Typography>
    </Paper>
  );
}

export function AiSummaryPanel({ metrics, targetQualifiedName, narrative }: AiSummaryPanelProps) {
  const status = summaryStatusLabel(metrics);
  const statusColor =
    status === "Complete" ? "#166534" : status === "Partial" ? "#92400e" : "#64748b";
  const statusBg =
    status === "Complete" ? "#ecfdf5" : status === "Partial" ? "#fffbeb" : "#f8fafc";

  return (
    <Box
      sx={{
        width: 320,
        minWidth: 280,
        maxWidth: 360,
        borderLeft: "1px solid #e5e7eb",
        backgroundColor: "#fafafa",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <Box sx={{ px: 2, py: 1.5, borderBottom: "1px solid #e5e7eb", backgroundColor: "#fff" }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <AutoAwesomeRoundedIcon sx={{ fontSize: 18, color: "#6366f1" }} />
          <Typography sx={{ fontSize: "0.92rem", fontWeight: 700, color: "#111827" }}>
            AI Summary
          </Typography>
        </Stack>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: 2 }}>
        <Stack spacing={2}>
          <Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
              <Typography sx={{ fontSize: "0.78rem", fontWeight: 600, color: "#475569" }}>
                Mapping Status
              </Typography>
              <Chip
                label={status}
                size="small"
                sx={{
                  height: 22,
                  fontSize: "0.68rem",
                  fontWeight: 700,
                  bgcolor: statusBg,
                  color: statusColor,
                }}
              />
            </Stack>
            <Typography sx={{ fontSize: "0.74rem", color: "#64748b", mb: 0.75 }}>
              Column Coverage
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.75 }}>
              <Typography sx={{ fontSize: "0.82rem", fontWeight: 700, color: "#111827" }}>
                {metrics.mappedCount}/{metrics.totalCount}
              </Typography>
              <Typography sx={{ fontSize: "0.74rem", color: "#64748b" }}>
                {metrics.progressPercent}% complete
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={metrics.progressPercent}
              sx={{
                height: 6,
                borderRadius: 999,
                backgroundColor: "#e5e7eb",
                "& .MuiLinearProgress-bar": {
                  borderRadius: 999,
                  backgroundColor: "#f59e0b",
                },
              }}
            />
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 1,
            }}
          >
            <MetricCard
              label="TOTAL MAPPED"
              value={metrics.mappedCount}
              tone="green"
              icon={<CheckCircleRoundedIcon sx={{ fontSize: 16, color: "#16a34a" }} />}
            />
            <MetricCard
              label="UNMAPPED"
              value={metrics.unmappedCount}
              tone="amber"
              icon={<ErrorOutlineRoundedIcon sx={{ fontSize: 16, color: "#d97706" }} />}
            />
            <MetricCard
              label="DIRECT RULES"
              value={metrics.directRuleCount}
              tone="purple"
              icon={<TrendingFlatRoundedIcon sx={{ fontSize: 16, color: "#7c3aed" }} />}
            />
            <MetricCard
              label="TRANSFORMS"
              value={metrics.transformRuleCount}
              tone="purple"
              icon={<PercentRoundedIcon sx={{ fontSize: 16, color: "#7c3aed" }} />}
            />
            <MetricCard
              label="JOINS"
              value={metrics.joinCount}
              tone="blue"
              icon={<HubRoundedIcon sx={{ fontSize: 16, color: "#2563eb" }} />}
            />
            <MetricCard
              label="SOURCE TABLES"
              value={metrics.sourceTableCount}
              tone="green"
              icon={<TableChartOutlinedIcon sx={{ fontSize: 16, color: "#16a34a" }} />}
            />
          </Box>

          <Box>
            <Typography sx={{ fontSize: "0.78rem", fontWeight: 700, color: "#111827", mb: 0.75 }}>
              Narrative Summary
            </Typography>
            <Typography sx={{ fontSize: "0.76rem", color: "#475569", lineHeight: 1.55 }}>
              {narrative}
            </Typography>
          </Box>

          {metrics.sourceTableLabels.length > 0 ? (
            <Box>
              <Typography sx={{ fontSize: "0.78rem", fontWeight: 700, color: "#111827", mb: 0.75 }}>
                Source Tables
              </Typography>
              <Stack spacing={0.5}>
                {metrics.sourceTableLabels.map((label) => (
                  <Typography key={label} sx={{ fontSize: "0.74rem", color: "#2563eb" }}>
                    • {label}
                  </Typography>
                ))}
              </Stack>
            </Box>
          ) : null}

          {metrics.transformRules.length > 0 ? (
            <Box>
              <Typography sx={{ fontSize: "0.78rem", fontWeight: 700, color: "#111827", mb: 0.75 }}>
                Transform Rules
              </Typography>
              <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
                {metrics.transformRules.map((rule) => (
                  <Chip
                    key={rule}
                    label={rule}
                    size="small"
                    sx={{
                      height: 22,
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      bgcolor: "#f5f3ff",
                      color: "#6d28d9",
                    }}
                  />
                ))}
              </Stack>
            </Box>
          ) : null}

          {metrics.unmappedColumns.length > 0 ? (
            <Box
              sx={{
                borderRadius: "10px",
                border: "1px solid #fde68a",
                backgroundColor: "#fffbeb",
                p: 1.25,
              }}
            >
              <Typography sx={{ fontSize: "0.76rem", fontWeight: 700, color: "#92400e", mb: 0.5 }}>
                Unmapped Columns ({metrics.unmappedColumns.length})
              </Typography>
              <Typography sx={{ fontSize: "0.74rem", color: "#78350f", lineHeight: 1.5 }}>
                {metrics.unmappedColumns.join(", ")}
              </Typography>
            </Box>
          ) : null}

          {metrics.mappedPairs.length > 0 ? (
            <Box>
              <Typography sx={{ fontSize: "0.78rem", fontWeight: 700, color: "#111827", mb: 0.75 }}>
                Mapped Columns
              </Typography>
              <Stack spacing={0.45}>
                {metrics.mappedPairs.slice(0, 8).map((pair) => (
                  <Typography key={`${pair.source}-${pair.target}`} sx={{ fontSize: "0.72rem", color: "#475569" }}>
                    {pair.source} → {pair.target}
                  </Typography>
                ))}
              </Stack>
            </Box>
          ) : null}

          {targetQualifiedName ? (
            <Typography sx={{ fontSize: "0.72rem", color: "#94a3b8" }}>
              Target table: {targetQualifiedName}
            </Typography>
          ) : null}
        </Stack>
      </Box>
    </Box>
  );
}
