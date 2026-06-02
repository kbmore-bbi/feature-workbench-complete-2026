"use client";

import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import AppShell from "./app-shell";
import {
  resolveAppNavItem,
  shouldShowAppSidebar,
} from "./app-sidebar-types";

type AppShellGateProps = {
  children: React.ReactNode;
};

function AppShellGateContent({ children }: AppShellGateProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (!shouldShowAppSidebar(pathname)) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {children}
      </div>
    );
  }

  const initialNewMappingOpen =
    pathname.startsWith("/dashboard") && searchParams.get("newMapping") === "1";

  return (
    <AppShell
      activeNav={resolveAppNavItem(pathname)}
      initialNewMappingOpen={initialNewMappingOpen}
    >
      {children}
    </AppShell>
  );
}

export default function AppShellGate({ children }: AppShellGateProps) {
  return (
    <Suspense fallback={children}>
      <AppShellGateContent>{children}</AppShellGateContent>
    </Suspense>
  );
}
