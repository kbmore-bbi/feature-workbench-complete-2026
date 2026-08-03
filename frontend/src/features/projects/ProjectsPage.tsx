"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Project loading state follows the remote request lifecycle. */
import { AiaBox, AiaLoadingOverlay } from '@/components/ui';

import { useEffect, useMemo, useState } from "react";

import { useRouter } from "next/navigation";
import NewProjectModal from "./new-project-modal";
import ProjectCard from "./project-card";
import ProjectsHeader from "./ProjectsHeader";
import ProjectsSummaryFooter from "./projects-summary-footer";
import { type ProjectItem } from "./projects-data";
import { buildProjectsSummary } from "./project-utils";
import { PROJECT_CARD_WIDTH } from "./projects-ui-styles";
import { PROJECT_COLOR_OPTIONS } from "./project-color-options";
import { createProject, getAllProjectsSummary, projectRecordToItem } from "@/services/projectService";

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);

  const summary = useMemo(() => buildProjectsSummary(projects), [projects]);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingProjects(true);

    getAllProjectsSummary()
      .then(({ projects: records }) => {
        if (cancelled) {
          return;
        }
        setProjects(records.map(projectRecordToItem));
      })
      .catch((error) => {
        if (process.env.NODE_ENV === "development") {
          console.warn("Project metadata is unavailable; showing no saved projects.", error);
        }
        if (!cancelled) {
          setProjects([]);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingProjects(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleCreateProject = async (project: ProjectItem) => {
    const color = PROJECT_COLOR_OPTIONS.find((option) => option.color === project.themeColor);

    try {
      const saved = await createProject({
        project_name: project.name,
        description: project.description,
        theme_color_id: color?.id,
        domain: project.domain,
        intended_outcome: project.intendedOutcome,
        business_process: project.businessProcess,
        owner: project.owner,
        linked_project_ids: project.linkedProjectIds,
      });
      setProjects((current) => [projectRecordToItem(saved), ...current]);
      router.push(`/mappings?project=${encodeURIComponent(saved.project_id)}`);
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.warn("Project creation failed; backend did not persist the project.", error);
      }
    }
  };

  return (
    <>
      <AiaBox
        sx={{
          display: "flex",
          position: "relative",
          flex: 1,
          minHeight: 0,
          flexDirection: "column",
          overflow: "hidden",
          bgcolor: "#F7F8FA",
        }}
      >
        <AiaBox
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            px: { xs: 2.5, md: 3.5 },
            py: 2.5,
          }}
        >
          <ProjectsHeader
            projectCount={summary.projectCount}
            totalMappings={summary.totalMappings}
            onNewProject={() => setIsNewProjectOpen(true)}
          />

          <AiaBox
            sx={{
              mt: 2.5,
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: 2,
              pb: 2,
            }}
          >
            {projects.length === 0 ? (
              <AiaBox
                sx={{
                  width: "100%",
                  border: "1px dashed #D1D5DB",
                  borderRadius: 3,
                  bgcolor: "#FFFFFF",
                  color: "#6B7280",
                  px: 3,
                  py: 6,
                  textAlign: "center",
                  fontSize: 14,
                }}
              >
                No saved projects found. Create a project to start saving STTMs.
              </AiaBox>
            ) : (
              projects.map((project) => (
                <AiaBox
                  key={project.id}
                  sx={{
                    flex: "0 0 auto",
                    width: { xs: "100%", sm: PROJECT_CARD_WIDTH },
                    maxWidth: { xs: "100%", sm: PROJECT_CARD_WIDTH },
                  }}
                >
                  <ProjectCard
                    project={project}
                    onClick={() => router.push(`/mappings?project=${encodeURIComponent(project.id)}`)}
                    onHardcodedValues={() =>
                      router.push(
                        `/attributes?project_id=${encodeURIComponent(project.id)}&project_name=${encodeURIComponent(project.name)}`,
                      )
                    }
                  />
                </AiaBox>
              ))
            )}
          </AiaBox>
        </AiaBox>

        <ProjectsSummaryFooter
          projectCount={summary.projectCount}
          totalMappings={summary.totalMappings}
          complete={summary.complete}
          inProgress={summary.inProgress}
        />
        <AiaLoadingOverlay open={isLoadingProjects} label="Loading projects…" />
      </AiaBox>

      <NewProjectModal
        open={isNewProjectOpen}
        onClose={() => setIsNewProjectOpen(false)}
        onCreate={handleCreateProject}
        availableProjects={projects}
      />
    </>
  );
}
