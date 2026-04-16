"use client";

import { Stack, Box } from "@mui/material";
import AIAgentPanel from "./AIAgentPanel";
import BuilderHeader from "./BuilderHeader";
import DataSelectionPanel from "./DataSelectionPanel";
import SourceTargetPanel from "./SourceTargetPanel";
import AddSourcePlaceholder from "./AddSourcePlaceholder";
import { DataProvider } from '../../contexts/DataContext';

export default function BuilderLayout() {
    return (
        <>
            <DataProvider>
                <div style={{ display: "flex", minHeight: "100vh" }}>
                    <DataSelectionPanel />
                    <div style={{ flex: 1, padding: "16px" }}>
                        <BuilderHeader />
                        <div style={{ display: "flex", gap: "16px", marginTop: "16px", flex: 1, height: '85vh' }}>
                            <Box sx={{ flex: 0.9 }}>
                                <Stack direction="row" spacing={2} sx={{ height: '100%' }}>
                                    <SourceTargetPanel type="target" />
                                    <SourceTargetPanel type="source" />
                                    {/* <AddSourcePlaceholder onAdd={(e: { e: any }) => { console.log(e) }} /> */}
                                </Stack>
                            </Box>
                            <Box sx={{ flex: 0.1, minWidth: '300px' }}>
                                <AIAgentPanel />
                            </Box>
                        </div>
                    </div>
                </div>
            </DataProvider>

        </>
    )
}