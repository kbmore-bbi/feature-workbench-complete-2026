"use client";
import { AiaAvatar, AiaBox } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import type { ProjectPerson } from "./projects-data";

type ProjectCardMetaProps = {
  label: string;
  person: ProjectPerson;
};

export default function ProjectCardMeta({ label, person }: ProjectCardMetaProps) {
  return (
    <AiaBox sx={{ minWidth: 0, flex: 1 }}>
      <AiaText
        sx={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          color: "#94A3B8",
          mb: 0.75,
        }}
      >
        {label}
      </AiaText>
      <AiaBox sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <AiaAvatar
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
        </AiaAvatar>
        <AiaBox sx={{ minWidth: 0 }}>
          <AiaText
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
          </AiaText>
          <AiaText sx={{ fontSize: 11, color: "#94A3B8", lineHeight: 1.25 }}>
            {person.timestamp}
          </AiaText>
        </AiaBox>
      </AiaBox>
    </AiaBox>
  );
}
