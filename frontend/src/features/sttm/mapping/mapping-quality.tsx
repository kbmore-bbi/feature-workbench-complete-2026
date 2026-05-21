"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Typography,
} from "@mui/material";
import { useSttmBuilderContext } from "@/features/sttm/context/sttm-builder-context";

const TOKEN_RE =
  /('(?:\\.|[^'])*')|\b(INSERT|INTO|SELECT|FROM|AS|WHERE|AND|OR|NOT|NULL|INNER|LEFT|RIGHT|FULL|JOIN|ON)\b/gi;

function indentBlock(text: string, prefix: string) {
  return text
    .split("\n")
    .map((line) => (line.trim() ? `${prefix}${line}` : line))
    .join("\n");
}

function highlightSqlLine(line: string): ReactNode {
  if (/^\s*--/.test(line)) {
    return (
      <span style={{ color: "#64748b", fontStyle: "italic" }}>{line}</span>
    );
  }

  const parts: ReactNode[] = [];
  let pos = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(TOKEN_RE.source, "gi");
  while ((match = re.exec(line)) !== null) {
    if (match.index > pos) {
      parts.push(
        <span key={`t-${pos}`} style={{ color: "#e2e8f0" }}>
          {line.slice(pos, match.index)}
        </span>
      );
    }
    const token = match[0];
    if (token.startsWith("'")) {
      parts.push(
        <span key={`s-${match.index}`} style={{ color: "#fcd34d" }}>
          {token}
        </span>
      );
    } else {
      parts.push(
        <span key={`k-${match.index}`} style={{ color: "#fb7185", fontWeight: 600 }}>
          {token}
        </span>
      );
    }
    pos = match.index + token.length;
  }
  if (pos < line.length) {
    parts.push(
      <span key="t-end" style={{ color: "#e2e8f0" }}>
        {line.slice(pos)}
      </span>
    );
  }
  return parts.length ? parts : line;
}

function SqlHighlightedBlock({ sql }: { sql: string }) {
  const lines = sql.split("\n");
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 0,
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: "12px",
        lineHeight: 1.55,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {lines.map((line, idx) => (
        <span key={idx}>
          {highlightSqlLine(line)}
          {idx < lines.length - 1 ? "\n" : null}
        </span>
      ))}
    </Box>
  );
}

type MappingQualityPanelProps = {
  mappedCount?: number;
  totalCount?: number;
  onRunValidation?: () => void;
};

type TabKey = "validate" | "preview" | "sql";

export default function MappingQualityPanel({
  mappedCount = 6,
  totalCount = 10,
  onRunValidation,
}: MappingQualityPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("validate");

  const { targets, targetAttributeGroup, sourceFilterSql, mappings } =
    useSttmBuilderContext();

  const selectedTargetQualifiedName = useMemo(() => {
    return (
      targets.find((t) => t.isSelected)?.qualifiedName ??
      targetAttributeGroup?.qualifiedName ??
      null
    );
  }, [targets, targetAttributeGroup]);

  const insertColumnName = useMemo(() => {
    const first = targetAttributeGroup?.columns?.find((c) => c.name)?.name;
    return (typeof first === "string" && first.trim()) || "ORDER_ID";
  }, [targetAttributeGroup]);

  const generatedSql = useMemo(() => {
    const targetQualified = selectedTargetQualifiedName?.trim() ?? "TARGET_TABLE";
    const today = new Date().toISOString().slice(0, 10);

    const insertColumns = mappings
      .filter((m) => m.status === "MAPPED")
      .map((m) => `  ${m.targetColumn}`)
      .join(",\n");

    const selectColumns = mappings
      .filter((m) => m.status === "MAPPED")
      .map((m) => {
        let expr = m.expression || m.sourceColumn || "NULL";
        return `  ${expr.padEnd(30)} AS ${m.targetColumn}`;
      })
      .join(",\n");

    const fromBody = sourceFilterSql.trim()
      ? indentBlock(sourceFilterSql.trim(), "  ")
      : "  -- No filter conditions defined (use Filter Conditions on Step 1)";

    if (!insertColumns) {
      return [
        "-- STTM Builder - Auto-generated SQL",
        `-- Target: ${targetQualified}`,
        `-- Date: ${today}`,
        "",
        "-- No columns mapped yet. Map columns to generate SQL.",
      ].join("\n");
    }

    return [
      "-- STTM Builder - Auto-generated SQL",
      `-- Target: ${targetQualified}`,
      `-- Date: ${today}`,
      "",
      `INSERT INTO ${targetQualified} (`,
      insertColumns,
      `)`,
      `SELECT`,
      selectColumns,
      `FROM`,
      fromBody,
      `;`,
    ].join("\n");
  }, [selectedTargetQualifiedName, sourceFilterSql, mappings]);

  const progressValue = totalCount > 0 ? (mappedCount / totalCount) * 100 : 0;

  return (
    <Paper
      elevation={0}
      sx={{
        height: "100%",
        border: "1px solid var(--color-soft-border)",
        borderRadius: "12px",
        backgroundColor: "var(--color-surface)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <Box sx={{ px: 2, py: 2, borderBottom: "1px solid var(--color-soft-border)" }}>
        <Typography
          sx={{
            fontSize: "13px",
            fontWeight: 700,
            color: "var(--color-title)",
          }}
        >
          Mapping Quality
        </Typography>

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mt: 1, mb: 0.75 }}>
          <Typography
            sx={{
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--color-text)",
            }}
          >
            {mappedCount}/{totalCount}{" "}
            {totalCount > 0 ? `${Math.round((mappedCount / totalCount) * 100)}%` : "0%"}
          </Typography>
          <Chip
            label="Clean"
            size="small"
            sx={{
              height: 20,
              fontSize: "0.65rem",
              fontWeight: 700,
              bgcolor: "#ecfdf5",
              color: "#059669",
              border: "1px solid #a7f3d0",
            }}
          />
        </Box>

        <LinearProgress
          variant="determinate"
          value={progressValue}
          sx={{
            height: 6,
            borderRadius: "999px",
            backgroundColor: "var(--color-surface-muted)",
            "& .MuiLinearProgress-bar": {
              backgroundColor: "var(--color-primary-save)",
              borderRadius: "999px",
            },
          }}
        />
      </Box>

      <Box
        sx={{
          display: "flex",
          gap: 0.75,
          px: 2,
          py: 1.5,
          borderBottom: "1px solid var(--color-soft-border)",
        }}
      >
        {[
          { key: "validate", label: "Validate" },
          { key: "sql", label: "SQL" },
          { key: "preview", label: "Preview" },

        ].map((tab) => {
          const selected = activeTab === tab.key;

          return (
            <Box
              key={tab.key}
              onClick={() => setActiveTab(tab.key as TabKey)}
              sx={{
                px: 1.25,
                py: 0.75,
                borderRadius: "6px",
                cursor: "pointer",
                backgroundColor: selected
                  ? "var(--color-header-text)"
                  : "transparent",
                color: selected ? "#ffffff" : "var(--color-muted)",
                border: selected
                  ? "1px solid var(--color-header-bg)"
                  : "1px solid transparent",
                fontSize: "11px",
                fontWeight: 700,
                lineHeight: 1,
              }}
            >
              {tab.label}
            </Box>
          );
        })}
      </Box>

      <Box sx={{ p: 2, flex: 1 }}>
        {activeTab === "validate" && (
          <Box>
            <Typography
              sx={{
                fontSize: "11px",
                color: "var(--color-muted)",
                mb: 1.5,
                lineHeight: 1.5,
              }}
            >
              Click Run Validation to check type compatibility &amp; mapping coverage.
            </Typography>

            <Button
              variant="contained"
              fullWidth
              onClick={onRunValidation}
              sx={{
                height: 32,
                borderRadius: "4px",
                backgroundColor: "var(--aia-mapping-button-color)",
                border: "1px solid var(--aia-mapping-button-color)",
                color: "#ffffff",
                fontSize: "12px",
                fontWeight: 700,
                textTransform: "none",
                boxShadow: "none",
                "&:hover": {
                  backgroundColor: "var(--aia-mapping-button-hoverColor)",
                  borderColor: "var(--aia-mapping-button-hoverColor)",
                  boxShadow: "none",
                },
              }}
            >
              Run Validation
            </Button>
          </Box>
        )}
        {activeTab === "sql" && (
          <Box>
            <Box
              sx={{
                mb: 1.5,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
              }}
            >
              <Typography sx={{ fontSize: "11px", color: "var(--color-muted)" }}>
                Generated SQL
              </Typography>
              <Button
                variant="outlined"
                size="small"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(generatedSql);
                  } catch {
                  }
                }}
                sx={{
                  textTransform: "none",
                  fontSize: "11px",
                  borderRadius: "6px",
                }}
              >
                Copy
              </Button>
            </Box>

            <Box
              sx={{
                borderRadius: "10px",
                border: "1px solid rgba(255,255,255,0.08)",
                backgroundColor: "#0b1220",
                p: 1.5,
                minHeight: 220,
                maxHeight: 495,
                overflow: "auto",
              }}
            >
              <SqlHighlightedBlock sql={generatedSql} />
            </Box>
          </Box>
        )}

        {activeTab === "preview" && (
          <Box>
            <Typography
              sx={{
                fontSize: "11px",
                color: "var(--color-muted)",
              }}
            >
              Preview content will appear here.
            </Typography>
          </Box>
        )}

        
      </Box>
    </Paper>
  );
}