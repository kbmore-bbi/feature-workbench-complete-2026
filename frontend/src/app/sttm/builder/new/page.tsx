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
    <div className="w-full bg-white flex flex-col p-3 gap-3">
      {/* Panels container: Column on mobile, Row on large screens */}
      <div className="flex flex-col lg:flex-row min-h-[450px] border border-[#e5e7eb] rounded-xl overflow-hidden bg-white shrink-0">
        {/* Source panel */}
        <div className="flex-1 border-b lg:border-b-0 lg:border-r border-[#e5e7eb]">
          <SourceTargetPanel type="source" />
        </div>
        {/* Target panel */}
        <div className="flex-1">
          <SourceTargetPanel type="target" />
        </div>
      </div>      
      {/* Table Relationships + Filter Conditions */}
      <SttmTableRelationshipFlow />
    </div>
  );
}
