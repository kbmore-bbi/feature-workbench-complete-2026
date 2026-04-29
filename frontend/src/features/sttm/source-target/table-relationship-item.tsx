import React from "react";
import {
    Box,
    Typography,
    Paper,
    Stack,
    Divider,
} from "@mui/material";
import TableChartIcon from "@mui/icons-material/TableChart";
import KeyIcon from "@mui/icons-material/Key";
import LinkIcon from "@mui/icons-material/Link";
import { TableMeta, TableJoin } from "../types/sttm.types";
import { FocusCheckbox } from "@/components/ui/focus-checkbox";

interface Props {
    table: TableMeta;
    joins: TableJoin[];
}

export const TableRelationshipItem: React.FC<Props> = ({ table, joins }) => {
    return (
        <Paper
            elevation={0}
            sx={{
                width: 280,
                borderRadius: "16px",
                border: "1px solid #e5e7eb",
                overflow: "hidden",
                backgroundColor: "white",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
                mx: 2, // adding margin to separate from the indicator
            }}
        >
            {/* Header */}
            <Box sx={{ py: 2, px: 2, display: "flex", alignItems: "flex-start", gap: 1.5, backgroundColor: '#f9fafb' }}>
                <Box
                    sx={{
                        backgroundColor: "#111827",
                        color: "white",
                        width: 32,
                        height: 32,
                        borderRadius: "8px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        mt: 0.5
                    }}
                >
                    <TableChartIcon sx={{ fontSize: 18 }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0, mt: -0.25 }}>
                    <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1 }}>
                        <Typography
                            variant="subtitle2"
                            sx={{
                                fontWeight: 800,
                                fontSize: "14px",
                                color: "#111827",
                                wordBreak: "break-all",
                                lineHeight: 1.2,
                            }}
                        >
                            {table.schema}.{table.name}
                        </Typography>
                        <Box
                            sx={{
                                backgroundColor: "#eff6ff",
                                color: "#3b82f6",
                                fontSize: "10px",
                                fontWeight: 700,
                                px: 1.25,
                                py: 0.25,
                                borderRadius: "9999px",
                                textTransform: "capitalize",
                                flexShrink: 0
                            }}
                        >
                            Sales
                        </Box>
                    </Box>
                    <Typography variant="caption" sx={{ color: "#6b7280", mt: 0.5, display: "block" }}>
                        {table.columns.length} cols · {table.rowCount || "1.2M"} rows
                    </Typography>
                </Box>
            </Box>
             <Divider />

            {/* Column List */}
            <Box sx={{ pb: 1.5, px: 1 }}>
                <Stack spacing={0}>
                    {table.columns.slice(0, 5).map((col) => {
                        const isJoined = joins.some(
                            (j) =>
                                (j.leftTable === table.name && j.leftColumn === col.name) ||
                                (j.rightTable === table.name && j.rightColumn === col.name)
                        );

                        return (
                            <Box
                                key={col.name}
                                sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    px: 1,
                                    py: 0.5,
                                    borderRadius: "6px",
                                    "&:hover": { backgroundColor: "#f9fafb" },
                                }}
                            >
                                <FocusCheckbox
                                    checked={isJoined}
                                    checkHandler={() => { }}
                                />
                                <Box sx={{ flex: 1, display: "flex", alignItems: "center", gap: 0.75, ml: 0.5 }}>
                                    {col.isPrimaryKey && (
                                        <KeyIcon sx={{ fontSize: 14, color: "#f59e0b", flexShrink: 0 }} />
                                    )}
                                    {col.isForeignKey && (
                                        <LinkIcon sx={{ fontSize: 14, color: "#cbd5e1", flexShrink: 0 }} />
                                    )}
                                    <Typography variant="body2" sx={{ fontSize: "13px", color: "#374151", fontWeight: 500, lineHeight: 1 }}>
                                        {col.name}
                                    </Typography>
                                </Box>
                                <Typography
                                    variant="caption"
                                    sx={{ color: "#9ca3af", fontSize: "11px", fontWeight: 500, textTransform: "uppercase" }}
                                >
                                    {col.type}
                                </Typography>
                            </Box>
                        );
                    })}
                </Stack>
                {table.columns.length > 5 && (
                    <Typography
                        variant="caption"
                        sx={{ px: 5, py: 1, color: "#9ca3af", display: "block", fontStyle: "italic", fontSize: "12px" }}
                    >
                        + {table.columns.length - 5} more
                    </Typography>
                )}
            </Box>
        </Paper>
    );
};
