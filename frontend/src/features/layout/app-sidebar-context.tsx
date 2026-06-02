"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { APP_SIDEBAR_STORAGE_KEY } from "./app-sidebar-types";

type AppSidebarContextValue = {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  hydrated: boolean;
};

const AppSidebarContext = createContext<AppSidebarContextValue | null>(null);

export function AppSidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(APP_SIDEBAR_STORAGE_KEY);
    if (stored === "true") {
      setCollapsedState(true);
    }
    setHydrated(true);
  }, []);

  const setCollapsed = (value: boolean) => {
    setCollapsedState(value);
    window.localStorage.setItem(APP_SIDEBAR_STORAGE_KEY, String(value));
  };

  const value = useMemo(
    () => ({
      collapsed,
      setCollapsed,
      hydrated,
    }),
    [collapsed, hydrated],
  );

  return <AppSidebarContext.Provider value={value}>{children}</AppSidebarContext.Provider>;
}

export function useAppSidebar() {
  const context = useContext(AppSidebarContext);

  if (!context) {
    throw new Error("useAppSidebar must be used inside AppSidebarProvider");
  }

  return context;
}
