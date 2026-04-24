
'use client';

import BuilderHeader from '@/features/sttm/layout/builder-header';
import BuilderSubHeader from '@/features/sttm/layout/builder-subheader';
import { SidebarHost } from '@/features/sttm/layout/sidebar-host';
import { SidebarSlotProvider } from '@/features/sttm/layout/sidebar-slot-context';

export default function BuilderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarSlotProvider>
      <div className="min-h-screen flex flex-col bg-gray-50">
        {/* Full-width header */}
        <BuilderHeader currentStep={1} />

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
              overflow-y-auto
            "
          >
            <SidebarHost />
          </aside>

          {/* Main column (subheader + content) */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Subheader (not full width, aligned next to sidebar) */}
            <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-2">
              <BuilderSubHeader />
            </div>

            {/* Main content */}
            <main className="flex-1 overflow-y-auto p-4">
              {children}
            </main>
          </div>
        </div>
      </div>
    </SidebarSlotProvider>
  );
}
