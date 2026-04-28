'use client';

import React, { createContext, useContext, useState } from 'react';

type SidebarContentComponent = React.ComponentType | null;

type SidebarSlotValue = {
  contentComponent: SidebarContentComponent;
  setContent: (component: SidebarContentComponent) => void;
};

const SidebarSlotContext = createContext<SidebarSlotValue | null>(null);

export function SidebarSlotProvider({ children }: { children: React.ReactNode }) {
  const [contentComponent, setContentComponent] = useState<SidebarContentComponent>(null);

  const setContent = (component: SidebarContentComponent) => {
    setContentComponent(() => component);
  };

  return (
    <SidebarSlotContext.Provider value={{ contentComponent, setContent }}>
      {children}
    </SidebarSlotContext.Provider>
  );
}

export function useSidebarSlot() {
  const ctx = useContext(SidebarSlotContext);
  if (!ctx) throw new Error('useSidebarSlot must be used inside provider');
  return ctx;
}
