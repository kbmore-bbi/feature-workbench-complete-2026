'use client';

import { useState } from 'react';
import BuilderContentHeader from '@/features/sttm/layout/builder-content-header';
import { SidebarHost } from '@/features/sttm/layout/sidebar-host';
import { SidebarSlotProvider } from '@/features/sttm/layout/sidebar-slot-context';
import { useRouter } from 'next/navigation';

export default function BuilderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);
  const router = useRouter();

  return (
    <SidebarSlotProvider>
      <div className="h-[calc(100vh-60px)] flex flex-col bg-gray-50">
        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <aside
            className="
              hidden md:block
              w-64 lg:w-72
              shrink-0
              border-r border-gray-200
              bg-white
            "
          >
            <SidebarHost />
          </aside>

          {/* Main column (subheader + content) */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Subheader (not full width, aligned next to sidebar) */}
            <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-2">
              <BuilderContentHeader
                currentStep={currentStep}
                tableCount={2}
                mappingCount={currentStep === 1 ? 0 : 9}
                onProceed={() => {
                  setCurrentStep(2)
                  router.push('/sttm/builder/new/mapping')
                }}
                onRunValidation={() => console.log("run validation")}
                onPublish={() => console.log("publish mapping")}
                onStepChange={(step) => {
                  setCurrentStep(step)
                  if(step == 1) {
                    router.push('/sttm/builder/new')
                  } else {
                    router.push('/sttm/builder/new/mapping')
                  }
                }}
              />
            </div>

            {/* Main content */}
            <main className="overflow-y-auto bg-white">
              {children}
            </main>
          </div>
        </div>
      </div>
    </SidebarSlotProvider>
  );
}
