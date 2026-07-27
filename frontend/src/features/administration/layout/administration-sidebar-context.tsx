'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ADMINISTRATION_SIDEBAR_STORAGE_KEY } from './administration-sidebar-types';

type AdministrationSidebarContextValue = {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  hydrated: boolean;
};

const AdministrationSidebarContext = createContext<AdministrationSidebarContextValue | null>(null);

export function AdministrationSidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(ADMINISTRATION_SIDEBAR_STORAGE_KEY);
    if (stored === 'true') {
      setCollapsedState(true);
    }
    setHydrated(true);
  }, []);

  const setCollapsed = (value: boolean) => {
    setCollapsedState(value);
    window.localStorage.setItem(ADMINISTRATION_SIDEBAR_STORAGE_KEY, String(value));
  };

  const value = useMemo(
    () => ({
      collapsed,
      setCollapsed,
      hydrated,
    }),
    [collapsed, hydrated],
  );

  return (
    <AdministrationSidebarContext.Provider value={value}>
      {children}
    </AdministrationSidebarContext.Provider>
  );
}

export function useAdministrationSidebar() {
  const context = useContext(AdministrationSidebarContext);

  if (!context) {
    throw new Error('useAdministrationSidebar must be used inside AdministrationSidebarProvider');
  }

  return context;
}
