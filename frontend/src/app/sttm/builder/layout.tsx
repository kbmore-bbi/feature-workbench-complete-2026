'use client';

import { SidebarHost } from '@/features/sttm/layout/sidebar-host';
import { SidebarSlotProvider } from '@/features/sttm/layout/sidebar-slot-context';

export default function BuilderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
            <main className="overflow-y-auto bg-white">{children}</main>
          </div>
        </div>
      </div>
    </SidebarSlotProvider>
  );
}
