"use client";
import { AiaAvatar, AiaBox, AiaButton, AiaCircularProgress, AiaIconButton, AiaInput, AiaPaper, AiaStack, AiaTooltip } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AutoAwesomeRoundedIcon,
  BoltIcon,
  CheckRoundedIcon,
  CloseFullscreenIcon,
  CloseRoundedIcon,
  HelpOutlineOutlinedIcon,
  KeyboardArrowDownIcon,
  KeyboardArrowRightIcon,
  OpenInFullIcon,
  SendIcon,
  SmartToyIcon,
  TableChartIcon,
  ThumbDownAltOutlinedIcon,
  ThumbUpAltOutlinedIcon,
  TipsAndUpdatesOutlinedIcon,
  VolumeUpIcon,
  WarningAmberRoundedIcon,
} from '@/utils/icons';
import { CocoSessionClient, type CocoServerMessage, type CocoPermissionRequest, fetchCocoDiagnostics, getDiagnosticsErrorMessage } from '@/services/cocoService';
import { recommendationService } from "@/services/recommendationService";
import { AiChatComposer } from "@/features/ai-agent/ai-chat-composer";
import { useAiChatLayout } from "@/features/ai-agent/ai-chat-layout-context";
import type {
  FIRRecommendation,
  FIRRecommendationAction,
  WorkbenchContextSnapshotV1,
} from '@/types/api-contract';






import { useSttmBuilderContext } from "@/features/sttm/context/sttm-builder-context";
import type { StreamingStatusPhase } from "@/features/sttm/types/sttm.types";
import { usePathname } from "next/navigation";
import { buildWorkbenchContextSnapshot } from "@/features/sttm/context/workbench-context";

// User-friendly labels for each streaming phase
const STATUS_PHASE_LABELS: Record<StreamingStatusPhase, string> = {
  preparing: "Preparing context...",
  semantic: "Loading semantic data...",
  learning: "Retrieving learnings...",
  invoking: "Connecting to AI...",
  processing: "Analyzing tables...",
  finalizing: "Generating suggestions...",
};

// Progress percentage for each phase (for visual feedback)
const STATUS_PHASE_PROGRESS: Record<StreamingStatusPhase, number> = {
  preparing: 10,
  semantic: 25,
  learning: 40,
  invoking: 55,
  processing: 75,
  finalizing: 90,
};

const APPROVAL_RESPONSE_PATTERN =
  /^(yes|yep|yeah|ok|okay|sure|approve|approved|apply|apply it|please apply|go ahead|looks good|do it|use it)[.! ]*$/i;
const SKIP_RESPONSE_PATTERN = /^(skip|pass|next one|next)[.! ]*$/i;

// CoCo mode types
type CocoToolExecution = {
  toolId: string;
  tool: string;
  resource?: string;
  status: 'started' | 'completed' | 'error';
  startedAt: string;
  completedAt?: string;
  result?: string;
};

type CocoPendingPermission = CocoPermissionRequest & {
  contextHash: string;
};

type CocoModeState = {
  isActive: boolean;
  isConnecting: boolean;
  isConnected: boolean;
  streamingText: string;
  statusMessage: string | null;
  toolExecutions: CocoToolExecution[];
  pendingPermission: CocoPendingPermission | null;
  error: string | null;
};

const initialCocoState: CocoModeState = {
  isActive: false,
  isConnecting: false,
  isConnected: false,
  streamingText: '',
  statusMessage: null,
  toolExecutions: [],
  pendingPermission: null,
  error: null,
};

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <AiaBox key={index} component="strong" sx={{ fontWeight: 800 }}>
          {part.slice(2, -2)}
        </AiaBox>
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

function formatPlainAssistantMessage(content: string) {
  const normalized = formatInterpretationMessage(content).replace(/\r\n/g, "\n").trim();
  if (
    normalized.length < 220 ||
    /(^|\n)\s*(#{1,3}\s|[-*]\s|\d+\.\s|```)/m.test(normalized) ||
    normalized.includes("**")
  ) {
    return normalized;
  }

  const numbered = normalized.split(/\s*\((\d+)\)\s*/);
  if (numbered.length >= 5) {
    const intro = numbered[0].trim().replace(/:\s*$/, ".");
    const items: string[] = [];
    for (let index = 1; index + 1 < numbered.length; index += 2) {
      const item = numbered[index + 1].trim().replace(/^[:;,.\s]+|[;\s]+$/g, "");
      if (item) items.push(item);
    }
    return [
      "## Summary",
      intro,
      "## Recommendations",
      ...items.map((item) => `- ${item}`),
    ].join("\n");
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length < 3) return normalized;
  return [
    "## Summary",
    sentences[0],
    "## Key Points",
    ...sentences.slice(1).map((sentence) => `- ${sentence}`),
  ].join("\n");
}

function MessageContent({ content, formatPlainText = false }: { content: string; formatPlainText?: boolean }) {
  const normalized = (formatPlainText
    ? formatPlainAssistantMessage(content)
    : formatInterpretationMessage(content)).replace(/\r\n/g, "\n").trim();
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
        <AiaBox
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
        </AiaBox>
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
        <AiaBox key={`table-${blocks.length}`} sx={{ overflowX: "auto" }}>
          <AiaBox component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <AiaBox component="thead">
              <AiaBox component="tr">
                {headerCells.map((cell, cellIndex) => (
                  <AiaBox
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
                  </AiaBox>
                ))}
              </AiaBox>
            </AiaBox>
            <AiaBox component="tbody">
              {rows.map((row, rowIndex) => (
                <AiaBox component="tr" key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <AiaBox
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
                    </AiaBox>
                  ))}
                </AiaBox>
              ))}
            </AiaBox>
          </AiaBox>
        </AiaBox>
      );
      continue;
    }

    if (/^#{1,3}\s/.test(trimmed)) {
      const level = trimmed.match(/^#+/)?.[0].length ?? 1;
      blocks.push(
        <AiaText
          key={`heading-${blocks.length}`}
          sx={{
            fontSize: level === 1 ? 18 : level === 2 ? 16 : 14,
            fontWeight: 800,
            color: "#0f172a",
            mt: blocks.length ? 0.5 : 0,
          }}
        >
          {trimmed.replace(/^#{1,3}\s/, "")}
        </AiaText>
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
        <AiaBox
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
            <AiaBox key={itemIndex} component="li" sx={{ lineHeight: 1.6 }}>
              {renderInline(item)}
            </AiaBox>
          ))}
        </AiaBox>
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
      <AiaText
        key={`p-${blocks.length}`}
        variant="body1"
        sx={{
          minWidth: 0,
          lineHeight: 1.7,
          color: "#0f172a",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
      >
        {renderInline(paragraphLines.join(" "))}
      </AiaText>
    );
  }

  return (
    <AiaBox
      sx={{
        display: "grid",
        gap: 1.25,
        minWidth: 0,
        maxWidth: "100%",
        overflowX: "hidden",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
      }}
    >
      {blocks}
    </AiaBox>
  );
}

function buildSignalUnderstandingText(signal: {
  attributes?: Record<string, unknown>;
  message?: string;
}) {
  const value = signal.attributes?.current_understanding;
  if (typeof value === "string" && value.trim()) {
    const understanding = value.trim();
    const normalize = (text: string) =>
      text
        .toLowerCase()
        .replace(/[`*_#>]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    const normalizedUnderstanding = normalize(understanding);
    const normalizedMessage = normalize(signal.message ?? "");
    const repeatsMessage =
      normalizedUnderstanding.length >= 48 &&
      (normalizedMessage === normalizedUnderstanding ||
        normalizedMessage.includes(normalizedUnderstanding) ||
        normalizedUnderstanding.includes(normalizedMessage));
    return repeatsMessage ? null : understanding;
  }
  return null;
}

function shouldSuppressSignalForCurrentState(
  signal: {
    attributes?: Record<string, unknown>;
  },
  relationshipCount: number,
) {
  if (relationshipCount === 0) return false;
  const actionType = typeof signal.attributes?.action_type === "string" ? signal.attributes.action_type : "";
  return actionType === "refresh_semantic_context";
}

function StreamingProgressIndicator({
  phase,
  message,
  elapsedSeconds,
}: {
  phase?: StreamingStatusPhase | null;
  message?: string | null;
  elapsedSeconds?: number | null;
}) {
  const label = phase ? STATUS_PHASE_LABELS[phase] : "Working...";
  const progress = phase ? STATUS_PHASE_PROGRESS[phase] : 50;

  return (
    <AiaStack spacing={1} sx={{ mt: 1.25 }}>
      <AiaStack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <AiaCircularProgress
          size={16}
          thickness={5}
          variant="determinate"
          value={progress}
          sx={{ color: "#2563eb" }}
        />
        <AiaText variant="caption" sx={{ color: "#1d4ed8", fontWeight: 600 }}>
          {label}
        </AiaText>
        {elapsedSeconds != null && elapsedSeconds > 0 ? (
          <AiaText variant="caption" sx={{ color: "#94a3b8", fontSize: 11 }}>
            ({Math.round(elapsedSeconds)}s)
          </AiaText>
        ) : null}
      </AiaStack>
      {message && message !== label ? (
        <AiaText variant="caption" sx={{ color: "#64748b", fontSize: 12, lineHeight: 1.4 }}>
          {message}
        </AiaText>
      ) : null}
      <AiaBox sx={{ width: "100%", height: 3, backgroundColor: "#e2e8f0", borderRadius: 2, overflow: "hidden" }}>
        <AiaBox
          sx={{
            width: `${progress}%`,
            height: "100%",
            backgroundColor: "#2563eb",
            borderRadius: 2,
            transition: "width 0.3s ease-in-out",
          }}
        />
      </AiaBox>
    </AiaStack>
  );
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
    <AiaBox
      sx={{
        mt: 1.25,
        borderRadius: 1.5,
        border: "1px solid #e2e8f0",
        backgroundColor: "#f8fafc",
        overflow: "hidden",
      }}
    >
      <AiaButton
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
        <AiaStack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
          {expanded ? (
            <KeyboardArrowDownIcon sx={{ fontSize: 16, color: "#64748b" }} />
          ) : (
            <KeyboardArrowRightIcon sx={{ fontSize: 16, color: "#64748b" }} />
          )}
          <AiaText sx={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>
            Execution
          </AiaText>
          <AiaText sx={{ fontSize: 12, color: "#64748b" }}>
            {steps.length} step{steps.length === 1 ? "" : "s"}
          </AiaText>
        </AiaStack>
      </AiaButton>
      {expanded ? (
        <AiaStack spacing={0.8} sx={{ px: 1.5, pb: 1.25, pt: 0.25 }}>
          {steps.map((step, stepIndex) => (
            <AiaStack
              key={`${messageId}-trace-${stepIndex}`}
              direction="row"
              spacing={1}
              sx={{ alignItems: "flex-start" }}
            >
              <AiaBox
                sx={{
                  mt: 0.6,
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  backgroundColor: "#94a3b8",
                  flexShrink: 0,
                }}
              />
              <AiaText sx={{ fontSize: 12, lineHeight: 1.6, color: "#475569" }}>
                {step}
              </AiaText>
            </AiaStack>
          ))}
        </AiaStack>
      ) : null}
    </AiaBox>
  );
}

export default function AIAgentPanel({
  expanded = false,
  onToggleExpanded,
  variant = "standalone",
}: {
  expanded?: boolean;
  onToggleExpanded?: () => void;
  variant?: "standalone" | "sidebar";
}) {
  const {
    assistantSignals,
    firRecommendations,
    firPrimaryQuestion,
    firRecommendationLoading,
    firRecommendationContextKey,
    chatLoading,
    chatMessages,
    datahubStatus,
    dismissPendingDerivedSourceDraft,
    applyPendingAiMappingReview,
    skipPendingAiMappingReview,
    mappingCount,
    openPendingDerivedSourceDraft,
    pendingDerivedSourceDraft,
    pendingAiMappingReviews,
    relationships,
    semanticBundleLabel,
    semanticBundleId,
    workspaceContextStatus,
    workspaceContextCacheStatus,
    workspaceContextError,
    semanticLevel,
    semanticStatus,
    semanticViewName,
    selectedSourceCount,
    respondToAssistantSignal,
    requestSemanticRefresh,
    refreshPreparedWorkspaceContext,
    sendChatMessage,
    // For CoCo snapshot building
    sources,
    targets,
    drivingTableId,
    derivedSources,
    mappings,
    selectedMappingIds,
    session,
    sourceAttributeGroups,
    activeProjectId,
    activeSttmId,
    activeProjectName,
    activeSttmName,
    mappingIntent,
    sourceFilterSql,
    sourceFilterGroups,
    sourceQuerySql,
    sourceGroupBySql,
    sourceOrderBySql,
    mappingSql,
    mappingPreviewSql,
    activeMappingId,
  } = useSttmBuilderContext();
  const {
    selectedRecommendationId,
    resolvedRecommendationIds,
    markRecommendationResolved,
  } = useAiChatLayout();
  const pathname = usePathname();
  const [draft, setDraft] = useState("");
  const [panelMode, setPanelMode] = useState<"assistant" | "recommendations">("assistant");
  const [pendingCorrectionRecommendation, setPendingCorrectionRecommendation] =
    useState<FIRRecommendation | null>(null);
  const [expandedTraces, setExpandedTraces] = useState<Record<string, boolean>>({});
  const [pendingSignalResponses, setPendingSignalResponses] = useState<Record<string, { optionSelected?: string | null; rating?: number | null; comment: string }>>({});
  const [signalActionBusyId, setSignalActionBusyId] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const shownRecommendationIdsRef = useRef<Set<string>>(new Set());
  const assistantFirstName = useMemo(() => {
    const rawName =
      session?.display_name?.trim()
      || session?.email?.split("@")[0]?.trim()
      || "";
    const firstToken = rawName.split(/[\s._-]+/).find(Boolean) || "";
    if (!firstToken) return "";
    return `${firstToken.charAt(0).toUpperCase()}${firstToken.slice(1).toLowerCase()}`;
  }, [session?.display_name, session?.email]);
  const hasStartedStandardConversation = useMemo(
    () => chatMessages.some((message) => message.role === "user"),
    [chatMessages],
  );
  const visibleStandardChatMessages = useMemo(
    () => (
      hasStartedStandardConversation
        ? chatMessages.filter(
            (message) => !(
              message.role === "assistant"
              && (
                message.id === "sttm-assistant-welcome"
                || message.content.includes(
                  "I can use the selected source and target semantics",
                )
              )
            ),
          )
        : chatMessages
    ),
    [chatMessages, hasStartedStandardConversation],
  );

  // CoCo mode state
  const [cocoState, setCocoState] = useState<CocoModeState>(initialCocoState);
  const [cocoMessages, setCocoMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string; id: string }>>([]);
  const [expandedToolExecutions, setExpandedToolExecutions] = useState(true);
  const cocoClientRef = useRef<CocoSessionClient | null>(null);
  const [cocoAvailable, setCocoAvailable] = useState<boolean | null>(null); // null = loading

  // Check CoCo availability on mount
  useEffect(() => {
    const checkCocoStatus = async () => {
      try {
        const response = await fetch('/api/v1/coco/status');
        if (response.ok) {
          const data = await response.json();
          setCocoAvailable(data.enabled && data.user_authorized);
        } else {
          setCocoAvailable(false);
        }
      } catch {
        setCocoAvailable(false);
      }
    };
    void checkCocoStatus();
  }, []);

  const statsLabel = useMemo(() => {
    const joinCount = relationships.length;
    const joinLabel = joinCount === 1 ? "1 relationship" : `${joinCount} relationships`;
    return `${selectedSourceCount} tables · ${mappingCount} mappings · ${joinLabel}`;
  }, [mappingCount, relationships.length, selectedSourceCount]);
  const hasStreamingMessage = useMemo(
    () => chatMessages.some((message) => message.isStreaming),
    [chatMessages]
  );
  const activeReview = pendingAiMappingReviews[0] ?? null;
  const isTransformationReview = !!activeReview?.preprocessingRule;
  const activeSignal = useMemo(
    () =>
      assistantSignals.find(
        (signal) =>
          signal.source !== "conversation_agent" &&
          signal.status !== "dismissed" &&
          signal.status !== "responded" &&
          signal.status !== "acknowledged" &&
          !shouldSuppressSignalForCurrentState(signal, relationships.length),
      ) ?? null,
    [assistantSignals, relationships.length],
  );
  const visibleFirRecommendations = useMemo(
    () =>
      firRecommendations.filter(
        (item) =>
          !resolvedRecommendationIds.has(item.recommendation_id),
      ),
    [
      firRecommendations,
      resolvedRecommendationIds,
    ],
  );
  const selectedRecommendation = useMemo(() => {
    if (!selectedRecommendationId) return null;
    if (
      firPrimaryQuestion?.recommendation_id === selectedRecommendationId
      && !resolvedRecommendationIds.has(selectedRecommendationId)
    ) {
      return firPrimaryQuestion;
    }
    return (
      firRecommendations.find(
        (item) =>
          item.recommendation_id === selectedRecommendationId
          && !resolvedRecommendationIds.has(item.recommendation_id),
      ) ?? null
    );
  }, [
    firPrimaryQuestion,
    firRecommendations,
    resolvedRecommendationIds,
    selectedRecommendationId,
  ]);

  const recordRecommendationOutcome = useCallback(
    async (
      recommendation: FIRRecommendation,
      outcomeType: string,
      payload: Record<string, unknown> = {},
    ) => {
      try {
        await recommendationService.recordOutcome(recommendation.recommendation_id, {
          outcome_type: outcomeType,
          context_key: firRecommendationContextKey,
          user_id: session ? String(session.user_id) : null,
          payload,
        });
      } catch (error) {
        console.warn("Could not record FIR recommendation outcome", error);
      }
    },
    [firRecommendationContextKey, session],
  );

  const handleFirRecommendationAction = useCallback(
    async (recommendation: FIRRecommendation, action: FIRRecommendationAction) => {
      if (action.action === "dismiss") {
        markRecommendationResolved(recommendation.recommendation_id);
        await recordRecommendationOutcome(recommendation, "dismissed", {
          action_id: action.id,
          checkpoint: recommendation.checkpoint,
        });
        return;
      }
      if (action.action === "confirm") {
        await recordRecommendationOutcome(recommendation, "accepted", {
          action_id: action.id,
          checkpoint: recommendation.checkpoint,
        });
        markRecommendationResolved(recommendation.recommendation_id);
        return;
      }

      let recommendationWithEvidence = recommendation;
      if (
        action.action === "open_assistant_explanation"
        && !(recommendation.evidence ?? []).length
      ) {
        try {
          recommendationWithEvidence = await recommendationService.get(
            recommendation.recommendation_id,
          );
        } catch (error) {
          console.warn("Could not load detailed FIR evidence", error);
        }
      }
      const evidenceText = (recommendationWithEvidence.evidence ?? [])
        .slice(0, 3)
        .map((item) => `${item.title}: ${item.summary}`)
        .join("\n");
      const prompt =
        action.action === "correct"
          ? `I want to correct this FIR understanding:\n${recommendation.current_understanding || recommendation.display_message}\n\nMy correction is: `
          : `Explain this FIR recommendation in the current mapping context:\n${recommendationWithEvidence.current_understanding || recommendationWithEvidence.display_message}${evidenceText ? `\n\nEvidence:\n${evidenceText}` : recommendationWithEvidence.evidence_summary ? `\n\nEvidence summary:\n${recommendationWithEvidence.evidence_summary}` : ""}`;
      setPanelMode("assistant");
      if (action.action === "correct") {
        setDraft(prompt);
        setPendingCorrectionRecommendation(recommendation);
        await recordRecommendationOutcome(recommendation, "opened", {
          action_id: action.id,
          intent: "correct",
        });
      } else {
        sendChatMessage(prompt);
        await recordRecommendationOutcome(recommendation, "explained", {
          action_id: action.id,
        });
      }
    },
    [markRecommendationResolved, recordRecommendationOutcome, sendChatMessage],
  );

  useEffect(() => {
    const newlyShown = visibleFirRecommendations.filter((recommendation) => {
      const shownKey = `${recommendation.recommendation_id}:${recommendation.content_version ?? 1}:${firRecommendationContextKey ?? ""}`;
      if (shownRecommendationIdsRef.current.has(shownKey)) return false;
      shownRecommendationIdsRef.current.add(shownKey);
      return true;
    });
    if (!newlyShown.length) return;
    void recommendationService.recordShownOutcomes(
      newlyShown.map((recommendation) => ({
        recommendation_id: recommendation.recommendation_id,
        context_key: firRecommendationContextKey,
        user_id: session ? String(session.user_id) : null,
        payload: {
          checkpoint: recommendation.checkpoint,
          retrieval_mode: recommendation.retrieval_mode,
        },
      })),
    ).catch((error) => {
      console.warn("Could not record FIR recommendation impressions", error);
    });
  }, [
    firRecommendationContextKey,
    session,
    visibleFirRecommendations,
  ]);

  const renderFirRecommendationCard = (
    recommendation: FIRRecommendation,
    interruptive = false,
  ) => {
    const confidence =
      recommendation.confidence == null
        ? null
        : `${Math.round(recommendation.confidence * 100)}% confidence`;
    const retrievalMode = String(recommendation.retrieval_mode || "structured")
      .replaceAll("_", " ");
    return (
      <AiaPaper
        key={`${recommendation.recommendation_id}:${recommendation.content_version ?? 1}`}
        elevation={0}
        sx={{
          p: 1.5,
          borderRadius: 2,
          border: interruptive ? "1px solid #fecaca" : "1px solid #bfdbfe",
          backgroundColor: interruptive ? "#fff7f7" : "#f8fbff",
        }}
      >
        <AiaStack spacing={1.1}>
          <AiaStack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            {interruptive ? (
              <HelpOutlineOutlinedIcon sx={{ fontSize: 18, color: "#dc2626" }} />
            ) : (
              <TipsAndUpdatesOutlinedIcon sx={{ fontSize: 18, color: "#2563eb" }} />
            )}
            <AiaBox sx={{ minWidth: 0, flex: 1 }}>
              <AiaText sx={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>
                {recommendation.title ||
                  String(recommendation.recommendation_category || "Recommendation")
                    .replaceAll("_", " ")}
              </AiaText>
              <AiaText sx={{ fontSize: 11, color: "#64748b", textTransform: "capitalize" }}>
                {[recommendation.question_id, confidence, retrievalMode].filter(Boolean).join(" · ")}
              </AiaText>
            </AiaBox>
          </AiaStack>

          <AiaText sx={{ fontSize: 13, color: "#334155", lineHeight: 1.55 }}>
            {recommendation.display_message}
          </AiaText>

          {recommendation.current_understanding ? (
            <AiaBox
              sx={{
                px: 1.25,
                py: 1,
                borderRadius: 1.5,
                border: "1px solid #dbeafe",
                backgroundColor: "#ffffff",
              }}
            >
              <AiaText sx={{ fontSize: 11.5, fontWeight: 800, color: "#1d4ed8", mb: 0.4 }}>
                Current understanding
              </AiaText>
              <AiaText sx={{ fontSize: 12.5, color: "#334155", lineHeight: 1.55 }}>
                {recommendation.current_understanding}
              </AiaText>
            </AiaBox>
          ) : null}

          {recommendation.evidence?.length ? (
            <AiaBox sx={{ display: "grid", gap: 0.5 }}>
              <AiaText sx={{ fontSize: 11.5, fontWeight: 800, color: "#475569" }}>
                Evidence
              </AiaText>
              {recommendation.evidence.slice(0, 3).map((evidence) => (
                <AiaText
                  key={evidence.evidence_id}
                  sx={{ fontSize: 12, color: "#64748b", lineHeight: 1.45 }}
                >
                  <strong>{evidence.title}:</strong> {evidence.summary}
                </AiaText>
              ))}
            </AiaBox>
          ) : recommendation.evidence_summary ? (
            <AiaText sx={{ fontSize: 12, color: "#64748b", lineHeight: 1.45 }}>
              <strong>Evidence:</strong> {recommendation.evidence_summary}
            </AiaText>
          ) : (
            <AiaText sx={{ fontSize: 11.5, color: "#94a3b8" }}>
              Semantic-only guidance; no readable evidence item is linked yet.
            </AiaText>
          )}

          <AiaStack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
            {recommendation.actions.map((action) => (
              <AiaButton
                key={action.id}
                size="small"
                variant={action.action === "confirm" ? "contained" : "outlined"}
                onClick={() => {
                  void handleFirRecommendationAction(recommendation, action);
                }}
                sx={{ textTransform: "none", borderRadius: "999px" }}
              >
                {action.label}
              </AiaButton>
            ))}
          </AiaStack>
        </AiaStack>
      </AiaPaper>
    );
  };

  const handleSend = () => {
    const message = draft.trim();
    if (!message) return;

    // Check if we should block due to loading state
    const isLoading = cocoState.isActive
      ? cocoState.isConnecting || !!cocoState.streamingText
      : chatLoading;
    if (isLoading) return;

    // If CoCo mode is active, use CoCo
    if (cocoState.isActive) {
      void connectAndSendCocoMessage(message);
      setDraft("");
      return;
    }

    if (pendingAiMappingReviews[0] && APPROVAL_RESPONSE_PATTERN.test(message)) {
      applyPendingAiMappingReview();
      setDraft("");
      return;
    }

    if (pendingAiMappingReviews[0] && SKIP_RESPONSE_PATTERN.test(message)) {
      skipPendingAiMappingReview();
      setDraft("");
      return;
    }

    if (pendingCorrectionRecommendation) {
      void recordRecommendationOutcome(pendingCorrectionRecommendation, "corrected", {
        correction: message,
        checkpoint: pendingCorrectionRecommendation.checkpoint,
      });
      markRecommendationResolved(pendingCorrectionRecommendation.recommendation_id);
      setPendingCorrectionRecommendation(null);
    }

    sendChatMessage(message);
    setDraft("");
  };

  useEffect(() => {
    const node = messagesRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [chatLoading, chatMessages, cocoMessages, cocoState.streamingText]);

  // Build workspace snapshot for CoCo
  const buildWorkspaceSnapshot = useCallback((): WorkbenchContextSnapshotV1 => {
    const selectedSourceTables = sources.filter((s) => s.isSelected);
    const selectedTargetTable = targets.find((t) => t.isSelected) ?? null;

    const currentPage = pathname.includes('/summary')
      ? 'summary'
      : pathname.includes('/mapping')
        ? 'mapping'
        : 'builder';
    const surface = currentPage === 'mapping' ? 'MAPPING' : 'SOURCE_SELECTION';

    return buildWorkbenchContextSnapshot({
      action: 'assistant.requested',
      page: currentPage,
      surface,
      sessionId: session ? String(session.user_id) : null,
      projectId: activeProjectId,
      projectName: activeProjectName,
      sttmId: activeSttmId,
      sttmName: activeSttmName,
      mappingLifecycle: mappingIntent?.lifecycle ?? (activeSttmId ? 'update' : 'new'),
      businessGoal: mappingIntent?.business_goal ?? mappingIntent?.target_outcome ?? null,
      sourceTables: selectedSourceTables,
      targetTable: selectedTargetTable,
      drivingTableId,
      sourceAttributeGroups,
      derivedSources,
      relationships,
      sourceFilterSql,
      sourceFilterGroups,
      sourceQuerySql,
      sourceGroupBySql,
      sourceOrderBySql,
      mappings,
      selectedMappingIds,
      activeMappingId,
      mappingSql,
      mappingPreviewSql,
      mappingIntent,
      semanticBundleId,
      semanticBundleLabel,
      semanticLevel,
      semanticStatus,
      semanticViewName,
    });
  }, [
    sources,
    targets,
    derivedSources,
    pathname,
    session,
    sourceAttributeGroups,
    drivingTableId,
    relationships,
    semanticBundleId,
    semanticBundleLabel,
    semanticViewName,
    mappings,
    selectedMappingIds,
    activeProjectId,
    activeSttmId,
    activeProjectName,
    activeSttmName,
    mappingIntent,
    sourceFilterSql,
    sourceFilterGroups,
    sourceQuerySql,
    sourceGroupBySql,
    sourceOrderBySql,
    mappingSql,
    mappingPreviewSql,
    activeMappingId,
    semanticLevel,
    semanticStatus,
  ]);

  // Handle CoCo WebSocket messages
  const handleCocoMessage = useCallback((message: CocoServerMessage) => {
    switch (message.type) {
      case 'session.ready':
        setCocoState((prev) => ({
          ...prev,
          isConnecting: false,
          isConnected: true,
          statusMessage: 'CoCo session ready',
        }));
        break;

      case 'assistant.delta':
        setCocoState((prev) => ({
          ...prev,
          streamingText: prev.streamingText + (message.data?.text ?? ''),
        }));
        break;

      case 'assistant.status':
        setCocoState((prev) => ({
          ...prev,
          statusMessage: String(message.data?.status ?? message.data?.message ?? 'Working...'),
        }));
        break;

      case 'assistant.final':
        setCocoState((prev) => {
          const finalText = prev.streamingText || String(message.data?.text ?? '');
          if (finalText) {
            setCocoMessages((msgs) => [
              ...msgs,
              { role: 'assistant', content: finalText, id: message.event_id },
            ]);
          }
          return {
            ...prev,
            streamingText: '',
            statusMessage: null,
            toolExecutions: [],
          };
        });
        break;

      case 'assistant.error':
        setCocoState((prev) => ({
          ...prev,
          streamingText: '',
          statusMessage: null,
          error: message.error?.detail ?? 'An error occurred',
        }));
        break;

      case 'permission.requested': {
        const permData = message.data as CocoPermissionRequest | undefined;
        if (permData) {
          setCocoState((prev) => ({
            ...prev,
            pendingPermission: {
              ...permData,
              contextHash: message.context_hash,
            },
          }));
        }
        break;
      }

      case 'tool.started': {
        const toolData = message.data as { tool_id?: string; tool?: string; resource?: string } | undefined;
        if (toolData) {
          setCocoState((prev) => ({
            ...prev,
            toolExecutions: [
              ...prev.toolExecutions,
              {
                toolId: toolData.tool_id ?? message.event_id,
                tool: toolData.tool ?? 'unknown',
                resource: toolData.resource,
                status: 'started',
                startedAt: message.timestamp,
              },
            ],
          }));
        }
        break;
      }

      case 'tool.completed': {
        const toolData = message.data as { tool_id?: string; result?: string } | undefined;
        if (toolData) {
          setCocoState((prev) => ({
            ...prev,
            toolExecutions: prev.toolExecutions.map((exec) =>
              exec.toolId === toolData.tool_id
                ? { ...exec, status: 'completed', completedAt: message.timestamp, result: toolData.result }
                : exec
            ),
          }));
        }
        break;
      }

      default:
        // Handle any other message types gracefully
        break;
    }
  }, []);

  // Handle CoCo disconnect
  const handleCocoDisconnect = useCallback(() => {
    setCocoState((prev) => ({
      ...prev,
      isConnected: false,
      isConnecting: false,
      statusMessage: null,
      error: prev.isActive ? 'Connection lost' : null,
    }));
  }, []);

  // Toggle CoCo mode
  const toggleCocoMode = useCallback(() => {
    if (cocoState.isActive) {
      // Turn off CoCo mode
      cocoClientRef.current?.close();
      cocoClientRef.current = null;
      setCocoState(initialCocoState);
      setCocoMessages([]);
    } else {
      // Turn on CoCo mode
      setCocoState((prev) => ({ ...prev, isActive: true }));
    }
  }, [cocoState.isActive]);

  // Connect to CoCo when sending first message in CoCo mode
  const connectAndSendCocoMessage = useCallback(async (message: string) => {
    if (!cocoClientRef.current) {
      cocoClientRef.current = new CocoSessionClient();
    }

    const snapshot = buildWorkspaceSnapshot();

    // Add user message to chat
    setCocoMessages((msgs) => [
      ...msgs,
      { role: 'user', content: message, id: `user-${Date.now()}` },
    ]);

    try {
      if (!cocoState.isConnected) {
        setCocoState((prev) => ({ ...prev, isConnecting: true, error: null, statusMessage: 'Checking CoCo service...' }));

        // Pre-connection health check
        const diagnostics = await fetchCocoDiagnostics();
        const diagnosticsError = getDiagnosticsErrorMessage(diagnostics);
        if (diagnosticsError) {
          setCocoState((prev) => ({
            ...prev,
            isConnecting: false,
            statusMessage: null,
            error: diagnosticsError,
          }));
          return;
        }

        setCocoState((prev) => ({ ...prev, statusMessage: 'Connecting to CoCo...' }));
        await cocoClientRef.current.connect(snapshot, handleCocoMessage, handleCocoDisconnect);
        setCocoState((prev) => ({ ...prev, statusMessage: null }));
      }
      cocoClientRef.current.sendMessage(message, snapshot);
    } catch (err) {
      setCocoState((prev) => ({
        ...prev,
        isConnecting: false,
        statusMessage: null,
        error: err instanceof Error ? err.message : 'Failed to connect to CoCo',
      }));
    }
  }, [buildWorkspaceSnapshot, cocoState.isConnected, handleCocoMessage, handleCocoDisconnect]);

  // Handle permission decision
  const handlePermissionDecision = useCallback(
    (decision: 'allow_once' | 'allow_session' | 'deny' | 'cancel', feedback = '') => {
      const perm = cocoState.pendingPermission;
      if (!perm || !cocoClientRef.current) return;

      cocoClientRef.current.decidePermission(
        perm.contextHash,
        perm.permission_id,
        decision,
        feedback
      );
      setCocoState((prev) => ({ ...prev, pendingPermission: null }));
    },
    [cocoState.pendingPermission]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cocoClientRef.current?.close();
    };
  }, []);

  const toggleTrace = (messageId: string) => {
    setExpandedTraces((current) => ({
      ...current,
      [messageId]: !current[messageId],
    }));
  };

  const startSignalRating = (signalId: string, rating: number) => {
    setPendingSignalResponses((current) => ({
      ...current,
      [signalId]: {
        rating,
        optionSelected: current[signalId]?.optionSelected ?? null,
        comment: current[signalId]?.comment ?? "",
      },
    }));
  };

  const selectSignalOption = (signalId: string, optionSelected: string) => {
    setPendingSignalResponses((current) => ({
      ...current,
      [signalId]: {
        rating: current[signalId]?.rating ?? null,
        optionSelected,
        comment: current[signalId]?.comment ?? "",
      },
    }));
  };

  const changeSignalComment = (signalId: string, comment: string) => {
    setPendingSignalResponses((current) => ({
      ...current,
      [signalId]: {
        rating: current[signalId]?.rating ?? null,
        optionSelected: current[signalId]?.optionSelected ?? null,
        comment,
      },
    }));
  };

  const submitSignalResponse = (signalId: string) => {
    const pending = pendingSignalResponses[signalId];
    respondToAssistantSignal({
      signalId,
      status: "responded",
      optionSelected: pending?.optionSelected ?? null,
      rating: pending?.rating ?? null,
      comment: pending?.comment?.trim() || null,
    });
    setPendingSignalResponses((current) => {
      const next = { ...current };
      delete next[signalId];
      return next;
    });
  };

  const dismissSignal = (signalId: string) => {
    respondToAssistantSignal({ signalId, status: "dismissed" });
    setPendingSignalResponses((current) => {
      const next = { ...current };
      delete next[signalId];
      return next;
    });
  };

  const confirmSignalOption = (signalId: string, optionSelected: string) => {
    respondToAssistantSignal({
      signalId,
      status: "responded",
      optionSelected,
    });
    setPendingSignalResponses((current) => {
      const next = { ...current };
      delete next[signalId];
      return next;
    });
  };

  const explainSignal = async (signal: (typeof assistantSignals)[number], optionLabel?: string) => {
    const signalTables =
      Array.isArray(signal.entity_ids) && signal.entity_ids.length >= 2
        ? signal.entity_ids.filter((entityId) => entityId.split(".").length === 3).slice(0, 2)
        : [];
    const fallbackPrompt =
      signalTables.length >= 2
        ? `Explain the relationship between ${signalTables[0]} and ${signalTables[1]} in simple business terms and tell me whether it looks reliable for mapping.`
        : "Explain the relationship between the selected tables in simple business terms and tell me whether it looks reliable for mapping.";
    const suggestedPrompt =
      typeof signal.attributes?.suggested_prompt === "string" && signal.attributes.suggested_prompt.trim()
        ? signal.attributes.suggested_prompt.trim()
        : fallbackPrompt;
    const currentUnderstanding = buildSignalUnderstandingText(signal);
    const explanationPrompt = currentUnderstanding
      ? `${suggestedPrompt}\n\nThis is your current understanding so far:\n${currentUnderstanding}\n\nPlease explain this in simple business terms, tell me what looks reliable, and call out the specific assumption or join detail the user should confirm or correct.`
      : suggestedPrompt;
    sendChatMessage(explanationPrompt);
    respondToAssistantSignal({
      signalId: signal.signal_id,
      status: "acknowledged",
      optionSelected: optionLabel ?? "Ask AI to explain first",
    });
  };

  const applySignalAction = async (signal: (typeof assistantSignals)[number]) => {
    const actionType = typeof signal.attributes?.action_type === "string" ? signal.attributes.action_type : "";
    if (actionType === "refresh_semantic_context") {
      try {
        setSignalActionBusyId(signal.signal_id);
        await requestSemanticRefresh();
        respondToAssistantSignal({
          signalId: signal.signal_id,
          status: "acknowledged",
          optionSelected: "Refresh semantic context",
        });
      } finally {
        setSignalActionBusyId(null);
      }
      return;
    }
    if (actionType === "explain_relationship") {
      await explainSignal(signal, "Explain this relationship");
    }
  };

  const handleSignalOption = async (signal: (typeof assistantSignals)[number], option: string) => {
    const normalized = option.trim().toLowerCase();
    if (normalized === "refresh semantic context" || normalized === "build stronger context") {
      await applySignalAction(signal);
      return;
    }
    const requestsExplanation =
      normalized === "ask ai to explain first" ||
      normalized === "explain this relationship" ||
      normalized === "explain this join" ||
      normalized === "tell me more" ||
      normalized.includes("explain") ||
      (normalized.includes("show me") &&
        ["join", "relationship", "pattern", "correct", "how", "why"].some((word) => normalized.includes(word)));
    if (requestsExplanation) {
      await explainSignal(signal, option);
      return;
    }
    if (normalized === "dismiss" || normalized === "not now") {
      dismissSignal(signal.signal_id);
      return;
    }
    if (
      normalized === "looks right" ||
      normalized.startsWith("understood") ||
      normalized.includes("i'll handle it") ||
      normalized.includes("i will handle it") ||
      normalized === "yes, that is correct" ||
      normalized === "this relationship looks right"
    ) {
      confirmSignalOption(signal.signal_id, option);
      return;
    }
    if (normalized === "needs correction") {
      const currentUnderstanding = buildSignalUnderstandingText(signal);
      setPendingSignalResponses((current) => ({
        ...current,
        [signal.signal_id]: {
          rating: current[signal.signal_id]?.rating ?? null,
          optionSelected: option,
          comment: current[signal.signal_id]?.comment ?? "",
        },
      }));
      sendChatMessage(
        currentUnderstanding
          ? `This current understanding needs correction:\n${currentUnderstanding}\n\nPlease ask me what looks wrong, what the right business meaning is, and what join or relationship should be used instead.`
          : "I think the current join needs correction. Please ask me what looks wrong and help me capture the right business relationship.",
      );
      return;
    }
    if (normalized === "i will type it manually" || normalized === "i want to describe it") {
      setPendingSignalResponses((current) => ({
        ...current,
        [signal.signal_id]: {
          rating: current[signal.signal_id]?.rating ?? null,
          optionSelected: option,
          comment: current[signal.signal_id]?.comment ?? "",
        },
      }));
      return;
    }
    selectSignalOption(signal.signal_id, option);
  };

  return (
    <AiaPaper
      elevation={0}
      sx={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        borderRadius: "12px",
        border: variant === "sidebar" ? "none" : "1px solid #e2e8f0",
        overflow: "hidden",
        backgroundColor: "#ffffff",
      }}
    >
      {variant !== "sidebar" ? <AiaBox
        sx={{
          p: 2.25,
          backgroundColor: "var(--aia-assitant-header-color)",
          color: "var(--aia-assitant-header-textColor)",
        }}
      >
        <AiaStack
          sx={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 1.5,
          }}
        >
          <AiaStack sx={{ flexDirection: "row", gap: 1.5, alignItems: "center" }}>
            <AiaAvatar
              sx={{
                bgcolor: cocoState.isActive ? '#7c3aed' : 'var(--aia-assitant-avatar-bgColor)',
                width: 36,
                height: 36,
              }}
            >
              {cocoState.isActive ? <BoltIcon sx={{ fontSize: 20 }} /> : <SmartToyIcon sx={{ fontSize: 20 }} />}
            </AiaAvatar>
            <AiaBox>
              <AiaStack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <AiaText
                  variant="subtitle1"
                  sx={{ fontWeight: 700, lineHeight: 1.2, color: 'var(--aia-assitant-textColor)' }}
                >
                  {cocoState.isActive ? 'CoCo Agent' : 'STTM AI Agent'}
                </AiaText>
                {cocoState.isActive && (
                  <AiaBox
                    sx={{
                      px: 0.75,
                      py: 0.25,
                      borderRadius: '4px',
                      backgroundColor: '#7c3aed',
                      color: '#ffffff',
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                    }}
                  >
                    Deep Agent
                  </AiaBox>
                )}
              </AiaStack>
              <AiaText
                variant="caption"
                sx={{
                  color: "#94a3b8",
                  display: "flex",
                  alignItems: "center",
                  gap: 0.75,
                }}
              >
                <AiaBox
                  component="span"
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    bgcolor: cocoState.isActive
                      ? cocoState.isConnecting
                        ? "#f59e0b"
                        : cocoState.isConnected
                          ? "#22c55e"
                          : "#94a3b8"
                      : chatLoading
                        ? "#f59e0b"
                        : "#22c55e",
                  }}
                />
                {cocoState.isActive
                  ? cocoState.isConnecting
                    ? "Connecting..."
                    : cocoState.isConnected
                      ? "Connected"
                      : "Ready"
                  : chatLoading
                    ? "Working"
                    : "Active"}{" "}
                · {cocoState.isActive ? "CoCo 1.0" : "Cortex 4.0"}
              </AiaText>
            </AiaBox>
          </AiaStack>
          <AiaStack direction="row" spacing={0.5}>
            {/* Only show CoCo toggle if CoCo is available */}
            {cocoAvailable && (
              <AiaTooltip title={cocoState.isActive ? "Switch to Standard Mode" : "Switch to CoCo Deep Agent Mode"}>
                <AiaIconButton
                  size="small"
                  onClick={toggleCocoMode}
                  sx={{
                    color: cocoState.isActive ? '#7c3aed' : 'var(--aia-assitant-textColor)',
                    backgroundColor: cocoState.isActive ? 'rgba(124, 58, 237, 0.15)' : 'transparent',
                    '&:hover': {
                      backgroundColor: cocoState.isActive ? 'rgba(124, 58, 237, 0.25)' : 'rgba(255,255,255,0.1)',
                    },
                  }}
                >
                  <AutoAwesomeRoundedIcon fontSize="small" />
                </AiaIconButton>
              </AiaTooltip>
            )}
            {/* Show disabled state when CoCo is not available but checking is done */}
            {cocoAvailable === false && (
              <AiaTooltip title="CoCo Deep Agent is not available">
                <AiaBox sx={{ opacity: 0.4 }}>
                  <AiaIconButton
                    size="small"
                    disabled
                    sx={{ color: 'var(--aia-assitant-textColor)' }}
                  >
                    <AutoAwesomeRoundedIcon fontSize="small" />
                  </AiaIconButton>
                </AiaBox>
              </AiaTooltip>
            )}
            <AiaIconButton
              size="small"
              onClick={onToggleExpanded}
              sx={{ color: 'var(--aia-assitant-textColor)' }}
            >
              {expanded ? <CloseFullscreenIcon fontSize="small" /> : <OpenInFullIcon fontSize="small" />}
            </AiaIconButton>
            <AiaIconButton size="small" sx={{ color: 'var(--aia-assitant-textColor)' }}>
              <VolumeUpIcon fontSize="small" />
            </AiaIconButton>
          </AiaStack>
        </AiaStack>

        <AiaBox
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
          <AiaText variant="caption" sx={{ color: 'var(--aia-assitant-table-textColor)' }}>
            {statsLabel}
          </AiaText>
        </AiaBox>

        {semanticStatus || semanticLevel || semanticViewName || datahubStatus || semanticBundleLabel ? (
          <AiaStack
            direction="row"
            spacing={0.75}
            useFlexGap
            sx={{ mt: 1.25, flexWrap: "wrap" }}
          >
            {semanticBundleLabel ? (
              <AiaBox
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
              </AiaBox>
            ) : null}
            {semanticLevel ? (
              <AiaBox
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
              </AiaBox>
            ) : null}
            {semanticStatus ? (
              <AiaBox
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
              </AiaBox>
            ) : null}
            {semanticViewName ? (
              <AiaBox
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
              </AiaBox>
            ) : null}
            {datahubStatus ? (
              <AiaBox
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
              </AiaBox>
            ) : null}
          </AiaStack>
        ) : null}
      </AiaBox> : (
        <AiaBox
          sx={{
            px: 2,
            py: 1,
            borderBottom: "1px solid #e2e8f0",
            backgroundColor: "#f8fafc",
            flexShrink: 0,
          }}
        >
          <AiaStack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <TableChartIcon sx={{ fontSize: 16, color: "#64748b" }} />
            <AiaText sx={{ fontSize: 12, color: "#64748b" }}>{statsLabel}</AiaText>
          </AiaStack>
        </AiaBox>
      )}

      <AiaStack
        direction="row"
        spacing={0.75}
        sx={{
          px: 2,
          py: 0.65,
          alignItems: "center",
          borderBottom: "1px solid #e2e8f0",
          backgroundColor:
            workspaceContextStatus === "failed" ? "#fff7ed" : "#f8fafc",
          flexShrink: 0,
        }}
      >
        {workspaceContextStatus === "updating" ? (
          <AiaCircularProgress size={12} />
        ) : (
          <AiaBox
            sx={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              backgroundColor:
                workspaceContextStatus === "ready"
                  ? "#22c55e"
                  : workspaceContextStatus === "partial"
                    ? "#f59e0b"
                    : workspaceContextStatus === "failed"
                      ? "#ef4444"
                      : "#94a3b8",
            }}
          />
        )}
        <AiaText
          sx={{
            minWidth: 0,
            flex: 1,
            fontSize: 11,
            color: workspaceContextStatus === "failed" ? "#9a3412" : "#64748b",
          }}
          title={workspaceContextError ?? undefined}
        >
          AI context:{" "}
          {workspaceContextStatus === "updating"
            ? "Updating"
            : workspaceContextStatus === "ready"
              ? "Ready"
              : workspaceContextStatus === "partial"
                ? "Ready with warnings"
                : workspaceContextStatus === "failed"
                  ? "Failed"
                  : "Waiting for a selection"}
          {workspaceContextCacheStatus ? ` · ${workspaceContextCacheStatus}` : ""}
        </AiaText>
        <AiaButton
          size="small"
          variant="text"
          disabled={workspaceContextStatus === "updating"}
          onClick={() => {
            void refreshPreparedWorkspaceContext().catch(() => undefined);
          }}
          sx={{
            minWidth: 0,
            px: 0.75,
            py: 0.25,
            fontSize: 11,
            textTransform: "none",
          }}
        >
          Refresh
        </AiaButton>
      </AiaStack>

      {variant !== "sidebar" ? <AiaStack
        direction="row"
        sx={{
          px: 1,
          py: 0.75,
          gap: 0.5,
          borderBottom: "1px solid #e2e8f0",
          backgroundColor: "#ffffff",
        }}
      >
        <AiaButton
          size="small"
          variant={panelMode === "assistant" ? "contained" : "text"}
          onClick={() => setPanelMode("assistant")}
          sx={{
            minHeight: 32,
            textTransform: "none",
            borderRadius: 1.5,
            boxShadow: "none",
          }}
        >
          Assistant
          {firPrimaryQuestion ? (
            <AiaBox
              component="span"
              sx={{
                ml: 0.75,
                minWidth: 18,
                height: 18,
                px: 0.5,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "999px",
                backgroundColor: panelMode === "assistant" ? "#ffffff" : "#fee2e2",
                color: "#dc2626",
                fontSize: 10,
                fontWeight: 800,
              }}
            >
              1
            </AiaBox>
          ) : null}
        </AiaButton>
        <AiaButton
          size="small"
          variant={panelMode === "recommendations" ? "contained" : "text"}
          onClick={() => setPanelMode("recommendations")}
          sx={{
            minHeight: 32,
            textTransform: "none",
            borderRadius: 1.5,
            boxShadow: "none",
          }}
        >
          Recommendations
          <AiaBox
            component="span"
            sx={{
              ml: 0.75,
              minWidth: 18,
              height: 18,
              px: 0.5,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "999px",
              backgroundColor: panelMode === "recommendations" ? "#ffffff" : "#dbeafe",
              color: "#1d4ed8",
              fontSize: 10,
              fontWeight: 800,
            }}
          >
            {visibleFirRecommendations.length}
          </AiaBox>
        </AiaButton>
      </AiaStack> : null}

      <AiaBox
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
        {variant !== "sidebar" && panelMode === "recommendations" ? (
          firRecommendationLoading ? (
            <AiaStack direction="row" spacing={1} sx={{ alignItems: "center", color: "#64748b" }}>
              <AiaCircularProgress size={16} />
              <AiaText sx={{ fontSize: 13 }}>Loading applicable guidance...</AiaText>
            </AiaStack>
          ) : visibleFirRecommendations.length ? (
            <AiaStack spacing={1.25}>
              {visibleFirRecommendations.map((recommendation) =>
                renderFirRecommendationCard(recommendation),
              )}
            </AiaStack>
          ) : (
            <AiaBox sx={{ py: 4, textAlign: "center" }}>
              <TipsAndUpdatesOutlinedIcon sx={{ color: "#94a3b8", mb: 1 }} />
              <AiaText sx={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>
                No guidance applies to this checkpoint yet.
              </AiaText>
              <AiaText sx={{ fontSize: 12, color: "#94a3b8", mt: 0.5 }}>
                New FIR results will appear here as the mapping context changes.
              </AiaText>
            </AiaBox>
          )
        ) : null}

        {(variant === "sidebar" || panelMode === "assistant") ? (
          <>
        {variant === "sidebar"
          ? selectedRecommendation
            ? renderFirRecommendationCard(selectedRecommendation, !!selectedRecommendation.question_id)
            : null
          : firPrimaryQuestion &&
              !resolvedRecommendationIds.has(firPrimaryQuestion.recommendation_id)
            ? renderFirRecommendationCard(firPrimaryQuestion, true)
            : null}
        {activeSignal ? (
          <AiaStack spacing={1.5}>
            {[activeSignal].map((signal) => {
              const draftResponse = pendingSignalResponses[signal.signal_id];
              const thumbsUpSelected = draftResponse?.rating === 5;
              const thumbsDownSelected = draftResponse?.rating === 1;
              const isRefreshSignal = signal.attributes?.action_type === "refresh_semantic_context";
              const currentUnderstanding = buildSignalUnderstandingText(signal);
              const actionLabel =
                isRefreshSignal
                  ? "Refresh now"
                  : signal.attributes?.action_type === "explain_relationship"
                    ? "Explain now"
                    : null;
              return (
                <AiaPaper
                  key={signal.signal_id}
                  elevation={0}
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    border: signal.signal_type === "recommendation" ? "1px solid #bfdbfe" : "1px solid #fecaca",
                    backgroundColor: signal.signal_type === "recommendation" ? "#eff6ff" : "#fff7f7",
                  }}
                >
                  <AiaStack spacing={1}>
                    <AiaStack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      {signal.signal_type === "recommendation" ? (
                        <TipsAndUpdatesOutlinedIcon sx={{ fontSize: 18, color: "#2563eb" }} />
                      ) : (
                        <HelpOutlineOutlinedIcon sx={{ fontSize: 18, color: "#dc2626" }} />
                      )}
                      <AiaText sx={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>
                        {signal.title}
                      </AiaText>
                    </AiaStack>
                    <AiaText
                      sx={{
                        fontSize: 13,
                        color: "#334155",
                        lineHeight: 1.55,
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                      }}
                    >
                      {signal.message}
                    </AiaText>
                    {currentUnderstanding ? (
                      <AiaBox
                        sx={{
                          borderRadius: 1.5,
                          border: "1px solid #dbeafe",
                          backgroundColor: "#ffffff",
                          px: 1.25,
                          py: 1,
                        }}
                      >
                        <AiaText sx={{ fontSize: 12, fontWeight: 800, color: "#1d4ed8", mb: 0.5 }}>
                          Current understanding
                        </AiaText>
                        <AiaText
                          sx={{
                            fontSize: 12.5,
                            color: "#334155",
                            lineHeight: 1.6,
                            whiteSpace: "pre-wrap",
                            overflowWrap: "anywhere",
                            wordBreak: "break-word",
                          }}
                        >
                          {currentUnderstanding}
                        </AiaText>
                      </AiaBox>
                    ) : null}
                    {signal.options?.length ? (
                      <AiaStack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                        {signal.options.map((option) => {
                          const selected = draftResponse?.optionSelected === option;
                          return (
                            <AiaButton
                              key={option}
                              size="small"
                              variant={selected ? "contained" : "outlined"}
                              onClick={() => {
                                void handleSignalOption(signal, option);
                              }}
                              sx={{ borderRadius: 999, textTransform: "none" }}
                            >
                              {option}
                            </AiaButton>
                          );
                        })}
                      </AiaStack>
                    ) : null}
                    {signal.signal_type === "recommendation" ? (
                      <AiaStack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                        <AiaIconButton
                          size="small"
                          onClick={() => startSignalRating(signal.signal_id, 5)}
                          sx={{ color: thumbsUpSelected ? "#16a34a" : "#64748b" }}
                        >
                          <ThumbUpAltOutlinedIcon fontSize="small" />
                        </AiaIconButton>
                        <AiaIconButton
                          size="small"
                          onClick={() => startSignalRating(signal.signal_id, 1)}
                          sx={{ color: thumbsDownSelected ? "#dc2626" : "#64748b" }}
                        >
                          <ThumbDownAltOutlinedIcon fontSize="small" />
                        </AiaIconButton>
                        <AiaText sx={{ fontSize: 12, color: "#64748b" }}>
                          Was this recommendation useful?
                        </AiaText>
                      </AiaStack>
                    ) : null}
                    {(!isRefreshSignal && (signal.allow_free_text || draftResponse?.rating || draftResponse?.optionSelected)) ? (
                      <AiaInput
                        size="small"
                        placeholder="Add a business comment or type your own answer"
                        value={draftResponse?.comment ?? ""}
                        onChange={(value) => changeSignalComment(signal.signal_id, value)}
                        multiline
                        minRows={2}
                      />
                    ) : null}
                    <AiaStack direction="row" spacing={1}>
                      {actionLabel ? (
                        <AiaButton
                          size="small"
                          variant="outlined"
                          onClick={() => {
                            void applySignalAction(signal);
                          }}
                          disabled={signalActionBusyId === signal.signal_id}
                          sx={{ textTransform: "none" }}
                        >
                          {signalActionBusyId === signal.signal_id ? "Working..." : actionLabel}
                        </AiaButton>
                      ) : null}
                      {!isRefreshSignal ? (
                        <AiaButton
                          size="small"
                          variant="contained"
                          onClick={() => submitSignalResponse(signal.signal_id)}
                          sx={{ textTransform: "none" }}
                        >
                          Send response
                        </AiaButton>
                      ) : null}
                      <AiaButton
                        size="small"
                        variant="text"
                        onClick={() => dismissSignal(signal.signal_id)}
                        sx={{ textTransform: "none" }}
                      >
                        Dismiss
                      </AiaButton>
                    </AiaStack>
                  </AiaStack>
                </AiaPaper>
              );
            })}
          </AiaStack>
        ) : null}
        {/* CoCo Mode Messages */}
        {cocoState.isActive ? (
          <>
            {cocoMessages.map((message) => {
              const isAssistant = message.role === "assistant";
              return (
                <AiaStack
                  key={message.id}
                  direction="row"
                  spacing={1.5}
                  sx={{ justifyContent: isAssistant ? "flex-start" : "flex-end" }}
                >
                  {isAssistant ? (
                    <AiaAvatar sx={{ bgcolor: '#7c3aed', width: 28, height: 28 }}>
                      <BoltIcon sx={{ fontSize: 16 }} />
                    </AiaAvatar>
                  ) : null}

                  <AiaPaper
                    elevation={0}
                    sx={{
                      p: 1.5,
                      borderRadius: isAssistant ? "0 12px 12px 12px" : "12px 0 12px 12px",
                      border: isAssistant ? "1px solid #c4b5fd" : "1px solid #e2e8f0",
                      maxWidth: expanded ? "92%" : "85%",
                      minWidth: 0,
                      backgroundColor: isAssistant ? "#faf5ff" : "#f8fafc",
                    }}
                  >
                    <AiaBox sx={{ minWidth: 0, maxWidth: "100%", fontSize: 14, overflowX: "hidden" }}>
                      <MessageContent content={message.content} formatPlainText={isAssistant} />
                    </AiaBox>
                  </AiaPaper>
                </AiaStack>
              );
            })}

            {/* Streaming CoCo response */}
            {cocoState.streamingText && (
              <AiaStack direction="row" spacing={1.5} sx={{ justifyContent: "flex-start" }}>
                <AiaAvatar sx={{ bgcolor: '#7c3aed', width: 28, height: 28 }}>
                  <BoltIcon sx={{ fontSize: 16 }} />
                </AiaAvatar>
                <AiaPaper
                  elevation={0}
                  sx={{
                    p: 1.5,
                    borderRadius: "0 12px 12px 12px",
                    border: "1px solid #c4b5fd",
                    maxWidth: expanded ? "92%" : "85%",
                    minWidth: 0,
                    backgroundColor: "#faf5ff",
                  }}
                >
                  <AiaBox sx={{ minWidth: 0, maxWidth: "100%", fontSize: 14, overflowX: "hidden" }}>
                    <MessageContent content={cocoState.streamingText} formatPlainText />
                  </AiaBox>
                  {cocoState.statusMessage && (
                    <AiaText
                      variant="caption"
                      sx={{ color: "#7c3aed", mt: 1, display: "block", fontWeight: 500 }}
                    >
                      {cocoState.statusMessage}
                    </AiaText>
                  )}
                </AiaPaper>
              </AiaStack>
            )}

            {/* CoCo Tool Executions Panel */}
            {cocoState.toolExecutions.length > 0 && (
              <AiaBox
                sx={{
                  borderRadius: 2,
                  border: "1px solid #c4b5fd",
                  backgroundColor: "#faf5ff",
                  overflow: "hidden",
                }}
              >
                <AiaButton
                  onClick={() => setExpandedToolExecutions((prev) => !prev)}
                  variant="text"
                  sx={{
                    width: "100%",
                    px: 1.5,
                    py: 1,
                    justifyContent: "space-between",
                    textTransform: "none",
                    color: "#5b21b6",
                    borderRadius: 0,
                    "&:hover": { backgroundColor: "#ede9fe" },
                  }}
                >
                  <AiaStack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                    {expandedToolExecutions ? (
                      <KeyboardArrowDownIcon sx={{ fontSize: 16, color: "#7c3aed" }} />
                    ) : (
                      <KeyboardArrowRightIcon sx={{ fontSize: 16, color: "#7c3aed" }} />
                    )}
                    <AiaText sx={{ fontSize: 12, fontWeight: 700, color: "#5b21b6" }}>
                      Tool Executions
                    </AiaText>
                    <AiaText sx={{ fontSize: 12, color: "#8b5cf6" }}>
                      {cocoState.toolExecutions.length} tool{cocoState.toolExecutions.length === 1 ? "" : "s"}
                    </AiaText>
                  </AiaStack>
                </AiaButton>
                {expandedToolExecutions && (
                  <AiaStack spacing={0.5} sx={{ px: 1.5, pb: 1.25, pt: 0.25 }}>
                    {cocoState.toolExecutions.map((exec) => (
                      <AiaStack
                        key={exec.toolId}
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: "center" }}
                      >
                        <AiaBox
                          sx={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            backgroundColor:
                              exec.status === "completed"
                                ? "#22c55e"
                                : exec.status === "error"
                                  ? "#ef4444"
                                  : "#f59e0b",
                            flexShrink: 0,
                          }}
                        />
                        <AiaText sx={{ fontSize: 12, color: "#5b21b6", fontWeight: 600 }}>
                          {exec.tool}
                        </AiaText>
                        {exec.resource && (
                          <AiaText sx={{ fontSize: 11, color: "#8b5cf6" }}>
                            {exec.resource}
                          </AiaText>
                        )}
                        <AiaText
                          sx={{
                            fontSize: 11,
                            color: exec.status === "completed" ? "#16a34a" : "#a78bfa",
                            fontStyle: "italic",
                          }}
                        >
                          {exec.status}
                        </AiaText>
                      </AiaStack>
                    ))}
                  </AiaStack>
                )}
              </AiaBox>
            )}

            {/* CoCo Permission Request Dialog */}
            {cocoState.pendingPermission && (
              <AiaPaper
                elevation={0}
                sx={{
                  p: 1.5,
                  borderRadius: 2,
                  border: "1px solid #fbbf24",
                  backgroundColor: "#fffbeb",
                }}
              >
                <AiaStack spacing={1.25}>
                  <AiaStack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <WarningAmberRoundedIcon sx={{ fontSize: 20, color: "#d97706" }} />
                    <AiaText sx={{ fontSize: 14, fontWeight: 700, color: "#92400e" }}>
                      Permission Required
                    </AiaText>
                  </AiaStack>
                  <AiaBox>
                    <AiaText sx={{ fontSize: 13, color: "#78350f", fontWeight: 600 }}>
                      Tool: {cocoState.pendingPermission.tool}
                    </AiaText>
                    {cocoState.pendingPermission.resource && (
                      <AiaText sx={{ fontSize: 12, color: "#92400e", mt: 0.25 }}>
                        Resource: {cocoState.pendingPermission.resource}
                      </AiaText>
                    )}
                    <AiaText sx={{ fontSize: 13, color: "#451a03", mt: 0.5, lineHeight: 1.5 }}>
                      {cocoState.pendingPermission.reason}
                    </AiaText>
                    {cocoState.pendingPermission.expected_effect && (
                      <AiaText sx={{ fontSize: 12, color: "#78350f", mt: 0.5 }}>
                        Expected effect: {cocoState.pendingPermission.expected_effect}
                      </AiaText>
                    )}
                    {cocoState.pendingPermission.risk && (
                      <AiaBox
                        sx={{
                          mt: 0.75,
                          px: 1,
                          py: 0.5,
                          borderRadius: 1,
                          backgroundColor:
                            cocoState.pendingPermission.risk === "high"
                              ? "#fef2f2"
                              : cocoState.pendingPermission.risk === "medium"
                                ? "#fff7ed"
                                : "#f0fdf4",
                          border: `1px solid ${
                            cocoState.pendingPermission.risk === "high"
                              ? "#fecaca"
                              : cocoState.pendingPermission.risk === "medium"
                                ? "#fed7aa"
                                : "#bbf7d0"
                          }`,
                        }}
                      >
                        <AiaText
                          sx={{
                            fontSize: 11,
                            fontWeight: 600,
                            color:
                              cocoState.pendingPermission.risk === "high"
                                ? "#dc2626"
                                : cocoState.pendingPermission.risk === "medium"
                                  ? "#ea580c"
                                  : "#16a34a",
                          }}
                        >
                          Risk: {cocoState.pendingPermission.risk}
                          {cocoState.pendingPermission.reversible ? " (reversible)" : " (not reversible)"}
                        </AiaText>
                      </AiaBox>
                    )}
                  </AiaBox>
                  <AiaStack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                    <AiaButton
                      size="small"
                      variant="contained"
                      onClick={() => handlePermissionDecision("allow_once")}
                      startIcon={<CheckRoundedIcon sx={{ fontSize: 16 }} />}
                      sx={{
                        textTransform: "none",
                        borderRadius: "999px",
                        backgroundColor: "#16a34a",
                        "&:hover": { backgroundColor: "#15803d" },
                      }}
                    >
                      Allow Once
                    </AiaButton>
                    <AiaButton
                      size="small"
                      variant="outlined"
                      onClick={() => handlePermissionDecision("allow_session")}
                      sx={{
                        textTransform: "none",
                        borderRadius: "999px",
                        borderColor: "#22c55e",
                        color: "#16a34a",
                        "&:hover": { backgroundColor: "#f0fdf4", borderColor: "#16a34a" },
                      }}
                    >
                      Allow for Session
                    </AiaButton>
                    <AiaButton
                      size="small"
                      variant="outlined"
                      onClick={() => handlePermissionDecision("deny")}
                      startIcon={<CloseRoundedIcon sx={{ fontSize: 16 }} />}
                      sx={{
                        textTransform: "none",
                        borderRadius: "999px",
                        borderColor: "#f87171",
                        color: "#dc2626",
                        "&:hover": { backgroundColor: "#fef2f2", borderColor: "#dc2626" },
                      }}
                    >
                      Deny
                    </AiaButton>
                    <AiaButton
                      size="small"
                      variant="text"
                      onClick={() => handlePermissionDecision("cancel")}
                      sx={{ textTransform: "none", color: "#64748b" }}
                    >
                      Cancel
                    </AiaButton>
                  </AiaStack>
                </AiaStack>
              </AiaPaper>
            )}

            {/* CoCo Error Display */}
            {cocoState.error && (
              <AiaPaper
                elevation={0}
                sx={{
                  p: 1.5,
                  borderRadius: 2,
                  border: "1px solid #fecaca",
                  backgroundColor: "#fef2f2",
                }}
              >
                <AiaStack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <WarningAmberRoundedIcon sx={{ fontSize: 18, color: "#dc2626" }} />
                  <AiaText sx={{ fontSize: 13, color: "#991b1b" }}>{cocoState.error}</AiaText>
                </AiaStack>
              </AiaPaper>
            )}

            {/* CoCo connecting indicator */}
            {cocoState.isConnecting && (
              <AiaStack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                <AiaAvatar sx={{ bgcolor: '#7c3aed', width: 28, height: 28 }}>
                  <BoltIcon sx={{ fontSize: 16 }} />
                </AiaAvatar>
                <AiaPaper
                  elevation={0}
                  sx={{
                    px: 1.5,
                    py: 1.25,
                    borderRadius: "0 12px 12px 12px",
                    border: "1px solid #c4b5fd",
                    backgroundColor: "#faf5ff",
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                  }}
                >
                  <AiaCircularProgress size={14} thickness={5} sx={{ color: "#7c3aed" }} />
                  <AiaText variant="body1" sx={{ color: "#5b21b6" }}>
                    Connecting to CoCo...
                  </AiaText>
                </AiaPaper>
              </AiaStack>
            )}
          </>
        ) : (
          /* Standard Mode Messages */
          visibleStandardChatMessages.map((message, index) => {
            const isAssistant = message.role === "assistant";
            const messageId = message.id ?? `${message.role}-${index}-${message.content.slice(0, 24)}`;
            const isWelcome =
              isAssistant
              && (
                message.id === "sttm-assistant-welcome"
                || message.content.includes(
                  "I can use the selected source and target semantics",
                )
              );
            const traceSteps = message.traceSteps ?? [];
            const isTraceExpanded = message.isStreaming || !!expandedTraces[messageId];
            return (
              <AiaStack
                key={messageId}
                direction="row"
                spacing={1.5}
                sx={{
                  justifyContent: isAssistant ? "flex-start" : "flex-end",
                  ...(isWelcome
                    ? {
                        width: "100%",
                        flex: 1,
                        minHeight: "calc(100vh - 340px)",
                        alignItems: "center",
                      }
                    : {}),
                }}
              >
                {isAssistant && !isWelcome ? (
                  <AiaAvatar sx={{ bgcolor: 'var(--aia-assitant-header-color)', width: 28, height: 28 }}>
                    <SmartToyIcon sx={{ fontSize: 16 }} />
                  </AiaAvatar>
                ) : null}

                <AiaPaper
                  elevation={0}
                  sx={{
                    p: 1.5,
                    borderRadius: isAssistant ? "0 12px 12px 12px" : "12px 0 12px 12px",
                    border: "1px solid #e2e8f0",
                    maxWidth: expanded ? "92%" : "85%",
                    minWidth: 0,
                    overflow: "hidden",
                    backgroundColor: isAssistant ? "#ffffff" : "#f8fafc",
                    ...(isWelcome
                      ? {
                          width: "100%",
                          maxWidth: "100%",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "stretch",
                          justifyContent: "center",
                          border: "none",
                          borderRadius: 0,
                          px: expanded ? 8 : 6,
                          py: 3,
                          backgroundColor: "transparent",
                        }
                      : {}),
                  }}
                >
                  <AiaBox sx={{ minWidth: 0, maxWidth: "100%", fontSize: 14, overflowX: "hidden" }}>
                    {isWelcome ? (
                      <AiaBox sx={{ width: "100%", maxWidth: 520, mb: 2.5 }}>
                        <AiaText
                          sx={{
                            fontSize: expanded ? 58 : 50,
                            lineHeight: 1.04,
                            fontWeight: 500,
                            color: "#0f172a",
                            letterSpacing: "-0.035em",
                          }}
                        >
                          Hi{assistantFirstName ? ` ${assistantFirstName}` : ""},
                        </AiaText>
                        <AiaText
                          sx={{
                            mt: 0.5,
                            fontSize: expanded ? 58 : 50,
                            lineHeight: 1.04,
                            fontWeight: 400,
                            color: "#64748b",
                            letterSpacing: "-0.035em",
                          }}
                        >
                          How can I help?
                        </AiaText>
                        {message.content.trim() ? (
                          <AiaText sx={{ mt: 2, fontSize: 13.5, color: "#475569", lineHeight: 1.6 }}>
                            {message.content}
                          </AiaText>
                        ) : null}
                      </AiaBox>
                    ) : (
                      <MessageContent content={message.content} formatPlainText={isAssistant} />
                    )}
                    {message.streamingSql ? (
                      <MessageContent
                        content={`\`\`\`sql\n${message.streamingSql}\n\`\`\``}
                        formatPlainText={false}
                      />
                    ) : null}
                  </AiaBox>
                  {traceSteps.length ? (
                    <TracePanel
                      messageId={messageId}
                      steps={traceSteps}
                      expanded={isTraceExpanded}
                      onToggle={toggleTrace}
                    />
                  ) : null}
                  {message.isStreaming ? (
                    <StreamingProgressIndicator
                      phase={message.statusPhase}
                      message={message.statusMessage}
                      elapsedSeconds={message.elapsedSeconds}
                    />
                  ) : null}
                  {message.options?.length ? (
                    <AiaStack
                      direction={isWelcome ? "column" : "row"}
                      spacing={0.75}
                      useFlexGap
                      sx={{
                        mt: 1.25,
                        flexWrap: "wrap",
                        width: "100%",
                        maxWidth: isWelcome ? 460 : "100%",
                        mx: 0,
                        minWidth: 0,
                        overflow: "hidden",
                      }}
                    >
                      {message.options.map((option) => (
                        <AiaButton
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
                            fontSize: isWelcome ? 13 : 12,
                            lineHeight: 1.4,
                            minWidth: 0,
                            maxWidth: "100%",
                            height: "auto",
                            flex: isWelcome ? "1 1 100%" : "0 1 auto",
                            width: isWelcome ? "100%" : "auto",
                            whiteSpace: "normal",
                            overflowWrap: "anywhere",
                            wordBreak: "break-word",
                            textAlign: "left",
                            justifyContent: "flex-start",
                            py: isWelcome ? 1.15 : 0.75,
                            px: isWelcome ? 1.75 : undefined,
                            "&:hover": {
                              borderColor: "#93c5fd",
                              backgroundColor: "#eff6ff",
                            },
                          }}
                        >
                          {option}
                        </AiaButton>
                      ))}
                    </AiaStack>
                  ) : null}
                </AiaPaper>
              </AiaStack>
            );
          })
        )}

        {/* Standard mode loading indicator - only show when not in CoCo mode */}
        {!cocoState.isActive && chatLoading && !hasStreamingMessage ? (
          <AiaStack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <AiaAvatar sx={{ bgcolor: "#000000", width: 28, height: 28 }}>
              <SmartToyIcon sx={{ fontSize: 16 }} />
            </AiaAvatar>
            <AiaPaper
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
              <AiaCircularProgress size={14} thickness={5} sx={{ color: "#2563eb" }} />
              <AiaText variant="body1" sx={{ color: "#475569" }}>
                Thinking…
              </AiaText>
            </AiaPaper>
          </AiaStack>
        ) : null}

        {activeReview ? (
          <AiaPaper
            elevation={0}
            sx={{
              p: 1.5,
              borderRadius: "12px",
              border: "1px solid #fde68a",
              backgroundColor: "#fffbeb",
              display: "grid",
              gap: 1,
            }}
          >
            <AiaBox>
              <AiaText sx={{ fontSize: 13, fontWeight: 800, color: "#92400e" }}>
                {isTransformationReview
                  ? "Review AI transformation suggestion"
                  : "Review AI mapping suggestion"}
              </AiaText>
              <AiaText sx={{ fontSize: 12, color: "#475569", mt: 0.35 }}>
                {activeReview.targetColumn} · {Math.round(activeReview.confidenceScore * 100)}% confidence
              </AiaText>
            </AiaBox>
            <AiaBox sx={{ display: "grid", gap: 0.75 }}>
              <AiaText sx={{ fontSize: 12.5, color: "#0f172a" }}>
                <strong>Suggested source:</strong> {activeReview.sourceAttributes.join(", ") || "No confident source found"}
              </AiaText>
              {activeReview.preprocessingRule ? (
                <AiaBox
                  component="pre"
                  sx={{
                    m: 0,
                    px: 1.25,
                    py: 1,
                    borderRadius: 1.5,
                    backgroundColor: "#fff7ed",
                    border: "1px solid #fed7aa",
                    color: "#7c2d12",
                    fontSize: 12,
                    whiteSpace: "pre-wrap",
                    overflowX: "auto",
                  }}
                >
                  <strong>Suggested SQL rule:</strong>
                  {"\n"}
                  {activeReview.preprocessingRule}
                </AiaBox>
              ) : null}
              {activeReview.preprocessingNlRule ? (
                <AiaText sx={{ fontSize: 12.5, color: "#0f172a" }}>
                  <strong>Why:</strong> {activeReview.preprocessingNlRule}
                </AiaText>
              ) : null}
              {activeReview.confidenceReason ? (
                <AiaText sx={{ fontSize: 12.5, color: "#475569", lineHeight: 1.6 }}>
                  {activeReview.confidenceReason}
                </AiaText>
              ) : null}
              {!activeReview.confidenceReason && activeReview.unmatchedReason ? (
                <AiaText sx={{ fontSize: 12.5, color: "#b45309", lineHeight: 1.6 }}>
                  {activeReview.unmatchedReason}
                </AiaText>
              ) : null}
              {activeReview.candidateSourceAttributes.length > 0 ? (
                <AiaText sx={{ fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>
                  Alternatives: {activeReview.candidateSourceAttributes.join(", ")}
                </AiaText>
              ) : null}
            </AiaBox>
            <AiaStack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
              <AiaButton
                size="small"
                variant="contained"
                onClick={applyPendingAiMappingReview}
                sx={{
                  textTransform: "none",
                  borderRadius: "999px",
                  boxShadow: "none",
                  backgroundColor: "#1d4ed8",
                  "&:hover": { backgroundColor: "#1e40af", boxShadow: "none" },
                }}
              >
                Apply Changes
              </AiaButton>
              <AiaButton
                size="small"
                variant="outlined"
                onClick={() =>
                  setDraft(
                    isTransformationReview
                      ? `Revise the transformation rule for ${activeReview.targetColumn}. Use these notes: `
                      : `Revise the mapping for ${activeReview.targetColumn}. Use these notes: `,
                  )
                }
                sx={{
                  textTransform: "none",
                  borderRadius: "999px",
                }}
              >
                Make Further Changes
              </AiaButton>
              <AiaButton
                size="small"
                variant="text"
                onClick={skipPendingAiMappingReview}
                sx={{ textTransform: "none", color: "#64748b" }}
              >
                Dismiss
              </AiaButton>
            </AiaStack>
          </AiaPaper>
        ) : null}

        {pendingDerivedSourceDraft ? (
          <AiaPaper
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
            <AiaBox>
              <AiaText sx={{ fontSize: 13, fontWeight: 800, color: "#1d4ed8" }}>
                Analyst-generated derived SQL is ready
              </AiaText>
              <AiaText sx={{ fontSize: 12, color: "#334155", mt: 0.25 }}>
                Open it in the derived-source builder to validate, preview, and save it through the existing flow.
              </AiaText>
            </AiaBox>
            <AiaStack direction="row" spacing={1}>
              <AiaButton
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
              </AiaButton>
              <AiaButton
                size="small"
                variant="text"
                onClick={dismissPendingDerivedSourceDraft}
                sx={{ textTransform: "none", color: "#475569" }}
              >
                Dismiss
              </AiaButton>
            </AiaStack>
          </AiaPaper>
        ) : null}
          </>
        ) : null}
      </AiaBox>

      <AiaBox sx={{ p: 1, backgroundColor: "#ffffff", borderTop: "1px solid #e2e8f0" }}>
        {/* CoCo Mode indicator badge above input */}
        {cocoState.isActive && (
          <AiaStack
            direction="row"
            spacing={0.75}
            sx={{ px: 1, pb: 0.5, alignItems: "center" }}
          >
            <BoltIcon sx={{ fontSize: 14, color: "#7c3aed" }} />
            <AiaText sx={{ fontSize: 11, color: "#7c3aed", fontWeight: 600 }}>
              CoCo Mode Active
            </AiaText>
            {cocoState.isConnected && (
              <AiaBox
                sx={{
                  px: 0.5,
                  py: 0.1,
                  borderRadius: "4px",
                  backgroundColor: "#dcfce7",
                  color: "#16a34a",
                  fontSize: 10,
                  fontWeight: 600,
                }}
              >
                Connected
              </AiaBox>
            )}
          </AiaStack>
        )}
        {variant === "sidebar" ? (
          <AiChatComposer
            value={draft}
            onChange={setDraft}
            onSend={handleSend}
            disabled={cocoState.isActive ? cocoState.isConnecting : false}
            loading={cocoState.isActive ? Boolean(cocoState.streamingText) : chatLoading}
          />
        ) : (
        <AiaPaper
          elevation={0}
          sx={{
            px: 1.5,
            py: 0.5,
            display: "flex",
            alignItems: "center",
            borderRadius: "16px",
            backgroundColor: cocoState.isActive ? "#faf5ff" : "#f8fafc",
            border: cocoState.isActive ? "1px solid #c4b5fd" : "1px solid #e2e8f0",
            minHeight: 48,
          }}
        >
          <AiaInput
            appearance="bare"
            value={draft}
            onChange={setDraft}
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
              "& .MuiInputBase-input::placeholder": {
                opacity: 0.7,
                color: cocoState.isActive ? "#7c3aed" : "#64748b",
              },
            }}
            placeholder={cocoState.isActive ? "Ask CoCo deep agent..." : "Ask STTM AI..."}
            disabled={
              cocoState.isActive
                ? cocoState.isConnecting || !!cocoState.streamingText
                : chatLoading
            }
          />
          <AiaIconButton
            size="small"
            onClick={handleSend}
            disabled={
              !draft.trim() ||
              (cocoState.isActive
                ? cocoState.isConnecting || !!cocoState.streamingText
                : chatLoading)
            }
            sx={{
              p: 0.5,
              color: draft.trim()
                ? cocoState.isActive
                  ? "#7c3aed"
                  : "#ef4444"
                : "#cbd5e1",
              "&:hover": { backgroundColor: "transparent" },
            }}
          >
            <SendIcon sx={{ fontSize: 18 }} />
          </AiaIconButton>
        </AiaPaper>
        )}
      </AiaBox>
    </AiaPaper>
  );
}
