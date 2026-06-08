"use client";

import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import FiberManualRecordRoundedIcon from "@mui/icons-material/FiberManualRecordRounded";
import {
  Box,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import type { MappingState } from "@/features/sttm/types/sttm.types";
import { formatMappingRule } from "./summary-utils";

type SttmSheetTabProps = {
  mappings: MappingState[];
};

const headerCellSx = {
  color: "#4b5563",
  fontWeight: 700,
  fontSize: "0.68rem",
  letterSpacing: "0.06em",
  textTransform: "uppercase" as const,
  borderBottom: "1px solid #e5e7eb",
  bgcolor: "#fafafa",
  py: 0.65,
  whiteSpace: "nowrap" as const,
};

function StatusChip({ status }: { status: MappingState["status"] }) {
  const mapped = status === "MAPPED";
  return (
    <Chip
      label={mapped ? "Mapped" : "Unmapped"}
      size="small"
      sx={{
        height: 22,
        fontSize: "0.68rem",
        fontWeight: 700,
        bgcolor: mapped ? "#dcfce7" : "#ffedd5",
        color: mapped ? "#166534" : "#c2410c",
        border: mapped ? "1px solid #bbf7d0" : "1px solid #fed7aa",
      }}
    />
  );
}

function RuleBadge({ rule }: { rule: string }) {
  const isDirect = rule === "Direct";
  if (isDirect) {
    return (
      <Typography sx={{ fontSize: "0.78rem", color: "#64748b" }}>
        Direct
      </Typography>
    );
  }

  return (
    <Chip
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
  );
}

export function SttmSheetTab({ mappings }: SttmSheetTabProps) {
  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <TableContainer
        component={Paper}
        elevation={0}
        sx={{
          flex: 1,
          minHeight: 0,
          border: "none",
          borderRadius: 0,
          overflow: "auto",
        }}
      >
        <Table
          stickyHeader
          size="small"
          sx={{
            minWidth: 980,
            "& .MuiTableBody-root .MuiTableCell-root": {
              borderBottom: "1px solid #edf2f7",
            },
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell sx={{ ...headerCellSx, width: 48 }}>#</TableCell>
              <TableCell sx={{ ...headerCellSx, minWidth: 160 }}>Target Column</TableCell>
              <TableCell sx={{ ...headerCellSx, minWidth: 140 }}>Transform Rule</TableCell>
              <TableCell sx={{ ...headerCellSx, minWidth: 220 }}>Source Column</TableCell>
              <TableCell sx={{ ...headerCellSx, width: 110 }}>Type</TableCell>
              <TableCell sx={{ ...headerCellSx, minWidth: 260 }}>Description</TableCell>
              <TableCell sx={{ ...headerCellSx, width: 110 }} align="right">
                Status
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {mappings.map((row, index) => {
              const rule = formatMappingRule(row.rule);
              const mapped = row.status === "MAPPED";
              const previewType = row.sourceType ?? row.targetType ?? "—";

              return (
                <TableRow key={row.id}>
                  <TableCell sx={{ color: "#94a3b8", fontSize: "0.78rem", py: 1.1 }}>
                    {index + 1}
                  </TableCell>
                  <TableCell sx={{ py: 1.1 }}>
                    <Typography sx={{ fontSize: "0.8rem", fontWeight: 600, color: "#111827" }}>
                      {row.targetColumn}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ py: 1.1 }}>
                    <RuleBadge rule={rule} />
                  </TableCell>
                  <TableCell sx={{ py: 1.1 }}>
                    {mapped && row.sourceColumn ? (
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
                        <FiberManualRecordRoundedIcon sx={{ fontSize: 10, color: "#22c55e" }} />
                        <ArrowBackRoundedIcon sx={{ fontSize: 14, color: "#94a3b8", transform: "rotate(180deg)" }} />
                        <Typography sx={{ fontSize: "0.78rem", color: "#111827", overflowWrap: "anywhere" }}>
                          {row.sourceColumn}
                        </Typography>
                      </Box>
                    ) : (
                      <Typography sx={{ fontSize: "0.78rem", color: "#94a3b8" }}>
                        — not mapped
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ py: 1.1 }}>
                    <Chip
                      label={previewType}
                      size="small"
                      sx={{
                        height: 22,
                        fontSize: "0.65rem",
                        fontWeight: 700,
                        bgcolor: "#f3f4f6",
                        color: "#4b5563",
                      }}
                    />
                  </TableCell>
                  <TableCell sx={{ py: 1.1 }}>
                    <Typography sx={{ fontSize: "0.76rem", color: "#475569", lineHeight: 1.45 }}>
                      {row.description || "—"}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ py: 1.1 }} align="right">
                    <StatusChip status={row.status} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
