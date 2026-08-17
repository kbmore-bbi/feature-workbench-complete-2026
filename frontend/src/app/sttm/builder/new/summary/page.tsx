"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSttmBuilderContext } from "@/features/sttm/context/sttm-builder-context";
import { SummaryWorkspace } from "@/features/sttm/summary/summary-workspace";
import { AiaCircularProgress } from "@/components/ui";

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

  // Mirrors the effect above: whenever it declines to settle on a destination,
  // show a loader instead of mounting a half-built workspace the user may be
  // redirected away from a moment later.
  const isResolvingAttributes = loadState.attributes === "loading" || loadState.attributes === "idle";
  const willRedirect =
    !hasSelectedInputs ||
    !hasSelectedTarget ||
    (!isResolvingAttributes && (!hasTargetColumns || mappings.length === 0));

  if (isResolvingAttributes || willRedirect) {
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-1 items-center justify-center gap-2.5 bg-white">
        <AiaCircularProgress size={20} />
        <span className="text-sm text-slate-500">Preparing final mapping &amp; summary…</span>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-white">
      <SummaryWorkspace />
    </div>
  );
}
