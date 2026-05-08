"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Avatar,
  Box,
  CircularProgress,
  IconButton,
  InputBase,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import TableChartIcon from "@mui/icons-material/TableChart";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";

import { useSttmBuilderContext } from "@/features/sttm/context/sttm-builder-context";

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <Box key={index} component="strong" sx={{ fontWeight: 800 }}>
          {part.slice(2, -2)}
        </Box>
      );
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function MessageContent({ content }: { content: string }) {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  const lines = normalized.split("\n");
  const blocks: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(
        <Box
          key={`code-${blocks.length}`}
          component="pre"
          sx={{
            m: 0,
            px: 1.5,
            py: 1.25,
            borderRadius: 1.5,
            backgroundColor: "var(--aia-assitant-header-color)",
            color: "var(--aia-assitant-header-textColor)",
            fontSize: 12,
            overflowX: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          <code>{codeLines.join("\n")}</code>
        </Box>
      );
      continue;
    }

    if (trimmed.includes("|") && index + 1 < lines.length && /^[\s|:-]+$/.test(lines[index + 1])) {
      const headerCells = trimmed.split("|").map((cell) => cell.trim()).filter(Boolean);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes("|")) {
        rows.push(lines[index].split("|").map((cell) => cell.trim()).filter(Boolean));
        index += 1;
      }
      blocks.push(
        <Box key={`table-${blocks.length}`} sx={{ overflowX: "auto" }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <Box component="thead">
              <Box component="tr">
                {headerCells.map((cell, cellIndex) => (
                  <Box
                    key={cellIndex}
                    component="th"
                    sx={{
                      textAlign: "left",
                      px: 1,
                      py: 0.75,
                      borderBottom: "1px solid #cbd5e1",
                      fontWeight: 800,
                      color: "#0f172a",
                    }}
                  >
                    {cell}
                  </Box>
                ))}
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map((row, rowIndex) => (
                <Box component="tr" key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <Box
                      key={cellIndex}
                      component="td"
                      sx={{
                        px: 1,
                        py: 0.75,
                        borderBottom: "1px solid #e2e8f0",
                        color: "#334155",
                        verticalAlign: "top",
                      }}
                    >
                      {renderInline(cell)}
                    </Box>
                  ))}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      );
      continue;
    }

    if (/^#{1,3}\s/.test(trimmed)) {
      const level = trimmed.match(/^#+/)?.[0].length ?? 1;
      blocks.push(
        <Typography
          key={`heading-${blocks.length}`}
          sx={{
            fontSize: level === 1 ? 18 : level === 2 ? 16 : 14,
            fontWeight: 800,
            color: "#0f172a",
            mt: blocks.length ? 0.5 : 0,
          }}
        >
          {trimmed.replace(/^#{1,3}\s/, "")}
        </Typography>
      );
      index += 1;
      continue;
    }

    if (/^[-*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      const items: string[] = [];
      const ordered = /^\d+\.\s/.test(trimmed);
      while (index < lines.length) {
        const current = lines[index].trim();
        if (ordered && /^\d+\.\s/.test(current)) {
          items.push(current.replace(/^\d+\.\s/, ""));
          index += 1;
          continue;
        }
        if (!ordered && /^[-*]\s/.test(current)) {
          items.push(current.replace(/^[-*]\s/, ""));
          index += 1;
          continue;
        }
        break;
      }
      blocks.push(
        <Box
          key={`list-${blocks.length}`}
          component={ordered ? "ol" : "ul"}
          sx={{
            pl: 2.5,
            my: 0,
            display: "grid",
            gap: 0.5,
            color: "#334155",
          }}
        >
          {items.map((item, itemIndex) => (
            <Box key={itemIndex} component="li" sx={{ lineHeight: 1.6 }}>
              {renderInline(item)}
            </Box>
          ))}
        </Box>
      );
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;
    while (index < lines.length) {
      const current = lines[index].trim();
      if (!current) {
        index += 1;
        break;
      }
      if (
        current.startsWith("```") ||
        current.includes("|") ||
        /^#{1,3}\s/.test(current) ||
        /^[-*]\s/.test(current) ||
        /^\d+\.\s/.test(current)
      ) {
        break;
      }
      paragraphLines.push(current);
      index += 1;
    }
    blocks.push(
      <Typography
        key={`p-${blocks.length}`}
        variant="body2"
        sx={{ lineHeight: 1.7, color: "#0f172a", whiteSpace: "pre-wrap" }}
      >
        {renderInline(paragraphLines.join(" "))}
      </Typography>
    );
  }

  return <Box sx={{ display: "grid", gap: 1.25 }}>{blocks}</Box>;
}

export default function AIAgentPanel({
  expanded = false,
  onToggleExpanded,
}: {
  expanded?: boolean;
  onToggleExpanded?: () => void;
}) {
  const {
    chatLoading,
    chatMessages,
    mappingCount,
    relationships,
    selectedSourceCount,
    sendChatMessage,
  } = useSttmBuilderContext();
  const [draft, setDraft] = useState("");
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const statsLabel = useMemo(() => {
    const joinCount = relationships.length;
    const joinLabel = joinCount === 1 ? "1 relationship" : `${joinCount} relationships`;
    return `${selectedSourceCount} tables · ${mappingCount} mappings · ${joinLabel}`;
  }, [mappingCount, relationships.length, selectedSourceCount]);

  const handleSend = () => {
    const message = draft.trim();
    if (!message || chatLoading) return;
    sendChatMessage(message);
    setDraft("");
  };

  useEffect(() => {
    const node = messagesRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [chatLoading, chatMessages]);

  return (
    <Paper
      elevation={0}
      sx={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        borderRadius: "12px",
        border: "1px solid #e2e8f0",
        overflow: "hidden",
        backgroundColor: "#ffffff",
      }}
    >
      <Box sx={{ p: 2.25, backgroundColor: 'var(--aia-assitant-header-color)', color: 'var(--aia-assitant-header-textColor' }}>
        <Stack
          sx={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 1.5,
          }}
        >
          <Stack sx={{ flexDirection: "row", gap: 1.5, alignItems: "center" }}>
            <Avatar sx={{ bgcolor: 'var(--aia-assitant-avatar-bgColor)', width: 36, height: 36 }}>
              <SmartToyIcon sx={{ fontSize: 20 }} />
            </Avatar>
            <Box>
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 700, lineHeight: 1.2, color: 'var(--aia-assitant-textColor)' }}
              >
                STTM AI Agent
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  color: "#94a3b8",
                  display: "flex",
                  alignItems: "center",
                  gap: 0.75,
                }}
              >
                <Box
                  component="span"
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    bgcolor: chatLoading ? "#f59e0b" : "#22c55e",
                  }}
                />
                {chatLoading ? "Working" : "Active"} · Cortex 4.0
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={0.5}>
            <IconButton
              size="small"
              onClick={onToggleExpanded}
              sx={{ color: 'var(--aia-assitant-textColor)' }}
            >
              {expanded ? <CloseFullscreenIcon fontSize="small" /> : <OpenInFullIcon fontSize="small" />}
            </IconButton>
            <IconButton size="small" sx={{ color: 'var(--aia-assitant-textColor)' }}>
              <VolumeUpIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Stack>

        <Box
          sx={{
            mt: 2,
            p: 1.25,
            borderRadius: "8px",
            backgroundColor: 'var(--aia-assitant-subheader-color)',
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <TableChartIcon sx={{ fontSize: 16, color: 'var(--aia-assitant-table-textColor)'  }} />
          <Typography variant="caption" sx={{ color: 'var(--aia-assitant-table-textColor)' }}>
            {statsLabel}
          </Typography>
        </Box>
      </Box>

      <Box
        ref={messagesRef}
        sx={{
          p: 2,
          flexGrow: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          overflowY: "auto",
          backgroundColor: "#ffffff",
        }}
      >
        {chatMessages.map((message, index) => {
          const isAssistant = message.role === "assistant";
          return (
            <Stack
              key={`${message.role}-${index}-${message.content.slice(0, 24)}`}
              direction="row"
              spacing={1.5}
              sx={{ justifyContent: isAssistant ? "flex-start" : "flex-end" }}
            >
              {isAssistant ? (
                <Avatar sx={{ bgcolor: 'var(--aia-assitant-header-color)', width: 28, height: 28 }}>
                  <SmartToyIcon sx={{ fontSize: 16 }} />
                </Avatar>
              ) : null}

              <Paper
                elevation={0}
                sx={{
                  p: 1.5,
                  borderRadius: isAssistant ? "0 12px 12px 12px" : "12px 0 12px 12px",
                  border: "1px solid #e2e8f0",
          maxWidth: expanded ? "92%" : "85%",
          backgroundColor: isAssistant ? "#ffffff" : "#f8fafc",
                }}
              >
                <Box sx={{ fontSize: 14, overflowX: "auto" }}>
                  <MessageContent content={message.content} />
                </Box>
              </Paper>
            </Stack>
          );
        })}

        {chatLoading ? (
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Avatar sx={{ bgcolor: "#000000", width: 28, height: 28 }}>
              <SmartToyIcon sx={{ fontSize: 16 }} />
            </Avatar>
            <Paper
              elevation={0}
              sx={{
                px: 1.5,
                py: 1.25,
                borderRadius: "0 12px 12px 12px",
                border: "1px solid #e2e8f0",
                backgroundColor: "#ffffff",
                display: "flex",
                alignItems: "center",
                gap: 1,
              }}
            >
              <CircularProgress size={14} thickness={5} sx={{ color: "#2563eb" }} />
              <Typography variant="body2" sx={{ color: "#475569" }}>
                Thinking…
              </Typography>
            </Paper>
          </Stack>
        ) : null}
      </Box>

      <Box sx={{ p: 1, backgroundColor: "#ffffff", borderTop: "1px solid #e2e8f0" }}>
        <Paper
          elevation={0}
          sx={{
            px: 1.5,
            py: 0.5,
            display: "flex",
            alignItems: "center",
            borderRadius: "16px",
            backgroundColor: "#f8fafc",
            border: "1px solid #e2e8f0",
            minHeight: 48,
          }}
        >
          <InputBase
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            sx={{
              ml: 0.5,
              flex: 1,
              fontSize: "0.9rem",
              color: "#0f172a",
              "& .MuiInputBase-input::placeholder": { opacity: 0.7, color: "#64748b" },
            }}
            placeholder="Ask STTM AI..."
            disabled={chatLoading}
          />
          <IconButton
            size="small"
            onClick={handleSend}
            disabled={chatLoading || !draft.trim()}
            sx={{
              p: 0.5,
              color: draft.trim() ? "#ef4444" : "#cbd5e1",
              "&:hover": { backgroundColor: "transparent" },
            }}
          >
            <SendIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Paper>
      </Box>
    </Paper>
  );
}
