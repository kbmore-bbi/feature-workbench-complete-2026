"use client";

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  LinearProgress,
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
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import TableRowsRoundedIcon from '@mui/icons-material/TableRowsRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import { useSidebarSlot } from '@/features/sttm/layout/sidebar-slot-context';
import SourceTargetAttributeList from '@/features/sttm/mapping/source-target-attribute-list';
import SourceTargetAttributeMapping from '@/features/sttm/mapping/source-target-attribute-mapping';
import PreProcessModal from '@/features/sttm/mapping/pre-process-modal';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import { useAppDispatch } from '@/store/hooks';
import { fetchAttributes } from '@/features/sttm/store/sttm-builder-slice';
import { dbService } from '@/services/dbService';
import { buildMappingInsertSql, buildMappingSelectSql } from '@/features/sttm/mapping/mapping-utils';

type MappingTab = 'mapping' | 'sql-preview' | 'data-preview' 
// | 'data-lineage';

const SQL_KEYWORDS = new Set([
  'AS',
  'BY',
  'FROM',
  'GROUP',
  'INSERT',
  'INTO',
  'JOIN',
  'LEFT',
  'ON',
  'ORDER',
  'RIGHT',
  'SELECT',
  'WHERE',
  'INNER',
  'OUTER',
  'FULL',
  'AND',
  'OR',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'NULL',
]);

const sqlStatPillSx = {
  px: 1,
  py: 0.45,
  borderRadius: '999px',
  border: '1px solid rgba(148,163,184,0.18)',
  backgroundColor: 'rgba(15,23,42,0.72)',
  color: '#cbd5e1',
  fontSize: '0.73rem',
  fontWeight: 800,
} as const;

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

function renderSqlToken(token: string, key: string) {
  if (/^\s+$/.test(token)) {
    return <span key={key}>{token}</span>;
  }

  let color = '#e5e7eb';
  let fontWeight = 500;

  if (token.startsWith('--')) {
    color = '#7c8597';
  } else if (/^['"].*['"]$/.test(token)) {
    color = '#a3e635';
  } else if (/^[(),;]$/.test(token)) {
    color = '#cbd5e1';
  } else if (SQL_KEYWORDS.has(token.toUpperCase())) {
    color = '#f97316';
    fontWeight = 800;
  } else if (/^\d+(\.\d+)?$/.test(token)) {
    color = '#fda4af';
  } else if (token.includes('.')) {
    color = '#f4c15d';
    fontWeight = 700;
  } else if (/^[A-Z0-9_]+$/.test(token)) {
    color = '#f8fafc';
    fontWeight = 700;
  } else if (/^[a-z][a-z0-9_]*$/i.test(token)) {
    color = '#f8d77c';
  }

  return (
    <Box key={key} component="span" sx={{ color, fontWeight }}>
      {token}
    </Box>
  );
}

function renderSqlLine(line: string, lineIndex: number) {
  const parts = line
    .split(/(\s+|--.*$|'[^']*'|"[^"]*"|\b[A-Za-z_][A-Za-z0-9_]*\b|[(),;])/g)
    .filter((part) => part !== '');

  return (
    <Box
      key={`sql-line-${lineIndex}`}
      component="div"
      sx={{ minHeight: 22 }}
    >
      {parts.map((token, tokenIndex) => renderSqlToken(token, `${lineIndex}-${tokenIndex}`))}
    </Box>
  );
}

export default function MappingPage() {
  const router = useRouter();
  const { setContent } = useSidebarSlot();
  const dispatch = useAppDispatch();
  const [activeTab, setActiveTab] = useState<MappingTab>('mapping');
  const [copiedSql, setCopiedSql] = useState(false);
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
  const progressValue = totalCount > 0 ? (mappedCount / totalCount) * 100 : 0;
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

  const tabs: Array<{ key: MappingTab; label: string; icon: ReactNode }> = [
    { key: 'mapping', label: 'Mapping', icon: <ChecklistRtlRoundedIcon sx={{ fontSize: 17 }} /> },
    { key: 'sql-preview', label: 'SQL Preview', icon: <CodeRoundedIcon sx={{ fontSize: 17 }} /> },
    { key: 'data-preview', label: 'Data Preview', icon: <TableRowsRoundedIcon sx={{ fontSize: 17 }} /> },
    // { key: 'data-lineage', label: 'Data Lineage', icon: <AccountTreeOutlinedIcon sx={{ fontSize: 17 }} /> },
  ];

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(generatedSql);
      setCopiedSql(true);
      window.setTimeout(() => setCopiedSql(false), 1500);
    } catch {
      setCopiedSql(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-white">
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 2,
          py: 1.25,
          borderBottom: '1px solid #e5e7eb',
          backgroundColor: '#fff',
        }}
      >
        {tabs.map((tab) => {
          const selected = activeTab === tab.key;
          return (
            <Button
              key={tab.key}
              variant="text"
              onClick={() => setActiveTab(tab.key)}
              sx={{
                minWidth: 0,
                px: 1.35,
                py: 0.75,
                borderRadius: '8px',
                textTransform: 'none',
                fontSize: '0.84rem',
                fontWeight: 700,
                display: 'inline-flex',
                gap: 0.75,
                alignItems: 'center',
                color: selected ? '#111827' : '#64748b',
                backgroundColor: selected ? '#f8fafc' : 'transparent',
                border: selected ? '1px solid #dbe2ea' : '1px solid transparent',
              }}
            >
              {tab.icon}
              {tab.label}
            </Button>
          );
        })}
        <Box sx={{ ml: 'auto', minWidth: 180 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: '#111827' }}>
              Mapping progress
            </Typography>
            <Typography sx={{ fontSize: '0.76rem', color: '#64748b' }}>
              {mappedCount}/{totalCount} {totalCount > 0 ? `${Math.round(progressValue)}%` : '0%'}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={progressValue}
            sx={{
              height: 7,
              borderRadius: 999,
              backgroundColor: '#e5e7eb',
              '& .MuiLinearProgress-bar': {
                borderRadius: 999,
                backgroundColor: '#f59e0b',
              },
            }}
          />
        </Box>
      </Box>

      <div className="flex min-h-0 w-full min-w-0 flex-1 overflow-hidden">
        {activeTab === 'mapping' ? (
          <div className="min-w-0 flex-1 overflow-hidden">
            <SourceTargetAttributeMapping />
          </div>
        ) : null}

        {activeTab === 'sql-preview' ? (
          <Box
            sx={{
              flex: 1,
              width: '100%',
              minWidth: 0,
              minHeight: 0,
              overflow: 'hidden',
              backgroundColor: '#0b1220',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Paper
              elevation={0}
              sx={{
                height: '100%',
                borderRadius: 0,
                backgroundColor: '#0b1220',
                color: '#e2e8f0',
                border: 'none',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <Box
                sx={{
                  px: 2,
                  py: 1.35,
                  borderBottom: '1px solid rgba(148,163,184,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  flexShrink: 0,
                }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: '#4ade80',
                      flexShrink: 0,
                    }}
                  />
                  <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color: '#f8fafc' }}>
                    Generated SQL
                  </Typography>
                  {selectedTargetQualifiedName ? (
                    <Typography
                      sx={{
                        fontSize: '0.8rem',
                        color: '#64748b',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      — {selectedTargetQualifiedName.split('.').pop()}
                    </Typography>
                  ) : null}
                </Stack>
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  sx={{ ml: 'auto', flexWrap: 'wrap', justifyContent: 'flex-end' }}
                >
                  <Box sx={sqlStatPillSx}>{mappedCount} MAPPED</Box>
                  <Box sx={sqlStatPillSx}>{selectedInputCount} TABLES</Box>
                  <Box sx={sqlStatPillSx}>{filterCount} FILTERS</Box>
                  <Tooltip title={copiedSql ? 'Copied' : 'Copy SQL'}>
                    <IconButton
                      size="small"
                      onClick={() => {
                        void handleCopySql();
                      }}
                      sx={{
                        borderRadius: '12px',
                        border: '1px solid rgba(148,163,184,0.18)',
                        color: '#e2e8f0',
                        px: 1,
                        gap: 0.75,
                      }}
                    >
                      <ContentCopyRoundedIcon sx={{ fontSize: 16 }} />
                      <Typography sx={{ fontSize: '0.76rem', fontWeight: 700 }}>
                        {copiedSql ? 'Copied' : 'Copy SQL'}
                      </Typography>
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Box>
              <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 2.5, py: 2.25 }}>
                <Box
                  sx={{
                    mb: 2,
                    display: 'inline-grid',
                    gap: 0.25,
                    px: 1.5,
                    py: 1.2,
                    borderRadius: 2,
                    border: '1px solid rgba(148,163,184,0.18)',
                    backgroundColor: 'rgba(15,23,42,0.5)',
                  }}
                >
                  <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>
                    STTM Builder · Frontend-generated SQL
                  </Typography>
                  <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                    Target: {selectedTargetQualifiedName ?? 'TARGET_TABLE'}
                  </Typography>
                  <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                    Live from source prep + mapping selections
                  </Typography>
                </Box>
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    fontSize: 13.5,
                    lineHeight: 1.82,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
                  }}
                >
                  {generatedSql.split('\n').map((line, index) => renderSqlLine(line, index))}
                </Box>
              </Box>
              <Box
                sx={{
                  px: 2,
                  py: 1.2,
                  borderTop: '1px solid rgba(148,163,184,0.12)',
                  backgroundColor: 'rgba(15,23,42,0.96)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 2,
                  flexShrink: 0,
                  position: 'sticky',
                  bottom: 0,
                  zIndex: 2,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc' }}>
                    SQL validation
                  </Typography>
                  <Typography sx={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                    {mappedCount > 0
                      ? 'Validate the live SQL generated from source prep and mapping rules.'
                      : 'Map at least one attribute to generate a validation-ready SQL statement.'}
                  </Typography>
                </Box>
                <Button
                  variant="contained"
                  size="small"
                  sx={{
                    minWidth: 118,
                    borderRadius: '10px',
                    textTransform: 'none',
                    fontWeight: 700,
                    bgcolor: '#133d5b',
                    boxShadow: 'none',
                    '&:hover': {
                      bgcolor: '#1d4f74',
                      boxShadow: 'none',
                    },
                  }}
                >
                  Validate SQL
                </Button>
              </Box>
            </Paper>
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
{/* 
        {activeTab === 'data-lineage' ? (
          <Box sx={{ flex: 1, width: '100%', minWidth: 0, minHeight: 0, overflow: 'auto', p: 2 }}>
            <Paper
              elevation={0}
              sx={{
                border: '1px dashed #cbd5e1',
                borderRadius: 3,
                p: 3,
                minHeight: 260,
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Typography sx={{ fontSize: '0.85rem', color: '#64748b' }}>
                Data lineage will be added here next.
              </Typography>
            </Paper>
          </Box>
        ) : null} */}
      </div>
      <PreProcessModal />
    </div>
  );
}
