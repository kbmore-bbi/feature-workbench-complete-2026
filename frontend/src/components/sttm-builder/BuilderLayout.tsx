"use client";

import { Stack } from "@mui/material";
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
                        <div style={{ display: "flex", gap: "16px", marginTop: "16px" }}>
                            {/* <SourceTargetpanel title="Target Table" />
                        <SourceTargetpanel title="Source Table" /> */}
                            <Stack direction="row" spacing={2}>
                                <SourceTargetPanel type="target" />
                                <SourceTargetPanel type="source" />
                                {/* <AddSourcePlaceholder onAdd={(e: {e:any})=>{
                                console.log(e)
                            }} /> */}

                            </Stack>
                            <AIAgentPanel />
                        </div>
                    </div>
                </div>
            </DataProvider>

        </>
    )
}