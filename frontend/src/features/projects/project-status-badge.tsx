"use client";

import { Box, Typography } from "@mui/material";
import type { ProjectMappingStatus } from "./projects-data";

const BADGE_STYLES: Record<
  ProjectMappingStatus | "mappings",
  { color: string; bg: string; border: string }
> = {
  mappings: {
    color: "#475569",
    bg: "#F8FAFC",
    border: "#E2E8F0",
  },
  complete: {
    color: "#166534",
    bg: "#ECFDF5",
    border: "#BBF7D0",
  },
  partial: {
    color: "#9A3412",
    bg: "#FFF7ED",
    border: "#FED7AA",
  },
  draft: {
    color: "#475569",
    bg: "#F8FAFC",
    border: "#E2E8F0",
  },
};

type ProjectStatusBadgeProps = {
  label: string;
  variant: ProjectMappingStatus | "mappings";
};

export default function ProjectStatusBadge({ label, variant }: ProjectStatusBadgeProps) {
  const palette = BADGE_STYLES[variant];

  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        px: 1,
        py: 0.35,
        borderRadius: "999px",
        bgcolor: palette.bg,
        border: `1px solid ${palette.border}`,
      }}
    >
      <Typography sx={{ fontSize: 11, fontWeight: 600, color: palette.color, lineHeight: 1.2 }}>
        {label}
      </Typography>
    </Box>
  );
}
