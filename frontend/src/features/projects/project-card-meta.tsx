"use client";

import { Avatar, Box, Typography } from "@mui/material";
import type { ProjectPerson } from "./projects-data";

type ProjectCardMetaProps = {
  label: string;
  person: ProjectPerson;
};

export default function ProjectCardMeta({ label, person }: ProjectCardMetaProps) {
  return (
    <Box sx={{ minWidth: 0, flex: 1 }}>
      <Typography
        sx={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          color: "#94A3B8",
          mb: 0.75,
        }}
      >
        {label}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Avatar
          sx={{
            width: 24,
            height: 24,
            bgcolor: "#111827",
            color: "#FFFFFF",
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          {person.initials}
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              fontSize: 12,
              fontWeight: 600,
              color: "#111827",
              lineHeight: 1.25,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {person.name}
          </Typography>
          <Typography sx={{ fontSize: 11, color: "#94A3B8", lineHeight: 1.25 }}>
            {person.timestamp}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
