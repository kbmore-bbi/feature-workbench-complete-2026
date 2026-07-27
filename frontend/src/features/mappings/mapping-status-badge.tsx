"use client";

import { AiaChip } from "@/components/ui/aia-chip";
import type { MappingListStatus } from "./all-mappings-data";

const STATUS_COLORS: Record<
  MappingListStatus,
  "default" | "success" | "warning"
> = {
  Complete: "success",
  Partial: "warning",
  Draft: "default",
};

type MappingStatusBadgeProps = {
  status: MappingListStatus;
};

export default function MappingStatusBadge({ status }: MappingStatusBadgeProps) {
  return <AiaChip label={status} color={STATUS_COLORS[status]} size="small" />;
}
