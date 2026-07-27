"use client";

import { useEffect } from "react";
import { useSidebarSlot } from "@/features/sttm/layout/sidebar-slot-context";
import SourceTargetPanel from "@/features/sttm/source-target/source-target-panel";
import SourceTargetDbSelection from "@/features/sttm/source-target/source-target-db-selection";
import SttmTableRelationshipFlow from "@/features/sttm/source-target/table-relationship-flow";

export default function SttmBuilderPage() {
  const { setContent } = useSidebarSlot();

  useEffect(() => {
    setContent(<SourceTargetDbSelection />);
    return () => {
      setContent(null);
    };
  }, [setContent]);

  return (
    <div className="sttm-scroll-pane h-full min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-white p-3">
      <div className="flex min-w-0 flex-col gap-3 pb-3">
        <div className="grid min-h-[450px] min-w-0 grid-cols-1 overflow-hidden rounded-lg border border-[#e5e7eb] bg-white lg:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
          <div className="flex min-w-0 border-b border-[#e5e7eb] lg:border-b-0 lg:border-r">
            <SourceTargetPanel type="source" />
          </div>
          <div className="grid min-w-0 grid-rows-[minmax(150px,auto)_minmax(240px,1fr)]">
            <div className="flex min-w-0 border-b border-[#e5e7eb]">
              <SourceTargetPanel type="derived" />
            </div>
            <div className="flex min-w-0">
              <SourceTargetPanel type="target" />
            </div>
          </div>
        </div>

        <SttmTableRelationshipFlow />
      </div>
    </div>
  );
}
