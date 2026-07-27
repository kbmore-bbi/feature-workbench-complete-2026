"use client";

import type { ReactNode } from "react";
import { AiaBadge, AiaBox, AiaIconButton, AiaInput, AiaStack } from "@/components/ui";
import { AiaText } from "@/components/ui/aia-text";
import {
  ArrowBackRoundedIcon,
  AutoAwesomeRoundedIcon,
  EditNoteRoundedIcon,
  HistoryRoundedIcon,
  KeyboardDoubleArrowRightRoundedIcon,
  NotificationsNoneRoundedIcon,
  SearchRoundedIcon,
} from "@/utils/icons";

type AiChatSidebarHeaderProps = {
  mode: "chat" | "history" | "notifications";
  onNewChat: () => void;
  onShowHistory: () => void;
  onShowNotifications: () => void;
  onBackToChat: () => void;
  onClose: () => void;
  notificationCount: number;
  historySearch: string;
  onHistorySearchChange: (value: string) => void;
};

function CloseHeaderButton({ onClick }: { onClick: () => void }) {
  return (
    <HeaderIconButton label="Close assistant" onClick={onClick}>
      <KeyboardDoubleArrowRightRoundedIcon sx={{ fontSize: 20 }} />
    </HeaderIconButton>
  );
}

function HeaderIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <AiaIconButton
      size="small"
      aria-label={label}
      title={label}
      onClick={onClick}
      sx={{
        color: "#475569",
        borderRadius: "50%",
        "&:hover": { backgroundColor: "#f1f5f9" },
      }}
    >
      {children}
    </AiaIconButton>
  );
}

export function AiChatSidebarHeader({
  mode,
  onNewChat,
  onShowHistory,
  onShowNotifications,
  onBackToChat,
  onClose,
  notificationCount,
  historySearch,
  onHistorySearchChange,
}: AiChatSidebarHeaderProps) {
  if (mode === "history" || mode === "notifications") {
    return (
      <AiaBox
        sx={{
          px: 1.5,
          py: 1.25,
          borderBottom: "1px solid #e2e8f0",
          backgroundColor: "#ffffff",
          flexShrink: 0,
        }}
      >
        <AiaStack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
          <HeaderIconButton label="Back to chat" onClick={onBackToChat}>
            <ArrowBackRoundedIcon sx={{ fontSize: 20 }} />
          </HeaderIconButton>
          {mode === "history" ? (
            <AiaBox sx={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 0.75, px: 1.25, py: 0.5, borderRadius: "10px", border: "1px solid #e2e8f0", backgroundColor: "#f8fafc" }}>
              <SearchRoundedIcon sx={{ fontSize: 18, color: "#94a3b8", flexShrink: 0 }} />
              <AiaInput
                appearance="bare"
                value={historySearch}
                onChange={onHistorySearchChange}
                placeholder="Search chats"
                sx={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 14,
                  "& .MuiInputBase-input::placeholder": { color: "#94a3b8", opacity: 1 },
                }}
              />
            </AiaBox>
          ) : (
            <AiaText sx={{ flex: 1, fontSize: 15, fontWeight: 800, color: "#0f172a" }}>
              Notifications
            </AiaText>
          )}
          <HeaderIconButton label="New chat" onClick={onNewChat}>
            <EditNoteRoundedIcon sx={{ fontSize: 20 }} />
          </HeaderIconButton>
          <CloseHeaderButton onClick={onClose} />
        </AiaStack>
      </AiaBox>
    );
  }

  return (
    <AiaBox
      sx={{
        px: 2,
        py: 1.5,
        borderBottom: "1px solid #e2e8f0",
        backgroundColor: "#ffffff",
        flexShrink: 0,
      }}
    >
      <AiaStack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <AiaStack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
          <AutoAwesomeRoundedIcon sx={{ fontSize: 22, color: "var(--color-primary, #0073a0)" }} />
          <AiaText sx={{ fontSize: 16, fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>
            STTM AI
          </AiaText>
        </AiaStack>
        <AiaStack direction="row" spacing={0.25} sx={{ alignItems: "center" }}>
          <HeaderIconButton label="New chat" onClick={onNewChat}>
            <EditNoteRoundedIcon sx={{ fontSize: 20 }} />
          </HeaderIconButton>
          <HeaderIconButton label="Chat history" onClick={onShowHistory}>
            <HistoryRoundedIcon sx={{ fontSize: 20 }} />
          </HeaderIconButton>
          <AiaBadge
            color="error"
            badgeContent={notificationCount}
            invisible={notificationCount === 0}
            max={99}
          >
            <HeaderIconButton label="Recommendations and questions" onClick={onShowNotifications}>
              <NotificationsNoneRoundedIcon sx={{ fontSize: 20 }} />
            </HeaderIconButton>
          </AiaBadge>
          <CloseHeaderButton onClick={onClose} />
        </AiaStack>
      </AiaStack>
    </AiaBox>
  );
}
