import type { ChatMessage } from "@/features/sttm/types/sttm.types";

export type StoredChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
};

export const AI_CHAT_SESSIONS_STORAGE_KEY = "sttm-ai-chat-sessions";

function storageKey(scope: string) {
  return `${AI_CHAT_SESSIONS_STORAGE_KEY}::${scope || "anonymous::new::new"}`;
}

export function createChatSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function deriveSessionTitle(messages: ChatMessage[]) {
  const userMessage = messages.find((message) => message.role === "user");
  if (!userMessage?.content.trim()) return "New chat";
  const trimmed = userMessage.content.trim();
  return trimmed.length > 56 ? `${trimmed.slice(0, 56)}…` : trimmed;
}

export function formatSessionRelativeTime(timestamp: number) {
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function loadStoredChatSessions(scope: string): StoredChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredChatSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistChatSessions(scope: string, sessions: StoredChatSession[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(sessions.slice(0, 30)));
  } catch {
    // Ignore quota errors in mock/dev mode.
  }
}
