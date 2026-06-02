"use client";

import { Box } from "@mui/material";
import LineageTab from "./lineage-tab";

/**
 * Shared full-height lineage workspace used by Map Transform Validate
 * and Final Mapping & Summary screens.
 */
export function SttmLineageWorkspacePanel() {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <LineageTab />
    </Box>
  );
}
