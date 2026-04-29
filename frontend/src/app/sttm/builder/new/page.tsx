"use client";

import { useEffect } from "react";
import { useSidebarSlot } from "@/features/sttm/layout/sidebar-slot-context";
import SourceTargetPanel from "@/features/sttm/source-target/source-target-panel";
import SourceTargetDbSelection from "@/features/sttm/source-target/source-target-db-selection";
import SourceTargetFilterConditions from "@/features/sttm/source-target/source-target-filter-conditions";

export default function SttmBuilderPage() {
  const { setContent } = useSidebarSlot();

  useEffect(() => {
    setContent(<SourceTargetDbSelection />);
  }, [setContent]);

  return (
    <div className="h-full">
      {/* Panels container: Column on mobile, Row on large screens */}
      <div className="flex flex-col lg:flex-row gap-4 h-full">
        
        {/* Source panel */}
        <div className="flex-1 min-h-[300px]">
          <SourceTargetPanel type="source" />
        </div>

        {/* Target panel */}
        <div className="flex-1 min-h-[300px]">
          <SourceTargetPanel type="target" />
        </div>
        
      </div>
      <SourceTargetFilterConditions/>
    </div>
  );
}
