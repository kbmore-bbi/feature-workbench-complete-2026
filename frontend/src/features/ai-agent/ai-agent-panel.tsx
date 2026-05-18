"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Avatar,
  Box,
  Button,
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
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";

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

function formatInterpretationMessage(content: string) {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  const prefix = "This is our interpretation of your question:";
  if (!normalized.startsWith(prefix)) {
    return content;
  }

  const body = normalized.slice(prefix.length).trim();
  if (!body) return content;

  const sentences = body
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length === 0) return content;

  const lines = ["## Interpretation"];
  if (sentences[0]) {
    lines.push(`- **Goal:** ${sentences[0]}`);
  }
  if (sentences[1]) {
    lines.push(`- **Approach:** ${sentences[1]}`);
  }
  if (sentences.length > 2) {
    lines.push(`- **Notes:** ${sentences.slice(2).join(" ")}`);
  }
  return lines.join("\n");
}

function MessageContent({ content }: { content: string }) {
  const normalized = formatInterpretationMessage(content).replace(/\r\n/g, "\n").trim();
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
            backgroundColor: "#0f172a",
            color: "#e2e8f0",
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

function TracePanel({
  messageId,
  steps,
  expanded,
  onToggle,
}: {
  messageId: string;
  steps: string[];
  expanded: boolean;
  onToggle: (messageId: string) => void;
}) {
  return (
    <Box
      sx={{
        mt: 1.25,
        borderRadius: 1.5,
        border: "1px solid #e2e8f0",
        backgroundColor: "#f8fafc",
        overflow: "hidden",
      }}
    >
      <Button
        onClick={() => onToggle(messageId)}
        variant="text"
        sx={{
          width: "100%",
          px: 1.25,
          py: 0.9,
          justifyContent: "space-between",
          textTransform: "none",
          color: "#334155",
          borderRadius: 0,
          "&:hover": { backgroundColor: "#f1f5f9" },
        }}
      >
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
          {expanded ? (
            <KeyboardArrowDownIcon sx={{ fontSize: 16, color: "#64748b" }} />
          ) : (
            <KeyboardArrowRightIcon sx={{ fontSize: 16, color: "#64748b" }} />
          )}
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>
            Execution
          </Typography>
          <Typography sx={{ fontSize: 12, color: "#64748b" }}>
            {steps.length} step{steps.length === 1 ? "" : "s"}
          </Typography>
        </Stack>
      </Button>
      {expanded ? (
        <Stack spacing={0.8} sx={{ px: 1.5, pb: 1.25, pt: 0.25 }}>
          {steps.map((step, stepIndex) => (
            <Stack
              key={`${messageId}-trace-${stepIndex}`}
              direction="row"
              spacing={1}
              sx={{ alignItems: "flex-start" }}
            >
              <Box
                sx={{
                  mt: 0.6,
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  backgroundColor: "#94a3b8",
                  flexShrink: 0,
                }}
              />
              <Typography sx={{ fontSize: 12, lineHeight: 1.6, color: "#475569" }}>
                {step}
              </Typography>
            </Stack>
          ))}
        </Stack>
      ) : null}
    </Box>
  );
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
    datahubStatus,
    dismissPendingDerivedSourceDraft,
    mappingCount,
    openPendingDerivedSourceDraft,
    pendingDerivedSourceDraft,
    relationships,
    semanticBundleLabel,
    semanticLevel,
    semanticStatus,
    semanticViewName,
    selectedSourceCount,
    sendChatMessage,
  } = useSttmBuilderContext();
  const [draft, setDraft] = useState("");
  const [expandedTraces, setExpandedTraces] = useState<Record<string, boolean>>({});
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const statsLabel = useMemo(() => {
    const joinCount = relationships.length;
    const joinLabel = joinCount === 1 ? "1 relationship" : `${joinCount} relationships`;
    return `${selectedSourceCount} tables · ${mappingCount} mappings · ${joinLabel}`;
  }, [mappingCount, relationships.length, selectedSourceCount]);
  const hasStreamingMessage = useMemo(
    () => chatMessages.some((message) => message.isStreaming),
    [chatMessages]
  );

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

  const toggleTrace = (messageId: string) => {
    setExpandedTraces((current) => ({
      ...current,
      [messageId]: !current[messageId],
    }));
  };

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
      <Box sx={{ p: 2.25, backgroundColor: "#000000", color: "#ffffff" }}>
        <Stack
          sx={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 1.5,
          }}
        >
          <Stack sx={{ flexDirection: "row", gap: 1.5, alignItems: "center" }}>
            <Avatar sx={{ bgcolor: "#2a2a2a", width: 36, height: 36 }}>
              <SmartToyIcon sx={{ fontSize: 20 }} />
            </Avatar>
            <Box>
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 700, lineHeight: 1.2, color: "#ffffff" }}
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
              sx={{ color: "#94a3b8" }}
            >
              {expanded ? <CloseFullscreenIcon fontSize="small" /> : <OpenInFullIcon fontSize="small" />}
            </IconButton>
            <IconButton size="small" sx={{ color: "#94a3b8" }}>
              <VolumeUpIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Stack>

        <Box
          sx={{
            mt: 2,
            p: 1.25,
            borderRadius: "8px",
            backgroundColor: "#161616",
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <TableChartIcon sx={{ fontSize: 16, color: "#94a3b8" }} />
          <Typography variant="caption" sx={{ color: "#cbd5e1" }}>
            {statsLabel}
          </Typography>
        </Box>

        {semanticStatus || semanticLevel || semanticViewName || datahubStatus || semanticBundleLabel ? (
          <Stack
            direction="row"
            spacing={0.75}
            useFlexGap
            sx={{ mt: 1.25, flexWrap: "wrap" }}
          >
            {semanticBundleLabel ? (
              <Box
                sx={{
                  px: 1,
                  py: 0.4,
                  borderRadius: "999px",
                  backgroundColor: "#1f2937",
                  color: "#e5e7eb",
                  fontSize: 11,
                  fontWeight: 700,
                  maxWidth: "100%",
                }}
              >
                {semanticBundleLabel}
              </Box>
            ) : null}
            {semanticLevel ? (
              <Box
                sx={{
                  px: 1,
                  py: 0.4,
                  borderRadius: "999px",
                  backgroundColor: "#1e293b",
                  color: "#e2e8f0",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {semanticLevel}
              </Box>
            ) : null}
            {semanticStatus ? (
              <Box
                sx={{
                  px: 1,
                  py: 0.4,
                  borderRadius: "999px",
                  backgroundColor: "#052e16",
                  color: "#86efac",
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "capitalize",
                }}
              >
                {semanticStatus}
              </Box>
            ) : null}
            {semanticViewName ? (
              <Box
                sx={{
                  px: 1,
                  py: 0.4,
                  borderRadius: "999px",
                  backgroundColor: "#172554",
                  color: "#bfdbfe",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                Semantic view
              </Box>
            ) : null}
            {datahubStatus ? (
              <Box
                sx={{
                  px: 1,
                  py: 0.4,
                  borderRadius: "999px",
                  backgroundColor: "#27272a",
                  color: "#d4d4d8",
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "capitalize",
                }}
              >
                DataHub {datahubStatus}
              </Box>
            ) : null}
          </Stack>
        ) : null}
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
          const messageId = message.id ?? `${message.role}-${index}-${message.content.slice(0, 24)}`;
          const traceSteps = message.traceSteps ?? [];
          const isTraceExpanded = message.isStreaming || !!expandedTraces[messageId];
          return (
            <Stack
              key={messageId}
              direction="row"
              spacing={1.5}
              sx={{ justifyContent: isAssistant ? "flex-start" : "flex-end" }}
            >
              {isAssistant ? (
                <Avatar sx={{ bgcolor: "#000000", width: 28, height: 28 }}>
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
                {traceSteps.length ? (
                  <TracePanel
                    messageId={messageId}
                    steps={traceSteps}
                    expanded={isTraceExpanded}
                    onToggle={toggleTrace}
                  />
                ) : null}
                {message.isStreaming ? (
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ mt: 1.25, alignItems: "center", color: "#475569" }}
                  >
                    <CircularProgress size={12} thickness={5} sx={{ color: "#2563eb" }} />
                    <Typography variant="caption" sx={{ color: "#475569" }}>
                      Working through this request…
                    </Typography>
                  </Stack>
                ) : null}
                {message.options?.length ? (
                  <Stack
                    direction="row"
                    spacing={0.75}
                    useFlexGap
                    sx={{ mt: 1.25, flexWrap: "wrap" }}
                  >
                    {message.options.map((option) => (
                      <Button
                        key={option}
                        size="small"
                        variant="outlined"
                        onClick={() => sendChatMessage(option)}
                        disabled={chatLoading}
                        sx={{
                          textTransform: "none",
                          borderRadius: "999px",
                          borderColor: "#bfdbfe",
                          color: "#1d4ed8",
                          fontSize: 12,
                          "&:hover": {
                            borderColor: "#93c5fd",
                            backgroundColor: "#eff6ff",
                          },
                        }}
                      >
                        {option}
                      </Button>
                    ))}
                  </Stack>
                ) : null}
              </Paper>
            </Stack>
          );
        })}

        {chatLoading && !hasStreamingMessage ? (
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

        {pendingDerivedSourceDraft ? (
          <Paper
            elevation={0}
            sx={{
              p: 1.5,
              borderRadius: "12px",
              border: "1px solid #dbeafe",
              backgroundColor: "#eff6ff",
              display: "grid",
              gap: 1,
            }}
          >
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 800, color: "#1d4ed8" }}>
                Analyst-generated derived SQL is ready
              </Typography>
              <Typography sx={{ fontSize: 12, color: "#334155", mt: 0.25 }}>
                Open it in the derived-source builder to validate, preview, and save it through the existing flow.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="contained"
                onClick={openPendingDerivedSourceDraft}
                sx={{
                  textTransform: "none",
                  borderRadius: "999px",
                  boxShadow: "none",
                  backgroundColor: "#1d4ed8",
                  "&:hover": { backgroundColor: "#1e40af", boxShadow: "none" },
                }}
              >
                Open In Derived Builder
              </Button>
              <Button
                size="small"
                variant="text"
                onClick={dismissPendingDerivedSourceDraft}
                sx={{ textTransform: "none", color: "#475569" }}
              >
                Dismiss
              </Button>
            </Stack>
          </Paper>
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
