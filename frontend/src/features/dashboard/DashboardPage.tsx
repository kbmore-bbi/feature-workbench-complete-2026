"use client";
import { AiaBox, AiaLoadingOverlay } from '@/components/ui';

import { useEffect, useState } from "react";
import DashboardStats from "./DashboardStats";
import QuickStatsPanel from "./QuickStatsPanel";
import RecentMappingsPanel from "./RecentMappingsPanel";
import DashboardHeader from "./DashboardHeader";
import {
  getAllProjectsSummary,
  type ProjectRecord,
  type STTMRecord,
} from "@/services/projectService";

type DashboardPageProps = {
  initialNewMappingOpen?: boolean;
};

export default function DashboardPage(_props: DashboardPageProps) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [sttms, setSttms] = useState<STTMRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    getAllProjectsSummary()
      .then((summary) => {
        if (cancelled) return;
        setProjects(summary.projects);
        setSttms(summary.sttms);
      })
      .catch((error) => {
        if (process.env.NODE_ENV === "development") {
          console.warn("Dashboard project/STTM metadata is unavailable.", error);
        }
        if (!cancelled) {
          setProjects([]);
          setSttms([]);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AiaBox
      sx={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        px: 3,
        py: 2.5,
      }}
    >
      <DashboardHeader />

      <AiaBox className="mt-6">
        <DashboardStats projects={projects} sttms={sttms} />
      </AiaBox>

      <AiaBox className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_1fr]">
        <QuickStatsPanel />
        <RecentMappingsPanel projects={projects} sttms={sttms} />
      </AiaBox>
      <AiaLoadingOverlay open={isLoading} label="Loading dashboard data…" />
    </AiaBox>
  );
}
