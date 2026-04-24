
"use client";

import { useEffect } from "react";
import { Box, Stack } from "@mui/material";
import { useSidebarSlot } from "@/features/sttm/layout/sidebar-slot-context";
import SourceTargetPanel from "@/features/sttm/source-target/source-target-panel";
import SourceTargetDbSelection from "@/features/sttm/source-target/source-target-db-selection";

export default function SttmBuilderPage() {
  const { setContent } = useSidebarSlot();

  useEffect(() => {
    setContent(<SourceTargetDbSelection />);
  }, [setContent]);

  return (
    <Box className="h-full">
      {/* Panels container */}
      <Stack
        direction={{ xs: "column", lg: "row" }}
        spacing={2}
        className="h-full"
      >
        {/* Source panel */}
        <Box className="flex-1 min-h-[300px]">
          <SourceTargetPanel type="source" />
        </Box>

        {/* Target panel */}
        <Box className="flex-1 min-h-[300px]">
          <SourceTargetPanel type="target" />
        </Box>
      </Stack>
    </Box>
  );
}
