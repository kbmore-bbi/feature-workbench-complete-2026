"use client";

import { AiaBox, AiaStack } from "@/components/ui";
import { AiaText } from "@/components/ui/aia-text";
import type { StoredChatSession } from "@/features/ai-agent/ai-chat-session-utils";
import { formatSessionRelativeTime } from "@/features/ai-agent/ai-chat-session-utils";
import { ChatBubbleOutlineRoundedIcon } from "@/utils/icons";

type AiChatHistoryPanelProps = {
  sessions: StoredChatSession[];
  searchQuery: string;
  activeSessionId: string | null;
  onSelectSession: (session: StoredChatSession) => void;
};

export function AiChatHistoryPanel({
  sessions,
  searchQuery,
  activeSessionId,
  onSelectSession,
}: AiChatHistoryPanelProps) {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredSessions = normalizedQuery
    ? sessions.filter((session) => session.title.toLowerCase().includes(normalizedQuery))
    : sessions;

  return (
    <AiaBox
      sx={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        backgroundColor: "#ffffff",
        px: 1.5,
        py: 1.5,
      }}
    >
      {filteredSessions.length === 0 ? (
        <AiaBox sx={{ py: 6, textAlign: "center" }}>
          <AiaText sx={{ fontSize: 14, color: "#64748b" }}>
            {normalizedQuery ? "No chats match your search." : "No chat history yet."}
          </AiaText>
        </AiaBox>
      ) : (
        <AiaStack spacing={0.5}>
          {filteredSessions.map((session) => {
            const isActive = session.id === activeSessionId;
            return (
              <AiaBox
                key={session.id}
                component="button"
                type="button"
                onClick={() => onSelectSession(session)}
                sx={{
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  cursor: "pointer",
                  borderRadius: "12px",
                  px: 1.25,
                  py: 1.25,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 1.25,
                  backgroundColor: isActive ? "#eff6ff" : "transparent",
                  "&:hover": { backgroundColor: isActive ? "#eff6ff" : "#f8fafc" },
                }}
              >
                <ChatBubbleOutlineRoundedIcon
                  sx={{ fontSize: 18, color: "#64748b", mt: 0.25, flexShrink: 0 }}
                />
                <AiaBox sx={{ minWidth: 0, flex: 1 }}>
                  <AiaText
                    sx={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: "#0f172a",
                      lineHeight: 1.35,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {session.title}
                  </AiaText>
                  <AiaText sx={{ mt: 0.35, fontSize: 12, color: "#94a3b8" }}>
                    {formatSessionRelativeTime(session.updatedAt)}
                  </AiaText>
                </AiaBox>
              </AiaBox>
            );
          })}
        </AiaStack>
      )}
    </AiaBox>
  );
}
