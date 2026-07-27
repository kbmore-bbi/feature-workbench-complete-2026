'use client';

import { AiaBox } from '@/components/ui';
import type { ReactNode } from 'react';
import { AdministrationProvider } from '../context/administration-context';
import AdministrationSidebar from './administration-sidebar';
import { AdministrationSidebarProvider } from './administration-sidebar-context';

type AdministrationLayoutShellProps = {
  children: ReactNode;
};

export default function AdministrationLayoutShell({ children }: AdministrationLayoutShellProps) {
  return (
    <AdministrationProvider>
      <AdministrationSidebarProvider>
        <AiaBox
          sx={{
            display: 'flex',
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            overflow: 'hidden',
            bgcolor: '#F7F8FA',
          }}
        >
          <AdministrationSidebar />
          <AiaBox sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>{children}</AiaBox>
        </AiaBox>
      </AdministrationSidebarProvider>
    </AdministrationProvider>
  );
}
