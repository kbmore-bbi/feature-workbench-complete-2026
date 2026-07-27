"use client";
import { AiaBox, AiaIconButton, AiaLinearProgress, AiaChip, AiaPaper, AiaStack } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import type { ReactNode } from "react";
import {
  AllInclusiveIcon,
  CheckRoundedIcon,
  ErrorOutlineRoundedIcon,
  EastRoundedIcon,
  KeyboardDoubleArrowLeftRoundedIcon,
  SwapHorizRoundedIcon,
  TableChartOutlinedIcon,
  WarningAmberRoundedIcon,
} from "@/utils/icons";
import { SttmSidebarSectionIcon } from "@/features/sttm/layout/sttm-sidebar-icons";
import { TOUR_TARGETS } from "@/features/tour/constants/tour-targets";

import type { SummaryMetrics } from "./summary-utils";
import { getMappedSourceColumnLabel, summaryStatusLabel } from "./summary-utils";

type AiSummaryPanelProps = {
  metrics: SummaryMetrics;
  targetQualifiedName?: string | null;
  narrative: string;
  onCollapse?: () => void;
};

type MetricTone = "green" | "amber" | "indigo" | "purple" | "sky" | "teal";

const SECTION_HEADER_SX = {
  fontSize: "0.68rem",
  fontWeight: 700,
  color: "#94a3b8",
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  mb: 0.75,
};

const MONO_TEXT_SX = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

function formatSourceTableDisplayLabel(qualifiedName: string): string {
  const parts = qualifiedName.split(".").filter(Boolean);
  if (parts.length >= 2) {
    const schema = parts[parts.length - 2];
    const tableRaw = parts[parts.length - 1];
    const table = tableRaw.charAt(0).toUpperCase() + tableRaw.slice(1).toLowerCase();
    return `${schema}.${table}`;
  }
  return qualifiedName;
}

function SourceTableRow({ label }: { label: string }) {
  return (
    <AiaBox
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.85,
        px: 1.1,
        py: 0.9,
        borderRadius: "10px",
        border: "1px solid #e5e7eb",
        bgcolor: "#f8fafc",
      }}
    >
      <AiaBox
        sx={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          bgcolor: "#2563eb",
          flexShrink: 0,
        }}
      />
      <AiaText
        sx={{
          fontSize: "0.78rem",
          fontWeight: 500,
          color: "#111827",
          lineHeight: 1.3,
          ...MONO_TEXT_SX,
        }}
      >
        {formatSourceTableDisplayLabel(label)}
      </AiaText>
    </AiaBox>
  );
}

function TransformRulePill({ rule, compact = false }: { rule: string; compact?: boolean }) {
  return (
    <AiaBox
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        px: compact ? 0.7 : 1.1,
        py: compact ? 0.15 : 0.4,
        borderRadius: "999px",
        border: "1px solid #ddd6fe",
        bgcolor: "#f5f3ff",
        fontSize: compact ? "0.62rem" : "0.68rem",
        fontWeight: 700,
        color: "#6d28d9",
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        lineHeight: 1.2,
        ...MONO_TEXT_SX,
      }}
    >
      {rule}
    </AiaBox>
  );
}

function MappedColumnRow({
  source,
  target,
  rule,
}: {
  source: string;
  target: string;
  rule: string;
}) {
  const showTransform = rule !== "Direct";

  return (
    <AiaBox
      sx={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        columnGap: 0.65,
        rowGap: 0.35,
        py: 0.2,
      }}
    >
      <AiaText
        sx={{
          fontSize: "0.72rem",
          fontWeight: 500,
          color: "#64748b",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          ...MONO_TEXT_SX,
        }}
      >
        {getMappedSourceColumnLabel(source)}
      </AiaText>
      <AiaText
        sx={{
          fontSize: "0.72rem",
          color: "#cbd5e1",
          lineHeight: 1,
          ...MONO_TEXT_SX,
        }}
      >
        →
      </AiaText>
      {showTransform ? <TransformRulePill rule={rule} compact /> : null}
      <AiaText
        sx={{
          fontSize: "0.72rem",
          fontWeight: 700,
          color: "#111827",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          ...MONO_TEXT_SX,
        }}
      >
        {target.toUpperCase()}
      </AiaText>
    </AiaBox>
  );
}

function UnmappedColumnsCard({ columns }: { columns: string[] }) {
  return (
    <AiaBox
      sx={{
        borderRadius: "12px",
        border: "1px solid #fde68a",
        backgroundColor: "#fffbeb",
        p: 1.25,
      }}
    >
      <AiaStack direction="row" spacing={0.6} sx={{ alignItems: "center", mb: 0.85 }}>
        <WarningAmberRoundedIcon sx={{ fontSize: 16, color: "#92400e" }} />
        <AiaText sx={{ fontSize: "0.76rem", fontWeight: 700, color: "#92400e" }}>
          Unmapped Columns ({columns.length})
        </AiaText>
      </AiaStack>
      <AiaStack spacing={0.35} sx={{ pl: 0.15 }}>
        {columns.map((column) => (
          <AiaText
            key={column}
            sx={{
              fontSize: "0.74rem",
              color: "#78350f",
              lineHeight: 1.45,
              ...MONO_TEXT_SX,
            }}
          >
            {column}
          </AiaText>
        ))}
      </AiaStack>
    </AiaBox>
  );
}

const METRIC_PALETTES: Record<
  MetricTone,
  { bg: string; border: string; color: string }
> = {
  green: { bg: "#ecfdf5", border: "#86efac", color: "#16a34a" },
  amber: { bg: "#fffbeb", border: "#fcd34d", color: "#d97706" },
  indigo: { bg: "#eef2ff", border: "#c7d2fe", color: "#6366f1" },
  purple: { bg: "#f5f3ff", border: "#d8b4fe", color: "#9333ea" },
  sky: { bg: "#eff6ff", border: "#93c5fd", color: "#3b82f6" },
  teal: { bg: "#f0fdfa", border: "#5eead4", color: "#14b8a6" },
};

function MetricCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string | number;
  tone: MetricTone;
  icon: ReactNode;
}) {
  const palette = METRIC_PALETTES[tone];

  return (
    <AiaPaper
      elevation={0}
      sx={{
        p: 1.15,
        height: 78,
        width: "100%",
        boxSizing: "border-box",
        borderRadius: "16px",
        border: `1px solid ${palette.border}`,
        backgroundColor: palette.bg,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <AiaBox
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: 24,
        }}
      >
        <AiaBox
          sx={{
            color: palette.color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 20,
            height: 20,
            flexShrink: 0,
            "& svg": { fontSize: 18 },
          }}
        >
          {icon}
        </AiaBox>
        <AiaText
          component="span"
          sx={{
            fontSize: "1.85rem",
            fontWeight: 800,
            color: palette.color,
            lineHeight: 1,
            letterSpacing: "-0.02em",
            height: 24,
            display: "flex",
            alignItems: "center",
          }}
        >
          {value}
        </AiaText>
      </AiaBox>
      <AiaText
        sx={{
          fontSize: "0.62rem",
          fontWeight: 700,
          color: palette.color,
          letterSpacing: "0.06em",
          lineHeight: 1.25,
        }}
      >
        {label}
      </AiaText>
    </AiaPaper>
  );
}

export function AiSummaryPanel({
  metrics,
  targetQualifiedName,
  narrative,
  onCollapse,
}: AiSummaryPanelProps) {
  const status = summaryStatusLabel(metrics);
  const statusChipColor =
    status === "Complete" ? "success" : status === "Partial" ? "warning" : "default";

  return (
    <AiaBox
      sx={{
        width: "100%",
        height: "100%",
        backgroundColor: "#fafafa",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <AiaBox
        data-tour={TOUR_TARGETS.sttmSummaryAiSummary}
        sx={{ px: 2, py: 1.5, borderBottom: "1px solid #e5e7eb", backgroundColor: "#fff" }}
      >
        <AiaStack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <SttmSidebarSectionIcon kind="ai" fontSize={18} />
          <AiaText sx={{ fontSize: "0.92rem", fontWeight: 700, color: "#111827" }}>
            AI Summary
          </AiaText>
        </AiaStack>
      </AiaBox>

      <AiaBox sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: 2 }}>
        <AiaStack spacing={2}>
          <AiaBox>
            <AiaBox
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
                mb: 1,
              }}
            >
              <AiaText sx={{ fontSize: "0.78rem", fontWeight: 600, color: "#475569" }}>
                Mapping Status
              </AiaText>
              <AiaChip label={status} size="small" color={statusChipColor} />
            </AiaBox>
            <AiaBox
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
                mb: 0.75,
              }}
            >
              <AiaText sx={{ fontSize: "0.74rem", color: "#64748b" }}>
                Column Coverage
              </AiaText>
              <AiaText sx={{ fontSize: "0.82rem", fontWeight: 700, color: "#111827" }}>
                {metrics.mappedCount}/{metrics.totalCount}
              </AiaText>
            </AiaBox>
            <AiaLinearProgress
              variant="determinate"
              value={metrics.progressPercent}
              sx={{
                height: 6,
                borderRadius: 999,
                backgroundColor: "#e5e7eb",
                mb: 0.5,
                "& .MuiLinearProgress-bar": {
                  borderRadius: 999,
                  backgroundColor: "#f59e0b",
                },
              }}
            />
            <AiaText sx={{ fontSize: "0.74rem", color: "#64748b" }}>
              {metrics.progressPercent}% complete
            </AiaText>
          </AiaBox>

          <AiaBox
            sx={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-around",
              alignItems: "stretch",
              rowGap: 1,
            }}
          >
            <AiaBox sx={{ width: "46%", minWidth: 118, display: "flex" }}>
              <MetricCard
                label="TOTAL MAPPED"
                value={metrics.mappedCount}
                tone="green"
                icon={<CheckRoundedIcon />}
              />
            </AiaBox>
            <AiaBox sx={{ width: "46%", minWidth: 118, display: "flex" }}>
              <MetricCard
                label="UNMAPPED"
                value={metrics.unmappedCount}
                tone="amber"
                icon={<ErrorOutlineRoundedIcon />}
              />
            </AiaBox>
            <AiaBox sx={{ width: "46%", minWidth: 118, display: "flex" }}>
              <MetricCard
                label="DIRECT RULES"
                value={metrics.directRuleCount}
                tone="indigo"
                icon={<EastRoundedIcon />}
              />
            </AiaBox>
            <AiaBox sx={{ width: "46%", minWidth: 118, display: "flex" }}>
              <MetricCard
                label="TRANSFORMS"
                value={metrics.transformRuleCount}
                tone="purple"
                icon={<SwapHorizRoundedIcon />}
              />
            </AiaBox>
            <AiaBox sx={{ width: "46%", minWidth: 118, display: "flex" }}>
              <MetricCard
                label="JOINS"
                value={metrics.joinCount}
                tone="sky"
                icon={<AllInclusiveIcon />}
              />
            </AiaBox>
            <AiaBox sx={{ width: "46%", minWidth: 118, display: "flex" }}>
              <MetricCard
                label="SOURCE TABLES"
                value={metrics.sourceTableCount}
                tone="teal"
                icon={<TableChartOutlinedIcon />}
              />
            </AiaBox>
          </AiaBox>

          <AiaBox>
            <AiaPaper
              elevation={0}
              sx={{
                borderRadius: "12px",
                border: "1px solid #e5e7eb",
                backgroundColor: "#fff",
                p: 1.25,
              }}
            >
              <AiaText sx={{ fontSize: "0.76rem", color: "#475569", lineHeight: 1.55 }}>
                {narrative}
              </AiaText>
            </AiaPaper>
          </AiaBox>

          {metrics.sourceTableLabels.length > 0 ? (
            <AiaBox>
              <AiaText sx={SECTION_HEADER_SX}>Source Tables</AiaText>
              <AiaStack spacing={0.65}>
                {metrics.sourceTableLabels.map((label) => (
                  <SourceTableRow key={label} label={label} />
                ))}
              </AiaStack>
            </AiaBox>
          ) : null}

          {metrics.transformRules.length > 0 ? (
            <AiaBox>
              <AiaText sx={SECTION_HEADER_SX}>Transform Rules</AiaText>
              <AiaStack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
                {metrics.transformRules.map((rule) => (
                  <TransformRulePill key={rule} rule={rule} />
                ))}
              </AiaStack>
            </AiaBox>
          ) : null}

          {metrics.unmappedColumns.length > 0 ? (
            <UnmappedColumnsCard columns={metrics.unmappedColumns} />
          ) : null}

          {metrics.mappedPairs.length > 0 ? (
            <AiaBox>
              <AiaText sx={SECTION_HEADER_SX}>Mapped Columns</AiaText>
              <AiaStack spacing={0.55}>
                {metrics.mappedPairs.map((pair) => (
                  <MappedColumnRow
                    key={`${pair.source}-${pair.target}-${pair.rule}`}
                    source={pair.source}
                    target={pair.target}
                    rule={pair.rule}
                  />
                ))}
              </AiaStack>
            </AiaBox>
          ) : null}

          {targetQualifiedName ? (
            <AiaText sx={{ fontSize: "0.72rem", color: "#94a3b8" }}>
              Target table: {targetQualifiedName}
            </AiaText>
          ) : null}
        </AiaStack>
      </AiaBox>

      {onCollapse ? (
        <AiaBox
          sx={{
            px: 1.5,
            py: 1,
            display: "flex",
            justifyContent: "flex-start",
            alignItems: "center",
            flexShrink: 0,
            borderTop: "1px solid #eef2f7",
            backgroundColor: "#fff",
          }}
        >
          <AiaIconButton
            size="small"
            aria-label="Collapse AI summary"
            onClick={onCollapse}
            sx={{
              width: 32,
              height: 32,
              color: "#64748b",
              border: "1px solid #dbe2ea",
              borderRadius: "50%",
              p: 0,
            }}
          >
            <KeyboardDoubleArrowLeftRoundedIcon sx={{ fontSize: 18 }} />
          </AiaIconButton>
        </AiaBox>
      ) : null}
    </AiaBox>
  );
}
