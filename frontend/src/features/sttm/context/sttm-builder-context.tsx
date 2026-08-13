"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { dbService } from "@/services/dbService";
import { preparedContextService } from "@/services/preparedContextService";
import { authService } from "@/services/authService";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  abortPendingEvaluateSignals,
  clearAssistantSignalsForContext,
  evaluateFirRecommendations,
  fetchDatabases,
  fetchSchemas,
  fetchTables,
  fetchAttributes,
  fetchDerivedSources,
  fetchRelationships,
  runAutoMap as runAutoMapThunk,
  sendChatMessage as sendChatMessageThunk,
  submitChatFeedback as submitChatFeedbackThunk,
  respondToAssistantSignal as respondToAssistantSignalThunk,
  toggleSource as toggleSourceAction,
  selectTarget as selectTargetAction,
  selectAllSources as selectAllSourcesAction,
  clearSources as clearSourcesAction,
  clearTargets as clearTargetsAction,
  setDrivingTable as setDrivingTableAction,
  setRelationships as setRelationshipsAction,
  approveRelationshipCandidate as approveRelationshipCandidateAction,
  rejectRelationshipCandidate as rejectRelationshipCandidateAction,
  setSourceFilterConditions as setSourceFilterConditionsAction,
  addDerivedSource as addDerivedSourceAction,
  updateDerivedSource as updateDerivedSourceAction,
  removeDerivedSource as removeDerivedSourceAction,
  toggleDerivedSource as toggleDerivedSourceAction,
  openPendingDerivedSourceDraft as openPendingDerivedSourceDraftAction,
  acknowledgePendingDerivedSourceDraft as acknowledgePendingDerivedSourceDraftAction,
  dismissPendingDerivedSourceDraft as dismissPendingDerivedSourceDraftAction,
  resetChatSession as resetChatSessionAction,
  restoreChatSession as restoreChatSessionAction,
  applySemanticRefresh as applySemanticRefreshAction,
  markPreparedWorkspaceContextUpdating,
  applyPreparedWorkspaceContext,
  failPreparedWorkspaceContext,
  initializeMappings as initializeMappingsAction,
  updateMapping as updateMappingAction,
  applyPendingAiMappingReview as applyPendingAiMappingReviewAction,
  skipPendingAiMappingReview as skipPendingAiMappingReviewAction,
  toggleMappingSelection as toggleMappingSelectionAction,
  selectAllMappings as selectAllMappingsAction,
  bulkMarkMapped as bulkMarkMappedAction,
  bulkSetDirect as bulkSetDirectAction,
  setPreProcessModalOpen as setPreProcessModalOpenAction,
  setMappingSql as setMappingSqlAction,
  setMappingPreviewSql as setMappingPreviewSqlAction,
  setMappingSqlVariant as setMappingSqlVariantAction,
  setCompiledMappingResult as setCompiledMappingResultAction,
  applyParsedSqlWorkspace as applyParsedSqlWorkspaceAction,
  updateAssistantPreferences as updateAssistantPreferencesThunk,
  hydrateBuilderSession,
  openSttmFromBackend,
  snapshotFromState,
  preparedWorkspaceSnapshot,
  type PersistedSttmBuilderSession,
} from "@/features/sttm/store/sttm-builder-slice";
import { autosaveSttm } from "@/services/projectService";
import {
  resolveSelectedSourceTables,
  resolveSelectedTargetTable,
} from "@/features/sttm/shared/sttm-selection-utils";
import type {
  DerivedSource,
  RuleGroup,
  SelectionSide,
  TableNode,
  SttmBuilderContextValue as ContextValue,
} from "@/features/sttm/types/sttm.types";
import type { SemanticLevel } from "@/types/api-contract";
import { consumeExplicitNewDraftIntent } from "./sttm-session-intent";

const SttmBuilderContext = createContext<ContextValue | null>(null);
// v7 scopes browser drafts by user + project + mapping + immutable snapshot.
// Saved workspaces always hydrate from the backend; scoped browser state is a
// recovery aid and never outranks a published snapshot.
const STTM_BUILDER_SESSION_BASE_KEY = "sttm-builder-session-v7";

/**
 * Build a storage key scoped by project and STTM IDs.
 * Format: sttm-builder-session-v6::{userId}::{projectId}::{sttmId}
 * Falls back to base key for truly new sessions with no IDs yet.
 */
function getScopedStorageKey(
  userId: string | null,
  projectId: string | null,
  sttmId: string | null,
  snapshotId?: string | null,
): string {
  const owner = userId || "anonymous";
  if (projectId && sttmId) {
    return `${STTM_BUILDER_SESSION_BASE_KEY}::${owner}::${projectId}::${sttmId}::${snapshotId || "draft"}`;
  }
  return `${STTM_BUILDER_SESSION_BASE_KEY}::${owner}::new`;
}

function getActiveWorkspacePointerKey(userId: string | null): string {
  return `${STTM_BUILDER_SESSION_BASE_KEY}::${userId || "anonymous"}::active`;
}

const BROWSER_INLINE_ARTIFACT_LIMIT_BYTES = 32 * 1024;

function keepSmallBrowserArtifact(value: string): string {
  if (!value) return "";
  return new TextEncoder().encode(value).byteLength <= BROWSER_INLINE_ARTIFACT_LIMIT_BYTES
    ? value
    : "";
}

function compactPersistedSessionForBrowser(
  session: PersistedSttmBuilderSession,
): PersistedSttmBuilderSession {
  return {
    ...session,
    // These catalogs are reloadable metadata, not user-authored state.
    sourceDatabases: [],
    targetDatabases: [],
    chatMessages: session.chatMessages.slice(-12).map((message) => ({
      ...message,
      content: message.content.slice(0, 12_000),
      streamingSql: message.streamingSql
        ? keepSmallBrowserArtifact(message.streamingSql)
        : undefined,
      traceSteps: message.traceSteps?.slice(-8),
    })),
    assistantSignals: session.assistantSignals.slice(-20),
    assistantInferences: session.assistantInferences.slice(-20),
    semanticContextItems: null,
    semanticLineage: [],
    semanticDatahubContext: null,
    pendingDerivedSourceDraft: null,
    derivedSources: session.derivedSources.map((source) => ({
      ...source,
      sqlText: source.sqlText ? keepSmallBrowserArtifact(source.sqlText) : undefined,
      semanticProjection: undefined,
      previewRows: undefined,
    })),
    mappingSql: keepSmallBrowserArtifact(session.mappingSql),
    mappingPreviewSql: keepSmallBrowserArtifact(session.mappingPreviewSql),
    compiledMappingSql: keepSmallBrowserArtifact(session.compiledMappingSql),
    compiledMappingPreviewSql: keepSmallBrowserArtifact(
      session.compiledMappingPreviewSql,
    ),
  };
}

function pruneObsoleteWorkspaceDrafts(currentStorageKey: string): void {
  const segments = currentStorageKey.split("::");
  if (segments.length < 5) return;
  const workspacePrefix = `${segments.slice(0, -1).join("::")}::`;
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key && key !== currentStorageKey && key.startsWith(workspacePrefix)) {
      window.localStorage.removeItem(key);
    }
  }
}

function persistBrowserWorkspace(
  storageKey: string,
  session: PersistedSttmBuilderSession,
): void {
  const serialized = JSON.stringify(session);
  try {
    window.localStorage.setItem(storageKey, serialized);
    return;
  } catch {
    // Snapshot IDs change as the workspace evolves. Reclaim superseded
    // recovery copies first, then fall back to a compact handle-rich record.
    pruneObsoleteWorkspaceDrafts(storageKey);
    try {
      window.localStorage.setItem(storageKey, serialized);
      return;
    } catch {
      const compact = compactPersistedSessionForBrowser(session);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(compact));
        return;
      } catch {
        // Backend autosave is authoritative. Keeping a partial or stale local
        // snapshot is worse than requiring a clean restore from the backend.
        window.localStorage.removeItem(storageKey);
      }
    }
  }
}

// Debounce times for different state categories
const CRITICAL_STATE_DEBOUNCE_MS = 1500;   // mappings, relationships, sources/targets
const NON_CRITICAL_STATE_DEBOUNCE_MS = 5000; // chat, semantic context
const SELECTION_METADATA_DEBOUNCE_MS = 750;
const PREPARED_CONTEXT_DEBOUNCE_MS = 750;
const PREPARED_CONTEXT_SESSION_KEY = "sttm-prepared-context-v2";
const PREPARED_CONTEXT_CHANNEL = "sttm-prepared-context-v2";

export function SttmBuilderProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const dispatch = useAppDispatch();
  const state = useAppSelector((s) => s.sttmBuilder);
  const lastAssistantSignalSignature = useRef<string | null>(null);
  const signalEvaluationTimerRef = useRef<number | null>(null);
  const signalEvaluationInFlightRef = useRef(false);
  const queuedAssistantSignalEvaluationRef = useRef<{
    signature: string;
    activityType: string;
  } | null>(null);
  const preparedContextInFlightSignatureRef = useRef<string | null>(null);
  const lastPreparedContextSignatureRef = useRef<string | null>(null);
  const semanticRefreshInFlightSignatureRef = useRef<string | null>(null);
  const lastSemanticRefreshSignatureRef = useRef<string | null>(null);
  const backendHydrationAttemptRef = useRef<string | null>(null);
  const [sessionHydrated, setSessionHydrated] = useState(false);
  // Track last persisted state signatures to avoid redundant writes
  const lastCriticalStateSignatureRef = useRef<string | null>(null);
  const lastNonCriticalStateSignatureRef = useRef<string | null>(null);
  const criticalPersistTimerRef = useRef<number | null>(null);
  const nonCriticalPersistTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
      return;
    }
    const channel = new BroadcastChannel(PREPARED_CONTEXT_CHANNEL);
    channel.onmessage = (event) => {
      const compact = event.data as {
        workspace_context_id?: string;
        snapshot_hash?: string;
      };
      if (
        !compact.workspace_context_id
        || !compact.snapshot_hash
        || (
          compact.snapshot_hash !== state.workspaceContextSnapshotHash
          && compact.snapshot_hash !== state.workspaceContextPendingSnapshotHash
        )
      ) {
        return;
      }
      void preparedContextService.get(compact.workspace_context_id)
        .then((prepared) => {
          dispatch(applyPreparedWorkspaceContext({
            context: prepared,
            snapshotHash: compact.snapshot_hash!,
          }));
        })
        .catch(() => {
          // The other tab may use a different authenticated access scope.
        });
    };
    return () => channel.close();
  }, [
    dispatch,
    state.workspaceContextPendingSnapshotHash,
    state.workspaceContextSnapshotHash,
  ]);
  const attributeHydrationSignatureRef = useRef<string | null>(null);
  const sourceAttributesInFlightRef = useRef<Set<string>>(new Set());
  const targetAttributesInFlightRef = useRef<Set<string>>(new Set());
  const relationshipHydrationSignatureRef = useRef<string | null>(null);
  const selectionMetadataTimerRef = useRef<number | null>(null);
  const semanticPrefetchTimerRef = useRef<number | null>(null);
  const backendAutosaveInFlightRef = useRef(false);
  const lastBackendAutosaveSignatureRef = useRef<string | null>(null);
  const pendingBackendAutosaveRef = useRef<{
    sttmId: string;
    payload: Parameters<typeof autosaveSttm>[1];
  } | null>(null);

  const enqueueBackendAutosave = useCallback((
    sttmId: string,
    payload: Parameters<typeof autosaveSttm>[1],
  ) => {
    // Coalesce rapid UI mutations while preserving write order. Without this,
    // a slower pre-join save can finish after the join save and erase the
    // newest relation graph from the durable snapshot.
    pendingBackendAutosaveRef.current = { sttmId, payload };
    if (backendAutosaveInFlightRef.current) return;
    backendAutosaveInFlightRef.current = true;
    void (async () => {
      while (pendingBackendAutosaveRef.current) {
        const pending = pendingBackendAutosaveRef.current;
        pendingBackendAutosaveRef.current = null;
        try {
          await autosaveSttm(pending.sttmId, pending.payload);
        } catch (error) {
          lastBackendAutosaveSignatureRef.current = null;
          console.warn("Unable to autosave the active STTM workspace.", error);
        }
      }
    })().finally(() => {
      backendAutosaveInFlightRef.current = false;
    });
  }, []);

  const currentAssistantPage = useMemo(() => {
    if (pathname.includes("/summary")) return "summary";
    if (pathname.includes("/mapping")) return "mapping";
    return "builder";
  }, [pathname]);

  const currentAssistantSurface = currentAssistantPage === "mapping" ? "MAPPING" : "SOURCE_SELECTION";

  const isInSttmBuilder = pathname.startsWith("/sttm");
  const isNewSession = pathname === "/sttm/builder/new";

  // Backend-first hydration. The generic ::new cache is read only for a truly
  // new draft. Mapping/summary refreshes recover identity from a tiny pointer
  // and then reload the latest backend snapshot.
  useEffect(() => {
    let cancelled = false;
    const hydrateSession = async () => {
      if (!isInSttmBuilder) {
        setSessionHydrated(true);
        return;
      }
      setSessionHydrated(false);
      let userId: string | null = null;
      try {
        const session = await authService.getSession();
        userId = session?.user_id != null ? String(session.user_id) : null;
      } catch {
        // Authentication errors are handled by the normal database bootstrap.
      }
      if (cancelled) return;
      // Uploads navigate directly to /sttm/builder/new/mapping. Consume the
      // explicit-new marker anywhere under the new-builder route so an old
      // backend workspace pointer cannot hydrate over the uploaded preview.
      const explicitNewDraft =
        pathname.startsWith("/sttm/builder/new") &&
        consumeExplicitNewDraftIntent();
      if (explicitNewDraft) {
        window.localStorage.removeItem(getActiveWorkspacePointerKey(userId));
      }

      // A saved mapping can navigate back to Selection at the same /new route.
      // Preserve that backend identity rather than treating it as a new draft.
      if (state.activeProjectId && state.activeSttmId) {
        if (state.openSttmStatus === "success") {
          setSessionHydrated(true);
          return;
        }
        if (state.openSttmStatus === "loading") return;

        const hydrationKey = `${pathname}:${state.activeProjectId}:${state.activeSttmId}`;
        if (backendHydrationAttemptRef.current !== hydrationKey) {
          backendHydrationAttemptRef.current = hydrationKey;
          try {
            await dispatch(openSttmFromBackend({
              projectId: String(state.activeProjectId),
              sttmId: String(state.activeSttmId),
            })).unwrap();
          } catch (error) {
            console.warn("Unable to refresh the saved STTM workspace.", error);
          }
        }
        if (!cancelled) setSessionHydrated(true);
        return;
      }
      if (state.openSttmStatus === "loading") {
        return;
      }

      if (!explicitNewDraft) {
        try {
          const rawPointer = window.localStorage.getItem(getActiveWorkspacePointerKey(userId));
          const pointer = rawPointer
            ? JSON.parse(rawPointer) as { projectId?: string; sttmId?: string }
            : null;
          if (pointer?.projectId && pointer?.sttmId) {
            const hydrationKey = `${pathname}:${pointer.projectId}:${pointer.sttmId}`;
            backendHydrationAttemptRef.current = hydrationKey;
            await dispatch(openSttmFromBackend({
              projectId: String(pointer.projectId),
              sttmId: String(pointer.sttmId),
            })).unwrap();
            if (!cancelled) setSessionHydrated(true);
            return;
          }
        } catch (error) {
          console.warn("Unable to resume the saved STTM workspace.", error);
        }
      }

      if (isNewSession || explicitNewDraft) {
        try {
          const newSessionKey = getScopedStorageKey(userId, null, null);
          const rawSession = window.localStorage.getItem(newSessionKey);
          if (rawSession) {
            const parsedSession = JSON.parse(rawSession) as PersistedSttmBuilderSession;
            if (!parsedSession.activeProjectId && !parsedSession.activeSttmId) {
              dispatch(hydrateBuilderSession(parsedSession));
            }
          }
        } catch (error) {
          console.warn("Unable to restore the new STTM draft session.", error);
        }
        if (!cancelled) setSessionHydrated(true);
        return;
      }

      if (!cancelled) setSessionHydrated(true);
    };

    void hydrateSession();
    return () => {
      cancelled = true;
    };
  }, [
    dispatch,
    isInSttmBuilder,
    isNewSession,
    pathname,
    state.activeProjectId,
    state.activeSttmId,
    state.openSttmStatus,
  ]);

  // Parallel data fetching - dispatch both thunks simultaneously
  // The thunks themselves check cache freshness and skip if data is < 5 minutes old
  useEffect(() => {
    if (!sessionHydrated || !isInSttmBuilder) {
      return;
    }
    // Dispatch both in parallel - thunks will self-skip if cache is fresh
    void Promise.all([
      dispatch(fetchDatabases()),
      dispatch(fetchDerivedSources()),
    ]);
  }, [dispatch, sessionHydrated, isInSttmBuilder]);

  // Backend snapshots persist selected table/column contracts, but not the
  // transient Redux attribute groups used by Selection and Derived Source UI.
  // Rehydrate only the missing groups when a saved mapping is reopened so a
  // 20+ table workspace does not render every selected relation as "0 cols".
  useEffect(() => {
    if (!sessionHydrated || !isInSttmBuilder || state.openSttmStatus === "loading") {
      return;
    }

    const selectedSourceNames = resolveSelectedSourceTables(state).map(
      (table) => table.qualifiedName,
    );
    const loadedSourceNames = new Set(
      state.sourceAttributeGroups
        .filter((group) => group.columns.length > 0)
        .map((group) => group.qualifiedName),
    );
    const missingSourceNames = selectedSourceNames.filter(
      (qualifiedName) =>
        !loadedSourceNames.has(qualifiedName)
        && !sourceAttributesInFlightRef.current.has(qualifiedName),
    );
    const selectedTarget = resolveSelectedTargetTable(state);
    const targetLoaded = Boolean(
      selectedTarget
      && state.targetAttributeGroup?.qualifiedName === selectedTarget.qualifiedName
      && state.targetAttributeGroup.columns.length > 0,
    );
    const missingTargetNames = selectedTarget && !targetLoaded
      && !targetAttributesInFlightRef.current.has(selectedTarget.qualifiedName)
      ? [selectedTarget.qualifiedName]
      : [];

    const relationshipSignature = [...selectedSourceNames].sort().join("|");
    const attributesComplete = !missingSourceNames.length && !missingTargetNames.length;
    const relationshipsComplete =
      selectedSourceNames.length < 2
      || relationshipHydrationSignatureRef.current === relationshipSignature;

    if (attributesComplete && relationshipsComplete) {
      attributeHydrationSignatureRef.current = null;
      return;
    }

    const signature = JSON.stringify({
      source: [...missingSourceNames].sort(),
      target: missingTargetNames,
    });
    if (
      attributeHydrationSignatureRef.current === signature
      && relationshipsComplete
    ) {
      return;
    }
    attributeHydrationSignatureRef.current = signature;
    if (selectionMetadataTimerRef.current !== null) {
      window.clearTimeout(selectionMetadataTimerRef.current);
    }
    selectionMetadataTimerRef.current = window.setTimeout(() => {
      selectionMetadataTimerRef.current = null;
      const requests: Promise<unknown>[] = [];
      if (missingSourceNames.length) {
        missingSourceNames.forEach((name) => sourceAttributesInFlightRef.current.add(name));
        requests.push(dispatch(
          fetchAttributes({ qualifiedNames: missingSourceNames, side: "source" }),
        ).finally(() => {
          missingSourceNames.forEach((name) => sourceAttributesInFlightRef.current.delete(name));
        }));
      }
      if (missingTargetNames.length) {
        missingTargetNames.forEach((name) => targetAttributesInFlightRef.current.add(name));
        requests.push(dispatch(
          fetchAttributes({ qualifiedNames: missingTargetNames, side: "target" }),
        ).finally(() => {
          missingTargetNames.forEach((name) => targetAttributesInFlightRef.current.delete(name));
        }));
      }
      if (selectedSourceNames.length >= 2 && !relationshipsComplete) {
        relationshipHydrationSignatureRef.current = relationshipSignature;
        requests.push(dispatch(fetchRelationships()));
      }
      void Promise.all(requests).finally(() => {
        attributeHydrationSignatureRef.current = null;
      });
    }, SELECTION_METADATA_DEBOUNCE_MS);

    return () => {
      if (selectionMetadataTimerRef.current !== null) {
        window.clearTimeout(selectionMetadataTimerRef.current);
        selectionMetadataTimerRef.current = null;
      }
    };
  }, [
    dispatch,
    isInSttmBuilder,
    sessionHydrated,
    state.openSttmStatus,
    state.sourceAttributeGroups,
    state.sources,
    state.targetAttributeGroup,
    state.targets,
  ]);

  // Prepare one immutable semantic/FIR/precedent handle after the exact
  // workspace selection settles. Full YAML and FIR evidence stay server-side.
  useEffect(() => {
    if (
      !sessionHydrated
      || !isInSttmBuilder
      || state.openSttmStatus === "loading"
      || state.loadState.attributes === "loading"
      || state.loadState.relationships === "loading"
    ) {
      return;
    }
    const selectedSourceTables = resolveSelectedSourceTables(state);
    const selectedDerivedSources = state.derivedSources
      .filter((source) => source.isSelected)
      .map((source) => source.id);
    if (!selectedSourceTables.length && !selectedDerivedSources.length) return;
    const rawWorkspace = snapshotFromState(state, "assistant.requested", {
      page: state.targetAttributeGroup ? "mapping" : "builder",
      surface: state.targetAttributeGroup ? "MAPPING" : "SOURCE_SELECTION",
    }) as unknown as Record<string, unknown>;
    const {
      workspace,
      dependencyHash: snapshotHash,
    } = preparedWorkspaceSnapshot(rawWorkspace);
    if (!snapshotHash) return;
    const payload = {
      workspace,
      workspace_context_id: state.workspaceContextId,
      workspace_context_hash: state.workspaceContextHash,
      semantic_bundle_id: state.semanticBundleId,
      semantic_bundle_hash: state.semanticBundleHash,
      learning_context_id: state.learningContextId,
      learning_context_hash: state.learningContextHash,
      force: false,
    };
    const signature = snapshotHash;
    if (
      lastPreparedContextSignatureRef.current === signature
      || preparedContextInFlightSignatureRef.current === signature
    ) {
      return;
    }
    dispatch(markPreparedWorkspaceContextUpdating({ snapshotHash }));
    if (semanticPrefetchTimerRef.current !== null) {
      window.clearTimeout(semanticPrefetchTimerRef.current);
    }
    semanticPrefetchTimerRef.current = window.setTimeout(() => {
      semanticPrefetchTimerRef.current = null;
      preparedContextInFlightSignatureRef.current = signature;
      void preparedContextService.prepare(payload)
        .then((prepared) => {
          dispatch(applyPreparedWorkspaceContext({
            context: prepared,
            snapshotHash,
          }));
          lastPreparedContextSignatureRef.current = signature;
          const compact = {
            workspace_context_id: prepared.workspace_context_id,
            workspace_context_hash: prepared.workspace_context_hash,
            semantic_bundle_id: prepared.semantic_bundle_id ?? null,
            semantic_bundle_hash: prepared.semantic_bundle_hash ?? null,
            learning_context_id: prepared.learning_context_id ?? null,
            learning_context_hash: prepared.learning_context_hash ?? null,
            snapshot_hash: snapshotHash,
            status: prepared.status,
          };
          window.sessionStorage.setItem(
            PREPARED_CONTEXT_SESSION_KEY,
            JSON.stringify(compact),
          );
          if (typeof BroadcastChannel !== "undefined") {
            const channel = new BroadcastChannel(PREPARED_CONTEXT_CHANNEL);
            channel.postMessage(compact);
            channel.close();
          }
        })
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : "AI context preparation failed.";
          dispatch(failPreparedWorkspaceContext({ snapshotHash, error: message }));
          console.warn("Prepared workspace context did not complete.", error);
        })
        .finally(() => {
          if (preparedContextInFlightSignatureRef.current === signature) {
            preparedContextInFlightSignatureRef.current = null;
          }
        });
    }, PREPARED_CONTEXT_DEBOUNCE_MS);
    return () => {
      if (semanticPrefetchTimerRef.current !== null) {
        window.clearTimeout(semanticPrefetchTimerRef.current);
        semanticPrefetchTimerRef.current = null;
      }
    };
  }, [
    dispatch,
    isInSttmBuilder,
    sessionHydrated,
    state.derivedSources,
    state.loadState.attributes,
    state.loadState.relationships,
    state.openSttmStatus,
    state.relationships,
    state.mappingIntent,
    state.mappings,
    state.selectedMappingIds,
    state.drivingTableId,
    state.semanticBundleId,
    state.semanticBundleHash,
    state.learningContextId,
    state.learningContextHash,
    state.workspaceContextId,
    state.workspaceContextHash,
    state.sourceDatabases,
    state.sources,
    state.targetDatabases,
    state.targets,
  ]);

  const persistedBuilderSession = useMemo<PersistedSttmBuilderSession>(() => ({
    sourceDatabases: state.sourceDatabases,
    targetDatabases: state.targetDatabases,
    cacheMetadata: state.cacheMetadata,
    sources: state.sources,
    targets: state.targets,
    sourceInfo: state.sourceInfo,
    targetInfo: state.targetInfo,
    sourceAttributeGroups: state.sourceAttributeGroups,
    targetAttributeGroup: state.targetAttributeGroup,
    mappingSuggestions: state.mappingSuggestions,
    chatMessages: state.chatMessages,
    assistantSignals: state.assistantSignals,
    assistantInferences: state.assistantInferences,
    assistantUnreadCount: state.assistantUnreadCount,
    mappingIntent: state.mappingIntent,
    agentThreadId: state.agentThreadId,
    agentLogicalConversationId: state.agentLogicalConversationId,
    agentPhysicalThreadSegment: state.agentPhysicalThreadSegment,
    agentParentMessageId: state.agentParentMessageId,
    semanticBundleId: state.semanticBundleId,
    semanticBundleHash: state.semanticBundleHash,
    learningContextId: state.learningContextId,
    learningContextHash: state.learningContextHash,
    workspaceContextId: state.workspaceContextId,
    workspaceContextHash: state.workspaceContextHash,
    workspaceContextSnapshotHash: state.workspaceContextSnapshotHash,
    workspaceContextPendingSnapshotHash: state.workspaceContextPendingSnapshotHash,
    workspaceContextStatus: state.workspaceContextStatus,
    workspaceContextCacheStatus: state.workspaceContextCacheStatus,
    workspaceContextError: state.workspaceContextError,
    semanticBundleLabel: state.semanticBundleLabel,
    semanticLevel: state.semanticLevel,
    semanticStatus: state.semanticStatus,
    semanticViewName: state.semanticViewName,
    semanticContextSummary: state.semanticContextSummary,
    semanticContextItems: state.semanticContextItems,
    semanticLineage: state.semanticLineage,
    semanticDatahubContext: state.semanticDatahubContext,
    datahubStatus: state.datahubStatus,
    pendingDerivedSourceDraft: state.pendingDerivedSourceDraft,
    derivedSourceDraftRequested: state.derivedSourceDraftRequested,
    drivingTableId: state.drivingTableId,
    relationships: state.relationships,
    relationshipCandidates: state.relationshipCandidates,
    derivedSources: state.derivedSources,
    sourceFilterSql: state.sourceFilterSql,
    sourceFilterGroups: state.sourceFilterGroups,
    sourceQuerySql: state.sourceQuerySql,
    sourceGroupBySql: state.sourceGroupBySql,
    sourceOrderBySql: state.sourceOrderBySql,
    mappings: state.mappings,
    selectedMappingIds: state.selectedMappingIds,
    mappingSql: state.mappingSql,
    mappingPreviewSql: state.mappingPreviewSql,
    mappingSqlVariant: state.mappingSqlVariant,
    compiledMappingSql: state.compiledMappingSql,
    compiledMappingPreviewSql: state.compiledMappingPreviewSql,
    compiledMappingContextHash: state.compiledMappingContextHash,
    isPreProcessModalOpen: state.isPreProcessModalOpen,
    activeMappingId: state.activeMappingId,
    pendingAiMappingReviews: state.pendingAiMappingReviews,
    activeSttmId: state.activeSttmId,
    activeProjectId: state.activeProjectId,
    activeSttmName: state.activeSttmName,
    activeProjectName: state.activeProjectName,
    activeSnapshotId: state.activeSnapshotId,
    sessionSavedAt: new Date().toISOString(),
  }), [state]);
  const latestStateRef = useRef(state);
  const latestPersistedSessionRef = useRef(persistedBuilderSession);
  const latestAssistantPageRef = useRef(currentAssistantPage);
  const latestAssistantSurfaceRef = useRef(currentAssistantSurface);
  const latestCriticalSignatureRef = useRef("");
  latestStateRef.current = state;
  latestPersistedSessionRef.current = persistedBuilderSession;
  latestAssistantPageRef.current = currentAssistantPage;
  latestAssistantSurfaceRef.current = currentAssistantSurface;

  // Compute signatures for critical and non-critical state to detect changes
  const criticalStateSignature = useMemo(() => {
    return JSON.stringify({
      sourceDatabases: state.sourceDatabases,
      targetDatabases: state.targetDatabases,
      sources: state.sources,
      targets: state.targets,
      sourceInfo: state.sourceInfo,
      targetInfo: state.targetInfo,
      sourceAttributeGroups: state.sourceAttributeGroups,
      targetAttributeGroup: state.targetAttributeGroup,
      mappings: state.mappings,
      mappingSql: state.mappingSql,
      mappingPreviewSql: state.mappingPreviewSql,
      mappingSqlVariant: state.mappingSqlVariant,
      compiledMappingSql: state.compiledMappingSql,
      compiledMappingPreviewSql: state.compiledMappingPreviewSql,
      compiledMappingContextHash: state.compiledMappingContextHash,
      mappingSuggestions: state.mappingSuggestions,
      drivingTableId: state.drivingTableId,
      relationships: state.relationships,
      derivedSources: state.derivedSources,
      selectedMappingIds: state.selectedMappingIds,
      sourceFilterSql: state.sourceFilterSql,
      sourceFilterGroups: state.sourceFilterGroups,
      sourceQuerySql: state.sourceQuerySql,
      sourceGroupBySql: state.sourceGroupBySql,
      sourceOrderBySql: state.sourceOrderBySql,
      cacheMetadata: state.cacheMetadata,
    });
  }, [
    state.sourceDatabases,
    state.targetDatabases,
    state.sources,
    state.targets,
    state.sourceInfo,
    state.targetInfo,
    state.sourceAttributeGroups,
    state.targetAttributeGroup,
    state.mappings,
    state.mappingSql,
    state.mappingPreviewSql,
    state.mappingSqlVariant,
    state.compiledMappingSql,
    state.compiledMappingPreviewSql,
    state.compiledMappingContextHash,
    state.mappingSuggestions,
    state.drivingTableId,
    state.relationships,
    state.derivedSources,
    state.selectedMappingIds,
    state.sourceFilterSql,
    state.sourceFilterGroups,
    state.sourceQuerySql,
    state.sourceGroupBySql,
    state.sourceOrderBySql,
    state.cacheMetadata,
  ]);
  latestCriticalSignatureRef.current = criticalStateSignature;

  const nonCriticalStateSignature = useMemo(() => {
    return JSON.stringify({
      chatMessages: state.chatMessages,
      assistantSignals: state.assistantSignals,
      assistantInferences: state.assistantInferences,
      assistantUnreadCount: state.assistantUnreadCount,
      semanticBundleId: state.semanticBundleId,
      semanticBundleLabel: state.semanticBundleLabel,
      semanticLevel: state.semanticLevel,
      semanticStatus: state.semanticStatus,
      semanticViewName: state.semanticViewName,
      semanticContextSummary: state.semanticContextSummary,
      semanticContextItems: state.semanticContextItems,
      semanticLineage: state.semanticLineage,
      semanticDatahubContext: state.semanticDatahubContext,
      datahubStatus: state.datahubStatus,
    });
  }, [
    state.chatMessages,
    state.assistantSignals,
    state.assistantInferences,
    state.assistantUnreadCount,
    state.semanticBundleId,
    state.semanticBundleLabel,
    state.semanticLevel,
    state.semanticStatus,
    state.semanticViewName,
    state.semanticContextSummary,
    state.semanticContextItems,
    state.semanticLineage,
    state.semanticDatahubContext,
    state.datahubStatus,
  ]);

  // Persist full state to localStorage with scoped key
  const persistState = useCallback((persistBackend = false) => {
    try {
      const latestState = latestStateRef.current;
      const storageKey = getScopedStorageKey(
        latestState.session?.user_id != null ? String(latestState.session.user_id) : null,
        latestState.activeProjectId,
        latestState.activeSttmId,
        latestState.activeSnapshotId,
      );
      persistBrowserWorkspace(storageKey, latestPersistedSessionRef.current);
      if (latestState.activeProjectId && latestState.activeSttmId) {
        window.localStorage.setItem(
          getActiveWorkspacePointerKey(
            latestState.session?.user_id != null ? String(latestState.session.user_id) : null,
          ),
          JSON.stringify({
            projectId: latestState.activeProjectId,
            sttmId: latestState.activeSttmId,
            snapshotId: latestState.activeSnapshotId,
          }),
        );
        if (
          persistBackend
          && latestCriticalSignatureRef.current !== lastBackendAutosaveSignatureRef.current
        ) {
          lastBackendAutosaveSignatureRef.current = latestCriticalSignatureRef.current;
          const workspaceSnapshot = snapshotFromState(latestState, "workspace.autosaved", {
            page: latestAssistantPageRef.current,
            surface: latestAssistantSurfaceRef.current,
            milestone: "workspace.autosaved",
          });
          enqueueBackendAutosave(latestState.activeSttmId, {
            workspace_snapshot: workspaceSnapshot as unknown as Record<string, unknown>,
            action: "workspace.autosaved",
            session_id: latestState.session?.user_id != null ? String(latestState.session.user_id) : null,
            thread_id: latestState.agentThreadId,
            semantic_bundle_id: latestState.semanticBundleId,
            semantic_bundle_hash:
              typeof latestState.semanticContextSummary?.bundle_hash === "string"
                ? latestState.semanticContextSummary.bundle_hash
                : null,
          });
        }
      }
    } catch (error) {
      console.warn("Unable to persist STTM builder draft session.", error);
    }
  }, [enqueueBackendAutosave]);

  const flushWorkspace = useCallback(async () => {
    persistState(true);
    while (
      pendingBackendAutosaveRef.current
      || backendAutosaveInFlightRef.current
    ) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
    }
  }, [persistState]);

  const getWorkspaceSnapshot = useCallback(() => (
    snapshotFromState(latestStateRef.current, "recommendation.preview", {
      page: latestAssistantPageRef.current,
      surface: latestAssistantSurfaceRef.current,
      milestone: "mapping",
    }) as unknown as Record<string, unknown>
  ), []);

  const previousWorkflowPathRef = useRef(pathname);
  useEffect(() => {
    if (
      previousWorkflowPathRef.current !== pathname
      && sessionHydrated
      && isInSttmBuilder
    ) {
      // Route changes cancel debounce timers, so capture the newest state
      // before the old workflow stage unmounts.
      persistState(true);
    }
    previousWorkflowPathRef.current = pathname;
  }, [isInSttmBuilder, pathname, persistState, sessionHydrated]);

  useEffect(() => {
    if (!sessionHydrated || !isInSttmBuilder) return;
    const flushHiddenWorkspace = () => {
      if (document.visibilityState === "hidden") {
        persistState(true);
      }
    };
    const flushPage = () => persistState(true);
    document.addEventListener("visibilitychange", flushHiddenWorkspace);
    window.addEventListener("pagehide", flushPage);
    return () => {
      document.removeEventListener("visibilitychange", flushHiddenWorkspace);
      window.removeEventListener("pagehide", flushPage);
    };
  }, [isInSttmBuilder, persistState, sessionHydrated]);

  useEffect(() => {
    if (!sessionHydrated || !isInSttmBuilder) return;
    const flushForExplicitAction = () => {
      void flushWorkspace();
    };
    const events = [
      "sttm:explicit-save",
      "sttm:run-validation",
      "sttm:before-publish",
    ];
    events.forEach((event) => window.addEventListener(event, flushForExplicitAction));
    return () => {
      events.forEach((event) => window.removeEventListener(event, flushForExplicitAction));
    };
  }, [flushWorkspace, isInSttmBuilder, sessionHydrated]);

  // Critical state persistence (1.5s backend debounce)
  useEffect(() => {
    if (!sessionHydrated || !isInSttmBuilder || state.openSttmStatus === "loading") {
      return;
    }
    // Skip if signature hasn't changed
    if (criticalStateSignature === lastCriticalStateSignatureRef.current) {
      return;
    }
    lastCriticalStateSignatureRef.current = criticalStateSignature;

    if (criticalPersistTimerRef.current !== null) {
      window.clearTimeout(criticalPersistTimerRef.current);
    }
    criticalPersistTimerRef.current = window.setTimeout(() => {
      persistState(true);
      criticalPersistTimerRef.current = null;
    }, CRITICAL_STATE_DEBOUNCE_MS);

    return () => {
      if (criticalPersistTimerRef.current !== null) {
        window.clearTimeout(criticalPersistTimerRef.current);
        criticalPersistTimerRef.current = null;
      }
    };
  }, [criticalStateSignature, sessionHydrated, persistState, isInSttmBuilder, state.openSttmStatus]);

  // Non-critical state persistence (5s debounce)
  useEffect(() => {
    if (!sessionHydrated || !isInSttmBuilder || state.openSttmStatus === "loading") {
      return;
    }
    // Skip if signature hasn't changed
    if (nonCriticalStateSignature === lastNonCriticalStateSignatureRef.current) {
      return;
    }
    lastNonCriticalStateSignatureRef.current = nonCriticalStateSignature;

    if (nonCriticalPersistTimerRef.current !== null) {
      window.clearTimeout(nonCriticalPersistTimerRef.current);
    }
    nonCriticalPersistTimerRef.current = window.setTimeout(() => {
      persistState(false);
      nonCriticalPersistTimerRef.current = null;
    }, NON_CRITICAL_STATE_DEBOUNCE_MS);

    return () => {
      if (nonCriticalPersistTimerRef.current !== null) {
        window.clearTimeout(nonCriticalPersistTimerRef.current);
        nonCriticalPersistTimerRef.current = null;
      }
    };
  }, [nonCriticalStateSignature, sessionHydrated, persistState, isInSttmBuilder, state.openSttmStatus]);

  const assistantSignalSignature = useMemo(() => {
    const selectedSources = resolveSelectedSourceTables(state)
      .map((table) => table.qualifiedName)
      .sort();
    const selectedDerived = state.derivedSources
      .filter((source) => source.isSelected)
      .map((source) => source.id)
      .sort();
    const selectedTarget = resolveSelectedTargetTable(state)?.qualifiedName ?? null;
    const relationshipSignature = state.relationships
      .map((join) =>
        [
          join.leftTableId ?? "",
          join.rightTableId ?? "",
          join.joinType ?? "INNER",
          (join.conditions ?? [])
            .map((condition) => `${condition.leftColumn ?? ""}${condition.operator ?? "="}${condition.rightColumn ?? ""}`)
            .join("&"),
        ].join("|"),
      )
      .sort();

    return JSON.stringify({
      page: currentAssistantPage,
      surface: currentAssistantSurface,
      selectedSources,
      selectedDerived,
      selectedTarget,
      drivingTableId: state.drivingTableId,
      relationshipSignature,
      selectedMappingCount: state.selectedMappingIds.length,
    });
  }, [
    state.sources,
    state.derivedSources,
    state.targets,
    state.drivingTableId,
    state.relationships,
    state.selectedMappingIds,
    currentAssistantPage,
    currentAssistantSurface,
  ]);

  const buildAssistantActivityType = (previousSignature: string | null) => {
    type SignalSnapshot = {
      selectedSources?: string[];
      selectedDerived?: string[];
      selectedTarget?: string | null;
      relationshipSignature?: string[];
      selectedMappingCount?: number;
    };
    const parseSnapshot = (signature: string | null): SignalSnapshot | null => {
      if (!signature) return null;
      try {
        return JSON.parse(signature) as SignalSnapshot;
      } catch {
        return null;
      }
    };
    const current = parseSnapshot(assistantSignalSignature);
    const previous = parseSnapshot(previousSignature);
    const changed = (left: unknown, right: unknown) => JSON.stringify(left ?? null) !== JSON.stringify(right ?? null);

    // Relationships can be inferred automatically as tables are selected. Classify
    // the user action that actually changed instead of treating any existing join
    // as a new join checkpoint forever.
    if (current && previous) {
      if (changed(current.selectedSources, previous.selectedSources)) {
        return (current.selectedSources?.length ?? 0) > 1 ? "source_set_completed" : "selection_changed";
      }
      if (current.selectedTarget !== previous.selectedTarget) {
        return current.selectedTarget ? "target_selected" : "selection_changed";
      }
      if (changed(current.selectedDerived, previous.selectedDerived)) {
        return (current.selectedDerived?.length ?? 0) > 0 ? "derived_source_selected" : "selection_changed";
      }
      if (changed(current.relationshipSignature, previous.relationshipSignature)) {
        return "join_completed";
      }
      if (current.selectedMappingCount !== previous.selectedMappingCount) {
        return "mapping_context_changed";
      }
    }

    if ((current?.selectedSources?.length ?? 0) > 1) return "source_set_completed";
    if (current?.selectedTarget) return "target_selected";
    if ((current?.selectedDerived?.length ?? 0) > 0) return "derived_source_selected";
    if ((current?.relationshipSignature?.length ?? 0) > 0) return "join_completed";
    return currentAssistantPage === "mapping" ? "mapping_context_changed" : "selection_changed";
  };

  const runAssistantSignalEvaluation = (signature: string, activityType: string) => {
    signalEvaluationInFlightRef.current = true;
    dispatch(clearAssistantSignalsForContext());
    void dispatch(
      evaluateFirRecommendations({
        checkpoint: activityType,
        page: currentAssistantPage,
        surface: currentAssistantSurface,
        scopeType:
          activityType === "target_selected"
            ? "target"
            : activityType.includes("derived_source")
              ? "derived_source"
              : currentAssistantPage === "mapping"
                ? "mapping"
                : "table_set",
        candidateAction: activityType,
      }),
    ).finally(() => {
      signalEvaluationInFlightRef.current = false;
      const queuedEvaluation = queuedAssistantSignalEvaluationRef.current;
      if (!queuedEvaluation || queuedEvaluation.signature === signature) {
        queuedAssistantSignalEvaluationRef.current = null;
        return;
      }
      queuedAssistantSignalEvaluationRef.current = null;
      lastAssistantSignalSignature.current = queuedEvaluation.signature;
      runAssistantSignalEvaluation(queuedEvaluation.signature, queuedEvaluation.activityType);
    });
  };

  useEffect(() => {
    if (
      !sessionHydrated ||
      !isInSttmBuilder ||
      state.openSttmStatus === "loading" ||
      (currentAssistantPage === "mapping" && (!state.activeProjectId || !state.activeSttmId))
    ) {
      abortPendingEvaluateSignals();
      dispatch(clearAssistantSignalsForContext());
      return;
    }
    if (!state.loadState.initial || state.loadState.initial === "loading") {
      return;
    }
    // Source selection starts relationship discovery asynchronously. Evaluate
    // after it settles so one user action produces one complete checkpoint.
    if (state.loadState.relationships === "loading") {
      return;
    }
    if (!state.assistantPreferences.feedback_enabled && !state.assistantPreferences.recommendations_enabled) {
      return;
    }
    const hasSignalContext =
      state.sources.some((table) => table.isSelected) ||
      state.derivedSources.some((source) => source.isSelected) ||
      state.relationships.length > 0 ||
      !!state.targets.find((table) => table.isSelected) ||
      !!state.targetAttributeGroup ||
      state.selectedMappingIds.length > 0 ||
      state.mappings.length > 0;
    if (!hasSignalContext) {
      if (signalEvaluationTimerRef.current !== null) {
        window.clearTimeout(signalEvaluationTimerRef.current);
        signalEvaluationTimerRef.current = null;
      }
      queuedAssistantSignalEvaluationRef.current = null;
      abortPendingEvaluateSignals();
      lastAssistantSignalSignature.current = assistantSignalSignature;
      dispatch(clearAssistantSignalsForContext());
      return;
    }
    const previousSignature = lastAssistantSignalSignature.current;
    if (assistantSignalSignature === previousSignature) {
      return;
    }
    const activityType = buildAssistantActivityType(previousSignature);
    lastAssistantSignalSignature.current = assistantSignalSignature;
    if (signalEvaluationTimerRef.current !== null) {
      window.clearTimeout(signalEvaluationTimerRef.current);
    }
    signalEvaluationTimerRef.current = window.setTimeout(() => {
      if (signalEvaluationInFlightRef.current) {
        abortPendingEvaluateSignals();
        dispatch(clearAssistantSignalsForContext());
        queuedAssistantSignalEvaluationRef.current = {
          signature: assistantSignalSignature,
          activityType,
        };
        signalEvaluationTimerRef.current = null;
        return;
      }
      runAssistantSignalEvaluation(assistantSignalSignature, activityType);
      signalEvaluationTimerRef.current = null;
    }, 900);
    return () => {
      if (signalEvaluationTimerRef.current !== null) {
        window.clearTimeout(signalEvaluationTimerRef.current);
        signalEvaluationTimerRef.current = null;
      }
    };
  }, [
    assistantSignalSignature,
    dispatch,
    state.assistantPreferences.feedback_enabled,
    state.assistantPreferences.recommendations_enabled,
    state.loadState.initial,
    state.loadState.relationships,
    currentAssistantPage,
    sessionHydrated,
    isInSttmBuilder,
    state.openSttmStatus,
    state.activeProjectId,
    state.activeSttmId,
  ]);

  const refreshPreparedWorkspaceContext = useCallback(async () => {
    const selectedSourceTables = resolveSelectedSourceTables(state);
    const selectedDerivedSources = state.derivedSources
      .filter((source) => source.isSelected)
      .map((source) => source.id);
    if (
      !selectedSourceTables.length
      && !selectedDerivedSources.length
      && !resolveSelectedTargetTable(state)
    ) {
      return;
    }
    const rawWorkspace = snapshotFromState(state, "assistant.requested", {
      page: state.targetAttributeGroup ? "mapping" : "builder",
      surface: state.targetAttributeGroup ? "MAPPING" : "SOURCE_SELECTION",
    }) as unknown as Record<string, unknown>;
    const {
      workspace,
      dependencyHash: snapshotHash,
    } = preparedWorkspaceSnapshot(rawWorkspace);
    if (!snapshotHash) return;

    dispatch(markPreparedWorkspaceContextUpdating({ snapshotHash }));
    preparedContextInFlightSignatureRef.current = snapshotHash;
    try {
      const prepared = await preparedContextService.prepare({
        workspace,
        workspace_context_id: state.workspaceContextId,
        workspace_context_hash: state.workspaceContextHash,
        semantic_bundle_id: state.semanticBundleId,
        semantic_bundle_hash: state.semanticBundleHash,
        learning_context_id: state.learningContextId,
        learning_context_hash: state.learningContextHash,
        force: true,
      });
      dispatch(applyPreparedWorkspaceContext({
        context: prepared,
        snapshotHash,
      }));
      lastPreparedContextSignatureRef.current = snapshotHash;
      const compact = {
        workspace_context_id: prepared.workspace_context_id,
        workspace_context_hash: prepared.workspace_context_hash,
        semantic_bundle_id: prepared.semantic_bundle_id ?? null,
        semantic_bundle_hash: prepared.semantic_bundle_hash ?? null,
        learning_context_id: prepared.learning_context_id ?? null,
        learning_context_hash: prepared.learning_context_hash ?? null,
        snapshot_hash: snapshotHash,
        status: prepared.status,
      };
      window.sessionStorage.setItem(
        PREPARED_CONTEXT_SESSION_KEY,
        JSON.stringify(compact),
      );
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(PREPARED_CONTEXT_CHANNEL);
        channel.postMessage(compact);
        channel.close();
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "AI context preparation failed.";
      dispatch(failPreparedWorkspaceContext({ snapshotHash, error: message }));
      throw error;
    } finally {
      if (preparedContextInFlightSignatureRef.current === snapshotHash) {
        preparedContextInFlightSignatureRef.current = null;
      }
    }
  }, [dispatch, state]);

  const value = useMemo<ContextValue>(() => {
    // Compose fullData from the two branches in Redux
    const fullData =
      state.sourceDatabases.length || state.targetDatabases.length
        ? { sources: state.sourceDatabases, targets: state.targetDatabases }
        : null;

    return {
      sessionHydrated,
      // Tree data
      fullData,

      // Flat lists
      sources: state.sources,
      targets: state.targets,
      sourceInfo: state.sourceInfo,
      targetInfo: state.targetInfo,

      // Attributes
      sourceAttributeGroups: state.sourceAttributeGroups,
      targetAttributeGroup: state.targetAttributeGroup,

      // Mapping
      mappingSuggestions: state.mappingSuggestions,
      mappingLoading: state.mappingLoading,
      autoMapStatusMessage: state.autoMapStatusMessage,
      autoMapProcessingIds: state.autoMapProcessingIds,
      autoMapGroupingEnabled: state.autoMapGroupingEnabled,

      // Chat
      chatMessages: state.chatMessages,
      chatLoading: state.chatLoading,
      assistantSignals: state.assistantSignals,
      assistantInferences: state.assistantInferences,
      assistantPreferences: state.assistantPreferences,
      assistantUnreadCount: state.assistantUnreadCount,
      firRecommendations: state.firRecommendations,
      firPrimaryQuestion: state.firPrimaryQuestion,
      firRecommendationLoading: state.firRecommendationLoading,
      firRecommendationCheckpoint: state.firRecommendationCheckpoint,
      firRecommendationContextKey: state.firRecommendationContextKey,
      mappingIntent: state.mappingIntent,
      semanticBundleId: state.semanticBundleId,
      semanticBundleHash: state.semanticBundleHash,
      learningContextId: state.learningContextId,
      learningContextHash: state.learningContextHash,
      workspaceContextId: state.workspaceContextId,
      workspaceContextHash: state.workspaceContextHash,
      workspaceContextStatus: state.workspaceContextStatus,
      workspaceContextCacheStatus: state.workspaceContextCacheStatus,
      workspaceContextError: state.workspaceContextError,
      semanticBundleLabel: state.semanticBundleLabel,
      semanticLevel: state.semanticLevel,
      semanticStatus: state.semanticStatus,
      semanticViewName: state.semanticViewName,
      semanticContextSummary: state.semanticContextSummary,
      semanticContextItems: state.semanticContextItems,
      semanticLineage: state.semanticLineage,
      semanticDatahubContext: state.semanticDatahubContext,
      datahubStatus: state.datahubStatus,
      pendingDerivedSourceDraft: state.pendingDerivedSourceDraft,
      derivedSourceDraftRequested: state.derivedSourceDraftRequested,

      // Session
      session: state.session,

      // Project/Mapping identity
      activeProjectId: state.activeProjectId,
      activeSttmId: state.activeSttmId,
      activeProjectName: state.activeProjectName,
      activeSttmName: state.activeSttmName,
      activeSnapshotId: state.activeSnapshotId,
      openSttmStatus: state.openSttmStatus,
      openSttmTargetPage: state.openSttmTargetPage,
      openSttmErrorMessage: state.openSttmErrorMessage,

      // Loading / error
      loadState: state.loadState,
      errorState: state.errorState,

      // Actions — data loading
      reloadInitialData: () => {
        dispatch(fetchDatabases());
        dispatch(fetchDerivedSources());
      },

      loadSchemas: (type: SelectionSide, dbId: string) => {
        dispatch(fetchSchemas({ type, dbId }));
      },

      selectSchema: (type: SelectionSide, dbId: string, schemaId: string) => {
        void dispatch(fetchTables({ type, dbId, schemaId })).then((action) => {
          const [database, schema] = schemaId.split(":", 2);
          const branch = type === "source" ? state.sourceDatabases : state.targetDatabases;
          const currentSchema = branch
            .find((item) => item.dbId === dbId)
            ?.schemas.find((item) => item.schemaId === schemaId);
          const payload = action.payload as { tables?: TableNode[] | null } | undefined;
          const tables = payload?.tables ?? currentSchema?.tables ?? [];
          void dispatch(
            evaluateFirRecommendations({
              checkpoint: "schema_browsed",
              page: "builder",
              surface: "SOURCE_SELECTION",
              scopeType: "schema",
              candidateAction:
                type === "source" ? "select_source_table" : "select_target_table",
              browsingContext: {
                side: type,
                database,
                schema,
                visible_candidate_tables: tables.map((table) => table.qualifiedName),
              },
            }),
          );
        });
      },

      // Actions — selection
      toggleSource: (tableId: string) => {
        dispatch(toggleSourceAction({ tableId }));
      },

      selectTarget: (tableId: string) => {
        dispatch(selectTargetAction({ tableId }));
        // After selecting, refresh target attributes
        const target = state.targets.find((t) => t.tableId === tableId);
        if (target) {
          dispatch(
            fetchAttributes({ qualifiedNames: [target.qualifiedName], side: "target" })
          );
        }
      },

      selectAllSources: () => dispatch(selectAllSourcesAction()),
      clearSources: () => dispatch(clearSourcesAction()),
      clearTargets: () => dispatch(clearTargetsAction()),

      // Actions — AI
      runAutoMap: () => {
        void dispatch(
          evaluateFirRecommendations({
            checkpoint: "before_auto_map",
            page: "mapping",
            surface: "MAPPING",
            scopeType: "mapping",
            candidateAction: "run_auto_map",
          }),
        );
        void dispatch(runAutoMapThunk()).finally(() => {
          void dispatch(
            evaluateFirRecommendations({
              checkpoint: "on_auto_map_review",
              page: "mapping",
              surface: "MAPPING",
              scopeType: "mapping",
              candidateAction: "review_auto_map",
            }),
          );
        });
      },
      sendChatMessage: (message: string) => {
        dispatch(sendChatMessageThunk(message));
      },
      resetChatSession: () => {
        dispatch(resetChatSessionAction());
      },
      restoreChatSession: ({ messages }) => {
        dispatch(restoreChatSessionAction({ messages }));
      },
      submitChatFeedback: ({ messageId, rating, comment }) => {
        const targetMessage = state.chatMessages.find((item) => item.id === messageId);
        dispatch(
          submitChatFeedbackThunk({
            messageId,
            rating,
            comment: comment ?? null,
            requestId: targetMessage?.requestId ?? null,
            conversationId: targetMessage?.conversationId ?? state.agentThreadId,
          }),
        );
      },
      refreshAssistantSignals: (activityType?: string) => {
        const checkpoint =
          activityType ?? buildAssistantActivityType(lastAssistantSignalSignature.current);
        void dispatch(
          evaluateFirRecommendations({
            checkpoint,
            page: currentAssistantPage,
            surface: currentAssistantSurface,
            scopeType:
              checkpoint.includes("derived_source")
                ? "derived_source"
                : currentAssistantPage === "mapping"
                  ? "mapping"
                  : "table_set",
            candidateAction: checkpoint,
          }),
        );
      },
      requestSemanticRefresh: async () => {
        const selectedSourceTables = resolveSelectedSourceTables(state)
          .map((table) => ({ database: table.qualifiedName.split(".", 3)[0], schema: table.qualifiedName.split(".", 3)[1], table: table.qualifiedName.split(".", 3)[2] }));
        const selectedDerivedSourceIds = state.derivedSources
          .filter((source) => source.isSelected)
          .map((source) => source.id);
        if (!selectedSourceTables.length && !selectedDerivedSourceIds.length) {
          return;
        }
        const selectedTargetTable = resolveSelectedTargetTable(state);
        const payload = {
          selected_source_tables: selectedSourceTables,
          selected_derived_sources: selectedDerivedSourceIds,
          target_table: selectedTargetTable
            ? { database: selectedTargetTable.qualifiedName.split(".", 3)[0], schema: selectedTargetTable.qualifiedName.split(".", 3)[1], table: selectedTargetTable.qualifiedName.split(".", 3)[2] }
            : null,
          relationships: state.relationships
            .filter((join) => join.leftTableId && join.rightTableId && join.conditions?.length)
            .flatMap((join) => {
              const leftParts = String(join.leftTableId).split(".", 3);
              const rightParts = String(join.rightTableId).split(".", 3);
              if (leftParts.length !== 3 || rightParts.length !== 3) return [];
              return [{
                left_table: { database: leftParts[0], schema: leftParts[1], table: leftParts[2] },
                right_table: { database: rightParts[0], schema: rightParts[1], table: rightParts[2] },
                constraint_name: join.constraintName ?? null,
                join_type: join.joinType ?? "INNER",
                source: join.source ?? "USER_DEFINED",
                locked: join.locked ?? false,
                conditions: (join.conditions ?? []).map((condition) => ({
                  left_column: condition.leftColumn,
                  right_column: condition.rightColumn,
                  operator: condition.operator ?? "=",
                })),
              }];
          }),
          requested_level: (selectedTargetTable ? "L3_MAPPING_ENRICHED" : "L2_ANALYST_READY") as SemanticLevel,
          force: false,
        };
        const signature = JSON.stringify(payload);
        if (
          semanticRefreshInFlightSignatureRef.current === signature ||
          lastSemanticRefreshSignatureRef.current === signature
        ) {
          return;
        }
        semanticRefreshInFlightSignatureRef.current = signature;
        try {
          const refresh = await dbService.refreshSemanticContext(payload);
          dispatch(applySemanticRefreshAction(refresh));
          lastSemanticRefreshSignatureRef.current = signature;
        } catch (error) {
          console.warn("Semantic refresh request did not complete in the background.", error);
        } finally {
          if (semanticRefreshInFlightSignatureRef.current === signature) {
            semanticRefreshInFlightSignatureRef.current = null;
          }
        }
      },
      refreshPreparedWorkspaceContext,
      flushWorkspace,
      getWorkspaceSnapshot,
      respondToAssistantSignal: ({ signalId, status, optionSelected, rating, comment }) => {
        dispatch(
          respondToAssistantSignalThunk({
            signalId,
            status,
            optionSelected: optionSelected ?? null,
            rating: rating ?? null,
            comment: comment ?? null,
          }),
        );
      },
      updateAssistantPreferences: (settings) => {
        dispatch(updateAssistantPreferencesThunk(settings));
      },
      openPendingDerivedSourceDraft: () => {
        dispatch(openPendingDerivedSourceDraftAction());
      },
      acknowledgePendingDerivedSourceDraft: () => {
        dispatch(acknowledgePendingDerivedSourceDraftAction());
      },
      dismissPendingDerivedSourceDraft: () => {
        dispatch(dismissPendingDerivedSourceDraftAction());
      },
      applyPendingAiMappingReview: () => {
        dispatch(applyPendingAiMappingReviewAction());
      },
      skipPendingAiMappingReview: () => {
        dispatch(skipPendingAiMappingReviewAction());
      },

      // Computed - use tree-based count if available, fall back to flat sources
      selectedSourceCount:
        resolveSelectedSourceTables(state).length,
      mappingCount: state.mappingSuggestions.filter(
        (item) => item.sourceAttributes.length > 0
      ).length,

      // Derived source features
      drivingTableId: state.drivingTableId,
      setDrivingTable: (tableId: string | null) =>
        dispatch(setDrivingTableAction({ tableId })),
      relationships: state.relationships,
      setRelationships: (joins) => dispatch(setRelationshipsAction({ joins })),
      relationshipCandidates: state.relationshipCandidates,
      approveRelationshipCandidate: (id) => {
        const candidate = state.relationshipCandidates.find((item) => item.id === id);
        if (candidate?.leftTableId && candidate.rightTableId) {
          const tableRef = (qualifiedName: string) => {
            const parts = qualifiedName.split(".");
            return {
              database: parts.at(-3) ?? "",
              schema: parts.at(-2) ?? "",
              table: parts.at(-1) ?? qualifiedName,
            };
          };
          void dbService.recordRelationshipReview(
            {
              id,
              left_table: tableRef(candidate.leftTableId),
              right_table: tableRef(candidate.rightTableId),
              constraint_name: candidate.constraintName ?? null,
              join_type: candidate.joinType,
              source: candidate.source,
              locked: candidate.locked,
              review_required: true,
              confidence: candidate.confidence,
              review_reason: candidate.reviewReason,
              evidence: candidate.evidence,
              conditions: (candidate.conditions ?? []).map((condition) => ({
                left_column: condition.leftColumn,
                right_column: condition.rightColumn,
                operator: condition.operator,
              })),
            },
            "accepted",
            {
              project_id: state.activeProjectId,
              sttm_id: state.activeSttmId,
              context_hash: state.workspaceContextHash,
            },
          ).catch((error) => console.warn("Could not record relationship approval feedback.", error));
        }
        dispatch(approveRelationshipCandidateAction({ id }));
      },
      rejectRelationshipCandidate: (id) => {
        const candidate = state.relationshipCandidates.find((item) => item.id === id);
        if (candidate?.leftTableId && candidate.rightTableId) {
          const tableRef = (qualifiedName: string) => {
            const parts = qualifiedName.split(".");
            return {
              database: parts.at(-3) ?? "",
              schema: parts.at(-2) ?? "",
              table: parts.at(-1) ?? qualifiedName,
            };
          };
          void dbService.recordRelationshipReview(
            {
              id,
              left_table: tableRef(candidate.leftTableId),
              right_table: tableRef(candidate.rightTableId),
              constraint_name: candidate.constraintName ?? null,
              join_type: candidate.joinType,
              source: candidate.source,
              locked: candidate.locked,
              review_required: true,
              confidence: candidate.confidence,
              review_reason: candidate.reviewReason,
              evidence: candidate.evidence,
              conditions: (candidate.conditions ?? []).map((condition) => ({
                left_column: condition.leftColumn,
                right_column: condition.rightColumn,
                operator: condition.operator,
              })),
            },
            "rejected",
            {
              project_id: state.activeProjectId,
              sttm_id: state.activeSttmId,
              context_hash: state.workspaceContextHash,
            },
          ).catch((error) => console.warn("Could not record relationship rejection feedback.", error));
        }
        dispatch(rejectRelationshipCandidateAction({ id }));
      },
      derivedSources: state.derivedSources,
      addDerivedSource: (source: DerivedSource) =>
        dispatch(addDerivedSourceAction(source)),
      updateDerivedSource: (source: DerivedSource) =>
        dispatch(updateDerivedSourceAction(source)),
      removeDerivedSource: (id: string) =>
        dispatch(removeDerivedSourceAction({ id })),
      toggleDerivedSource: (id: string) =>
        dispatch(toggleDerivedSourceAction({ id })),

      sourceFilterSql: state.sourceFilterSql,
      sourceFilterGroups: state.sourceFilterGroups,
      sourceQuerySql: state.sourceQuerySql,
      sourceGroupBySql: state.sourceGroupBySql,
      sourceOrderBySql: state.sourceOrderBySql,
      setSourceFilterConditions: (payload: {
        sql: string;
        groups: RuleGroup[];
        baseSql?: string;
        groupBySql?: string;
        orderBySql?: string;
      }) =>
        dispatch(setSourceFilterConditionsAction(payload)),

      // UI Mapping state
      mappings: state.mappings,
      selectedMappingIds: state.selectedMappingIds,
      mappingSql: state.mappingSql,
      mappingPreviewSql: state.mappingPreviewSql,
      mappingSqlVariant: state.mappingSqlVariant,
      compiledMappingSql: state.compiledMappingSql,
      compiledMappingPreviewSql: state.compiledMappingPreviewSql,
      compiledMappingContextHash: state.compiledMappingContextHash,
      isPreProcessModalOpen: state.isPreProcessModalOpen,
      activeMappingId: state.activeMappingId,
      pendingAiMappingReviews: state.pendingAiMappingReviews,
      
      // UI Mapping actions
      applySemanticRefresh: (payload) => dispatch(applySemanticRefreshAction(payload)),
      initializeMappings: (mappings) => dispatch(initializeMappingsAction(mappings)),
      updateMapping: (id, updates) => dispatch(updateMappingAction({ id, updates })),
      toggleMappingSelection: (id) => dispatch(toggleMappingSelectionAction({ id })),
      selectAllMappings: (ids, select) => dispatch(selectAllMappingsAction({ ids, select })),
      bulkMarkMapped: (ids) => dispatch(bulkMarkMappedAction({ ids })),
      bulkSetDirect: (ids) => dispatch(bulkSetDirectAction({ ids })),
      setPreProcessModalOpen: (open, mappingId) => dispatch(setPreProcessModalOpenAction({ open, mappingId })),
      setMappingSql: (sql) => dispatch(setMappingSqlAction({ sql })),
      setMappingPreviewSql: (sql) => dispatch(setMappingPreviewSqlAction({ sql })),
      setMappingSqlVariant: (variant) => dispatch(setMappingSqlVariantAction({ variant })),
      setCompiledMappingResult: (payload) => dispatch(setCompiledMappingResultAction(payload)),
      applyParsedSqlWorkspace: (payload) => dispatch(applyParsedSqlWorkspaceAction(payload)),
    };
  }, [
    state,
    dispatch,
    currentAssistantPage,
    currentAssistantSurface,
    sessionHydrated,
    refreshPreparedWorkspaceContext,
    flushWorkspace,
    getWorkspaceSnapshot,
  ]);

  return (
    <SttmBuilderContext.Provider value={value}>
      {children}
    </SttmBuilderContext.Provider>
  );
}

export const useSttmBuilderContext = () => {
  const context = useContext(SttmBuilderContext);

  if (!context) {
    throw new Error(
      "useSttmBuilderContext must be used within SttmBuilderProvider"
    );
  }

  return context;
};
