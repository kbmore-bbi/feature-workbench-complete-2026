"use client";
import { AiaBox } from '@/components/ui';
import { ReactFlowProvider } from "@xyflow/react";

import LineageTab from "./lineage-tab";

/**
 * Shared full-height lineage workspace used by Map Transform Validate
 * and Final Mapping & Summary screens.
 */
export function SttmLineageWorkspacePanel() {
  return (
    <AiaBox
      sx={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        height: "100%",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <ReactFlowProvider>
        <LineageTab />
      </ReactFlowProvider>
    </AiaBox>
  );
}
