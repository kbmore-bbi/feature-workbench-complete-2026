"use client";
import { AiaBox } from '@/components/ui';
import StatCard from "./StatCard";
import {
  AccountTreeOutlinedIcon,
  AutorenewOutlinedIcon,
  CheckCircleOutlinedIcon,
  FolderOutlinedIcon,
} from "@/utils/icons";

import type { ProjectRecord, STTMRecord } from "@/services/projectService";

const statIcons = [
  <FolderOutlinedIcon key="projects" sx={{ fontSize: 42 }} />,
  <AccountTreeOutlinedIcon key="mappings" sx={{ fontSize: 42 }} />,
  <AutorenewOutlinedIcon key="in-progress" sx={{ fontSize: 42 }} />,
  <CheckCircleOutlinedIcon key="published" sx={{ fontSize: 42 }} />,
];

const emptyStats = [
  { label: "Total Projects", value: 0 },
  { label: "Total Mappings", value: 0 },
  { label: "In-progress Mappings", value: 0 },
  { label: "Published Mappings", value: 0 },
].map((item, index) => ({
  ...item,
  icon: statIcons[index],
}));

type DashboardStatsProps = {
  projects: ProjectRecord[];
  sttms: STTMRecord[];
};

export default function DashboardStats({ projects, sttms }: DashboardStatsProps) {
  const published = sttms.filter((row) =>
    ["COMPLETE", "COMPLETED", "PUBLISHED"].includes(row.status?.toUpperCase()),
  ).length;
  const inProgress = sttms.length - published;
  const stats = projects.length || sttms.length
    ? [
        { label: "Total Projects", value: projects.length },
        { label: "Total Mappings", value: sttms.length },
        { label: "In-progress Mappings", value: inProgress },
        { label: "Published Mappings", value: published },
      ].map((item, index) => ({ ...item, icon: statIcons[index] }))
    : emptyStats;

  return (
    <AiaBox className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
      {stats.map((item) => (
        <StatCard
          key={item.label}
          icon={item.icon}
          label={item.label}
          value={item.value}
        />
      ))}
    </AiaBox>
  );
}
