"use client";

import { Box, Typography } from "@mui/material";
import type { MappingListStatus } from "./all-mappings-data";
import { MAPPINGS_CELL_FONT_SIZE } from "./mappings-ui-styles";

const STATUS_STYLES: Record<
  MappingListStatus,
  { dot: string; text: string; bg: string; border: string }
> = {
  Complete: {
    dot: "#22C55E",
    text: "#166534",
    bg: "#ECFDF5",
    border: "#BBF7D0",
  },
  Partial: {
    dot: "#F97316",
    text: "#9A3412",
    bg: "#FFF7ED",
    border: "#FED7AA",
  },
  Draft: {
    dot: "#94A3B8",
    text: "#475569",
    bg: "#F8FAFC",
    border: "#E2E8F0",
  },
};

type MappingStatusBadgeProps = {
  status: MappingListStatus;
};

export default function MappingStatusBadge({ status }: MappingStatusBadgeProps) {
  const palette = STATUS_STYLES[status];

  return (
    <Box
      className="inline-flex items-center gap-1.5 px-2 py-0.5"
      sx={{
        backgroundColor: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: "10px",
      }}
    >
      <Box
        className="h-1.5 w-1.5 rounded-full"
        sx={{ backgroundColor: palette.dot }}
      />
      <Typography
        className="font-semibold"
        sx={{ color: palette.text, fontSize: MAPPINGS_CELL_FONT_SIZE }}
      >
        {status}
      </Typography>
    </Box>
  );
}
