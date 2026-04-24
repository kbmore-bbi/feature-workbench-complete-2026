// app/sttm/builder/[id]/mapping/page.tsx
import { useEffect } from 'react';
import { useSidebarSlot } from '@/features/sttm/layout/sidebar-slot-context';
import SourceTargetAttributeList from '@/features/sttm/mapping/source-target-attribute-list';
import SourceTargetAttributeMapping from '@/features/sttm/mapping/source-target-attribute-mapping';

export default function MappingPage() {
  const { setContent } = useSidebarSlot();

  useEffect(() => {
    setContent(<SourceTargetAttributeList />);
  }, []);

  return <SourceTargetAttributeMapping />;
}