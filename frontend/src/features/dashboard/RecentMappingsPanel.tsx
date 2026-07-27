"use client";
import { AiaBox, AiaPaper } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import { EditNoteRoundedIcon } from '@/utils/icons';

import { CAPTION_SX, SECONDARY_TEXT_SX } from '@/config/typography-tokens';
import type { ProjectRecord, STTMRecord } from "@/services/projectService";

function formatCreatedOn(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })} ${date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

type RecentMappingsPanelProps = {
  projects: ProjectRecord[];
  sttms: STTMRecord[];
};

export default function RecentMappingsPanel({ projects, sttms }: RecentMappingsPanelProps) {
  const projectById = new Map(projects.map((project) => [project.project_id, project]));
  const mappings = sttms
    .map((row) => {
      const project = projectById.get(row.project_id);
      if (!project) return null;
      return {
        id: row.sttm_id,
        title: row.sttm_name || row.target_table || `${project.project_name} STTM`,
        createdOn: formatCreatedOn(row.updated_at ?? row.created_at),
        sortTime: new Date(row.updated_at ?? row.created_at ?? 0).getTime(),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.sortTime - a.sortTime)
    .slice(0, 4)
    .map(({ sortTime: _sortTime, ...row }) => row);

  return (
    <AiaPaper
      elevation={0}
      className="rounded-2xl border border-[#EEF2F7] bg-white p-5"
    >
      <AiaText sx={{ ...CAPTION_SX, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        Recent Mappings
      </AiaText>

      <AiaBox className="mt-4 flex flex-col">
        {mappings.length === 0 ? (
          <AiaText sx={{ ...SECONDARY_TEXT_SX, color: "#6B7280" }}>
            No saved mappings yet.
          </AiaText>
        ) : (
          mappings.map((item, index) => (
            <AiaBox
              key={item.id}
              className={`flex items-start gap-3 py-3 ${
                index < mappings.length - 1 ? "border-b border-[#F1F5F9]" : ""
              }`}
            >
              <AiaBox className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center text-[#374151]">
                <EditNoteRoundedIcon sx={{ fontSize: 22 }} />
              </AiaBox>

              <AiaBox className="min-w-0">
                <AiaText sx={{ ...SECONDARY_TEXT_SX, fontWeight: 600, color: "#111827" }}>
                  {item.title}
                </AiaText>
                <AiaText sx={{ ...CAPTION_SX, mt: 0.5 }}>
                  Created on {item.createdOn}
                </AiaText>
              </AiaBox>
            </AiaBox>
          ))
        )}
      </AiaBox>
    </AiaPaper>
  );
}
