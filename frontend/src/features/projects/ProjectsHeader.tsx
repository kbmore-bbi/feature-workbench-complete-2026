"use client";

import { AddRoundedIcon } from "@/utils/icons";
import { Box, Button, Typography } from "@mui/material";

type ProjectsHeaderProps = {
  projectCount: number;
  totalMappings: number;
  onNewProject: () => void;
};

export default function ProjectsHeader({
  projectCount,
  totalMappings,
  onNewProject,
}: ProjectsHeaderProps) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: { xs: "column", lg: "row" },
        alignItems: { xs: "flex-start", lg: "flex-start" },
        justifyContent: "space-between",
        gap: 2,
      }}
    >
      <Box>
        <Typography
          sx={{
            fontSize: "1.5rem",
            fontWeight: 600,
            color: "#111827",
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
          }}
        >
          Projects
        </Typography>
        <Typography sx={{ mt: 0.75, fontSize: 14, color: "#6B7280" }}>
          {projectCount} project folders · {totalMappings} total mappings
        </Typography>
      </Box>

      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          alignItems: { xs: "flex-start", sm: "center" },
          gap: 1.5,
        }}
      >
        <Typography sx={{ fontSize: 12, color: "#94A3B8", whiteSpace: "nowrap" }}>
          Click a project to explore its mappings
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddRoundedIcon sx={{ fontSize: 16, color: "#FFFFFF" }} />}
          onClick={onNewProject}
          sx={{
            textTransform: "none",
            borderRadius: "10px",
            bgcolor: "#111827",
            color: "#FFFFFF",
            border: "1px solid #111827",
            fontWeight: 700,
            fontSize: 13,
            px: 1.75,
            py: 0.85,
            boxShadow: "none",
            whiteSpace: "nowrap",
            "&:hover": {
              bgcolor: "#1F2937",
              borderColor: "#1F2937",
              boxShadow: "none",
            },
          }}
        >
          New Project
        </Button>
      </Box>
    </Box>
  );
}
