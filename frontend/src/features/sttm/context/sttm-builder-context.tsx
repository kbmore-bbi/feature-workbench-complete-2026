"use client";

import { createContext, useContext, useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchDatabases,
  fetchSchemas,
  fetchTables,
  fetchAttributes,
  fetchDerivedSources,
  fetchRelationships,
  runAutoMap as runAutoMapThunk,
  sendChatMessage as sendChatMessageThunk,
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
  initializeMappings as initializeMappingsAction,
  updateMapping as updateMappingAction,
  toggleMappingSelection as toggleMappingSelectionAction,
  selectAllMappings as selectAllMappingsAction,
  bulkMarkMapped as bulkMarkMappedAction,
  bulkSetDirect as bulkSetDirectAction,
  setPreProcessModalOpen as setPreProcessModalOpenAction,
  setMappingSql as setMappingSqlAction,
} from "@/features/sttm/store/sttm-builder-slice";
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
  const dispatch = useAppDispatch();
  const state = useAppSelector((s) => s.sttmBuilder);

  // Load databases on mount
  useEffect(() => {
    dispatch(fetchDatabases());
    dispatch(fetchDerivedSources());
  }, [dispatch]);

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

      // Chat
      chatMessages: state.chatMessages,
      chatLoading: state.chatLoading,
      semanticBundleId: state.semanticBundleId,
      semanticBundleLabel: state.semanticBundleLabel,
      semanticLevel: state.semanticLevel,
      semanticStatus: state.semanticStatus,
      semanticViewName: state.semanticViewName,
      semanticContextSummary: state.semanticContextSummary,
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
        dispatch(toggleSourceAction({ tableId }));
        // After toggling, refresh source attributes
        const nextSources = state.sources.map((t) =>
          t.tableId === tableId ? { ...t, isSelected: !t.isSelected } : t
        );
        const selectedNames = nextSources
          .filter((t) => t.isSelected)
          .map((t) => t.qualifiedName);
        dispatch(fetchAttributes({ qualifiedNames: selectedNames, side: "source" }));
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
      openPendingDerivedSourceDraft: () => {
        dispatch(openPendingDerivedSourceDraftAction());
      },
      acknowledgePendingDerivedSourceDraft: () => {
        dispatch(acknowledgePendingDerivedSourceDraftAction());
      },
      dismissPendingDerivedSourceDraft: () => {
        dispatch(dismissPendingDerivedSourceDraftAction());
      },

      // Computed
      selectedSourceCount: state.sources.filter((t) => t.isSelected).length,
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
      setSourceFilterConditions: (payload: { sql: string; groups: RuleGroup[] }) =>
        dispatch(setSourceFilterConditionsAction(payload)),

      // UI Mapping state
      mappings: state.mappings,
      selectedMappingIds: state.selectedMappingIds,
      mappingSql: state.mappingSql,
      isPreProcessModalOpen: state.isPreProcessModalOpen,
      activeMappingId: state.activeMappingId,
      
      // UI Mapping actions
      initializeMappings: (mappings) => dispatch(initializeMappingsAction(mappings)),
      updateMapping: (id, updates) => dispatch(updateMappingAction({ id, updates })),
      toggleMappingSelection: (id) => dispatch(toggleMappingSelectionAction({ id })),
      selectAllMappings: (ids, select) => dispatch(selectAllMappingsAction({ ids, select })),
      bulkMarkMapped: (ids) => dispatch(bulkMarkMappedAction({ ids })),
      bulkSetDirect: (ids) => dispatch(bulkSetDirectAction({ ids })),
      setPreProcessModalOpen: (open, mappingId) => dispatch(setPreProcessModalOpenAction({ open, mappingId })),
      setMappingSql: (sql) => dispatch(setMappingSqlAction({ sql })),
    };
  }, [state, dispatch]);

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
