"use client";
import { AiaBox, AiaButton } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import { AddRoundedIcon } from "@/utils/icons";
import { CAPTION_SX, SECTION_TITLE_SX, SECONDARY_TEXT_SX } from '@/config/typography-tokens';
import { TOUR_TARGETS } from '@/features/tour/constants/tour-targets';

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
    <AiaBox
      data-tour={TOUR_TARGETS.projectsHeader}
      sx={{
        display: "flex",
        flexDirection: { xs: "column", lg: "row" },
        alignItems: { xs: "flex-start", lg: "flex-start" },
        justifyContent: "space-between",
        gap: 2,
      }}
    >
      <AiaBox>
        <AiaText sx={{ ...SECTION_TITLE_SX, letterSpacing: "-0.02em" }}>
          Projects
        </AiaText>
        <AiaText sx={{ ...SECONDARY_TEXT_SX, mt: 0.75 }}>
          {projectCount} project folders · {totalMappings} total mappings
        </AiaText>
      </AiaBox>

      <AiaBox
        sx={{
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          alignItems: { xs: "flex-start", sm: "center" },
          gap: 1.5,
        }}
      >
        <AiaText sx={{ ...CAPTION_SX, whiteSpace: "nowrap" }}>
          Click a project to explore its mappings
        </AiaText>
        <AiaButton
          variant="contained"
          color="primary"
          size="medium"
          data-tour={TOUR_TARGETS.projectsNewProject}
          startIcon={<AddRoundedIcon sx={{ fontSize: 18 }} />}
          onClick={onNewProject}
        >
          New Project
        </AiaButton>
      </AiaBox>
    </AiaBox>
  );
}
