"use client";

import { useMemo, useState } from "react";
import { Box } from "@mui/material";
import { useRouter } from "next/navigation";
import NewProjectModal from "./new-project-modal";
import ProjectCard from "./project-card";
import ProjectsHeader from "./ProjectsHeader";
import ProjectsSummaryFooter from "./projects-summary-footer";
import { INITIAL_PROJECT_ITEMS, type ProjectItem } from "./projects-data";
import { buildProjectsSummary } from "./project-utils";
import { buildMappingsUrl } from "@/features/mappings/mappings-project-filter";
import { PROJECT_CARD_WIDTH } from "./projects-ui-styles";

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectItem[]>(INITIAL_PROJECT_ITEMS);
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);

  const summary = useMemo(() => buildProjectsSummary(projects), [projects]);

  const handleCreateProject = (project: ProjectItem) => {
    setProjects((current) => [project, ...current]);
  };

  return (
    <>
      <Box
        sx={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          flexDirection: "column",
          overflow: "hidden",
          bgcolor: "#F7F8FA",
        }}
      >
        <Box
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

          <Box
            sx={{
              mt: 2.5,
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: 2,
              pb: 2,
            }}
          >
            {projects.map((project) => (
              <Box
                key={project.id}
                sx={{
                  flex: "0 0 auto",
                  width: { xs: "100%", sm: PROJECT_CARD_WIDTH },
                  maxWidth: { xs: "100%", sm: PROJECT_CARD_WIDTH },
                }}
              >
                <ProjectCard
                  project={project}
                  onClick={() => router.push(buildMappingsUrl(project.id))}
                />
              </Box>
            ))}
          </Box>
        </Box>

        <ProjectsSummaryFooter
          projectCount={summary.projectCount}
          totalMappings={summary.totalMappings}
          complete={summary.complete}
          inProgress={summary.inProgress}
        />
      </Box>

      <NewProjectModal
        open={isNewProjectOpen}
        onClose={() => setIsNewProjectOpen(false)}
        onCreate={handleCreateProject}
      />
    </>
  );
}
