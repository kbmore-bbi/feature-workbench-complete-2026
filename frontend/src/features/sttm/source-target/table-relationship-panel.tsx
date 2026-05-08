import React, { useState } from "react";
import {
    Box,
    Typography,
    Stack,
    Divider,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AllInclusiveIcon from "@mui/icons-material/AllInclusive";
import { TableRelationshipItem } from "./table-relationship-item";
import { TableMeta, TableJoin } from "../types/sttm.types";
import { EstablishJoinModal } from "./establish-join-modal";
import { FocusButton } from "@/components/ui/focus-button";
import KeyIcon from "@mui/icons-material/Key";
import LinkIcon from "@mui/icons-material/Link";

interface Props {
    tables: TableMeta[];
}

export const TableRelationshipPanel: React.FC<Props> = ({ tables }) => {
    const [showJoinModal, setShowJoinModal] = useState(false);
    const [joins, setJoins] = useState<TableJoin[]>([]);

    const joinTypes = [
        { label: "INNER JOIN", color: "#111827" },
        { label: "LEFT JOIN", color: "#3B82F6" },
        { label: "RIGHT JOIN", color: "#06B6D4" },
        { label: "FULL JOIN", color: "#A855F7" },
    ];

    return (
        <Box sx={{ height: "100%" }}>
            {/* Header */}
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 4 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <AllInclusiveIcon sx={{ color: "#2563eb", fontSize: "20px" }} />
                    <Typography variant="h6" sx={{ fontWeight: 800, fontSize: "16px", color: "#111827" }}>
                        Table Relationships
                    </Typography>
                </Box>

                <FocusButton
                    variant="contained"
                    rounded="full"
                    startIcon={<AddIcon sx={{ fontSize: 18 }} />}
                   
                    onClick={() => setShowJoinModal(true)}
                >
                    Add Join
                </FocusButton>
            </Box>

            {/* Canvas */}
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0,
                    overflowX: "auto",
                    pb: 2,
                }}
            >
                <TableRelationshipItem table={tables[0]} joins={joins} />

                {/* Join Indicator */}
                <Box
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        width: 140, // Match screenshot spacing better
                        position: "relative",
                    }}
                >
                    <Box
                        sx={{
                            width: "100%",
                            borderTop: "2px dashed #cbd5e1", // Lighter grey for dashed line
                            position: "absolute",
                            top: "24px", // Align with table headers roughly
                            transform: "translateY(-50%)",
                            zIndex: 0,
                        }}
                    />
                    <Stack                       
                        spacing={0.5} // Tighter spacing
                        sx={{  alignItems:"center", zIndex: 1, position: "relative", top: "12px" }}
                    >
                        <Box
                            component="button"
                            onClick={() => setShowJoinModal(true)}
                            sx={{
                                width: 32,
                                height: 32,
                                borderRadius: "50%",
                                backgroundColor: "#fef3c7",
                                color: "#d97706",
                                border: "none",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "16px",
                                fontWeight: 800,
                                cursor: "pointer",
                                boxShadow: "0 0 0 4px #ffffff", // white ring around it to cut the dashed line
                                "&:hover": { backgroundColor: "#fde68a" },
                            }}
                        >
                            ?
                        </Box>
                        <Box
                            sx={{
                                backgroundColor: "#fef3c7",
                                color: "#d97706",
                                px: 1.5,
                                py: 0.25,
                                borderRadius: "9999px",
                                fontSize: "11px",
                                fontWeight: 700,
                                whiteSpace: "nowrap",
                                cursor: "pointer",
                                "&:hover": { backgroundColor: "#fde68a" },
                            }}
                            onClick={() => setShowJoinModal(true)}
                        >
                            Establish Join
                        </Box>
                    </Stack>
                </Box>

                <TableRelationshipItem table={tables[1]} joins={joins} />
            </Box>

            {/* Legend */}
            <Box sx={{ mt: 6, display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap" }}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                    <Typography variant="overline" sx={{ fontWeight: 700, color: "#9ca3af", letterSpacing: "0.5px" }}>
                        LEGEND:
                    </Typography>
                    {joinTypes.map((jt) => (
                        <Box
                            key={jt.label}
                            sx={{
                                backgroundColor: jt.color,
                                color: "white",
                                px: 1.25,
                                py: 0.25,
                                borderRadius: "6px",
                                fontSize: "10px",
                                fontWeight: 700,
                                lineHeight: 1.5
                            }}
                        >
                            {jt.label}
                        </Box>
                    ))}
                </Stack>

                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Box sx={{ width: 32, borderTop: "1px dashed #cbd5e1" }} />
                    <Typography variant="caption" sx={{ color: "#9ca3af", fontStyle: "italic", fontSize: "12px" }}>
                        No join - click Establish Join
                    </Typography>
                </Stack>

                <Stack direction="row" spacing={2.5} sx={{ alignItems: 'center' }}>
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <KeyIcon sx={{ fontSize: 16, color: "#f59e0b" }} />
                        <Typography variant="caption" sx={{ color: "#6b7280", fontWeight: 500 }}>
                            Primary Key
                        </Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <LinkIcon sx={{ fontSize: 16, color: "#6366f1" }} />
                        <Typography variant="caption" sx={{ color: "#6b7280", fontWeight: 500 }}>
                            Foreign Key
                        </Typography>
                    </Stack>
                </Stack>
            </Box>

            <EstablishJoinModal
                isOpen={showJoinModal}
                tables={tables}
                onClose={() => setShowJoinModal(false)}
                onConfirm={(join) => {
                    setJoins((prev) => [...prev, { ...join, id: Math.random().toString(36).substr(2, 9) }]);
                    setShowJoinModal(false);
                }}
            />
        </Box>
    );
};

