'use client';

import React, { createContext, useContext, useState } from 'react';

type SidebarSlotContextValue = {
  content: React.ReactNode;
  setContent: React.Dispatch<React.SetStateAction<React.ReactNode>>;
  collapsed: boolean;
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  width: number;
  setWidth: React.Dispatch<React.SetStateAction<number>>;
};

const DEFAULT_WIDTH = 304;

const SidebarSlotContext = createContext<SidebarSlotContextValue | null>(null);

export function SidebarSlotProvider({ children }: { children: React.ReactNode }) {
  const [content, setContent] = useState<React.ReactNode>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  return (
    <SidebarSlotContext.Provider
      value={{
        content,
        setContent,
        collapsed,
        setCollapsed,
        width,
        setWidth,
      }}
    >
      {children}
    </SidebarSlotContext.Provider>
  );
}

export function useSidebarSlot() {
  const ctx = useContext(SidebarSlotContext);
  if (!ctx) throw new Error('useSidebarSlot must be used inside provider');
  return ctx;
}
