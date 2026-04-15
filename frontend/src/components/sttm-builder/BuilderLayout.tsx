"use client";

import AIAgentPanel from "./AIAgentPanel";
import BuilderHeader from "./BuilderHeader";
import DataSelectionPanel from "./DataSelectionPanel";
import SourceTargetSelection from "./SourceTargetSelection";

export default function BuilderLayout() {
    return (
        <>
            <div style={{ display: "flex", minHeight: "100vh" }}>
                <DataSelectionPanel />
                <div style={{ flex: 1, padding: "16px" }}>
                    <BuilderHeader />
                    <div style={{ display: "flex", gap: "16px", marginTop: "16px" }}>
                        <SourceTargetSelection title="Source Table" />
                        <SourceTargetSelection title="Target Table" />
                        <AIAgentPanel />
                    </div>
                </div>
            </div>

        </>
    )
}