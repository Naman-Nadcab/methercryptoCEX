'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface SidebarContextValue {
  collapsed: boolean;
  toggle: () => void;
}

const SidebarCtx = createContext<SidebarContextValue>({ collapsed: false, toggle: () => {} });

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const toggle = useCallback(() => setCollapsed((c) => !c), []);
  return (
    <SidebarCtx.Provider value={{ collapsed, toggle }}>
      {children}
    </SidebarCtx.Provider>
  );
}

export function useSidebarState() {
  return useContext(SidebarCtx);
}
