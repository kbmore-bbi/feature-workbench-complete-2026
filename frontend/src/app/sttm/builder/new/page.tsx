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
    <div className="sttm-scroll-pane h-full min-h-0 flex-1 overflow-y-auto bg-white p-3">
      <div className="flex flex-col gap-3 pb-3">
        <div className="flex min-h-[450px] flex-col rounded-xl border border-[#e5e7eb] bg-white lg:flex-row lg:items-stretch">
          <div className="flex flex-1 border-b border-[#e5e7eb] lg:border-b-0 lg:border-r">
            <SourceTargetPanel type="source" />
          </div>
          <div className="flex flex-1">
            <SourceTargetPanel type="target" />
          </div>
        </div>

        <SttmTableRelationshipFlow />
      </div>
    </div>
  );
}
