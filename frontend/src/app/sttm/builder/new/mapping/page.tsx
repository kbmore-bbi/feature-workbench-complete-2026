"use client";

import { useEffect } from 'react';
import { useSidebarSlot } from '@/features/sttm/layout/sidebar-slot-context';
import SourceTargetAttributeList from '@/features/sttm/mapping/source-target-attribute-list';
import SourceTargetAttributeMapping from '@/features/sttm/mapping/source-target-attribute-mapping';
import MappingQualityPanel from '@/features/sttm/mapping/mapping-quality';

export default function MappingPage() {
  const { setContent } = useSidebarSlot();

  useEffect(() => {
    setContent(SourceTargetAttributeList);
    return () => setContent(null);
  }, [setContent]);

  return (
    /* h-screen or h-full is needed on the parent to make overflow-auto work */
    <div className="flex-1 min-h-0 p-4 h-full overflow-hidden">
      <div className="flex gap-4 h-full">
        
        {/* Main mapping area: Added overflow-auto and flex-1 */}
        <div className="flex-1 overflow-auto bg-white rounded-lg">
          <SourceTargetAttributeMapping />
        </div>

        {/* Sidebar panel: Added overflow-y-auto in case the panel is long */}
        <div className="w-[300px] shrink-0 overflow-y-auto">
          <MappingQualityPanel
            mappedCount={9}
            onRunValidation={() => console.log("run validation")}
          />
        </div>

      </div>
    </div>
  );
}
