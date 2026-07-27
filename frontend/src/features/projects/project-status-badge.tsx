"use client";

import { AiaChip } from "@/components/ui/aia-chip";
import type { ProjectMappingStatus } from "./projects-data";

const VARIANT_COLORS: Record<
  ProjectMappingStatus | "mappings",
  "default" | "success" | "warning"
> = {
  mappings: "default",
  complete: "success",
  partial: "warning",
  draft: "default",
};

type ProjectStatusBadgeProps = {
  label: string;
  variant: ProjectMappingStatus | "mappings";
};

export default function ProjectStatusBadge({ label, variant }: ProjectStatusBadgeProps) {
  return <AiaChip label={label} color={VARIANT_COLORS[variant]} size="small" />;
}
