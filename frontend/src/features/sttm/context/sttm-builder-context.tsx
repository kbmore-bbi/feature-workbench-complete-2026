"use client";

import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { usePathname } from "next/navigation";
import { dbService } from "@/services/dbService";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  evaluateAssistantSignals,
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
  clearSources as clearSourcesAction,
  clearTargets as clearTargetsAction,
  setDrivingTable as setDrivingTableAction,
  setRelationships as setRelationshipsAction,
  setSourceFilterConditions as setSourceFilterConditionsAction,
  addDerivedSource as addDerivedSourceAction,
  updateDerivedSource as updateDerivedSourceAction,
  removeDerivedSource as removeDerivedSourceAction,
  toggleDerivedSource as toggleDerivedSourceAction,
  openPendingDerivedSourceDraft as openPendingDerivedSourceDraftAction,
  acknowledgePendingDerivedSourceDraft as acknowledgePendingDerivedSourceDraftAction,
  dismissPendingDerivedSourceDraft as dismissPendingDerivedSourceDraftAction,
  applySemanticRefresh as applySemanticRefreshAction,
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
  updateAssistantPreferences as updateAssistantPreferencesThunk,
} from "@/features/sttm/store/sttm-builder-slice";
import { getSelectedSourceTables } from "@/features/sttm/shared/sttm-selection-utils";
import type {
  DerivedSource,
  RuleGroup,
  SelectionSide,
  SttmBuilderContextValue as ContextValue,
} from "@/features/sttm/types/sttm.types";

const SttmBuilderContext = createContext<ContextValue | null>(null);

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
  const queuedAssistantSignalSignatureRef = useRef<string | null>(null);

  const currentAssistantPage = useMemo(() => {
    if (pathname.includes("/summary")) return "summary";
    if (pathname.includes("/mapping")) return "mapping";
    return "builder";
  }, [pathname]);

  const currentAssistantSurface = currentAssistantPage === "mapping" ? "MAPPING" : "SOURCE_SELECTION";

  // Load databases on mount
  useEffect(() => {
    dispatch(fetchDatabases());
    dispatch(fetchDerivedSources());
  }, [dispatch]);

  useEffect(() => {
    try {
      window.sessionStorage.removeItem("sttm-builder-session-v1");
      window.sessionStorage.removeItem("sttm-builder-session-v2");
    } catch (error) {
      console.warn("Unable to clear STTM builder draft session.", error);
    }
  }, []);

  const assistantSignalSignature = useMemo(() => {
    const selectedSources = state.sources
      .filter((table) => table.isSelected)
      .map((table) => table.qualifiedName)
      .sort();
    const selectedDerived = state.derivedSources
      .filter((source) => source.isSelected)
      .map((source) => source.id)
      .sort();
    const selectedTarget = state.targets.find((table) => table.isSelected)?.qualifiedName ?? null;
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
      semanticBundleId: state.semanticBundleId,
      semanticViewName: state.semanticViewName,
      relationshipSignature,
      mappedCount: state.mappings.filter((item) => item.status === "MAPPED").length,
      unmappedCount: state.mappings.filter((item) => item.status !== "MAPPED").length,
      selectedMappingCount: state.selectedMappingIds.length,
    });
  }, [
    state.sources,
    state.derivedSources,
    state.targets,
    state.drivingTableId,
    state.semanticBundleId,
    state.semanticViewName,
    state.relationships,
    state.mappings,
    state.selectedMappingIds,
    currentAssistantPage,
    currentAssistantSurface,
  ]);

  const buildAssistantActivityType = () => {
    if (currentAssistantPage === "mapping") {
      return state.relationships.length > 0 ? "mapping_join_ready" : "mapping_context_changed";
    }
    if (state.relationships.length > 0) {
      return "relationship_changed";
    }
    if (state.derivedSources.some((source) => source.isSelected)) {
      return "derived_source_selected";
    }
    return "selection_changed";
  };

  const runAssistantSignalEvaluation = (signature: string) => {
    signalEvaluationInFlightRef.current = true;
    void dispatch(
      evaluateAssistantSignals({
        page: currentAssistantPage,
        surface: currentAssistantSurface,
        activityType: buildAssistantActivityType(),
      }),
    ).finally(() => {
      signalEvaluationInFlightRef.current = false;
      const queuedSignature = queuedAssistantSignalSignatureRef.current;
      if (!queuedSignature || queuedSignature === signature) {
        queuedAssistantSignalSignatureRef.current = null;
        return;
      }
      queuedAssistantSignalSignatureRef.current = null;
      lastAssistantSignalSignature.current = queuedSignature;
      runAssistantSignalEvaluation(queuedSignature);
    });
  };

  useEffect(() => {
    if (!state.loadState.initial || state.loadState.initial === "loading") {
      return;
    }
    if (currentAssistantPage === "mapping" && state.loadState.attributes === "loading") {
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
      return;
    }
    if (assistantSignalSignature === lastAssistantSignalSignature.current) {
      return;
    }
    lastAssistantSignalSignature.current = assistantSignalSignature;
    if (signalEvaluationTimerRef.current !== null) {
      window.clearTimeout(signalEvaluationTimerRef.current);
    }
    signalEvaluationTimerRef.current = window.setTimeout(() => {
      if (signalEvaluationInFlightRef.current) {
        queuedAssistantSignalSignatureRef.current = assistantSignalSignature;
        signalEvaluationTimerRef.current = null;
        return;
      }
      runAssistantSignalEvaluation(assistantSignalSignature);
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
    state.loadState.attributes,
    state.loadState.initial,
    currentAssistantPage,
  ]);

  const value = useMemo<ContextValue>(() => {
    // Compose fullData from the two branches in Redux
    const fullData =
      state.sourceDatabases.length || state.targetDatabases.length
        ? { sources: state.sourceDatabases, targets: state.targetDatabases }
        : null;

    return {
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

      // Chat
      chatMessages: state.chatMessages,
      chatLoading: state.chatLoading,
      assistantSignals: state.assistantSignals,
      assistantInferences: state.assistantInferences,
      assistantPreferences: state.assistantPreferences,
      assistantUnreadCount: state.assistantUnreadCount,
      mappingIntent: state.mappingIntent,
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
      pendingDerivedSourceDraft: state.pendingDerivedSourceDraft,
      derivedSourceDraftRequested: state.derivedSourceDraftRequested,

      // Session
      session: state.session,

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
        dispatch(fetchTables({ type, dbId, schemaId }));
      },

      // Actions — selection
      toggleSource: (tableId: string) => {
        const nextSelectedNames: string[] = [];
        for (const db of state.sourceDatabases) {
          for (const schema of db.schemas) {
            for (const table of schema.tables) {
              const isSelected =
                table.tableId === tableId ? !table.isSelected : table.isSelected;
              if (isSelected) {
                nextSelectedNames.push(table.qualifiedName);
              }
            }
          }
        }

        dispatch(toggleSourceAction({ tableId }));

        if (nextSelectedNames.length) {
          dispatch(fetchAttributes({ qualifiedNames: nextSelectedNames, side: "source" }));
        }
        dispatch(fetchRelationships());
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

      clearSources: () => dispatch(clearSourcesAction()),
      clearTargets: () => dispatch(clearTargetsAction()),

      // Actions — AI
      runAutoMap: () => {
        dispatch(runAutoMapThunk());
      },
      sendChatMessage: (message: string) => {
        dispatch(sendChatMessageThunk(message));
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
      refreshAssistantSignals: () => {
        dispatch(
          evaluateAssistantSignals({
            page: currentAssistantPage,
            surface: currentAssistantSurface,
            activityType: buildAssistantActivityType(),
          }),
        );
      },
      requestSemanticRefresh: async () => {
        const selectedSourceTables = state.sources
          .filter((table) => table.isSelected)
          .map((table) => ({ database: table.qualifiedName.split(".", 3)[0], schema: table.qualifiedName.split(".", 3)[1], table: table.qualifiedName.split(".", 3)[2] }));
        const selectedDerivedSourceIds = state.derivedSources
          .filter((source) => source.isSelected)
          .map((source) => source.id);
        if (!selectedSourceTables.length && !selectedDerivedSourceIds.length) {
          return;
        }
        const selectedTargetTable = state.targets.find((table) => table.isSelected);
        void dbService.refreshSemanticContext({
          selected_source_tables: selectedSourceTables,
          selected_derived_sources: selectedDerivedSourceIds,
          target_table: selectedTargetTable
            ? { database: selectedTargetTable.qualifiedName.split(".", 3)[0], schema: selectedTargetTable.qualifiedName.split(".", 3)[1], table: selectedTargetTable.qualifiedName.split(".", 3)[2] }
            : null,
          relationships: state.relationships
            .filter((join) => join.leftTableId && join.rightTableId && join.conditions?.length)
            .map((join) => ({
              left_table: { database: (join.leftTableId as string).split(".", 3)[0], schema: (join.leftTableId as string).split(".", 3)[1], table: (join.leftTableId as string).split(".", 3)[2] },
              right_table: { database: (join.rightTableId as string).split(".", 3)[0], schema: (join.rightTableId as string).split(".", 3)[1], table: (join.rightTableId as string).split(".", 3)[2] },
              constraint_name: join.constraintName ?? null,
              join_type: join.joinType ?? "INNER",
              source: join.source ?? "USER_DEFINED",
              locked: join.locked ?? false,
              conditions: (join.conditions ?? []).map((condition) => ({
                left_column: condition.leftColumn,
                right_column: condition.rightColumn,
                operator: condition.operator ?? "=",
              })),
          })),
          requested_level: selectedTargetTable ? "L3_MAPPING_ENRICHED" : "L2_ANALYST_READY",
          force: false,
        })
          .then((refresh) => {
            dispatch(applySemanticRefreshAction(refresh));
            dispatch(
              evaluateAssistantSignals({
                page: currentAssistantPage,
                surface: currentAssistantSurface,
                activityType: "semantic_context_refreshed",
              }),
            );
          })
          .catch((error) => {
            console.warn("Semantic refresh request did not complete in the background.", error);
          });
      },
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
        dispatch(updateAssistantPreferencesThunk(settings)).then(() => {
          dispatch(
            evaluateAssistantSignals({
              page: currentAssistantPage,
              surface: currentAssistantSurface,
              activityType: "settings_changed",
            }),
          );
        });
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

      // Computed
      selectedSourceCount: getSelectedSourceTables(state.sourceDatabases).length,
      mappingCount: state.mappingSuggestions.filter(
        (item) => item.sourceAttributes.length > 0
      ).length,

      // Derived source features
      drivingTableId: state.drivingTableId,
      setDrivingTable: (tableId: string | null) =>
        dispatch(setDrivingTableAction({ tableId })),
      relationships: state.relationships,
      setRelationships: (joins) => dispatch(setRelationshipsAction({ joins })),
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
    };
  }, [state, dispatch, currentAssistantPage, currentAssistantSurface]);

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
