"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ChecklistRtlRoundedIcon from '@mui/icons-material/ChecklistRtlRounded';
import TerminalRoundedIcon from '@mui/icons-material/TerminalRounded';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import TableRowsRoundedIcon from '@mui/icons-material/TableRowsRounded';
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded';
import KeyboardDoubleArrowRightRoundedIcon from '@mui/icons-material/KeyboardDoubleArrowRightRounded';
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
  buildMappingInsertSql,
  buildMappingSelectSql,
  buildSourceQueryPreviewSql,
} from '@/features/sttm/mapping/mapping-utils';
import { MappingSqlPreview } from '@/components/sql';
import { MappingProgressIndicator } from '@/features/sttm/shared/mapping-progress-indicator';
import { BuilderWorkspaceTabBar } from '@/features/sttm/shared/builder-workspace-tab-bar';

type MappingTab = 'mapping' | 'sql-preview' | 'data-preview' | 'data-lineage';

const MIN_SIDEBAR_WIDTH = 248;
const MAX_SIDEBAR_WIDTH = 420;
const COLLAPSED_SIDEBAR_WIDTH = 54;

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

export default function MappingPage() {
  const router = useRouter();
  const { setContent, collapsed, setCollapsed, width, setWidth } = useSidebarSlot();
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const dispatch = useAppDispatch();
  const [activeTab, setActiveTab] = useState<MappingTab>('mapping');
  const [previewColumns, setPreviewColumns] = useState<Array<{ name: string; dataType: string }>>([]);
  const [previewRows, setPreviewRows] = useState<Array<Record<string, unknown>>>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
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

  const beginResize = (event: React.MouseEvent<HTMLButtonElement>) => {
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: width,
    };
  };

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

  const generatedSql = useMemo(
    () =>
      buildMappingInsertSql({
        mappings,
        targetQualifiedName: selectedTargetQualifiedName,
        sourceQuerySql,
        sourceFilterSql,
        sourceGroupBySql,
        sourceOrderBySql,
      }),
    [
      mappings,
      selectedTargetQualifiedName,
      sourceQuerySql,
      sourceFilterSql,
      sourceGroupBySql,
      sourceOrderBySql,
    ],
  );

  const previewSql = useMemo(
    () =>
      buildMappingSelectSql({
        mappings,
        sourceQuerySql,
        sourceFilterSql,
        sourceGroupBySql,
        sourceOrderBySql,
      }),
    [mappings, sourceFilterSql, sourceGroupBySql, sourceOrderBySql, sourceQuerySql],
  );

  const sourceQueryPreviewSql = useMemo(
    () =>
      buildSourceQueryPreviewSql({
        sourceQuerySql,
        sourceFilterSql,
        sourceGroupBySql,
        sourceOrderBySql,
      }),
    [sourceFilterSql, sourceGroupBySql, sourceOrderBySql, sourceQuerySql],
  );

  useEffect(() => {
    if (activeTab !== 'data-preview') {
      return;
    }
    if (!previewSql.trim() || previewSql.startsWith('--')) {
      const resetTimer = window.setTimeout(() => {
        setPreviewColumns([]);
        setPreviewRows([]);
        setPreviewError(null);
        setPreviewLoading(false);
      }, 0);
      return () => window.clearTimeout(resetTimer);
    }

    const selectedSourceTables = sources
      .filter((table) => table.isSelected)
      .map((table) => {
        const [database, schema, tableName] = table.qualifiedName.split('.', 3);
        return { database, schema, table: tableName };
      });

    const requestPayload = {
      derived_source_name: 'sttm_mapping_preview',
      sql_text: previewSql,
      source_tables: selectedSourceTables,
      parent_derived_source_ids: derivedSources.filter((source) => source.isSelected).map((source) => source.id),
      driving_table: drivingTableId
        ? (() => {
            const [database, schema, table] = drivingTableId.split('.', 3);
            return { database, schema, table };
          })()
        : null,
      relationships: relationships
        .filter((join) => join.leftTableId && join.rightTableId && join.conditions?.length)
        .map((join) => {
          const [leftDatabase, leftSchema, leftTable] = String(join.leftTableId).split('.', 3);
          const [rightDatabase, rightSchema, rightTable] = String(join.rightTableId).split('.', 3);
          return {
            id: join.id ?? undefined,
            left_table: { database: leftDatabase, schema: leftSchema, table: leftTable },
            right_table: { database: rightDatabase, schema: rightSchema, table: rightTable },
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
          };
        }),
      selected_columns_by_table: Object.fromEntries(
        sourceAttributeGroups
          .map((group) => [
            group.qualifiedName,
            group.columns.map((column) => String(column.name)).filter(Boolean),
          ])
          .filter(([, columns]) => columns.length > 0),
      ),
    };

    let cancelled = false;
    const startTimer = window.setTimeout(() => {
      if (!cancelled) {
        setPreviewLoading(true);
        setPreviewError(null);
      }
    }, 0);

    dbService
      .validateDerivedSource(requestPayload)
      .then((result) => {
        if (cancelled) return;
        setPreviewColumns(
          (result.preview_columns ?? []).map((column) => ({
            name: column.name,
            dataType: column.data_type,
          })),
        );
        setPreviewRows(
          (result.preview_rows ?? []).map((row) => row.values ?? {}),
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setPreviewError(error instanceof Error ? error.message : 'Unable to preview mapped data.');
        setPreviewColumns([]);
        setPreviewRows([]);
      })
      .finally(() => {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
    };
  }, [
    activeTab,
    derivedSources,
    drivingTableId,
    previewSql,
    relationships,
    sourceAttributeGroups,
    sources,
  ]);

  useEffect(() => {
    const handleRunValidation = () => setActiveTab('sql-preview');
    window.addEventListener('sttm:run-validation', handleRunValidation);
    return () => window.removeEventListener('sttm:run-validation', handleRunValidation);
  }, []);

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
            display: 'flex',
            width: collapsed ? COLLAPSED_SIDEBAR_WIDTH : width,
            minWidth: collapsed ? COLLAPSED_SIDEBAR_WIDTH : MIN_SIDEBAR_WIDTH,
            maxWidth: collapsed ? COLLAPSED_SIDEBAR_WIDTH : MAX_SIDEBAR_WIDTH,
            flexShrink: 0,
            borderRight: '1px solid #e5e7eb',
            overflow: 'hidden',
            bgcolor: '#fff',
          }}
        >
          {collapsed ? (
            <Box
              sx={{
                width: '100%',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'center',
                py: 1.25,
              }}
            >
              <IconButton
                size="small"
                aria-label="Expand source sidebar"
                onClick={() => setCollapsed(false)}
                sx={{
                  color: '#475569',
                  border: '1px solid #dbe2ea',
                  backgroundColor: '#fff',
                  '&:hover': {
                    backgroundColor: '#f8fafc',
                  },
                }}
              >
                <KeyboardDoubleArrowRightRoundedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', width: '100%', minWidth: 0, minHeight: 0, flex: 1 }}>
              <Box
                sx={{
                  minWidth: 0,
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <SourceTargetAttributeList embedded />
              </Box>
              <Box
                sx={{
                  width: 18,
                  display: 'flex',
                  alignItems: 'stretch',
                  justifyContent: 'center',
                  borderLeft: '1px solid #eef2f7',
                  backgroundColor: '#fff',
                  cursor: 'col-resize',
                }}
              >
                <IconButton
                  size="small"
                  aria-label="Resize source sidebar"
                  onMouseDown={beginResize}
                  sx={{
                    width: '100%',
                    borderRadius: 0,
                    color: '#94a3b8',
                    '&:hover': { backgroundColor: '#f8fafc', color: '#475569' },
                  }}
                >
                  <DragIndicatorRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Box>
            </Box>
          )}
        </Box>

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
          <MappingSqlPreview
            targetLabel={selectedTargetQualifiedName?.split('.').pop() ?? null}
            mappedCount={mappedCount}
            tableCount={selectedInputCount}
            filterCount={filterCount}
            joinCount={relationships.length}
            sourceQuerySql={sourceQueryPreviewSql}
            generatedSql={generatedSql}
          />
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
                  {previewRows.length} sample rows
                </Typography>
              </Box>
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
              ) : previewColumns.length === 0 ? (
                <Box sx={{ p: 2.5 }}>
                  <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>
                    Map at least one attribute to preview sample output rows.
                  </Typography>
                </Box>
              ) : (
                <Box sx={{ overflow: 'auto' }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        {previewColumns.map((column) => (
                          <TableCell key={column.name} sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>
                            <Box sx={{ display: 'grid', gap: 0.25 }}>
                              <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, color: '#111827' }}>
                                {column.name}
                              </Typography>
                              <Typography sx={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                                {column.dataType}
                              </Typography>
                            </Box>
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {previewRows.map((row, index) => (
                        <TableRow key={`preview-row-${index}`} hover>
                          {previewColumns.map((column) => (
                            <TableCell key={`${index}-${column.name}`} sx={{ fontSize: '0.78rem', color: '#334155' }}>
                              {String(row[column.name] ?? '')}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </Paper>
          </Box>
        ) : null}
        {activeTab === 'data-lineage' ? (
          <LineageTab />
        ) : null}
        </Box>
      </Box>
      <PreProcessModal />
    </div>
  );
}
