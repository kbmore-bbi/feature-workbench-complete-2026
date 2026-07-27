"use client";
import { AiaBox } from '@/components/ui';
import { useEffect, useRef } from "react";

import { AiChatMainOverlay } from "@/features/ai-agent/ai-chat-shell-integration";
import { AiChatRailTab, AiChatSidebarPanel } from "@/features/ai-agent/ai-chat-shell-host";
import { useAiChatLayout } from "@/features/ai-agent/ai-chat-layout-context";
import AppSidebar from "./app-sidebar";
import type { AppNavItem } from "./app-sidebar-types";

type AppShellProps = {
  activeNav?: AppNavItem;
  initialNewMappingOpen?: boolean;
  children: React.ReactNode;
};

export default function AppShell({
  activeNav,
  initialNewMappingOpen = false,
  children,
}: AppShellProps) {
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const { isOpen, setLayoutMetrics } = useAiChatLayout();

  useEffect(() => {
    const node = workspaceRef.current;
    if (!node) return;

    const update = () => {
      setLayoutMetrics(node.clientWidth, node.clientHeight);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [setLayoutMetrics]);

  return (
    <AiaBox
      sx={{
        display: "flex",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
        bgcolor: "#F7F8FA",
      }}
    >
      <AppSidebar activeNav={activeNav} initialNewMappingOpen={initialNewMappingOpen} />
      <AiaBox
        ref={workspaceRef}
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <AiaBox
          component="main"
          sx={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <AiChatMainOverlay />
          {children}
        </AiaBox>

        {isOpen ? <AiChatSidebarPanel /> : <AiChatRailTab />}
      </AiaBox>
    </AiaBox>
  );
}
