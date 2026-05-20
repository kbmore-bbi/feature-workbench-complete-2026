'use client';

import { useEffect, useMemo, useState } from 'react';
import BuilderContentHeader from '@/features/sttm/layout/builder-content-header';
import { SidebarHost } from '@/features/sttm/layout/sidebar-host';
import { SidebarSlotProvider } from '@/features/sttm/layout/sidebar-slot-context';
import { usePathname, useRouter } from 'next/navigation';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';

export default function BuilderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);
  const router = useRouter();
  const pathname = usePathname();
  const { sources, targets, mappings } = useSttmBuilderContext();

  const tableCount = useMemo(
    () =>
      sources.filter((table) => table.isSelected).length +
      (targets.some((table) => table.isSelected) ? 1 : 0),
    [sources, targets],
  );

  const mappedCount = useMemo(
    () => mappings.filter((mapping) => mapping.status === 'MAPPED').length,
    [mappings],
  );

  const canProceedToMapping = useMemo(
    () => sources.some((table) => table.isSelected) && targets.some((table) => table.isSelected),
    [sources, targets],
  );

  useEffect(() => {
    setCurrentStep(pathname.includes('/mapping') ? 2 : 1);
  }, [pathname]);

  return (
    <SidebarSlotProvider>
      <div className="h-[calc(100vh-60px)] flex flex-col bg-gray-50">
        <div className="flex flex-1 overflow-hidden">
          <aside
            className="
              hidden md:flex flex-col
              w-64 lg:w-72
              shrink-0
              border-r border-gray-200
              bg-white
            "
          >
            <SidebarHost />
          </aside>

          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-2">
              <BuilderContentHeader
                currentStep={currentStep}
                tableCount={tableCount}
                mappingCount={mappedCount}
                onProceed={() => {
                  if (!canProceedToMapping) {
                    return;
                  }
                  router.push('/sttm/builder/new/mapping');
                }}
                onRunValidation={() => console.log('run validation')}
                onPublish={() => console.log('publish mapping')}
                onStepChange={(step) => {
                  if (step === 1) {
                    router.push('/sttm/builder/new');
                  } else if (canProceedToMapping) {
                    router.push('/sttm/builder/new/mapping');
                  }
                }}
              />
            </div>

            <main className="overflow-y-auto bg-white">{children}</main>
          </div>
        </div>
      </div>
    </SidebarSlotProvider>
  );
}
