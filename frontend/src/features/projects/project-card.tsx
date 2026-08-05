"use client";
import { AiaBox, AiaButton, AiaPaper } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import {
  FolderOutlinedIcon,
  KeyboardArrowRightRoundedIcon,
  LockOutlinedIcon,
} from '@/utils/icons';

import type { ProjectItem } from "./projects-data";
import ProjectCardMeta from "./project-card-meta";
import ProjectProgressBar from "./project-progress-bar";
import ProjectStatusBadge from "./project-status-badge";
import { TOUR_TARGETS } from "@/features/tour/constants/tour-targets";

type ProjectCardProps = {
  project: ProjectItem;
  onClick: () => void;
  onHardcodedValues: () => void;
  isTourAnchor?: boolean;
};

export default function ProjectCard({
  project,
  onClick,
  onHardcodedValues,
  isTourAnchor = false,
}: ProjectCardProps) {
  const tourTarget = (target: string) => (isTourAnchor ? target : undefined);

  return (
    <AiaPaper
      elevation={0}
      onClick={onClick}
      data-tour={tourTarget(TOUR_TARGETS.projectsCard)}
      sx={{
        cursor: "pointer",
        width: "100%",
        borderRadius: "12px",
        border: "1px solid #E5E7EB",
        borderTop: `4px solid ${project.themeBorder}`,
        overflow: "hidden",
        bgcolor: "#FFFFFF",
        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
        transition: "box-shadow 120ms ease, border-color 120ms ease",
        "&:hover": {
          boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
          borderColor: "#D1D5DB",
        },
      }}
    >
      <AiaBox sx={{ p: 2 }}>
        <AiaBox sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1.5 }}>
          <AiaBox sx={{ display: "flex", alignItems: "flex-start", gap: 1.25, minWidth: 0 }}>
            <AiaBox
              sx={{
                width: 40,
                height: 40,
                borderRadius: "10px",
                bgcolor: project.themeBg,
                color: project.themeColor,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <FolderOutlinedIcon sx={{ fontSize: 20 }} />
            </AiaBox>
            <AiaBox sx={{ minWidth: 0 }}>
              <AiaText sx={{ fontSize: 15, fontWeight: 700, color: "#111827", lineHeight: 1.25 }}>
                {project.name}
              </AiaText>
              <AiaText
                sx={{
                  mt: 0.5,
                  fontSize: 12,
                  color: "#64748B",
                  lineHeight: 1.45,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {project.description}
              </AiaText>
            </AiaBox>
          </AiaBox>
          <KeyboardArrowRightRoundedIcon sx={{ fontSize: 18, color: "#94A3B8", mt: 0.25, flexShrink: 0 }} />
        </AiaBox>

        <AiaBox sx={{ mt: 1.75 }} data-tour={tourTarget(TOUR_TARGETS.projectsCardCoverage)}>
          <ProjectProgressBar percent={project.coveragePercent} barColor={project.coverageBarColor} />
        </AiaBox>

        <AiaBox
          data-tour={tourTarget(TOUR_TARGETS.projectsCardStatus)}
          sx={{ mt: 1.5, display: "flex", flexWrap: "wrap", gap: 0.75 }}
        >
          <ProjectStatusBadge
            variant="mappings"
            label={`${project.totalMappings} mapping${project.totalMappings === 1 ? "" : "s"}`}
          />
          {project.completeCount > 0 ? (
            <ProjectStatusBadge
              variant="complete"
              label={`${project.completeCount} complete`}
            />
          ) : null}
          {project.partialCount > 0 ? (
            <ProjectStatusBadge
              variant="partial"
              label={`${project.partialCount} partial`}
            />
          ) : null}
          {project.draftCount > 0 ? (
            <ProjectStatusBadge variant="draft" label={`${project.draftCount} draft`} />
          ) : null}
        </AiaBox>

        <AiaBox sx={{ mt: 1.75 }}>
          <AiaButton
            variant="outlined"
            size="small"
            data-tour={tourTarget(TOUR_TARGETS.projectsCardHardcodedValues)}
            startIcon={<LockOutlinedIcon sx={{ fontSize: 16 }} />}
            onClick={(event) => {
              event.stopPropagation();
              onHardcodedValues();
            }}
            sx={{
              width: "100%",
              height: 36,
              borderRadius: "10px",
              borderColor: "#E5E7EB",
              color: "#374151",
              fontSize: 13,
              fontWeight: 600,
              textTransform: "none",
              bgcolor: "#FFFFFF",
              "&:hover": {
                borderColor: "#D1D5DB",
                bgcolor: "#F8FAFC",
              },
            }}
          >
            Hardcoded Values
          </AiaButton>
        </AiaBox>
      </AiaBox>

      <AiaBox
        data-tour={tourTarget(TOUR_TARGETS.projectsCardMeta)}
        sx={{
          display: "flex",
          gap: 2,
          px: 2,
          py: 1.5,
          borderTop: "1px solid #F1F5F9",
          bgcolor: "#FAFBFC",
        }}
      >
        <ProjectCardMeta label="CREATED BY" person={project.createdBy} />
        <ProjectCardMeta label="LAST MODIFIED BY" person={project.lastModifiedBy} />
      </AiaBox>
    </AiaPaper>
  );
}
