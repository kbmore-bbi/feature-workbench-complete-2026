'use client';

import React, { createContext, useContext, useState } from 'react';

const SidebarSlotContext = createContext<any>(null);

export function SidebarSlotProvider({ children }: { children: React.ReactNode }) {
  const [content, setContent] = useState<React.ReactNode>(null);

  return (
    <SidebarSlotContext.Provider value={{ content, setContent }}>
      {children}
    </SidebarSlotContext.Provider>
  );
}

export function useSidebarSlot() {
  const ctx = useContext(SidebarSlotContext);
  if (!ctx) throw new Error('useSidebarSlot must be used inside provider');
  return ctx;
}
