import React, { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Typography,
  Box,
  Stack,
  Divider,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { TableMeta, Column } from "../types/sttm.types";
import { FocusButton } from "@/components/ui/focus-button";
import { FocusSelect } from "@/components/ui/focus-select";

type JoinType = "INNER" | "LEFT" | "RIGHT" | "FULL";

interface Props {
  tables: TableMeta[];
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (join: any) => void;
}

export const EstablishJoinModal: React.FC<Props> = ({
  tables,
  isOpen,
  onClose,
  onConfirm,
}) => {
  const [joinType, setJoinType] = useState<JoinType>("INNER");
  const [leftTable, setLeftTable] = useState<TableMeta>(tables[0]);
  const [rightTable, setRightTable] = useState<TableMeta>(tables[1] || tables[0]);
  const [leftColumn, setLeftColumn] = useState<Column | null>(null);
  const [rightColumn, setRightColumn] = useState<Column | null>(null);

  const tableOptions = tables.map((t) => ({
    label: `${t.schema}.${t.name}`,
    value: t.name,
  }));

  const leftColumnOptions = leftTable.columns.map((c) => ({
    label: `${c.name} (${c.type})`,
    value: c.name,
  }));

  const rightColumnOptions = rightTable.columns.map((c) => ({
    label: `${c.name} (${c.type})`,
    value: c.name,
  }));

  const joinTypes: JoinType[] = ["INNER", "LEFT", "RIGHT", "FULL"];

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: "16px",
            p: 1.5,
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)"
          }
        }
      }}

    >
      <DialogTitle sx={{ m: 0, p: 2, display: "flex", alignItems: "center", gap: 2 }}>
        <Box
          sx={{
            backgroundColor: "#2563eb",
            color: "white",
            width: 44,
            height: 44,
            borderRadius: "12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "24px",
            fontWeight: "bold",
            lineHeight: 1
          }}
        >
          ∞
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 800, fontSize: "18px", color: "#111827", lineHeight: 1.2 }}>
            Establish Join
          </Typography>
          <Typography variant="body2" sx={{ color: "#6b7280", mt: 0.5 }}>
            Define a relationship between two tables
          </Typography>
        </Box>
        <IconButton
          aria-label="close"
          onClick={onClose}
          sx={{
            color: "#9ca3af",
            "&:hover": { color: "#4b5563" }
          }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <Divider sx={{ mx: 2, borderColor: "#f3f4f6" }} />

      <DialogContent sx={{ mt: 1, px: 2, pb: 1 }}>
        <Stack spacing={3.5}>
          {/* Join Type Section */}
          <Box>
            <Typography
              variant="overline"
              sx={{ fontWeight: 800, color: "#9ca3af", mb: 1.5, display: "block", lineHeight: 1, letterSpacing: "0.5px" }}
            >
              JOIN TYPE
            </Typography>
            <Stack direction="row" spacing={1.5}>
              {joinTypes.map((type) => {
                const isActive = joinType === type;
                return (
                  <Box
                    key={type}
                    onClick={() => setJoinType(type)}
                    sx={{
                      px: 2.5,
                      py: 1,
                      borderRadius: "9999px",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontWeight: 700,
                      backgroundColor: isActive ? "#111827" : "#f3f4f6",
                      color: isActive ? "#ffffff" : "#6b7280",
                      transition: "all 0.2s",
                      "&:hover": {
                        backgroundColor: isActive ? "#111827" : "#e5e7eb",
                      }
                    }}
                  >
                    {type} JOIN
                  </Box>
                );
              })}
            </Stack>
          </Box>

          {/* Table Selectors Section */}
          <Box
            sx={{
              display: "flex",
              alignItems: "flex-start",
              gap: 2,
            }}
          >
            {/* Left Table */}
            <Box sx={{ flex: 1 }}>
              <Typography
                variant="overline"
                sx={{ fontWeight: 800, color: "#9ca3af", mb: 0.5, display: "block", lineHeight: 1, letterSpacing: "0.5px" }}
              >
                LEFT TABLE
              </Typography>
              <FocusSelect
                options={tableOptions}
                value={leftTable.name}
                onChange={(val) => {
                  const table = tables.find((t) => t.name === val);
                  if (table) {
                    setLeftTable(table);
                    setLeftColumn(null);
                  }
                }}
              />
              <Box sx={{ mt: 1.5 }}>
                <FocusSelect
                  options={[{ label: "— column —", value: "" }, ...leftColumnOptions]}
                  value={leftColumn?.name || ""}
                  onChange={(val) => {
                    const col = leftTable.columns.find((c) => c.name === val);
                    setLeftColumn(col || null);
                  }}
                />
              </Box>
            </Box>

            <Box sx={{ display: "flex", alignItems: "center", pt: 8, pb: 1.5 }}>
              <Typography sx={{ fontWeight: 600, color: "#6b7280", fontSize: "16px" }}>
                =
              </Typography>
            </Box>

            {/* Right Table */}
            <Box sx={{ flex: 1 }}>
              <Typography
                variant="overline"
                sx={{ fontWeight: 800, color: "#9ca3af", mb: 0.5, display: "block", lineHeight: 1, letterSpacing: "0.5px" }}
              >
                RIGHT TABLE
              </Typography>
              <FocusSelect
                options={tableOptions}
                value={rightTable.name}
                onChange={(val) => {
                  const table = tables.find((t) => t.name === val);
                  if (table) {
                    setRightTable(table);
                    setRightColumn(null);
                  }
                }}
              />
              <Box sx={{ mt: 1.5 }}>
                <FocusSelect
                  options={[{ label: "— column —", value: "" }, ...rightColumnOptions]}
                  value={rightColumn?.name || ""}
                  onChange={(val) => {
                    const col = rightTable.columns.find((c) => c.name === val);
                    setRightColumn(col || null);
                  }}
                />
              </Box>
            </Box>
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2.5, pt: 1, gap: 2 }}>
        <Box
          component="button"
          onClick={onClose}
          sx={{
            background: "none",
            border: "none",
            color: "#6b7280",
            fontWeight: 600,
            fontSize: "14px",
            cursor: "pointer",
            "&:hover": { color: "#374151" }
          }}
        >
          Cancel
        </Box>
        <FocusButton
          disabled={!leftColumn || !rightColumn}
          onClick={() =>
            onConfirm({
              joinType,
              leftTable,
              rightTable,
              leftColumn,
              rightColumn,
            })
          }
          rounded="full"

        >
          Add Join
        </FocusButton>
      </DialogActions>
    </Dialog>
  );
};

