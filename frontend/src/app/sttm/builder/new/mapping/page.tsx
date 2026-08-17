"use client";
import { AiaAlert, AiaBox, AiaButton, AiaCircularProgress, AiaDialog, AiaDialogActions, AiaDialogContent, AiaDialogTitle, AiaIconButton, AiaCheckbox, AiaPaper, AiaStack, AiaTableBody, AiaTableCellPrimitive, AiaTableHead, AiaTablePrimitive, AiaTableRowPrimitive, AiaTooltip } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  AccountTreeOutlinedIcon,
  ChecklistRtlRoundedIcon,
  CloseRoundedIcon,
  InfoOutlinedIcon,
  TableRowsRoundedIcon,
  TerminalRoundedIcon,
} from '@/utils/icons';

import { AiaResizeHandle } from '@/components/ui/aia-resize-handle';
import { useSidebarSlot } from '@/features/sttm/layout/sidebar-slot-context';
import { SttmSidebarCollapseFooter } from '@/features/sttm/layout/sttm-sidebar-collapse-footer';
import SourceTargetAttributeList from '@/features/sttm/mapping/source-target-attribute-list';
import SourceTargetAttributeMapping from '@/features/sttm/mapping/source-target-attribute-mapping';
import PreProcessModal from '@/features/sttm/mapping/pre-process-modal';
import { SttmLineageWorkspacePanel } from '@/features/sttm/lineage/sttm-lineage-workspace-panel';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import { useAppDispatch } from '@/store/hooks';
import { fetchAttributes } from '@/features/sttm/store/sttm-builder-slice';
import { collectSelectedSourceQualifiedNames } from '@/features/sttm/shared/sttm-selection-utils';
import {
  buildFallbackSourceQuerySql,
  buildCompilerRelationGraph,
  buildMappingInsertSql,
  buildMappingSelectSql,
  buildSourceQueryPreviewSql,
  generateMappingDescription,
  parseSourceColumns,
} from '@/features/sttm/mapping/mapping-utils';
import { dbService } from '@/services/dbService';
import { MappingSqlPreview } from '@/components/sql';
import { MappingProgressIndicator } from '@/features/sttm/shared/mapping-progress-indicator';
import { BuilderWorkspaceTabBar } from '@/features/sttm/shared/builder-workspace-tab-bar';
import { CARD_TITLE_SX, BODY_SX } from '@/config/typography-tokens';
import { TOUR_TARGETS } from '@/features/tour/constants/tour-targets';
import { useTour } from '@/features/tour/engine/tour-context';
import type {
  MappingSqlPreviewResponse,
  MappingSqlCompileResponse,
  MappingSqlParseResponse,
  MappingSqlReviewRequest,
  MappingSqlReviewResponse,
  TableRef,
} from '@/types/api-contract';
import type { JoinConfig, MappingState } from '@/features/sttm/types/sttm.types';
import type { SqlUploadResult } from '@/features/sttm/mapping/sql-bundle-review-panel';
import { buildSqlUploadWorkspace } from '@/features/sttm/mapping/sql-upload-workspace';

type MappingTab = 'mapping' | 'sql-preview' | 'data-preview' | 'data-lineage';

const MIN_SIDEBAR_WIDTH = 248;
const MAX_SIDEBAR_WIDTH = 420;
const COLLAPSED_SIDEBAR_WIDTH = 70;

type PreviewDisplayRow = {
  mappingId: string;
  targetColumn: string;
  targetType: string;
  sourceColumn: string;
  sourceColumnDisplay: string;
  sourceColumnFullName: string;
  sourceValue: string;
  transformedValue: string;
  description: string;
  expressionLabel: string | null;
  confidenceScore: number | null;
  confidenceReason: string | null;
  candidateSourceColumns: string[];
  rowCount: number;
  rowIndex: number;
  displayIndex: number;
};

type SqlUnifiedDiffLine = {
  text: string;
  kind: 'context' | 'removed' | 'added' | 'separator';
};

function countFilterConditions(
  groups: Array<{ type?: string; children?: unknown[] }>,
): number {
  return groups.reduce((count, group) => {
    if (group.type === 'condition') {
      return count + 1;
    }
    const children = Array.isArray(group.children)
      ? (group.children as Array<{ type?: string; children?: unknown[] }>)
      : [];
    return count + countFilterConditions(children);
  }, 0);
}

function qualifiedNameToTableRef(qualifiedName: string): TableRef | null {
  const [database, schema, table] = qualifiedName.split('.', 3);
  if (!database || !schema || !table) {
    return null;
  }
  return { database, schema, table };
}

function stringifyPreviewValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function formatSourceColumnDisplay(sourceColumn: string) {
  const parts = sourceColumn.split('.').filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  }
  return sourceColumn;
}

function confidenceTone(confidenceScore: number | null | undefined) {
  if (confidenceScore === null || confidenceScore === undefined) {
    return { color: '#64748b', backgroundColor: '#f8fafc', borderColor: '#e2e8f0' };
  }
  if (confidenceScore >= 0.8) {
    return { color: '#166534', backgroundColor: '#dcfce7', borderColor: '#86efac' };
  }
  if (confidenceScore >= 0.55) {
    return { color: '#92400e', backgroundColor: '#fef3c7', borderColor: '#fcd34d' };
  }
  return { color: '#b91c1c', backgroundColor: '#fee2e2', borderColor: '#fca5a5' };
}

function buildUnifiedSqlDiffLines(originalSql: string, optimizedSql: string): SqlUnifiedDiffLine[] {
  const originalLines = originalSql.split('\n');
  const optimizedLines = optimizedSql.split('\n');
  const dp: number[][] = Array.from({ length: originalLines.length + 1 }, () =>
    Array.from({ length: optimizedLines.length + 1 }, () => 0),
  );

  for (let i = originalLines.length - 1; i >= 0; i -= 1) {
    for (let j = optimizedLines.length - 1; j >= 0; j -= 1) {
      dp[i][j] =
        originalLines[i] === optimizedLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows: SqlUnifiedDiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < originalLines.length && j < optimizedLines.length) {
    if (originalLines[i] === optimizedLines[j]) {
      rows.push({ text: originalLines[i], kind: 'context' });
      i += 1;
      j += 1;
      continue;
    }

    if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ text: originalLines[i], kind: 'removed' });
      i += 1;
      continue;
    }

    rows.push({ text: optimizedLines[j], kind: 'added' });
    j += 1;
  }

  while (i < originalLines.length) {
    rows.push({ text: originalLines[i], kind: 'removed' });
    i += 1;
  }

  while (j < optimizedLines.length) {
    rows.push({ text: optimizedLines[j], kind: 'added' });
    j += 1;
  }

  const contextRadius = 3;
  const visibleContextIndexes = new Set<number>();

  rows.forEach((row, index) => {
    if (row.kind === 'context') {
      return;
    }
    for (
      let visibleIndex = Math.max(0, index - contextRadius);
      visibleIndex <= Math.min(rows.length - 1, index + contextRadius);
      visibleIndex += 1
    ) {
      visibleContextIndexes.add(visibleIndex);
    }
  });

  const compacted: SqlUnifiedDiffLine[] = [];
  let hiddenContextRun = false;

  rows.forEach((row, index) => {
    if (row.kind === 'context' && !visibleContextIndexes.has(index)) {
      if (!hiddenContextRun) {
        compacted.push({ text: '...', kind: 'separator' });
        hiddenContextRun = true;
      }
      return;
    }
    hiddenContextRun = false;
    compacted.push(row);
  });

  const changedLineCount = compacted.filter(
    (row) => row.kind === 'added' || row.kind === 'removed',
  ).length;
  if (changedLineCount === 0) {
    return rows.slice(0, 120);
  }

  return compacted;
}

function getReviewAgentLabel(reviewAgent: string | null | undefined): string {
  return reviewAgent === 'CORTEX_ANALYST' ? 'Cortex Analyst' : 'Snowflake validation repair';
}

export default function MappingPage() {
  return <MappingPageContent />;
}

function MappingPageContent() {
  const router = useRouter();
  const { setContent, collapsed, setCollapsed, width, setWidth } = useSidebarSlot();
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const dispatch = useAppDispatch();
  const lastValidatedReviewContextRef = useRef<string | null>(null);
  const [activeTab, setActiveTab] = useState<MappingTab>('mapping');
  const { notifyTourContextChanged } = useTour();

  useEffect(() => {
    notifyTourContextChanged();
  }, [activeTab, notifyTourContextChanged]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewStage, setReviewStage] = useState<string | null>(null);
  const [reviewResult, setReviewResult] = useState<MappingSqlReviewResponse | null>(null);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewBannerDismissed, setReviewBannerDismissed] = useState(false);
  const [approvedVariant, setApprovedVariant] = useState<'original' | 'optimized'>('original');
  const [reviewSelectionVariant, setReviewSelectionVariant] = useState<'original' | 'optimized' | null>(null);
  const [approvedPreviewSql, setApprovedPreviewSql] = useState<string | null>(null);
  const [validatedPreviewData, setValidatedPreviewData] = useState<MappingSqlPreviewResponse | null>(null);
  const [editableSql, setEditableSql] = useState('');
  const [sqlParseLoading, setSqlParseLoading] = useState(false);
  // Recompilation runs in the background whenever mappings change (applying a
  // pre-processing rule, auto-map, editing a row). Tracked so the user gets
  // feedback instead of the SQL silently going stale for a few seconds.
  const [isCompilingSql, setIsCompilingSql] = useState(false);
  const [sqlParseResult, setSqlParseResult] = useState<MappingSqlParseResponse | null>(null);
  const [sqlParseDialogOpen, setSqlParseDialogOpen] = useState(false);
  const [selectedPreviewRowIndex, setSelectedPreviewRowIndex] = useState(0);
  const {
    mappings,
    mappingLoading,
    targetAttributeGroup,
    initializeMappings,
    fullData,
    sources,
    targets,
    loadState,
    errorState,
    relationships,
    derivedSources,
    drivingTableId,
    sourceAttributeGroups,
    sourceFilterSql,
    sourceFilterGroups,
    sourceQuerySql,
    sourceGroupBySql,
    sourceOrderBySql,
    semanticBundleId,
    semanticBundleLabel,
    semanticViewName,
    mappingSql,
    compiledMappingSql,
    compiledMappingPreviewSql,
    compiledMappingContextHash,
    openSttmStatus,
    sessionHydrated,
    activeProjectId,
    activeSttmId,
    isPreProcessModalOpen,
    applySemanticRefresh,
    refreshAssistantSignals,
    setMappingPreviewSql,
    setMappingSqlVariant,
    setCompiledMappingResult,
    applyParsedSqlWorkspace,
  } = useSttmBuilderContext();
  const uploadHydratedRef = useRef(false);

  useEffect(() => {
    if (uploadHydratedRef.current || loadState.initial !== 'success') return;
    const raw = sessionStorage.getItem('upload_parsed_data');
    if (!raw) return;
    let uploaded: SqlUploadResult;
    try {
      uploaded = JSON.parse(raw) as SqlUploadResult;
    } catch {
      sessionStorage.removeItem('upload_parsed_data');
      return;
    }
    applyParsedSqlWorkspace(buildSqlUploadWorkspace(uploaded));
    uploadHydratedRef.current = true;
    sessionStorage.removeItem('upload_parsed_data');
    refreshAssistantSignals('sql.upload.applied');
  }, [applyParsedSqlWorkspace, loadState.initial, refreshAssistantSignals]);

  const hasSelectedSources = useMemo(
    () => sources.some((table) => table.isSelected),
    [sources],
  );
  const hasSelectedDerivedSources = useMemo(
    () => derivedSources.some((source) => source.isSelected),
    [derivedSources],
  );
  const hasSelectedInputs = hasSelectedSources || hasSelectedDerivedSources;

  const hasSelectedTarget = useMemo(
    () => targets.some((table) => table.isSelected),
    [targets],
  );

  const hasTargetColumns = useMemo(
    () => (targetAttributeGroup?.columns?.filter((col) => col.name).length ?? 0) > 0,
    [targetAttributeGroup],
  );
  const selectedTargetQualifiedNameForHydration =
    targets.find((table) => table.isSelected)?.qualifiedName ?? null;
  const selectedTargetMetadataLoaded = Boolean(
    selectedTargetQualifiedNameForHydration
    && targetAttributeGroup?.qualifiedName === selectedTargetQualifiedNameForHydration
    && hasTargetColumns,
  );
  const isSavedWorkspace = Boolean(activeProjectId && activeSttmId);

  const savedWorkspaceHydrating =
    !sessionHydrated ||
    openSttmStatus === 'loading' ||
    (isSavedWorkspace &&
      openSttmStatus === 'success' &&
      !selectedTargetMetadataLoaded &&
      loadState.attributes !== 'error' &&
      !errorState.attributes);

  const totalCount = mappings.length;
  const mappedCount = mappings.filter((m) => m.status === 'MAPPED').length;
  const selectedInputCount = useMemo(
    () =>
      sources.filter((table) => table.isSelected).length +
      derivedSources.filter((source) => source.isSelected).length,
    [derivedSources, sources],
  );
  const filterCount = useMemo(
    () => countFilterConditions(sourceFilterGroups as Array<{ type?: string; children?: unknown[] }>),
    [sourceFilterGroups],
  );

  useEffect(() => {
    setContent(null);
    return () => setContent(null);
  }, [setContent]);

  useEffect(() => {
    const handlePointerMove = (event: MouseEvent) => {
      const state = resizeStateRef.current;
      if (!state) {
        return;
      }
      const nextWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, state.startWidth + event.clientX - state.startX),
      );
      setWidth(nextWidth);
    };

    const handlePointerUp = () => {
      resizeStateRef.current = null;
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
    };
  }, [setWidth]);

  const beginResize = (event: React.MouseEvent<HTMLDivElement>) => {
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: width,
    };
  };

  useEffect(() => {
    if (savedWorkspaceHydrating) {
      return;
    }
    if (!hasSelectedInputs || !hasSelectedTarget) {
      router.replace('/sttm/builder/new');
      return;
    }

    if (loadState.attributes === 'loading' || loadState.attributes === 'idle') {
      return;
    }

    // A saved mapping already has durable mapping rows. Do not send it back to
    // Selection simply because source metadata completed before target metadata.
    // The selected-target hydration effect will populate the target group.
    if (!hasTargetColumns && !isSavedWorkspace) {
      router.replace('/sttm/builder/new');
    }
  }, [
    hasSelectedInputs,
    hasSelectedTarget,
    hasTargetColumns,
    isSavedWorkspace,
    loadState.attributes,
    router,
    savedWorkspaceHydrating,
  ]);

  const targetTableKey = targetAttributeGroup?.qualifiedName ?? '';
  const targetColumnsSignature = useMemo(
    () =>
      (targetAttributeGroup?.columns ?? [])
        .filter((col) => col.name)
        .map((col) => `${col.name}:${col.type ?? ''}`)
        .join('|'),
    [targetAttributeGroup],
  );

  useEffect(() => {
    if (
      savedWorkspaceHydrating ||
      !targetAttributeGroup ||
      !targetColumnsSignature ||
      mappings.length > 0
    ) {
      return;
    }

    const initialMappings = targetAttributeGroup.columns
      .filter((col) => col.name)
      .map((col, idx) => {
        const targetColumn = col.name as string;
        return {
          id: `${targetTableKey}-${idx}`,
          targetColumn,
          targetType: col.type || 'VARCHAR',
          sourceColumn: null,
          sourceType: null,
          expression: null,
          rule: 'Select...' as const,
          status: 'UNMAPPED' as const,
          nlRule: null,
          loadOrder: null,
          description: null,
          confidenceScore: null,
          confidenceReason: null,
          candidateSourceColumns: [],
          unmatchedReason: null,
          aiSuggestedRule: null,
          aiSuggestedRuleType: null,
        };
      });
    initializeMappings(initialMappings);
  }, [
    targetAttributeGroup,
    targetTableKey,
    targetColumnsSignature,
    mappings,
    initializeMappings,
    savedWorkspaceHydrating,
  ]);

  const selectedSourceKey = useMemo(
    () =>
      Array.from(new Set([
        ...collectSelectedSourceQualifiedNames(fullData?.sources ?? []),
        ...sources.filter((table) => table.isSelected).map((table) => table.qualifiedName),
      ]))
        .sort()
        .join('|'),
    [fullData?.sources, sources],
  );

  const selectedTargetKey =
    targets.find((table) => table.isSelected)?.qualifiedName ?? '';

  useEffect(() => {
    if (openSttmStatus === 'loading') return;
    if (selectedSourceKey) {
      dispatch(
        fetchAttributes({
          qualifiedNames: selectedSourceKey.split('|'),
          side: 'source',
        }),
      );
    }
    if (selectedTargetKey) {
      dispatch(
        fetchAttributes({
          qualifiedNames: [selectedTargetKey],
          side: 'target',
        }),
      );
    }
  }, [dispatch, openSttmStatus, selectedSourceKey, selectedTargetKey]);

  const selectedTargetQualifiedName =
    targets.find((table) => table.isSelected)?.qualifiedName ??
    targetAttributeGroup?.qualifiedName ??
    null;

  const selectedSourceTables = useMemo(
    () =>
      sources
        .filter((table) => table.isSelected)
        .map((table) => qualifiedNameToTableRef(table.qualifiedName))
        .filter((table): table is TableRef => Boolean(table)),
    [sources],
  );
  const selectedDerivedSourceRecords = useMemo(
    () => derivedSources.filter((source) => source.isSelected),
    [derivedSources],
  );

  const selectedTargetTableRef = useMemo(
    () =>
      selectedTargetQualifiedName
        ? qualifiedNameToTableRef(selectedTargetQualifiedName)
        : null,
    [selectedTargetQualifiedName],
  );

  const drivingTableRef = useMemo(
    () => (drivingTableId ? qualifiedNameToTableRef(drivingTableId) : null),
    [drivingTableId],
  );

  const selectedColumnsByTable = useMemo(
    () =>
      Object.fromEntries(
        sourceAttributeGroups
          .map((group) => [
            group.qualifiedName,
            group.columns.map((column) => String(column.name)).filter(Boolean),
          ])
          .filter(([, columns]) => columns.length > 0),
      ),
    [sourceAttributeGroups],
  );

  const relationshipPayload = useMemo(
    () =>
      relationships
        .filter((join) => join.leftTableId && join.rightTableId && join.conditions?.length)
        .map((join) => {
          const leftTable = qualifiedNameToTableRef(String(join.leftTableId));
          const rightTable = qualifiedNameToTableRef(String(join.rightTableId));
          return leftTable && rightTable
            ? {
                left_table: leftTable,
                right_table: rightTable,
                join_type: join.joinType ?? 'INNER',
                constraint_name: join.constraintName ?? null,
                source: join.source ?? 'USER_DEFINED',
                locked: join.locked ?? false,
                conditions: (join.conditions ?? [])
                  .filter((condition) => condition.leftColumn && condition.rightColumn)
                  .map((condition) => ({
                    left_column: String(condition.leftColumn),
                    right_column: String(condition.rightColumn),
                    operator: condition.operator ?? '=',
                  })),
              }
            : null;
        })
        .filter((join): join is NonNullable<typeof join> => Boolean(join)),
    [relationships],
  );

  const resolvedSourceQuerySql = useMemo(
    () =>
      buildFallbackSourceQuerySql({
        sourceQuerySql,
        sourceTables: selectedSourceTables,
        derivedSources: selectedDerivedSourceRecords,
        relationships: relationshipPayload,
        drivingTable: drivingTableRef,
      }),
    [
      drivingTableRef,
      relationshipPayload,
      selectedDerivedSourceRecords,
      selectedSourceTables,
      sourceQuerySql,
    ],
  );

  const generatedInsertSql = useMemo(
    () =>
      buildMappingInsertSql({
        mappings,
        targetQualifiedName: selectedTargetQualifiedName,
        sourceQuerySql: resolvedSourceQuerySql,
        sourceTables: selectedSourceTables,
        derivedSources: selectedDerivedSourceRecords,
        sourceFilterSql,
        sourceGroupBySql,
        sourceOrderBySql,
      }),
    [
      selectedDerivedSourceRecords,
      selectedSourceTables,
      mappings,
      resolvedSourceQuerySql,
      selectedTargetQualifiedName,
      sourceFilterSql,
      sourceGroupBySql,
      sourceOrderBySql,
    ],
  );

  const previewSql = useMemo(
    () =>
      buildMappingSelectSql({
        mappings,
        sourceQuerySql: resolvedSourceQuerySql,
        sourceTables: selectedSourceTables,
        derivedSources: selectedDerivedSourceRecords,
        sourceFilterSql,
        sourceGroupBySql,
        sourceOrderBySql,
      }),
    [
      selectedDerivedSourceRecords,
      selectedSourceTables,
      mappings,
      resolvedSourceQuerySql,
      sourceFilterSql,
      sourceGroupBySql,
      sourceOrderBySql,
    ],
  );

  const compilerRelationGraph = useMemo(
    () => buildCompilerRelationGraph({
      sourceTables: selectedSourceTables,
      sourceColumnsByTable: Object.fromEntries(
        sourceAttributeGroups.map((group) => [group.qualifiedName, group.columns]),
      ),
      derivedSources: selectedDerivedSourceRecords,
      relationships,
      mappings,
    }),
    [mappings, relationships, selectedDerivedSourceRecords, selectedSourceTables, sourceAttributeGroups],
  );
  const [compiledSql, setCompiledSql] = useState<MappingSqlCompileResponse | null>(null);
  const [compilerError, setCompilerError] = useState<string | null>(null);
  const compilerContextHash = useMemo(
    () =>
      JSON.stringify({
        relationGraph: compilerRelationGraph,
        mappings: mappings.filter((mapping) => mapping.status === 'MAPPED').map((mapping) => ({
          targetColumn: mapping.targetColumn,
          targetType: mapping.targetType,
          sourceColumn: mapping.sourceColumn,
          sourceColumns: mapping.sourceColumns,
          mappingMode: mapping.mappingMode,
          constantValue: mapping.constantValue,
          expression: mapping.expression,
          rule: mapping.rule,
          sourceDependencies: mapping.sourceDependencies,
          valueBindingIds: mapping.valueBindingIds,
        })),
        targetTable: selectedTargetTableRef,
        drivingTableId,
        sourceFilterSql,
        sourceGroupBySql,
        sourceOrderBySql,
      }),
    [
      compilerRelationGraph,
      drivingTableId,
      mappings,
      selectedTargetTableRef,
      sourceFilterSql,
      sourceGroupBySql,
      sourceOrderBySql,
    ],
  );

  useEffect(() => {
    const activeMappings = mappings.filter((mapping) => mapping.status === 'MAPPED');
    if (
      mappingLoading
      || !activeMappings.length
      || !compilerRelationGraph.nodes.length
      || mappingSql.trim()
    ) {
      setCompiledSql(null);
      setCompilerError(null);
      return;
    }
    if (
      compiledMappingContextHash === compilerContextHash
      && compiledMappingSql.trim()
      && compiledMappingPreviewSql.trim()
    ) {
      setCompiledSql(null);
      setCompilerError(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsCompilingSql(true);
      try {
        const response = await dbService.compileMappingSql({
          relation_graph: compilerRelationGraph,
          mappings: activeMappings.map((mapping) => ({
            target_column: mapping.targetColumn,
            target_type: mapping.targetType,
            source_column: mapping.sourceColumn,
            source_columns: mapping.sourceColumns ?? parseSourceColumns(mapping.sourceColumn),
            mapping_mode: mapping.mappingMode ?? 'source',
            constant_value: mapping.constantValue ?? null,
            attribute_name: mapping.attributeName ?? null,
            expression: mapping.expression,
            rule: mapping.rule,
            status: mapping.status,
            nl_rule: mapping.nlRule,
            description: mapping.description,
            source_dependencies: mapping.sourceDependencies ?? mapping.sourceColumns ?? parseSourceColumns(mapping.sourceColumn),
            value_binding_ids: mapping.mappingMode === 'constant' || mapping.mappingMode === 'attribute'
              ? (mapping.valueBindingIds?.length ? mapping.valueBindingIds : [mapping.id])
              : [],
            precedent_decision: mapping.precedentDecision,
            precedent_mapping_id: mapping.precedentMappingId,
          })),
          target_table: selectedTargetTableRef,
          driving_relation_id: drivingTableId || compilerRelationGraph.nodes[0]?.relation_id || null,
          where_predicates: sourceFilterSql?.trim() ? [sourceFilterSql.trim()] : [],
          group_by_expressions: sourceGroupBySql?.trim() ? [sourceGroupBySql.trim()] : [],
          order_by_expressions: sourceOrderBySql?.trim() ? [sourceOrderBySql.trim()] : [],
          self_contained_derived: true,
          validate_with_explain: false,
          allow_unresolved_placeholders: true,
          // Linked mappings guide the agents, but current SQL is always compiled
          // from the current relation graph and current mapping expressions.
          accepted_precedent_sttm_id: null,
        });
        if (!cancelled) {
          setCompiledSql(response);
          setCompilerError(null);
          setCompiledMappingResult({
            generatedSql: response.generated_sql,
            previewSql: response.preview_sql,
            contextHash: compilerContextHash,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setCompilerError(error instanceof Error ? error.message : 'The relation graph could not be compiled.');
        }
      } finally {
        setIsCompilingSql(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      // The debounced call may never have started; clear the flag either way so
      // a superseded compile cannot leave the indicator spinning.
      setIsCompilingSql(false);
    };
  }, [
    compilerRelationGraph,
    compilerContextHash,
    compiledMappingContextHash,
    compiledMappingPreviewSql,
    compiledMappingSql,
    drivingTableId,
    mappingLoading,
    mappingSql,
    mappings,
    selectedTargetTableRef,
    sourceFilterSql,
    sourceGroupBySql,
    sourceOrderBySql,
    setCompiledMappingResult,
  ]);

  const sourceQueryPreviewSql = useMemo(
    () =>
      buildSourceQueryPreviewSql({
        sourceQuerySql: resolvedSourceQuerySql,
        sourceFilterSql,
        sourceGroupBySql,
        sourceOrderBySql,
      }),
    [resolvedSourceQuerySql, sourceFilterSql, sourceGroupBySql, sourceOrderBySql],
  );

  // `mappingSql` is the immutable/imported mapping SQL. The SQL assembled
  // from rows is useful as a live preview for brand-new mappings, but it must
  // never replace the uploaded source text when a saved mapping is reopened.
  const canonicalOrGeneratedPreviewSql = useMemo(
    () => (mappingSql.trim()
      ? mappingSql
      : compiledMappingContextHash === compilerContextHash && compiledMappingPreviewSql.trim()
        ? compiledMappingPreviewSql
        : compiledSql?.preview_sql ?? previewSql),
    [compiledMappingContextHash, compiledMappingPreviewSql, compiledSql, compilerContextHash, mappingSql, previewSql],
  );

  const canonicalOrGeneratedExecutionSql = useMemo(
    () => (mappingSql.trim()
      ? mappingSql
      : compiledMappingContextHash === compilerContextHash && compiledMappingSql.trim()
        ? compiledMappingSql
        : compiledSql?.generated_sql ?? generatedInsertSql),
    [compiledMappingContextHash, compiledMappingSql, compiledSql, compilerContextHash, generatedInsertSql, mappingSql],
  );

  useEffect(() => {
    if (!sqlParseDialogOpen) {
      setEditableSql(canonicalOrGeneratedPreviewSql);
    }
  }, [canonicalOrGeneratedPreviewSql, sqlParseDialogOpen]);

  const knownSqlTables = useMemo(() => {
    const refs = new Map<string, TableRef>();
    const collect = (
      databases: NonNullable<typeof fullData>['sources'],
    ) => {
      for (const database of databases ?? []) {
        for (const schema of database.schemas ?? []) {
          for (const table of schema.tables ?? []) {
            const ref = qualifiedNameToTableRef(table.qualifiedName);
            if (ref) refs.set(table.qualifiedName.toUpperCase(), ref);
          }
        }
      }
    };
    collect(fullData?.sources ?? []);
    collect(fullData?.targets ?? []);
    return Array.from(refs.values());
  }, [fullData]);

  const handleApplyParsedSql = useCallback(() => {
    if (!sqlParseResult?.valid) return;
    const workspace = sqlParseResult.parsed_workspace;
    const parsedMappings: MappingState[] = (workspace.mapping_rows ?? []).map((item, index) => {
      const targetColumn = String(item.target_column ?? item.target_alias ?? `COLUMN_${index + 1}`);
      const sourceColumns = Array.isArray(item.source_columns)
        ? item.source_columns.map(String)
        : [];
      const mappingModeRaw = String(item.mapping_mode ?? '').toLowerCase();
      const isValueBinding = mappingModeRaw === 'constant' || mappingModeRaw === 'attribute';
      return {
        id: `sql:${targetColumn}:${index}`,
        targetColumn,
        targetType:
          targetAttributeGroup?.columns.find((column) => column.name === targetColumn)?.type ?? 'TEXT',
        sourceColumn:
          isValueBinding
            ? null
            : sourceColumns[0] ?? (String(item.source_column ?? '') || null),
        sourceColumns,
        sourceType: null,
        mappingMode:
          mappingModeRaw === 'constant'
            ? 'constant'
            : mappingModeRaw === 'attribute'
              ? 'attribute'
              : 'source',
        constantValue:
          isValueBinding
            ? String(item.constant_value ?? '')
            : null,
        attributeName:
          mappingModeRaw === 'attribute'
            ? String(item.attribute_name ?? '')
            : null,
        expression:
          isValueBinding
            ? null
            : item.expression ? String(item.expression) : null,
        rule:
          isValueBinding
            ? 'Value'
            : item.expression ? 'Custom' : 'Direct',
        status: 'MAPPED',
      };
    });
    const parsedRelationships: JoinConfig[] = (workspace.relationships ?? []).map((item, index) => {
      const keys = Array.isArray(item.keys) ? item.keys.map(String) : [];
      const condition = String(item.condition ?? '');
      const conditionColumns = keys.length >= 2
        ? keys.slice(0, 2)
        : condition.split('=').map((value) => value.trim()).filter(Boolean).slice(0, 2);
      const joinType = String(item.join_type ?? 'INNER').replace(/\s+JOIN$/i, '').toUpperCase();
      return {
        id: `sql-join:${index}`,
        joinType: (['INNER', 'LEFT', 'RIGHT', 'FULL'].includes(joinType) ? joinType : 'INNER') as JoinConfig['joinType'],
        leftTableId: String(item.left_table ?? ''),
        rightTableId: String(item.right_table ?? ''),
        source: 'USER_DEFINED',
        conditions: conditionColumns.length >= 2
          ? [{
              leftColumn: conditionColumns[0].split('.').pop(),
              operator: '=',
              rightColumn: conditionColumns[1].split('.').pop(),
            }]
          : [],
      };
    });
    applyParsedSqlWorkspace({
      sourceTableFqns: workspace.source_tables ?? [],
      targetTableFqn: workspace.target_table ?? null,
      relationships: parsedRelationships,
      mappings: parsedMappings,
      derivedSources: (workspace.derived_sources ?? []).map((item) => ({
        name: String(item.name ?? 'derived_source'),
        sqlText: item.sql_text ? String(item.sql_text) : null,
        inputTables: Array.isArray(item.tables_referenced)
          ? item.tables_referenced.map(String)
          : [],
      })),
      filterSql: (workspace.filters ?? [])
        .map((item) => String(item.sql_fragment ?? ''))
        .filter(Boolean)
        .join('\n'),
      sql: String(workspace.sql ?? editableSql),
    });
    setSqlParseDialogOpen(false);
    setReviewResult(null);
    setValidatedPreviewData(null);
    refreshAssistantSignals('sql.applied');
  }, [
    applyParsedSqlWorkspace,
    editableSql,
    refreshAssistantSignals,
    sqlParseResult,
    targetAttributeGroup,
  ]);

  const mappedMappings = useMemo(
    () =>
      mappings
        .filter((mapping) => mapping.status === 'MAPPED')
        .map((mapping) => ({
          target_column: mapping.targetColumn,
          target_type: mapping.targetType,
          source_column: mapping.sourceColumn,
          source_columns:
            mapping.sourceColumns && mapping.sourceColumns.length
              ? mapping.sourceColumns
              : parseSourceColumns(mapping.sourceColumn),
          mapping_mode: mapping.mappingMode ?? "source",
          constant_value: mapping.constantValue ?? null,
          attribute_name: mapping.attributeName ?? null,
          expression: mapping.expression,
          rule: mapping.rule,
          status: mapping.status,
          nl_rule: mapping.nlRule,
          description: mapping.description,
        })),
    [mappings],
  );

  const mappingSqlRequestPayload = useMemo(
    () => ({
      source_tables: selectedSourceTables,
      target_table: selectedTargetTableRef,
      driving_table: drivingTableRef,
      selected_derived_sources: derivedSources
        .filter((source) => source.isSelected)
        .map((source) => source.id),
      relationships: relationshipPayload,
      selected_columns_by_table: selectedColumnsByTable,
      semantic_bundle_id: semanticBundleId,
      semantic_bundle_label: semanticBundleLabel,
      semantic_view_name: semanticViewName,
      relation_graph: compilerRelationGraph,
      source_query_sql: sourceQueryPreviewSql,
      preview_sql: canonicalOrGeneratedPreviewSql,
      generated_sql: canonicalOrGeneratedExecutionSql,
      mappings: mappedMappings,
      preview_limit: 5,
    }),
    [
      derivedSources,
      drivingTableRef,
      canonicalOrGeneratedExecutionSql,
      canonicalOrGeneratedPreviewSql,
      compilerRelationGraph,
      mappedMappings,
      relationshipPayload,
      selectedColumnsByTable,
      selectedSourceTables,
      selectedTargetTableRef,
      semanticBundleId,
      semanticBundleLabel,
      semanticViewName,
      sourceQueryPreviewSql,
    ],
  );

  const handleReviewSqlChanges = useCallback(async () => {
    if (!editableSql.trim()) return;
    setSqlParseLoading(true);
    try {
      const result = await dbService.parseMappingSql({
        sql: editableSql,
        known_tables: knownSqlTables,
        current_workspace: {
          source_tables: selectedSourceTables.map(
            (table) => `${table.database}.${table.schema}.${table.table}`,
          ),
          target_table: selectedTargetQualifiedName,
          mapping_rows: mappedMappings,
          relationships: relationshipPayload,
          filters: sourceFilterSql ? [{ sql_fragment: sourceFilterSql }] : [],
        },
      });
      setSqlParseResult(result);
      setSqlParseDialogOpen(true);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'SQL parsing failed.');
    } finally {
      setSqlParseLoading(false);
    }
  }, [
    editableSql,
    knownSqlTables,
    mappedMappings,
    relationshipPayload,
    selectedSourceTables,
    selectedTargetQualifiedName,
    sourceFilterSql,
  ]);

  const reviewContextSignature = useMemo(
    () =>
      JSON.stringify({
        target: selectedTargetQualifiedName,
        drivingTableId,
        selectedSourceTables: selectedSourceTables
          .map((table) => `${table.database}.${table.schema}.${table.table}`)
          .sort(),
        selectedDerivedSources: selectedDerivedSourceRecords.map((source) => source.id).sort(),
        relationshipSignature: relationshipPayload.map((join) => ({
          left: `${join.left_table.database}.${join.left_table.schema}.${join.left_table.table}`,
          right: `${join.right_table.database}.${join.right_table.schema}.${join.right_table.table}`,
          joinType: join.join_type,
          conditions: join.conditions,
        })),
        mappingSql: canonicalOrGeneratedPreviewSql,
      }),
    [
      drivingTableId,
      canonicalOrGeneratedPreviewSql,
      relationshipPayload,
      selectedDerivedSourceRecords,
      selectedSourceTables,
      selectedTargetQualifiedName,
    ],
  );

  useEffect(() => {
    if (reviewResult || validatedPreviewData) {
      return;
    }
    setApprovedVariant('original');
    setReviewSelectionVariant(null);
    setApprovedPreviewSql(null);
    setSelectedPreviewRowIndex(0);
        setPreviewError(null);
    setReviewBannerDismissed(false);
    setMappingPreviewSql(previewSql);
    setMappingSqlVariant('original');
  }, [
    generatedInsertSql,
    previewSql,
    reviewResult,
    setMappingPreviewSql,
    setMappingSqlVariant,
    validatedPreviewData,
  ]);

  useEffect(() => {
    if ((!reviewResult && !validatedPreviewData) || !lastValidatedReviewContextRef.current) {
      return;
    }
    if (reviewContextSignature === lastValidatedReviewContextRef.current) {
      return;
    }
    if (reviewDialogOpen || reviewLoading || previewLoading) {
      return;
    }
    lastValidatedReviewContextRef.current = reviewContextSignature;
    setApprovedVariant('original');
    setReviewSelectionVariant(null);
    setApprovedPreviewSql(null);
    setValidatedPreviewData(null);
    setSelectedPreviewRowIndex(0);
    setPreviewError(null);
    setReviewResult(null);
    setReviewStage(null);
    setReviewBannerDismissed(false);
    setMappingPreviewSql(previewSql);
    setMappingSqlVariant('original');
  }, [
    generatedInsertSql,
    previewLoading,
    previewSql,
    reviewContextSignature,
    reviewDialogOpen,
    reviewLoading,
    reviewResult,
    setMappingPreviewSql,
    setMappingSqlVariant,
    validatedPreviewData,
  ]);

  useEffect(() => {
    const handleRunValidation = () => setActiveTab('sql-preview');
    window.addEventListener('sttm:run-validation', handleRunValidation);
    return () => window.removeEventListener('sttm:run-validation', handleRunValidation);
  }, []);

  const runValidatedPreview = async (
    variant: 'original' | 'optimized',
    review: MappingSqlReviewResponse,
  ) => {
    setPreviewLoading(true);
    setPreviewError(null);
    setReviewStage(
      variant === 'optimized'
        ? 'Running the Cortex Analyst-approved SQL preview in Snowflake...'
        : 'Running the approved SQL preview in Snowflake...'
    );
    const approvedPreview = variant === 'optimized'
      ? review.optimized_preview_sql ?? review.original_preview_sql
      : review.original_preview_sql;
    const approvedGenerated = variant === 'optimized'
      ? review.optimized_generated_sql ?? review.original_generated_sql
      : review.original_generated_sql;

    try {
      const result = await dbService.previewMappingSql({
        ...mappingSqlRequestPayload,
        chosen_variant: variant,
        approved_preview_sql: approvedPreview,
        approved_generated_sql: approvedGenerated,
      });
      setApprovedVariant(variant);
      setApprovedPreviewSql(approvedPreview);
      setMappingPreviewSql(result.executed_preview_sql || approvedPreview);
      setMappingSqlVariant(result.variant_used ?? variant);
      setValidatedPreviewData(result);
      setActiveTab('data-preview');
      setReviewStage(
        `${result.variant_used === 'optimized' ? 'Optimized' : 'Original'} SQL preview finished. ${result.preview_rows.length} sample row(s) were returned.`
      );
    } catch (error) {
      setPreviewError(
        error instanceof Error ? error.message : 'Unable to run validated SQL preview.',
      );
      setValidatedPreviewData(null);
      setActiveTab('data-preview');
      setReviewStage('Preview execution failed. Review the error details below.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleRunPreview = async () => {
    if (!reviewResult) {
      setPreviewLoading(true);
      setPreviewError(null);
      setReviewStage('Running the current SQL preview in Snowflake...');
      try {
        const result = await dbService.previewMappingSql({
          ...mappingSqlRequestPayload,
          chosen_variant: 'original',
          approved_preview_sql: canonicalOrGeneratedPreviewSql,
          approved_generated_sql: canonicalOrGeneratedExecutionSql,
        });
        setApprovedVariant('original');
        setApprovedPreviewSql(result.executed_preview_sql || canonicalOrGeneratedPreviewSql);
        setMappingPreviewSql(result.executed_preview_sql || canonicalOrGeneratedPreviewSql);
        setMappingSqlVariant('original');
        setValidatedPreviewData(result);
        setActiveTab('data-preview');
        setReviewStage(`SQL preview finished. ${result.preview_rows.length} sample row(s) were returned.`);
      } catch (error) {
        setPreviewError(
          error instanceof Error ? error.message : 'Unable to run the current SQL preview.',
        );
        setValidatedPreviewData(null);
        setActiveTab('sql-preview');
        setReviewStage('Preview execution failed. Validate SQL to generate a reviewed repair.');
      } finally {
        setPreviewLoading(false);
      }
      return;
    }
    const variant = reviewResult.requires_approval
      ? reviewSelectionVariant
      : (reviewSelectionVariant ?? 'original');
    if (!variant) {
      setReviewDialogOpen(true);
      return;
    }
    await runValidatedPreview(variant, reviewResult);
  };

  const handleValidateSql = async () => {
    if (!mappedMappings.length) {
      setReviewError('Map at least one target attribute before validating SQL.');
      setActiveTab('sql-preview');
      return;
    }
    setReviewLoading(true);
    setReviewError(null);
        setPreviewError(null);
    setValidatedPreviewData(null);
    setReviewResult(null);
    setReviewBannerDismissed(false);
    setApprovedVariant('original');
    setReviewStage(
      semanticViewName
        ? 'Checking the generated SQL with Cortex Analyst and Snowflake validation...'
        : 'Preparing the semantic view before Cortex Analyst reviews the SQL...',
    );
    refreshAssistantSignals("before_validation");
    try {
      let reviewPayload: MappingSqlReviewRequest = mappingSqlRequestPayload;
      if (!semanticViewName) {
        const semanticRefresh = await dbService.refreshSemanticContext({
          selected_source_tables: selectedSourceTables,
          selected_derived_sources: derivedSources
            .filter((source) => source.isSelected)
            .map((source) => source.id),
          target_table: selectedTargetTableRef,
          relationships: relationshipPayload as Array<Record<string, unknown>>,
          requested_level: 'FULL_REGISTRY',
          force: false,
        });
        applySemanticRefresh(semanticRefresh);
        reviewPayload = {
          ...mappingSqlRequestPayload,
          semantic_bundle_id: semanticRefresh.bundle_id ?? mappingSqlRequestPayload.semantic_bundle_id,
          semantic_bundle_label: semanticRefresh.bundle_label ?? mappingSqlRequestPayload.semantic_bundle_label,
          semantic_view_name: semanticRefresh.semantic_view_name ?? null,
          semantic_model_yaml: semanticRefresh.semantic_model_yaml ?? null,
        };
        setReviewStage(
          semanticRefresh.semantic_view_name || semanticRefresh.semantic_model_yaml
            ? 'Semantic model ready. Cortex Analyst is reviewing the SQL...'
            : 'No Analyst-ready semantic model was available. Running Snowflake validation only...',
        );
      }
      const result = await dbService.reviewMappingSql(reviewPayload);
      lastValidatedReviewContextRef.current = reviewContextSignature;
      setReviewResult(result);
      setReviewSelectionVariant(result.requires_approval ? 'original' : null);
      const defaultPreviewSql =
        result.optimized_preview_sql ?? result.original_preview_sql;
      setApprovedPreviewSql(result.requires_approval ? result.original_preview_sql : defaultPreviewSql);
      if (result.requires_approval) {
        setMappingPreviewSql(result.original_preview_sql);
        setMappingSqlVariant('original');
      } else {
        setMappingPreviewSql(defaultPreviewSql);
        setMappingSqlVariant('original');
      }
      setActiveTab('sql-preview');
      if (!result.execution_ready) {
        setReviewStage(result.review_summary || 'SQL review found issues that still need attention before preview can run.');
      } else if (result.review_agent === 'CORTEX_ANALYST') {
        setReviewStage(
          result.requires_approval
            ? 'Cortex Analyst found an optimization suggestion. Review the proposed SQL before running the preview.'
            : 'Cortex Analyst reviewed the SQL and found no required optimization changes. You can run the preview now.'
        );
      } else {
        setReviewStage(
          result.requires_approval
            ? 'Snowflake validation found an optimized SQL option. Review it before running the preview.'
            : 'Snowflake validation completed successfully. No SQL optimization changes were required.'
        );
      }
      if (result.requires_approval && result.optimized_preview_sql) {
        setReviewDialogOpen(true);
      }
      refreshAssistantSignals("after_validation");
    } catch (error) {
      refreshAssistantSignals("after_validation");
      setReviewError(
        error instanceof Error ? error.message : 'Unable to validate the generated SQL.',
      );
      setReviewStage('SQL review failed. Fix the issue and try validation again.');
    } finally {
      setReviewLoading(false);
    }
  };

  const handleAiSqlRepair = useCallback(async () => {
    setReviewLoading(true);
    setReviewError(null);
    setReviewStage('AI is repairing the syntax and Snowflake will validate the candidate...');
    try {
      const result = await dbService.reviewMappingSql({
        ...mappingSqlRequestPayload,
        attempt_ai_repair: true,
      });
      setReviewResult(result);
      setReviewSelectionVariant(result.requires_approval ? 'original' : null);
      if (result.optimized_preview_sql) {
        setApprovedPreviewSql(result.original_preview_sql);
        setMappingPreviewSql(result.original_preview_sql);
        setMappingSqlVariant('original');
        setReviewDialogOpen(true);
        setReviewStage('AI prepared a repair that passed Snowflake validation. Compare and approve it.');
      } else {
        setReviewStage(result.review_summary || 'AI could not produce a safe validated repair.');
      }
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Unable to generate an AI SQL repair.');
      setReviewStage('AI SQL repair failed. The current SQL was not changed.');
    } finally {
      setReviewLoading(false);
    }
  }, [mappingSqlRequestPayload, setMappingPreviewSql, setMappingSqlVariant]);

  const handleApproveReviewedSql = useCallback(async (variant: 'original' | 'optimized') => {
    if (!reviewResult) {
      setReviewDialogOpen(false);
      return;
    }
    setReviewDialogOpen(false);
    setApprovedVariant(variant);
    setReviewSelectionVariant(variant);
    if (variant === 'optimized') {
      const optimizedPreviewSql =
        reviewResult.optimized_preview_sql ?? reviewResult.original_preview_sql;
      setApprovedPreviewSql(optimizedPreviewSql);
      setMappingPreviewSql(optimizedPreviewSql);
      setMappingSqlVariant('optimized');
      setReviewStage(
        reviewResult.review_kind === 'repair'
          ? 'Suggested SQL repair applied. Run the preview when you are ready.'
          : 'Optimized SQL applied. Run the preview when you are ready.',
      );
    } else {
      setApprovedPreviewSql(reviewResult.original_preview_sql);
      setMappingPreviewSql(reviewResult.original_preview_sql);
      setMappingSqlVariant('original');
      setReviewStage('Original SQL selected. Run the preview when you are ready.');
    }
  }, [reviewResult, setMappingPreviewSql, setMappingSqlVariant]);

  const previewDisplayRows = useMemo<PreviewDisplayRow[]>(() => {
    if (!validatedPreviewData || !validatedPreviewData.preview_rows?.length) {
      return [];
    }
    const selectedRow =
      validatedPreviewData.preview_rows[selectedPreviewRowIndex] ??
      validatedPreviewData.preview_rows[0];
    const selectedSourceRow =
      validatedPreviewData.source_sample_rows?.[selectedPreviewRowIndex] ??
      validatedPreviewData.source_sample_rows?.[0];
    const sourceRow = selectedSourceRow?.values ?? {};
    const transformedRow = selectedRow?.values ?? {};
    let displayIndex = 1;

    return mappings.flatMap((mapping) => {
      if (mapping.status !== 'MAPPED') {
        return [];
      }
      const sourceColumns =
        mapping.sourceColumns && mapping.sourceColumns.length
          ? mapping.sourceColumns
          : parseSourceColumns(mapping.sourceColumn);
      const effectiveSources = sourceColumns.length ? sourceColumns : ['—'];
      const description =
        mapping.description?.trim() ||
        generateMappingDescription({
          rule: mapping.rule,
          sourceColumns: sourceColumns.filter(Boolean),
          targetColumn: mapping.targetColumn,
          expression: mapping.expression,
        }) ||
        '—';
      const transformedValue = stringifyPreviewValue(transformedRow[mapping.targetColumn]);
      const expressionLabel =
        mapping.expression?.trim() ||
        (mapping.rule && mapping.rule !== 'Direct' && mapping.rule !== 'Select...' ? mapping.rule : null);

      return effectiveSources.map((sourceColumn, index) => {
        const alias = validatedPreviewData.source_sample_aliases?.[sourceColumn];
        const sourceValue =
          sourceColumn === '—'
            ? '—'
            : stringifyPreviewValue(alias ? sourceRow[alias] : undefined);
        const row: PreviewDisplayRow = {
          mappingId: mapping.id,
          targetColumn: mapping.targetColumn,
          targetType: mapping.targetType,
          sourceColumn,
          sourceColumnDisplay: formatSourceColumnDisplay(sourceColumn),
          sourceColumnFullName: sourceColumn,
          sourceValue,
          transformedValue,
          description,
          expressionLabel,
          confidenceScore: mapping.confidenceScore ?? null,
          confidenceReason: mapping.confidenceReason ?? null,
          candidateSourceColumns: mapping.candidateSourceColumns ?? [],
          rowCount: effectiveSources.length,
          rowIndex: index,
          displayIndex,
        };
        if (index === effectiveSources.length - 1) {
          displayIndex += 1;
        }
        return row;
      });
    });
  }, [mappings, selectedPreviewRowIndex, validatedPreviewData]);

  const previewResultRows = useMemo<Array<Record<string, unknown> & { index: number }>>(
    () =>
      (validatedPreviewData?.preview_rows ?? []).map((row, index) => ({
        index: index + 1,
        ...row.values,
      })),
    [validatedPreviewData],
  );

  useEffect(() => {
    if (!previewResultRows.length) {
      setSelectedPreviewRowIndex(0);
      return;
    }
    if (selectedPreviewRowIndex > previewResultRows.length - 1) {
      setSelectedPreviewRowIndex(0);
    }
  }, [previewResultRows.length, selectedPreviewRowIndex]);

  const tabs: Array<{ key: MappingTab; label: string; icon: ReactNode; badge?: number; tourTarget?: string }> = [
    { key: 'mapping', label: 'Mapping', icon: <ChecklistRtlRoundedIcon sx={{ fontSize: 17 }} /> },
    {
      key: 'sql-preview',
      label: 'SQL Preview',
      icon: <TerminalRoundedIcon sx={{ fontSize: 17 }} />,
      badge: mappedCount > 0 ? mappedCount : undefined,
      tourTarget: TOUR_TARGETS.sttmSqlPreviewTab,
    },
    {
      key: 'data-preview',
      label: 'Data Preview',
      icon: <TableRowsRoundedIcon sx={{ fontSize: 17 }} />,
      tourTarget: TOUR_TARGETS.sttmDataPreviewTab,
    },
    {
      key: 'data-lineage',
      label: 'Data Lineage',
      icon: <AccountTreeOutlinedIcon sx={{ fontSize: 17 }} />,
      tourTarget: TOUR_TARGETS.sttmDataLineageTab,
    },
  ];

  const progressTrailing = (
    <MappingProgressIndicator mappedCount={mappedCount} totalCount={totalCount} />
  );

  const compactReviewSummary = useMemo(() => {
    if (!reviewResult?.review_summary) return null;
    const firstSentence = reviewResult.review_summary.split(/(?<=[.!?])\s+/)[0]?.trim();
    return firstSentence || reviewResult.review_summary;
  }, [reviewResult]);

  const reviewDiffDocument = useMemo(
    () => {
      if (!reviewResult?.optimized_preview_sql) {
        return null;
      }
      const hasGeneratedDelta =
        Boolean(reviewResult.optimized_generated_sql) &&
        reviewResult.optimized_generated_sql !== reviewResult.original_generated_sql;
      const originalSql = hasGeneratedDelta
        ? reviewResult.original_generated_sql
        : reviewResult.original_preview_sql;
      const optimizedSql = hasGeneratedDelta
        ? (reviewResult.optimized_generated_sql ?? reviewResult.original_generated_sql)
        : (reviewResult.optimized_preview_sql ?? reviewResult.original_preview_sql);

      return {
        title: hasGeneratedDelta ? 'Final generated SQL changes' : 'Preview SQL changes',
        originalSql,
        optimizedSql,
        lines: buildUnifiedSqlDiffLines(originalSql, optimizedSql),
      };
    },
    [reviewResult],
  );

  const reviewDiffSummary = useMemo(() => {
    const removals = reviewDiffDocument?.lines.filter((row) => row.kind === 'removed').length ?? 0;
    const additions = reviewDiffDocument?.lines.filter((row) => row.kind === 'added').length ?? 0;
    return { removals, additions };
  }, [reviewDiffDocument]);

  const sqlReviewStatusPanel = useMemo(() => {
    if ((!reviewError && !reviewStage && !reviewResult && !previewError) || reviewBannerDismissed) {
      return null;
    }

    const tone = reviewError
      ? 'error'
      : previewError
        ? 'warning'
        : reviewResult && !reviewResult.execution_ready
          ? 'error'
        : reviewResult?.requires_approval
          ? 'warning'
          : reviewLoading || previewLoading
            ? 'info'
            : 'success';

    const primaryMessage = reviewError
      ? reviewError
      : previewError
        ? previewError
        : reviewResult
          ? compactReviewSummary || reviewResult.review_summary
          : reviewStage;

    const secondaryMessage =
      !reviewError && !previewError && reviewResult?.warnings?.length
        ? reviewResult.warnings.join(' ')
        : null;

    return (
      <AiaStack spacing={1.25}>
        {primaryMessage ? (
          <AiaAlert
            severity={tone}
            sx={{ borderRadius: 2, py: 0.25 }}
            action={
              reviewLoading || previewLoading ? (
                <AiaCircularProgress size={18} color="inherit" />
              ) : reviewResult?.requires_approval ? (
                <AiaBox sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                  <AiaButton
                    color="inherit"
                    size="small"
                    sx={{ textTransform: 'none', fontWeight: 700 }}
                    onClick={() => setReviewDialogOpen(true)}
                  >
                    View diff
                  </AiaButton>
                  <AiaButton
                    color="inherit"
                    size="small"
                    disabled={reviewSelectionVariant === 'optimized'}
                    sx={{ textTransform: 'none', fontWeight: 700 }}
                    onClick={() => {
                      void handleApproveReviewedSql('optimized');
                    }}
                  >
                    {reviewSelectionVariant === 'optimized' ? 'Applied' : 'Apply'}
                  </AiaButton>
                  <AiaIconButton size="small" color="inherit" onClick={() => setReviewBannerDismissed(true)}>
                    <CloseRoundedIcon fontSize="small" />
                  </AiaIconButton>
                </AiaBox>
              ) : (
                <AiaBox sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  {reviewResult && !reviewError && !previewError && !reviewLoading && !previewLoading ? (
                    <AiaText sx={{ fontSize: '0.76rem', fontWeight: 700, opacity: 0.9 }}>
                      {!reviewResult.execution_ready
                        ? 'Fix required'
                        : reviewResult.requires_approval
                          ? 'Review required'
                          : 'No changes required'}
                    </AiaText>
                  ) : null}
                  <AiaIconButton size="small" color="inherit" onClick={() => setReviewBannerDismissed(true)}>
                    <CloseRoundedIcon fontSize="small" />
                  </AiaIconButton>
                </AiaBox>
              )
            }
          >
            {reviewResult && !reviewError && !previewError ? (
              <AiaText sx={{ fontSize: '0.82rem', fontWeight: 700, mb: 0.4 }}>
                Reviewed by {getReviewAgentLabel(reviewResult.review_agent)}
              </AiaText>
            ) : null}
            <AiaText sx={{ fontSize: '0.8rem', lineHeight: 1.5 }}>
              {primaryMessage}
            </AiaText>
            {secondaryMessage ? (
              <AiaText sx={{ fontSize: '0.76rem', lineHeight: 1.45, mt: 0.5 }}>
                {secondaryMessage}
              </AiaText>
            ) : null}
            {reviewResult && !reviewResult.execution_ready && reviewResult.repair_options?.length ? (
              <AiaBox sx={{ mt: 1.25, display: 'grid', gap: 0.75 }}>
                <AiaText sx={{ fontSize: '0.78rem', fontWeight: 800 }}>
                  Ways to fix this
                </AiaText>
                {reviewResult.repair_options.map((option) => (
                  <AiaBox
                    key={`${option.code}-${option.identifier ?? ''}`}
                    sx={{
                      minWidth: 0,
                      p: 1,
                      border: '1px solid currentColor',
                      borderRadius: 1.5,
                      opacity: 0.95,
                    }}
                  >
                    <AiaBox sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                      <AiaBox sx={{ minWidth: 0, flex: '1 1 280px' }}>
                        <AiaText sx={{ fontSize: '0.76rem', fontWeight: 800, overflowWrap: 'anywhere' }}>
                          {option.title}
                        </AiaText>
                        <AiaText sx={{ mt: 0.25, fontSize: '0.73rem', lineHeight: 1.45, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                          {option.description}
                        </AiaText>
                      </AiaBox>
                      {option.action === 'review_suggested_sql' ? (
                        <AiaButton color="inherit" size="small" sx={{ textTransform: 'none', fontWeight: 700 }} onClick={() => setReviewDialogOpen(true)}>
                          Compare repair
                        </AiaButton>
                      ) : option.action === 'request_ai_repair' ? (
                        <AiaButton
                          color="inherit"
                          size="small"
                          disabled={reviewLoading}
                          sx={{ textTransform: 'none', fontWeight: 700 }}
                          onClick={() => { void handleAiSqlRepair(); }}
                        >
                          {reviewLoading ? 'Repairing…' : 'Fix with AI'}
                        </AiaButton>
                      ) : option.action === 'open_mapping' ? (
                        <AiaButton color="inherit" size="small" sx={{ textTransform: 'none', fontWeight: 700 }} onClick={() => setActiveTab('mapping')}>
                          Open mapping
                        </AiaButton>
                      ) : (
                        <AiaText sx={{ fontSize: '0.7rem', fontWeight: 800, opacity: 0.85 }}>
                          Use Edit SQL above
                        </AiaText>
                      )}
                    </AiaBox>
                  </AiaBox>
                ))}
              </AiaBox>
            ) : null}
          </AiaAlert>
        ) : null}
      </AiaStack>
    );
  }, [
    compactReviewSummary,
    previewError,
    previewLoading,
    reviewBannerDismissed,
    reviewError,
    reviewLoading,
    reviewResult,
    reviewSelectionVariant,
    reviewStage,
    handleApproveReviewedSql,
    handleAiSqlRepair,
  ]);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-white">
      <BuilderWorkspaceTabBar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        trailing={progressTrailing}
      />

      <AiaDialog open={isCompilingSql && !isPreProcessModalOpen}>
        <AiaDialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 320, py: 3 }}>
          <AiaCircularProgress size={48} />
          <AiaText sx={{ fontSize: '1rem', fontWeight: 500, textAlign: 'center', color: '#1f2937' }}>
            Recompiling mapping SQL…
          </AiaText>
        </AiaDialogContent>
      </AiaDialog>

      <AiaBox
        sx={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {activeTab === 'mapping' ? (
        <AiaBox
              sx={{
            display: 'flex',
            width: collapsed ? COLLAPSED_SIDEBAR_WIDTH : width,
            minWidth: collapsed ? COLLAPSED_SIDEBAR_WIDTH : MIN_SIDEBAR_WIDTH,
            maxWidth: collapsed ? COLLAPSED_SIDEBAR_WIDTH : MAX_SIDEBAR_WIDTH,
            flexShrink: 0,
            borderRight: '1px solid #e5e7eb',
            overflow: 'hidden',
            bgcolor: 'var(--color-surface)',
            minHeight: 0,
            height: '100%',
          }}
        >
          {collapsed ? (
            <AiaBox
            sx={{
                width: '100%',
                height: '100%',
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <AiaBox sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                <SourceTargetAttributeList embedded />
              </AiaBox>
              <SttmSidebarCollapseFooter
                collapsed
                centered
                expandLabel="Expand source sidebar"
                onToggle={() => setCollapsed(false)}
              />
            </AiaBox>
          ) : (
            <AiaBox sx={{ display: 'flex', width: '100%', minWidth: 0, minHeight: 0, flex: 1 }}>
              <AiaBox
                sx={{
                  minWidth: 0,
                  flex: 1,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <SourceTargetAttributeList embedded />
              </AiaBox>
              <AiaResizeHandle
                direction="horizontal"
                onMouseDown={beginResize}
                sx={{ alignSelf: 'stretch', height: '100%' }}
              />
            </AiaBox>
          )}
        </AiaBox>
        ) : null}

        <AiaBox
            sx={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
        {activeTab === 'mapping' ? (
          <AiaBox
              sx={{
              minWidth: 0,
              flex: 1,
              minHeight: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
            <SourceTargetAttributeMapping />
          </AiaBox>
        ) : null}

        {activeTab === 'sql-preview' ? (
          <AiaBox
            data-tour={TOUR_TARGETS.sttmSqlPreviewPanel}
            sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
          >
            <MappingSqlPreview
              sqlTitle={mappingSql.trim() ? 'Imported SQL' : 'Generated SQL'}
              targetLabel={selectedTargetQualifiedName?.split('.').pop() ?? null}
              mappedCount={mappedCount}
              tableCount={selectedInputCount}
              filterCount={filterCount}
              joinCount={relationships.length}
              sourceQuerySql={sourceQueryPreviewSql}
              generatedSql={
                approvedVariant === 'optimized' && approvedPreviewSql
                  ? approvedPreviewSql
                  : canonicalOrGeneratedPreviewSql
              }
              onValidate={() => {
                void handleValidateSql();
              }}
              validateDisabled={reviewLoading || mappedCount === 0}
              validateLoading={reviewLoading}
              validateLabel={reviewLoading ? 'Reviewing SQL...' : 'Validate SQL'}
              onRunPreview={() => {
                void handleRunPreview();
              }}
              runDisabled={previewLoading}
              runLoading={previewLoading}
              runLabel={previewLoading ? 'Running...' : 'Run Preview'}
              statusPanel={
                <>
                  {compilerError ? (
                    <AiaAlert severity="warning" sx={{ mb: 1 }}>
                      <AiaText sx={{ fontSize: '0.8rem', fontWeight: 800 }}>
                        SQL graph needs attention
                      </AiaText>
                      <AiaText sx={{ mt: 0.35, fontSize: '0.76rem', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                        {compilerError}
                      </AiaText>
                      <AiaText sx={{ mt: 0.35, fontSize: '0.73rem', lineHeight: 1.45 }}>
                        The live row-based preview is preserved below. Add the missing joins or map those targets to outputs from the connected derived source, then compile again.
                      </AiaText>
                    </AiaAlert>
                  ) : null}
                  {sqlReviewStatusPanel}
                </>
              }
              editableSql={editableSql}
              onEditableSqlChange={setEditableSql}
              onReviewSqlChanges={() => {
                void handleReviewSqlChanges();
              }}
              reviewSqlChangesLoading={sqlParseLoading}
            />
          </AiaBox>
                  ) : null}

        {activeTab === 'data-preview' ? (
          <AiaBox
            data-tour={TOUR_TARGETS.sttmDataPreviewPanel}
            sx={{ flex: 1, width: '100%', minWidth: 0, minHeight: 0, overflow: 'auto', p: 2, backgroundColor: '#fff' }}
          >
            <AiaPaper
              elevation={0}
              sx={{ border: '1px solid #e5e7eb', borderRadius: 3, overflow: 'hidden', width: '100%' }}
            >
              <AiaBox sx={{ px: 2, py: 1.5, borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <AiaText sx={CARD_TITLE_SX}>
                  Result preview
                </AiaText>
                <AiaText sx={{ fontSize: '0.76rem', color: '#64748b' }}>
                  {validatedPreviewData?.preview_rows?.length ?? 0} sample rows
                </AiaText>
              </AiaBox>
              {validatedPreviewData ? (
                <AiaBox sx={{ px: 2, py: 1.25, borderBottom: '1px solid #e5e7eb', bgcolor: '#f8fafc' }}>
                  <AiaText sx={{ fontSize: '0.76rem', color: '#475569', lineHeight: 1.5 }}>
                    Sample values below come from executing the approved SQL in Snowflake. They are not AI-generated values.
                    {reviewResult
                      ? ` The approved SQL variant came from ${getReviewAgentLabel(reviewResult.review_agent)}.`
                      : ''}
                  </AiaText>
                </AiaBox>
              ) : null}
              {previewLoading ? (
                <AiaBox sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', py: 8, gap: 1.5 }}>
                  <AiaCircularProgress size={32} />
                  <AiaText sx={{ fontSize: '0.88rem', color: '#475569', fontWeight: 500 }}>
                    Running preview in Snowflake…
                  </AiaText>
                </AiaBox>
              ) : previewError ? (
                <AiaBox sx={{ p: 2.5 }}>
                  <AiaText sx={{ fontSize: '0.82rem', color: '#b91c1c' }}>
                    {previewError}
                  </AiaText>
                </AiaBox>
              ) : !validatedPreviewData ? (
                <AiaBox sx={{ p: 2.5 }}>
                  <AiaText sx={BODY_SX}>
                    Validate the generated SQL first to preview actual sample output values.
                  </AiaText>
                  <AiaButton
                    variant="outlined"
                    size="medium"
                    customColor="var(--color-primary)"
                    customBorderColor="var(--color-primary)"
                    sx={{ mt: 1.5 }}
                    onClick={() => {
                      setActiveTab('sql-preview');
                    }}
                  >
                    Go to SQL preview
                  </AiaButton>
                </AiaBox>
              ) : previewResultRows.length === 0 ? (
                <AiaBox sx={{ p: 2.5 }}>
                  <AiaText sx={{ fontSize: '0.82rem', color: '#64748b' }}>
                    The approved SQL executed successfully, but it returned 0 preview rows for this sample run.
                  </AiaText>
                  <AiaText sx={{ fontSize: '0.76rem', color: '#94a3b8', mt: 0.75, lineHeight: 1.5 }}>
                    This usually means the current joins, filters, or transformed expressions did not produce matching sample output rows yet.
                  </AiaText>
                </AiaBox>
              ) : (
                <AiaStack spacing={2} sx={{ p: 2 }}>
                  {validatedPreviewData.warnings?.length ? (
                    <AiaAlert severity="warning" sx={{ borderRadius: 2 }}>
                      {validatedPreviewData.warnings.join(' ')}
                    </AiaAlert>
                  ) : null}
                  <AiaPaper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                    <AiaBox sx={{ px: 2, py: 1.25, borderBottom: '1px solid #e5e7eb', bgcolor: '#f8fafc' }}>
                      <AiaText sx={{ fontSize: '0.82rem', fontWeight: 800 }}>Sample output rows</AiaText>
                      <AiaText sx={{ mt: 0.4, fontSize: '0.72rem', color: '#64748b' }}>
                        Select one row to drive the column trace below.
                      </AiaText>
                    </AiaBox>
                    <AiaBox sx={{ overflow: 'auto' }}>
                      <AiaTablePrimitive size="small" stickyHeader>
                        <AiaTableHead>
                          <AiaTableRowPrimitive>
                            <AiaTableCellPrimitive sx={{ width: 56, fontWeight: 800 }}>Use</AiaTableCellPrimitive>
                            <AiaTableCellPrimitive sx={{ width: 52, fontWeight: 800 }}>#</AiaTableCellPrimitive>
                            {validatedPreviewData.preview_columns.map((column) => (
                              <AiaTableCellPrimitive key={column.name} sx={{ minWidth: 180, fontWeight: 800 }}>
                                {column.name}
                              </AiaTableCellPrimitive>
                            ))}
                          </AiaTableRowPrimitive>
                        </AiaTableHead>
                        <AiaTableBody>
                          {previewResultRows.map((row) => (
                            <AiaTableRowPrimitive
                              key={`result-${row.index}`}
                              hover
                              selected={selectedPreviewRowIndex === row.index - 1}
                  sx={{
                                cursor: 'pointer',
                                '&.Mui-selected': { backgroundColor: '#eff6ff' },
                                '&.Mui-selected:hover': { backgroundColor: '#dbeafe' },
                              }}
                              onClick={() => setSelectedPreviewRowIndex(row.index - 1)}
                            >
                              <AiaTableCellPrimitive padding="checkbox">
                                <AiaCheckbox
                                  checked={selectedPreviewRowIndex === row.index - 1}
                                  checkHandler={() => setSelectedPreviewRowIndex(row.index - 1)}
                                  size="small"
                                />
                              </AiaTableCellPrimitive>
                              <AiaTableCellPrimitive sx={{ fontSize: '0.8rem', color: '#64748b' }}>{row.index}</AiaTableCellPrimitive>
                              {validatedPreviewData.preview_columns.map((column) => (
                                <AiaTableCellPrimitive key={`${row.index}-${column.name}`} sx={{ fontSize: '0.82rem', color: '#111827', whiteSpace: 'nowrap' }}>
                                  {stringifyPreviewValue(row[column.name])}
                                </AiaTableCellPrimitive>
                              ))}
                            </AiaTableRowPrimitive>
                          ))}
                        </AiaTableBody>
                      </AiaTablePrimitive>
                    </AiaBox>
                  </AiaPaper>
                  <AiaPaper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                    <AiaBox sx={{ px: 2, py: 1.25, borderBottom: '1px solid #e5e7eb', bgcolor: '#f8fafc' }}>
                      <AiaText sx={{ fontSize: '0.82rem', fontWeight: 800 }}>
                        Column trace for sample row {selectedPreviewRowIndex + 1}
                      </AiaText>
                    </AiaBox>
                    <AiaBox sx={{ overflow: 'auto' }}>
                      <AiaTablePrimitive size="small" stickyHeader>
                        <AiaTableHead>
                          <AiaTableRowPrimitive>
                            <AiaTableCellPrimitive sx={{ width: 52, fontWeight: 800 }}>#</AiaTableCellPrimitive>
                            <AiaTableCellPrimitive sx={{ minWidth: 240, fontWeight: 800 }}>Target Attr</AiaTableCellPrimitive>
                            <AiaTableCellPrimitive sx={{ minWidth: 210, fontWeight: 800 }}>Source Column</AiaTableCellPrimitive>
                            <AiaTableCellPrimitive sx={{ minWidth: 170, fontWeight: 800 }}>Source Value</AiaTableCellPrimitive>
                            <AiaTableCellPrimitive sx={{ minWidth: 200, fontWeight: 800 }}>Transformed Value</AiaTableCellPrimitive>
                            <AiaTableCellPrimitive sx={{ minWidth: 280, fontWeight: 800 }}>Description</AiaTableCellPrimitive>
                          </AiaTableRowPrimitive>
                        </AiaTableHead>
                        <AiaTableBody>
                          {previewDisplayRows.map((row) => (
                            <AiaTableRowPrimitive key={`${row.mappingId}-${row.rowIndex}`} hover>
                              {row.rowIndex === 0 ? (
                                <AiaTableCellPrimitive rowSpan={row.rowCount} sx={{ fontSize: '0.82rem', color: '#64748b', verticalAlign: 'top' }}>
                                  {row.displayIndex}
                                </AiaTableCellPrimitive>
                              ) : null}
                              {row.rowIndex === 0 ? (
                                <AiaTableCellPrimitive rowSpan={row.rowCount} sx={{ verticalAlign: 'top' }}>
                                  <AiaBox sx={{ minWidth: 0 }}>
                                    <AiaText sx={{ fontSize: '0.92rem', fontWeight: 800, color: '#111827' }}>
                                      {row.targetColumn}
                                    </AiaText>
                                    <AiaText sx={{ fontSize: '0.72rem', color: '#94a3b8', mt: 0.25 }}>
                                      {row.targetType || '—'}
                                    </AiaText>
                                  </AiaBox>
                                </AiaTableCellPrimitive>
                              ) : null}
                              <AiaTableCellPrimitive sx={{ verticalAlign: 'top' }}>
                                <AiaBox sx={{ display: 'grid', gap: 0.45 }}>
                                  <AiaBox sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.55 }}>
                                    <AiaText sx={{ fontSize: '0.84rem', fontWeight: 700, color: '#111827', lineHeight: 1.4, overflowWrap: 'anywhere' }}>
                                      {row.sourceColumnDisplay}
                                    </AiaText>
                                    {row.confidenceScore !== null ? (
                                      <AiaBox
                    sx={{
                                          display: 'inline-flex',
                      alignItems: 'center',
                                          gap: 0.35,
                                          px: 0.65,
                                          py: 0.15,
                                          borderRadius: 999,
                                          border: '1px solid',
                                          ...confidenceTone(row.confidenceScore),
                                        }}
                                        >
                                          <AiaText sx={{ fontSize: '0.68rem', fontWeight: 800, color: 'inherit' }}>
                                            {Math.round(row.confidenceScore * 100)}%
                                          </AiaText>
                                          {row.confidenceReason || row.candidateSourceColumns.length ? (
                                            <AiaTooltip
                                              title={
                                                [
                                                  row.description && row.description !== '—'
                                                    ? `Business fit: ${row.description}`
                                                    : null,
                                                  row.confidenceReason
                                                    ? `Evidence: ${row.confidenceReason}`
                                                    : null,
                                                  row.candidateSourceColumns.length
                                                    ? `Best alternatives: ${row.candidateSourceColumns.join(', ')}`
                                                    : null,
                                                ].filter(Boolean).join('\n')
                                              }
                                              placement="top"
                                              arrow
                                            >
                                              <InfoOutlinedIcon sx={{ fontSize: 13, color: 'inherit', cursor: 'help' }} />
                                            </AiaTooltip>
                                          ) : null}
                                        </AiaBox>
                                    ) : null}
                                  </AiaBox>
                                  {row.sourceColumnDisplay !== row.sourceColumnFullName ? (
                                    <AiaText sx={{ fontSize: '0.7rem', color: '#94a3b8', lineHeight: 1.35, overflowWrap: 'anywhere' }}>
                                      {row.sourceColumnFullName}
                                    </AiaText>
                                  ) : null}
                                </AiaBox>
                              </AiaTableCellPrimitive>
                              <AiaTableCellPrimitive sx={{ verticalAlign: 'top' }}>
                                <AiaBox
                    sx={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    px: 1.25,
                                    py: 0.5,
                                    borderRadius: 1.5,
                                    bgcolor: '#111827',
                                    color: '#f8fafc',
                                    fontSize: '0.78rem',
                                    fontWeight: 700,
                                  }}
                                >
                                  {row.sourceValue}
                                </AiaBox>
                              </AiaTableCellPrimitive>
                              {row.rowIndex === 0 ? (
                                <AiaTableCellPrimitive rowSpan={row.rowCount} sx={{ verticalAlign: 'top' }}>
                                  <AiaBox sx={{ display: 'grid', gap: 0.7, minWidth: 180 }}>
                                    <AiaBox
                  sx={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        px: 1.25,
                                        py: 0.6,
                                        borderRadius: 1.5,
                                        bgcolor: '#ecfdf5',
                                        color: '#166534',
                                        fontSize: '0.84rem',
                                        fontWeight: 800,
                                      }}
                                    >
                                      {row.transformedValue}
                                    </AiaBox>
                                    {row.expressionLabel ? (
                                      <AiaBox
                  sx={{
                                          display: 'inline-flex',
                                          px: 1.1,
                                          py: 0.55,
                                          borderRadius: 1.5,
                                          bgcolor: '#f5f3ff',
                                          color: '#6d28d9',
                                        }}
                                      >
                                        <AiaText sx={{ fontSize: '0.7rem', fontWeight: 700, lineHeight: 1.45 }}>
                                          {row.expressionLabel}
                                        </AiaText>
                                      </AiaBox>
                                    ) : null}
                                  </AiaBox>
                                </AiaTableCellPrimitive>
                              ) : null}
                              {row.rowIndex === 0 ? (
                                <AiaTableCellPrimitive rowSpan={row.rowCount} sx={{ verticalAlign: 'top' }}>
                                  <AiaText sx={{ fontSize: '0.82rem', color: '#475569', lineHeight: 1.5 }}>
                                    {row.description}
                                  </AiaText>
                                </AiaTableCellPrimitive>
                              ) : null}
                            </AiaTableRowPrimitive>
                          ))}
                        </AiaTableBody>
                      </AiaTablePrimitive>
                    </AiaBox>
                  </AiaPaper>
                </AiaStack>
              )}
            </AiaPaper>
          </AiaBox>
        ) : null}
        {activeTab === 'data-lineage' ? (
          <AiaBox data-tour={TOUR_TARGETS.sttmDataLineagePanel} sx={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <SttmLineageWorkspacePanel />
          </AiaBox>
        ) : null}
        </AiaBox>
      </AiaBox>
      <AiaDialog
        open={sqlParseDialogOpen}
        onClose={() => setSqlParseDialogOpen(false)}
        fullWidth
        maxWidth="md"
      >
        <AiaDialogTitle sx={{ fontWeight: 800 }}>
          Review SQL workspace changes
        </AiaDialogTitle>
        <AiaDialogContent dividers>
          {!sqlParseResult ? (
            <AiaAlert severity="warning">No parsed SQL result is available.</AiaAlert>
          ) : (
            <AiaStack spacing={2}>
              <AiaAlert severity={sqlParseResult.valid ? 'info' : 'error'}>
                {sqlParseResult.valid
                  ? 'The SQL resolved successfully. Applying it will update the complete mapping workspace in one operation.'
                  : 'The SQL cannot be applied until every ambiguous or unresolved reference is corrected.'}
              </AiaAlert>
              {sqlParseResult.unresolved_references.length ? (
                <AiaBox>
                  <AiaText sx={{ fontSize: '0.82rem', fontWeight: 800 }}>Unresolved references</AiaText>
                  {sqlParseResult.unresolved_references.map((reference) => (
                    <AiaText key={reference} sx={{ mt: 0.5, fontSize: '0.78rem', color: '#b91c1c', overflowWrap: 'anywhere' }}>
                      {reference}
                    </AiaText>
                  ))}
                </AiaBox>
              ) : null}
              {Object.keys(sqlParseResult.ambiguous_references).length ? (
                <AiaBox>
                  <AiaText sx={{ fontSize: '0.82rem', fontWeight: 800 }}>Ambiguous references</AiaText>
                  {Object.entries(sqlParseResult.ambiguous_references).map(([reference, candidates]) => (
                    <AiaText key={reference} sx={{ mt: 0.5, fontSize: '0.78rem', color: '#b91c1c', overflowWrap: 'anywhere' }}>
                      {reference}: {candidates.join(', ')}
                    </AiaText>
                  ))}
                </AiaBox>
              ) : null}
              {sqlParseResult.warnings.length ? (
                <AiaBox>
                  <AiaText sx={{ fontSize: '0.82rem', fontWeight: 800 }}>Warnings</AiaText>
                  {sqlParseResult.warnings.map((warning) => (
                    <AiaText key={warning} sx={{ mt: 0.5, fontSize: '0.78rem', color: '#92400e' }}>
                      {warning}
                    </AiaText>
                  ))}
                </AiaBox>
              ) : null}
              <AiaBox
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                  gap: 1.25,
                }}
              >
                {Object.entries(sqlParseResult.diff).map(([category, changes]) => (
                  <AiaPaper key={category} variant="outlined" sx={{ p: 1.5, borderRadius: 2, minWidth: 0 }}>
                    <AiaText sx={{ fontSize: '0.76rem', fontWeight: 800, textTransform: 'capitalize' }}>
                      {category.replaceAll('_', ' ')}
                    </AiaText>
                    <AiaText sx={{ mt: 0.35, fontSize: '0.74rem', color: '#64748b' }}>
                      {changes.length} change{changes.length === 1 ? '' : 's'}
                    </AiaText>
                    {changes.slice(0, 4).map((change, index) => (
                      <AiaText key={`${category}-${index}`} sx={{ mt: 0.5, fontSize: '0.72rem', overflowWrap: 'anywhere' }}>
                        {typeof change === 'string' ? change : JSON.stringify(change)}
                      </AiaText>
                    ))}
                  </AiaPaper>
                ))}
              </AiaBox>
            </AiaStack>
          )}
        </AiaDialogContent>
        <AiaDialogActions sx={{ px: 3, py: 2 }}>
          <AiaButton onClick={() => setSqlParseDialogOpen(false)}>Cancel</AiaButton>
          <AiaButton
            variant="contained"
            disabled={!sqlParseResult?.valid}
            onClick={handleApplyParsedSql}
          >
            Apply workspace changes
          </AiaButton>
        </AiaDialogActions>
      </AiaDialog>
      <AiaDialog
        open={reviewDialogOpen}
        onClose={() => setReviewDialogOpen(false)}
        fullWidth
        maxWidth="lg"
        slotProps={{
          paper: {
            sx: {
              borderRadius: 3,
              maxHeight: '90vh',
            },
          },
        }}
      >
        <AiaDialogTitle sx={{ fontWeight: 800 }}>
          {reviewResult?.review_kind === 'repair' ? 'Review suggested SQL repair' : 'Review optimized SQL'}
        </AiaDialogTitle>
        <AiaDialogContent dividers sx={{ overflowY: 'auto', minHeight: 240, p: 0 }}>
          {reviewResult ? (
            <AiaBox sx={{ display: 'grid', gap: 2, p: 3 }}>
              <AiaAlert severity="info" sx={{ borderRadius: 2 }}>
                <AiaText sx={{ fontSize: '0.82rem', whiteSpace: 'pre-line' }}>
                  {reviewResult.review_summary}
                </AiaText>
              </AiaAlert>
              {reviewResult.warnings?.length ? (
                <AiaAlert severity="warning" sx={{ borderRadius: 2 }}>
                  <AiaText sx={{ fontSize: '0.8rem', whiteSpace: 'pre-line' }}>
                    {reviewResult.warnings.join(' ')}
                  </AiaText>
                </AiaAlert>
              ) : null}
              {reviewDiffDocument?.lines.length ? (
                <AiaPaper
                  variant="outlined"
                sx={{
                    borderRadius: 2,
                    overflow: 'hidden',
                  display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <AiaBox sx={{ px: 2, py: 1.25, borderBottom: '1px solid #e5e7eb', bgcolor: '#f8fafc' }}>
                    <AiaBox sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
                      <AiaText sx={{ fontSize: '0.82rem', fontWeight: 800 }}>{reviewDiffDocument.title}</AiaText>
                      <AiaBox sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                        <AiaText sx={{ fontSize: '0.74rem', fontWeight: 700, color: '#b91c1c' }}>
                          - {reviewDiffSummary.removals} removal{reviewDiffSummary.removals === 1 ? '' : 's'}
                        </AiaText>
                        <AiaText sx={{ fontSize: '0.74rem', fontWeight: 700, color: '#15803d' }}>
                          + {reviewDiffSummary.additions} addition{reviewDiffSummary.additions === 1 ? '' : 's'}
                        </AiaText>
                      </AiaBox>
                    </AiaBox>
                    <AiaText sx={{ mt: 0.75, fontSize: '0.74rem', color: '#64748b' }}>
                      Green lines are from the suggested {reviewResult.review_kind === 'repair' ? 'repaired' : 'optimized'} version. Red lines are from the current version that would be replaced.
                    </AiaText>
                  </AiaBox>
                  <AiaBox
                  sx={{
                      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                      fontSize: '0.74rem',
                      overflowY: 'auto',
                      overflowX: 'auto',
                      bgcolor: '#ffffff',
                      maxHeight: '52vh',
                    }}
                  >
                    {reviewDiffDocument.lines.map((row, index) => (
                      <AiaBox
                        key={`diff-${index}`}
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: '32px 1fr',
                          gap: 1,
                          px: 1.5,
                          py: 0.45,
                          bgcolor:
                            row.kind === 'added'
                              ? '#dcfce7'
                              : row.kind === 'removed'
                                ? '#fee2e2'
                                : row.kind === 'separator'
                                  ? '#f8fafc'
                                  : '#ffffff',
                          color:
                            row.kind === 'added'
                              ? '#166534'
                              : row.kind === 'removed'
                                ? '#991b1b'
                                : row.kind === 'separator'
                                  ? '#64748b'
                                  : '#111827',
                          borderBottom:
                            row.kind === 'added'
                              ? '1px solid #86efac'
                              : row.kind === 'removed'
                                ? '1px solid #fca5a5'
                                : '1px solid #f3f4f6',
                          whiteSpace: 'pre',
                        }}
                      >
                        <AiaText component="span" sx={{ fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 800, color: 'inherit', textAlign: 'center' }}>
                          {row.kind === 'added'
                            ? '+'
                            : row.kind === 'removed'
                              ? '-'
                              : row.kind === 'separator'
                                ? '⋯'
                                : ' '}
                        </AiaText>
                        <AiaText component="span" sx={{ fontFamily: 'inherit', fontSize: 'inherit', color: 'inherit', fontStyle: row.kind === 'separator' ? 'italic' : 'normal' }}>
                          {row.text || ' '}
                        </AiaText>
                      </AiaBox>
                    ))}
                  </AiaBox>
                </AiaPaper>
              ) : null}
              <AiaBox sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                <AiaPaper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                  <AiaBox sx={{ px: 2, py: 1.1, borderBottom: '1px solid #e5e7eb', bgcolor: '#f8fafc' }}>
                    <AiaText sx={{ fontSize: '0.8rem', fontWeight: 800 }}>
                      Original SQL
                    </AiaText>
                  </AiaBox>
                  <AiaBox sx={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: '0.72rem', maxHeight: '32vh', overflow: 'auto', bgcolor: '#fff' }}>
                    {(reviewResult.original_preview_sql || '').split('\n').map((line, index) => (
                      <AiaBox key={`original-sql-${index}`} sx={{ px: 1.5, py: 0.42, borderBottom: '1px solid #f3f4f6', whiteSpace: 'pre', color: '#111827' }}>
                        {line || ' '}
                      </AiaBox>
                    ))}
                  </AiaBox>
                </AiaPaper>
                <AiaPaper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                  <AiaBox sx={{ px: 2, py: 1.1, borderBottom: '1px solid #e5e7eb', bgcolor: '#f8fafc' }}>
                    <AiaText sx={{ fontSize: '0.8rem', fontWeight: 800 }}>
                      {reviewResult.review_kind === 'repair' ? 'Suggested repaired SQL' : 'Optimized SQL'}
                    </AiaText>
                  </AiaBox>
                  <AiaBox sx={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: '0.72rem', maxHeight: '32vh', overflow: 'auto', bgcolor: '#fff' }}>
                    {(reviewResult.optimized_preview_sql || '').split('\n').map((line, index) => (
                      <AiaBox key={`optimized-sql-${index}`} sx={{ px: 1.5, py: 0.42, borderBottom: '1px solid #f3f4f6', whiteSpace: 'pre', color: '#111827' }}>
                        {line || ' '}
                      </AiaBox>
                    ))}
                  </AiaBox>
                </AiaPaper>
              </AiaBox>
            </AiaBox>
        ) : null}
          {!reviewResult ? (
            <AiaBox sx={{ p: 3 }}>
              <AiaAlert severity="warning" sx={{ borderRadius: 2 }}>
                <AiaText sx={{ fontSize: '0.8rem', lineHeight: 1.5 }}>
                  The SQL review changed before the dialog finished rendering. Please validate SQL again to review the latest version.
                </AiaText>
              </AiaAlert>
            </AiaBox>
        ) : null}
        </AiaDialogContent>
        <AiaDialogActions sx={{ px: 3, py: 2 }}>
          <AiaButton onClick={() => setReviewDialogOpen(false)} sx={{ textTransform: 'none', fontWeight: 700 }}>
            Cancel
          </AiaButton>
          <AiaButton
            variant="outlined"
            onClick={() => {
              void handleApproveReviewedSql('original');
            }}
            disabled={reviewSelectionVariant === 'original'}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {reviewSelectionVariant === 'original' ? 'Original selected' : 'Keep original and run preview'}
          </AiaButton>
          <AiaButton
            variant="contained"
            onClick={() => {
              void handleApproveReviewedSql('optimized');
            }}
            disabled={reviewSelectionVariant === 'optimized'}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {reviewSelectionVariant === 'optimized'
              ? reviewResult?.review_kind === 'repair' ? 'Suggested repair applied' : 'Optimized SQL applied'
              : reviewResult?.review_kind === 'repair' ? 'Use suggested repair' : 'Use optimized and run preview'}
          </AiaButton>
        </AiaDialogActions>
      </AiaDialog>
      <PreProcessModal />
    </div>
  );
}
