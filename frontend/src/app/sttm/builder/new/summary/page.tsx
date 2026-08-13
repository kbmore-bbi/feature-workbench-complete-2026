"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSttmBuilderContext } from "@/features/sttm/context/sttm-builder-context";
import { SummaryWorkspace } from "@/features/sttm/summary/summary-workspace";

export default function SummaryPage() {
  const router = useRouter();
  const { sources, targets, derivedSources, mappings, loadState, targetAttributeGroup, activeSttmId } =
    useSttmBuilderContext();
  const routeBase =
    process.env.NEXT_PUBLIC_DURABLE_STTM_ROUTE_V1 !== "false" && activeSttmId
      ? `/sttm/builder/${encodeURIComponent(activeSttmId)}`
      : "/sttm/builder/new";

  const hasSelectedInputs =
    sources.some((table) => table.isSelected) || derivedSources.some((source) => source.isSelected);
  const hasSelectedTarget = targets.some((table) => table.isSelected);
  const hasTargetColumns = (targetAttributeGroup?.columns?.filter((col) => col.name).length ?? 0) > 0;

  useEffect(() => {
    if (!hasSelectedInputs || !hasSelectedTarget) {
      router.replace(routeBase);
      return;
    }

    if (loadState.attributes === "loading" || loadState.attributes === "idle") {
      return;
    }

    if (!hasTargetColumns || mappings.length === 0) {
      router.replace(`${routeBase}/mapping`);
    }
  }, [
    hasSelectedInputs,
    hasSelectedTarget,
    hasTargetColumns,
    loadState.attributes,
    mappings.length,
    router,
    routeBase,
  ]);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-white">
      <SummaryWorkspace />
    </div>
  );
}
