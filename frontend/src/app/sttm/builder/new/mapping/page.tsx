"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import ChecklistRtlRoundedIcon from '@mui/icons-material/ChecklistRtlRounded';
import TerminalRoundedIcon from '@mui/icons-material/TerminalRounded';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import TableRowsRoundedIcon from '@mui/icons-material/TableRowsRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useSidebarSlot } from '@/features/sttm/layout/sidebar-slot-context';
import SourceTargetAttributeList from '@/features/sttm/mapping/source-target-attribute-list';
import SourceTargetAttributeMapping from '@/features/sttm/mapping/source-target-attribute-mapping';
import PreProcessModal from '@/features/sttm/mapping/pre-process-modal';
import LineageTab from '@/features/sttm/lineage/lineage-tab';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import { useAppDispatch } from '@/store/hooks';
import { fetchAttributes } from '@/features/sttm/store/sttm-builder-slice';
import { dbService } from '@/services/dbService';
import {
  buildFallbackSourceQuerySql,
  buildMappingInsertSql,
  buildMappingSelectSql,
  buildSourceQueryPreviewSql,
  generateMappingDescription,
  parseSourceColumns,
} from '@/features/sttm/mapping/mapping-utils';
import { MappingSqlPreview } from '@/components/sql';
import { MappingProgressIndicator } from '@/features/sttm/shared/mapping-progress-indicator';
import { BuilderWorkspaceTabBar } from '@/features/sttm/shared/builder-workspace-tab-bar';
import type {
  MappingSqlPreviewResponse,
  MappingSqlReviewResponse,
  TableRef,
} from '@/types/api-contract';

type MappingTab = 'mapping' | 'sql-preview' | 'data-preview' | 'data-lineage';

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
  const router = useRouter();
  const { setContent } = useSidebarSlot();
  const dispatch = useAppDispatch();
  const lastValidatedReviewContextRef = useRef<string | null>(null);
  const [activeTab, setActiveTab] = useState<MappingTab>('mapping');
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
  const [selectedPreviewRowIndex, setSelectedPreviewRowIndex] = useState(0);
  const {
    mappings,
    targetAttributeGroup,
    initializeMappings,
    sources,
    targets,
    loadState,
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
    requestSemanticRefresh,
    setMappingPreviewSql,
    setMappingSql,
    setMappingSqlVariant,
  } = useSttmBuilderContext();

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

  useEffect(() => {
    if (!hasSelectedInputs || !hasSelectedTarget || semanticViewName) {
      return;
    }
    void requestSemanticRefresh();
  }, [hasSelectedInputs, hasSelectedTarget, requestSemanticRefresh, semanticViewName]);

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
    setContent(<SourceTargetAttributeList />);
    return () => setContent(null);
  }, [setContent]);

  useEffect(() => {
    if (!hasSelectedInputs || !hasSelectedTarget) {
      router.replace('/sttm/builder/new');
      return;
    }

    if (loadState.attributes === 'loading' || loadState.attributes === 'idle') {
      return;
    }

    if (!hasTargetColumns) {
      router.replace('/sttm/builder/new');
    }
  }, [
    hasSelectedInputs,
    hasSelectedTarget,
    hasTargetColumns,
    loadState.attributes,
    router,
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
    if (!targetAttributeGroup || !targetColumnsSignature) {
      return;
    }

    const targetColumns = targetAttributeGroup.columns
      .filter((col) => col.name)
      .map((col) => col.name as string);
    const targetColumnSet = new Set(targetColumns);

    const matchesCurrentTarget =
      mappings.length === targetColumns.length &&
      mappings.every((m) => targetColumnSet.has(m.targetColumn));

    if (matchesCurrentTarget) {
      return;
    }

    const initialMappings = targetAttributeGroup.columns
      .filter((col) => col.name)
      .map((col, idx) => ({
        id: `${targetTableKey}-${idx}`,
        targetColumn: col.name as string,
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
      }));
    initializeMappings(initialMappings);
  }, [
    targetAttributeGroup,
    targetTableKey,
    targetColumnsSignature,
    mappings,
    initializeMappings,
  ]);

  const selectedSourceKey = useMemo(
    () =>
      sources
        .filter((table) => table.isSelected)
        .map((table) => table.qualifiedName)
        .sort()
        .join('|'),
    [sources],
  );

  const selectedTargetKey =
    targets.find((table) => table.isSelected)?.qualifiedName ?? '';

  useEffect(() => {
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
  }, [dispatch, selectedSourceKey, selectedTargetKey]);

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
      source_query_sql: sourceQueryPreviewSql,
      preview_sql: previewSql,
      generated_sql: generatedInsertSql,
      mappings: mappedMappings,
      preview_limit: 5,
    }),
    [
      derivedSources,
      drivingTableRef,
      generatedInsertSql,
      mappedMappings,
      previewSql,
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
        previewSql,
        generatedInsertSql,
      }),
    [
      drivingTableId,
      generatedInsertSql,
      previewSql,
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
    setMappingSql(generatedInsertSql);
    setMappingPreviewSql(previewSql);
    setMappingSqlVariant('original');
  }, [
    generatedInsertSql,
    previewSql,
    reviewResult,
    setMappingPreviewSql,
    setMappingSql,
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
    setMappingSql(generatedInsertSql);
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
    setMappingSql,
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
      setMappingSql(result.executed_generated_sql || approvedGenerated);
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
    setReviewStage('Checking the generated SQL in Snowflake for syntax and execution readiness...');
    try {
      const result = await dbService.reviewMappingSql(mappingSqlRequestPayload);
      lastValidatedReviewContextRef.current = reviewContextSignature;
      setReviewResult(result);
      setReviewSelectionVariant(result.requires_approval ? 'original' : null);
      const defaultPreviewSql =
        result.optimized_preview_sql ?? result.original_preview_sql;
      const defaultGeneratedSql =
        result.optimized_generated_sql ?? result.original_generated_sql;
      setApprovedPreviewSql(result.requires_approval ? result.original_preview_sql : defaultPreviewSql);
      if (result.requires_approval) {
        setMappingPreviewSql(result.original_preview_sql);
        setMappingSql(result.original_generated_sql);
        setMappingSqlVariant('original');
      } else {
        setMappingPreviewSql(defaultPreviewSql);
        setMappingSql(defaultGeneratedSql);
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
    } catch (error) {
      setReviewError(
        error instanceof Error ? error.message : 'Unable to validate the generated SQL.',
      );
      setReviewStage('SQL review failed. Fix the issue and try validation again.');
    } finally {
      setReviewLoading(false);
    }
  };

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
      const optimizedGeneratedSql =
        reviewResult.optimized_generated_sql ?? reviewResult.original_generated_sql;
      setApprovedPreviewSql(optimizedPreviewSql);
      setMappingPreviewSql(optimizedPreviewSql);
      setMappingSql(optimizedGeneratedSql);
      setMappingSqlVariant('optimized');
      setReviewStage('Optimized SQL applied. Run the preview when you are ready.');
    } else {
      setApprovedPreviewSql(reviewResult.original_preview_sql);
      setMappingPreviewSql(reviewResult.original_preview_sql);
      setMappingSql(reviewResult.original_generated_sql);
      setMappingSqlVariant('original');
      setReviewStage('Original SQL selected. Run the preview when you are ready.');
    }
  }, [reviewResult, setMappingPreviewSql, setMappingSql, setMappingSqlVariant]);

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

  const tabs: Array<{ key: MappingTab; label: string; icon: ReactNode; badge?: number }> = [
    { key: 'mapping', label: 'Mapping', icon: <ChecklistRtlRoundedIcon sx={{ fontSize: 17 }} /> },
    {
      key: 'sql-preview',
      label: 'SQL Preview',
      icon: <TerminalRoundedIcon sx={{ fontSize: 17 }} />,
      badge: mappedCount > 0 ? mappedCount : undefined,
    },
    { key: 'data-preview', label: 'Data Preview', icon: <TableRowsRoundedIcon sx={{ fontSize: 17 }} /> },
    { key: 'data-lineage', label: 'Data Lineage', icon: <AccountTreeOutlinedIcon sx={{ fontSize: 17 }} /> },
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
      <Stack spacing={1.25}>
        {primaryMessage ? (
          <Alert
            severity={tone}
            sx={{ borderRadius: 2, py: 0.25 }}
            action={
              reviewLoading || previewLoading ? (
                <CircularProgress size={18} color="inherit" />
              ) : reviewResult?.requires_approval ? (
                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                  <Button
                    color="inherit"
                    size="small"
                    sx={{ textTransform: 'none', fontWeight: 700 }}
                    onClick={() => setReviewDialogOpen(true)}
                  >
                    View diff
                  </Button>
                  <Button
                    color="inherit"
                    size="small"
                    disabled={reviewSelectionVariant === 'optimized'}
                    sx={{ textTransform: 'none', fontWeight: 700 }}
                    onClick={() => {
                      void handleApproveReviewedSql('optimized');
                    }}
                  >
                    {reviewSelectionVariant === 'optimized' ? 'Applied' : 'Apply'}
                  </Button>
                  <IconButton size="small" color="inherit" onClick={() => setReviewBannerDismissed(true)}>
                    <CloseRoundedIcon fontSize="small" />
                  </IconButton>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  {reviewResult && !reviewError && !previewError && !reviewLoading && !previewLoading ? (
                    <Typography sx={{ fontSize: '0.76rem', fontWeight: 700, opacity: 0.9 }}>
                      {reviewResult.requires_approval ? 'Review required' : 'No changes required'}
                    </Typography>
                  ) : null}
                  <IconButton size="small" color="inherit" onClick={() => setReviewBannerDismissed(true)}>
                    <CloseRoundedIcon fontSize="small" />
                  </IconButton>
                </Box>
              )
            }
          >
            {reviewResult && !reviewError && !previewError ? (
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, mb: 0.4 }}>
                Reviewed by {getReviewAgentLabel(reviewResult.review_agent)}
              </Typography>
            ) : null}
            <Typography sx={{ fontSize: '0.8rem', lineHeight: 1.5 }}>
              {primaryMessage}
            </Typography>
            {secondaryMessage ? (
              <Typography sx={{ fontSize: '0.76rem', lineHeight: 1.45, mt: 0.5 }}>
                {secondaryMessage}
              </Typography>
            ) : null}
          </Alert>
        ) : null}
      </Stack>
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
  ]);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-white">
      <BuilderWorkspaceTabBar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        trailing={progressTrailing}
      />

      <Box
        sx={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <Box
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
          <Box sx={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
            <SourceTargetAttributeMapping />
          </Box>
        ) : null}

        {activeTab === 'sql-preview' ? (
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <MappingSqlPreview
              targetLabel={selectedTargetQualifiedName?.split('.').pop() ?? null}
              mappedCount={mappedCount}
              tableCount={selectedInputCount}
              filterCount={filterCount}
              joinCount={relationships.length}
              sourceQuerySql={sourceQueryPreviewSql}
              generatedSql={approvedVariant === 'optimized' && approvedPreviewSql ? approvedPreviewSql : previewSql}
              onValidate={() => {
                void handleValidateSql();
              }}
              validateDisabled={reviewLoading || mappedCount === 0}
              validateLoading={reviewLoading}
              validateLabel={reviewLoading ? 'Reviewing SQL...' : 'Validate SQL'}
              onRunPreview={() => {
                void handleRunPreview();
              }}
              runDisabled={
                previewLoading ||
                !reviewResult ||
                !reviewResult.execution_ready ||
                (reviewResult.requires_approval && !reviewSelectionVariant)
              }
              runLoading={previewLoading}
              runLabel={previewLoading ? 'Running...' : 'Run Preview'}
              statusPanel={sqlReviewStatusPanel}
            />
          </Box>
        ) : null}

        {activeTab === 'data-preview' ? (
          <Box sx={{ flex: 1, width: '100%', minWidth: 0, minHeight: 0, overflow: 'auto', p: 2, backgroundColor: '#fff' }}>
            <Paper
              elevation={0}
              sx={{ border: '1px solid #e5e7eb', borderRadius: 3, overflow: 'hidden', width: '100%' }}
            >
              <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: '0.85rem', fontWeight: 800, color: '#111827' }}>
                  Result preview
                </Typography>
                <Typography sx={{ fontSize: '0.76rem', color: '#64748b' }}>
                  {validatedPreviewData?.preview_rows?.length ?? 0} sample rows
                </Typography>
              </Box>
              {validatedPreviewData ? (
                <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid #e5e7eb', bgcolor: '#f8fafc' }}>
                  <Typography sx={{ fontSize: '0.76rem', color: '#475569', lineHeight: 1.5 }}>
                    Sample values below come from executing the approved SQL in Snowflake. They are not AI-generated values.
                    {reviewResult
                      ? ` The approved SQL variant came from ${getReviewAgentLabel(reviewResult.review_agent)}.`
                      : ''}
                  </Typography>
                </Box>
              ) : null}
              {previewLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                  <CircularProgress size={28} />
                </Box>
              ) : previewError ? (
                <Box sx={{ p: 2.5 }}>
                  <Typography sx={{ fontSize: '0.82rem', color: '#b91c1c' }}>
                    {previewError}
                  </Typography>
                </Box>
              ) : !validatedPreviewData ? (
                <Box sx={{ p: 2.5 }}>
                  <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>
                    Validate the generated SQL first to preview actual sample output values.
                  </Typography>
                  <Button
                    variant="outlined"
                    size="small"
                    sx={{ mt: 1.5, textTransform: 'none', fontWeight: 700 }}
                    onClick={() => {
                      setActiveTab('sql-preview');
                    }}
                  >
                    Go to SQL preview
                  </Button>
                </Box>
              ) : previewResultRows.length === 0 ? (
                <Box sx={{ p: 2.5 }}>
                  <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>
                    The approved SQL executed successfully, but it returned 0 preview rows for this sample run.
                  </Typography>
                  <Typography sx={{ fontSize: '0.76rem', color: '#94a3b8', mt: 0.75, lineHeight: 1.5 }}>
                    This usually means the current joins, filters, or transformed expressions did not produce matching sample output rows yet.
                  </Typography>
                </Box>
              ) : (
                <Stack spacing={2} sx={{ p: 2 }}>
                  {validatedPreviewData.warnings?.length ? (
                    <Alert severity="warning" sx={{ borderRadius: 2 }}>
                      {validatedPreviewData.warnings.join(' ')}
                    </Alert>
                  ) : null}
                  <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                    <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid #e5e7eb', bgcolor: '#f8fafc' }}>
                      <Typography sx={{ fontSize: '0.82rem', fontWeight: 800 }}>Sample output rows</Typography>
                      <Typography sx={{ mt: 0.4, fontSize: '0.72rem', color: '#64748b' }}>
                        Select one row to drive the column trace below.
                      </Typography>
                    </Box>
                    <Box sx={{ overflow: 'auto' }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ width: 56, fontWeight: 800 }}>Use</TableCell>
                            <TableCell sx={{ width: 52, fontWeight: 800 }}>#</TableCell>
                            {validatedPreviewData.preview_columns.map((column) => (
                              <TableCell key={column.name} sx={{ minWidth: 180, fontWeight: 800 }}>
                                {column.name}
                              </TableCell>
                            ))}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {previewResultRows.map((row) => (
                            <TableRow
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
                              <TableCell padding="checkbox">
                                <Checkbox
                                  checked={selectedPreviewRowIndex === row.index - 1}
                                  onChange={() => setSelectedPreviewRowIndex(row.index - 1)}
                                  size="small"
                                />
                              </TableCell>
                              <TableCell sx={{ fontSize: '0.8rem', color: '#64748b' }}>{row.index}</TableCell>
                              {validatedPreviewData.preview_columns.map((column) => (
                                <TableCell key={`${row.index}-${column.name}`} sx={{ fontSize: '0.82rem', color: '#111827', whiteSpace: 'nowrap' }}>
                                  {stringifyPreviewValue(row[column.name])}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Box>
                  </Paper>
                  <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                    <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid #e5e7eb', bgcolor: '#f8fafc' }}>
                      <Typography sx={{ fontSize: '0.82rem', fontWeight: 800 }}>
                        Column trace for sample row {selectedPreviewRowIndex + 1}
                      </Typography>
                    </Box>
                    <Box sx={{ overflow: 'auto' }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ width: 52, fontWeight: 800 }}>#</TableCell>
                            <TableCell sx={{ minWidth: 240, fontWeight: 800 }}>Target Attr</TableCell>
                            <TableCell sx={{ minWidth: 210, fontWeight: 800 }}>Source Column</TableCell>
                            <TableCell sx={{ minWidth: 170, fontWeight: 800 }}>Source Value</TableCell>
                            <TableCell sx={{ minWidth: 200, fontWeight: 800 }}>Transformed Value</TableCell>
                            <TableCell sx={{ minWidth: 280, fontWeight: 800 }}>Description</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {previewDisplayRows.map((row) => (
                            <TableRow key={`${row.mappingId}-${row.rowIndex}`} hover>
                              {row.rowIndex === 0 ? (
                                <TableCell rowSpan={row.rowCount} sx={{ fontSize: '0.82rem', color: '#64748b', verticalAlign: 'top' }}>
                                  {row.displayIndex}
                                </TableCell>
                              ) : null}
                              {row.rowIndex === 0 ? (
                                <TableCell rowSpan={row.rowCount} sx={{ verticalAlign: 'top' }}>
                                  <Box sx={{ minWidth: 0 }}>
                                    <Typography sx={{ fontSize: '0.92rem', fontWeight: 800, color: '#111827' }}>
                                      {row.targetColumn}
                                    </Typography>
                                    <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8', mt: 0.25 }}>
                                      {row.targetType || '—'}
                                    </Typography>
                                  </Box>
                                </TableCell>
                              ) : null}
                              <TableCell sx={{ verticalAlign: 'top' }}>
                                <Box sx={{ display: 'grid', gap: 0.45 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.55 }}>
                                    <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, color: '#111827', lineHeight: 1.4, overflowWrap: 'anywhere' }}>
                                      {row.sourceColumnDisplay}
                                    </Typography>
                                    {row.confidenceScore !== null ? (
                                      <Box
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
                                          <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, color: 'inherit' }}>
                                            {Math.round(row.confidenceScore * 100)}%
                                          </Typography>
                                          {row.confidenceReason || row.candidateSourceColumns.length ? (
                                            <Tooltip
                                              title={
                                                row.confidenceReason ||
                                                (row.candidateSourceColumns.length
                                                  ? `Best alternatives: ${row.candidateSourceColumns.join(', ')}`
                                                  : '')
                                              }
                                              placement="top"
                                              arrow
                                            >
                                              <InfoOutlinedIcon sx={{ fontSize: 13, color: 'inherit', cursor: 'help' }} />
                                            </Tooltip>
                                          ) : null}
                                        </Box>
                                    ) : null}
                                  </Box>
                                  {row.sourceColumnDisplay !== row.sourceColumnFullName ? (
                                    <Typography sx={{ fontSize: '0.7rem', color: '#94a3b8', lineHeight: 1.35, overflowWrap: 'anywhere' }}>
                                      {row.sourceColumnFullName}
                                    </Typography>
                                  ) : null}
                                </Box>
                              </TableCell>
                              <TableCell sx={{ verticalAlign: 'top' }}>
                                <Box
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
                                </Box>
                              </TableCell>
                              {row.rowIndex === 0 ? (
                                <TableCell rowSpan={row.rowCount} sx={{ verticalAlign: 'top' }}>
                                  <Box sx={{ display: 'grid', gap: 0.7, minWidth: 180 }}>
                                    <Box
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
                                    </Box>
                                    {row.expressionLabel ? (
                                      <Box
                                        sx={{
                                          display: 'inline-flex',
                                          px: 1.1,
                                          py: 0.55,
                                          borderRadius: 1.5,
                                          bgcolor: '#f5f3ff',
                                          color: '#6d28d9',
                                        }}
                                      >
                                        <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, lineHeight: 1.45 }}>
                                          {row.expressionLabel}
                                        </Typography>
                                      </Box>
                                    ) : null}
                                  </Box>
                                </TableCell>
                              ) : null}
                              {row.rowIndex === 0 ? (
                                <TableCell rowSpan={row.rowCount} sx={{ verticalAlign: 'top' }}>
                                  <Typography sx={{ fontSize: '0.82rem', color: '#475569', lineHeight: 1.5 }}>
                                    {row.description}
                                  </Typography>
                                </TableCell>
                              ) : null}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Box>
                  </Paper>
                </Stack>
              )}
            </Paper>
          </Box>
        ) : null}
        {activeTab === 'data-lineage' ? (
          <LineageTab />
        ) : null}
        </Box>
      </Box>
      <Dialog
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
        <DialogTitle sx={{ fontWeight: 800 }}>
          Review optimized SQL
        </DialogTitle>
        <DialogContent dividers sx={{ overflowY: 'auto', minHeight: 240, p: 0 }}>
          {reviewResult ? (
            <Box sx={{ display: 'grid', gap: 2, p: 3 }}>
              <Alert severity="info" sx={{ borderRadius: 2 }}>
                <Typography sx={{ fontSize: '0.82rem', whiteSpace: 'pre-line' }}>
                  {reviewResult.review_summary}
                </Typography>
              </Alert>
              {reviewResult.warnings?.length ? (
                <Alert severity="warning" sx={{ borderRadius: 2 }}>
                  <Typography sx={{ fontSize: '0.8rem', whiteSpace: 'pre-line' }}>
                    {reviewResult.warnings.join(' ')}
                  </Typography>
                </Alert>
              ) : null}
              {reviewDiffDocument?.lines.length ? (
                <Paper
                  variant="outlined"
                  sx={{
                    borderRadius: 2,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid #e5e7eb', bgcolor: '#f8fafc' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
                      <Typography sx={{ fontSize: '0.82rem', fontWeight: 800 }}>{reviewDiffDocument.title}</Typography>
                      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                        <Typography sx={{ fontSize: '0.74rem', fontWeight: 700, color: '#b91c1c' }}>
                          - {reviewDiffSummary.removals} removal{reviewDiffSummary.removals === 1 ? '' : 's'}
                        </Typography>
                        <Typography sx={{ fontSize: '0.74rem', fontWeight: 700, color: '#15803d' }}>
                          + {reviewDiffSummary.additions} addition{reviewDiffSummary.additions === 1 ? '' : 's'}
                        </Typography>
                      </Box>
                    </Box>
                    <Typography sx={{ mt: 0.75, fontSize: '0.74rem', color: '#64748b' }}>
                      Green lines are from the optimized analyst version. Red lines are from the current version that would be replaced.
                    </Typography>
                  </Box>
                  <Box
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
                      <Box
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
                        <Typography component="span" sx={{ fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 800, color: 'inherit', textAlign: 'center' }}>
                          {row.kind === 'added'
                            ? '+'
                            : row.kind === 'removed'
                              ? '-'
                              : row.kind === 'separator'
                                ? '⋯'
                                : ' '}
                        </Typography>
                        <Typography component="span" sx={{ fontFamily: 'inherit', fontSize: 'inherit', color: 'inherit', fontStyle: row.kind === 'separator' ? 'italic' : 'normal' }}>
                          {row.text || ' '}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Paper>
              ) : null}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                  <Box sx={{ px: 2, py: 1.1, borderBottom: '1px solid #e5e7eb', bgcolor: '#f8fafc' }}>
                    <Typography sx={{ fontSize: '0.8rem', fontWeight: 800 }}>
                      Original SQL
                    </Typography>
                  </Box>
                  <Box sx={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: '0.72rem', maxHeight: '32vh', overflow: 'auto', bgcolor: '#fff' }}>
                    {(reviewResult.original_preview_sql || '').split('\n').map((line, index) => (
                      <Box key={`original-sql-${index}`} sx={{ px: 1.5, py: 0.42, borderBottom: '1px solid #f3f4f6', whiteSpace: 'pre', color: '#111827' }}>
                        {line || ' '}
                      </Box>
                    ))}
                  </Box>
                </Paper>
                <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                  <Box sx={{ px: 2, py: 1.1, borderBottom: '1px solid #e5e7eb', bgcolor: '#f8fafc' }}>
                    <Typography sx={{ fontSize: '0.8rem', fontWeight: 800 }}>
                      Optimized SQL
                    </Typography>
                  </Box>
                  <Box sx={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: '0.72rem', maxHeight: '32vh', overflow: 'auto', bgcolor: '#fff' }}>
                    {(reviewResult.optimized_preview_sql || '').split('\n').map((line, index) => (
                      <Box key={`optimized-sql-${index}`} sx={{ px: 1.5, py: 0.42, borderBottom: '1px solid #f3f4f6', whiteSpace: 'pre', color: '#111827' }}>
                        {line || ' '}
                      </Box>
                    ))}
                  </Box>
                </Paper>
              </Box>
            </Box>
          ) : null}
          {!reviewResult ? (
            <Box sx={{ p: 3 }}>
              <Alert severity="warning" sx={{ borderRadius: 2 }}>
                <Typography sx={{ fontSize: '0.8rem', lineHeight: 1.5 }}>
                  The SQL review changed before the dialog finished rendering. Please validate SQL again to review the latest version.
                </Typography>
              </Alert>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setReviewDialogOpen(false)} sx={{ textTransform: 'none', fontWeight: 700 }}>
            Cancel
          </Button>
          <Button
            variant="outlined"
            onClick={() => {
              void handleApproveReviewedSql('original');
            }}
            disabled={reviewSelectionVariant === 'original'}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {reviewSelectionVariant === 'original' ? 'Original selected' : 'Keep original and run preview'}
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              void handleApproveReviewedSql('optimized');
            }}
            disabled={reviewSelectionVariant === 'optimized'}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {reviewSelectionVariant === 'optimized' ? 'Optimized SQL applied' : 'Use optimized and run preview'}
          </Button>
        </DialogActions>
      </Dialog>
      <PreProcessModal />
    </div>
  );
}
