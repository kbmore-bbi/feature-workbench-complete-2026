"use client";

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useSidebarSlot } from '@/features/sttm/layout/sidebar-slot-context';
import SourceTargetAttributeList from '@/features/sttm/mapping/source-target-attribute-list';
import SourceTargetAttributeMapping from '@/features/sttm/mapping/source-target-attribute-mapping';
import PreProcessModal from '@/features/sttm/mapping/pre-process-modal';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import { useAppDispatch } from '@/store/hooks';
import { fetchAttributes } from '@/features/sttm/store/sttm-builder-slice';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import TableViewRoundedIcon from '@mui/icons-material/TableViewRounded';
import HubRoundedIcon from '@mui/icons-material/HubRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import { Box, Button, Paper, Typography } from '@mui/material';
import { buildPreProcessSql } from '@/features/sttm/mapping/pre-process-sql';

type MappingTab = 'mapping' | 'sqlPreview' | 'dataPreview' 
//  |'dataLineage';

const TOKEN_RE =
  /('(?:\\.|[^'])*')|\b(INSERT|INTO|SELECT|FROM|AS|WHERE|AND|OR|NOT|NULL|INNER|LEFT|RIGHT|FULL|JOIN|ON|GROUP|ORDER|BY)\b/gi;

type SourceQueryTable = {
  id: string;
  qualifiedName: string;
  alias: string;
  sqlText?: string;
};

function indentBlock(text: string, prefix: string) {
  return text
    .split('\n')
    .map((line) => (line.trim() ? `${prefix}${line}` : line))
    .join('\n');
}

function renderSourceTableReference(table: SourceQueryTable) {
  if (table.sqlText?.trim()) {
    const nested = indentBlock(table.sqlText.trim(), '    ');
    return `(\n${nested}\n  ) ${table.alias}`;
  }
  return `${table.qualifiedName} ${table.alias}`;
}

function renderSourceColumnReference(table: SourceQueryTable, columnName: string) {
  return `${table.alias}.${columnName}`;
}

function highlightSqlLine(line: string): ReactNode {
  if (/^\s*--/.test(line)) {
    return <span style={{ color: '#6b7280', fontStyle: 'italic' }}>{line}</span>;
  }
  const parts: ReactNode[] = [];
  let pos = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(TOKEN_RE.source, 'gi');
  while ((match = re.exec(line)) !== null) {
    if (match.index > pos) {
      parts.push(
        <span key={`t-${pos}`} style={{ color: '#d1d5db' }}>
          {line.slice(pos, match.index)}
        </span>,
      );
    }
    const token = match[0];
    if (token.startsWith("'")) {
      parts.push(
        <span key={`s-${match.index}`} style={{ color: '#22d3ee' }}>
          {token}
        </span>,
      );
    } else {
      parts.push(
        <span key={`k-${match.index}`} style={{ color: '#f59e0b', fontWeight: 700 }}>
          {token}
        </span>,
      );
    }
    pos = match.index + token.length;
  }
  if (pos < line.length) {
    parts.push(
      <span key="t-end" style={{ color: '#d1d5db' }}>
        {line.slice(pos)}
      </span>,
    );
  }
  return parts.length ? parts : line;
}

function SqlHighlightedBlock({ sql }: { sql: string }) {
  const lines = sql.split('\n');
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 0,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: '12px',
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {lines.map((line, idx) => (
        <span key={idx}>
          {highlightSqlLine(line)}
          {idx < lines.length - 1 ? '\n' : null}
        </span>
      ))}
    </Box>
  );
}

const mappingTabs: Array<{
  id: MappingTab;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: 'mapping', label: 'Mapping', icon: <TableChartOutlinedIcon sx={{ fontSize: 15 }} /> },
  { id: 'sqlPreview', label: 'SQL Preview', icon: <CodeRoundedIcon sx={{ fontSize: 15 }} /> },
  { id: 'dataPreview', label: 'Data Preview', icon: <TableViewRoundedIcon sx={{ fontSize: 15 }} /> },
 // { id: 'dataLineage', label: 'Data Lineage', icon: <HubRoundedIcon sx={{ fontSize: 15 }} /> },
];

export default function MappingPage() {
  const router = useRouter();
  const { setContent } = useSidebarSlot();
  const dispatch = useAppDispatch();
  const [activeTab, setActiveTab] = useState<MappingTab>('mapping');
  const {
    mappings,
    targetAttributeGroup,
    initializeMappings,
    sources,
    targets,
    loadState,
    sourceFilterSql,
    sourceAttributeGroups,
    derivedSources,
    relationships,
    drivingTableId,
  } = useSttmBuilderContext();

  const hasSelectedSources = useMemo(
    () => sources.some((table) => table.isSelected),
    [sources],
  );

  const hasSelectedTarget = useMemo(
    () => targets.some((table) => table.isSelected),
    [targets],
  );

  const hasTargetColumns = useMemo(
    () => (targetAttributeGroup?.columns?.filter((col) => col.name).length ?? 0) > 0,
    [targetAttributeGroup],
  );

  useEffect(() => {
    setContent(<SourceTargetAttributeList />);
  }, [setContent]);

  useEffect(() => {
    if (!hasSelectedSources || !hasSelectedTarget) {
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
    hasSelectedSources,
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
    'TARGET_TABLE';

  const sqlRows = useMemo(
    () =>
      mappings.filter((mapping) => {
        if (mapping.status === 'MAPPED') return true;
        return Boolean(
          mapping.expression?.trim() ||
            mapping.sourceColumn?.trim() ||
            mapping.sourceColumns?.some((column) => column.trim()),
        );
      }),
    [mappings],
  );

  const sourceQueryPreview = useMemo(() => {
    const selectedSourceTables = sources
      .filter((table) => table.isSelected)
      .map((table, idx) => ({
        id: table.tableId,
        qualifiedName: table.qualifiedName,
        alias: `t${idx + 1}`,
      }));

    const selectedDerivedTables = derivedSources
      .filter((source) => source.isSelected)
      .map((source, idx) => ({
        id: source.id,
        qualifiedName: source.sourceName,
        alias: `d${idx + 1}`,
        sqlText: source.sqlText,
      }));

    const activeTables: SourceQueryTable[] = [...selectedSourceTables, ...selectedDerivedTables];
    if (!activeTables.length) {
      return '';
    }

    const tableById = new Map(activeTables.map((table) => [table.id, table]));
    const seedTable =
      (drivingTableId ? tableById.get(drivingTableId) : undefined) ??
      (relationships[0]?.leftTableId ? tableById.get(relationships[0].leftTableId) : undefined) ??
      activeTables[0];

    if (!seedTable) return '';

    const lines = ['SELECT', '  *', `FROM ${renderSourceTableReference(seedTable)}`];
    const visited = new Set<string>([seedTable.id]);
    const pending = [...relationships];

    while (pending.length > 0) {
      const nextIndex = pending.findIndex((join) => {
        const leftVisited = !!join.leftTableId && visited.has(join.leftTableId);
        const rightVisited = !!join.rightTableId && visited.has(join.rightTableId);
        return leftVisited !== rightVisited;
      });
      if (nextIndex === -1) break;

      const [join] = pending.splice(nextIndex, 1);
      const leftTable = join.leftTableId ? tableById.get(join.leftTableId) : undefined;
      const rightTable = join.rightTableId ? tableById.get(join.rightTableId) : undefined;
      if (!leftTable || !rightTable || !join.conditions?.length) continue;

      const attachRight = visited.has(leftTable.id) && !visited.has(rightTable.id);
      const attachingTable = attachRight ? rightTable : leftTable;
      const validConditions = join.conditions.filter(
        (condition) => condition.leftColumn && condition.rightColumn,
      );
      if (!validConditions.length) continue;

      lines.push(`${join.joinType ?? 'INNER'} JOIN ${renderSourceTableReference(attachingTable)}`);
      lines.push(
        `  ON ${validConditions
          .map(
            (condition) =>
              `${renderSourceColumnReference(leftTable, condition.leftColumn as string)} ${condition.operator ?? '='} ${renderSourceColumnReference(rightTable, condition.rightColumn as string)}`,
          )
          .join('\n  AND ')}`,
      );
      visited.add(attachingTable.id);
    }

    if (sourceFilterSql.trim()) {
      lines.push('WHERE');
      lines.push(indentBlock(sourceFilterSql.trim(), '  '));
    }

    return lines.join('\n');
  }, [derivedSources, drivingTableId, relationships, sourceFilterSql, sources]);

  const generatedSql = useMemo(() => {
    const targetQualified = selectedTargetQualifiedName?.trim() || 'TARGET_TABLE';
    const today = new Date().toISOString().slice(0, 10);
    const insertColumns = sqlRows.map((row) => `  ${row.targetColumn}`).join(',\n');

    const selectColumns = sqlRows
      .map((row) => {
        const popupSql = buildPreProcessSql({
          expression:
            row.expression?.trim() ||
            row.sourceColumn?.trim() ||
            row.sourceColumns?.[0]?.trim() ||
            'NULL',
          targetColumn: row.targetColumn,
          sourceAttributeGroups,
          relationships,
          sources,
          drivingTableId,
          derivedSources,
        });
        const selectToFrom = popupSql
          .replace(/^[\s\S]*?SELECT\s*/i, '')
          .replace(/\s*FROM[\s\S]*$/i, '')
          .trim();
        const fallbackExpr =
          row.expression?.trim() ||
          row.sourceColumn?.trim() ||
          row.sourceColumns?.[0]?.trim() ||
          'NULL';
        return `  ${(selectToFrom || `${fallbackExpr} AS ${row.targetColumn}`).padEnd(36)}`;
      })
      .join(',\n');

    const fromBody = sourceQueryPreview.trim()
      ? `  (\n${indentBlock(sourceQueryPreview, '    ')}\n  ) src_preview`
      : sourceFilterSql.trim()
        ? indentBlock(sourceFilterSql.trim(), '  ')
        : '  -- No filter conditions defined on Select Tables step';

    if (!sqlRows.length) {
      return [
        '-- STTM Builder - Auto-generated SQL',
        `-- Target: ${targetQualified}`,
        `-- Date: ${today}`,
        '',
        '-- No mapped target columns yet. Map columns to generate SQL preview.',
      ].join('\n');
    }

    return [
      '-- STTM Builder - Auto-generated SQL',
      `-- Target: ${targetQualified}`,
      `-- Date: ${today}`,
      '',
      `INSERT INTO ${targetQualified} (`,
      insertColumns,
      `)`,
      `SELECT`,
      selectColumns,
      `FROM`,
      fromBody,
      `;`,
    ].join('\n');
  }, [
    sqlRows,
    selectedTargetQualifiedName,
    sourceFilterSql,
    sourceAttributeGroups,
    relationships,
    sources,
    drivingTableId,
    derivedSources,
    sourceQueryPreview,
  ]);

  useEffect(() => {
    const handleRunValidation = () => setActiveTab('sqlPreview');
    window.addEventListener('sttm:run-validation', handleRunValidation);
    return () => window.removeEventListener('sttm:run-validation', handleRunValidation);
  }, []);

  const renderTabPanel = () => {
    if (activeTab === 'mapping') {
      return (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="min-w-0 flex-1 overflow-hidden border-r border-[#e5e7eb]">
            <SourceTargetAttributeMapping />
          </div>
        </div>
      );
    }

    if (activeTab === 'sqlPreview') {
      return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#0b1220' }}>
          <Box
            sx={{
              px: 1.5,
              py: 1,
              borderBottom: '1px solid rgba(148,163,184,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
            }}
          >
            <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: '#e2e8f0' }}>
              Generate SQL
              <Box component="span" sx={{ color: '#64748b', ml: 0.75, fontWeight: 600 }}>
                — {selectedTargetQualifiedName.split('.').pop()}
              </Box>
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Button
                size="small"
                startIcon={<ContentCopyRoundedIcon sx={{ fontSize: 14 }} />}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(generatedSql);
                  } catch {}
                }}
                sx={{ textTransform: 'none', fontSize: '0.72rem', color: '#e2e8f0', border: '1px solid #334155', borderRadius: '8px' }}
              >
                Copy SQL
              </Button>
            </Box>
          </Box>

          <Box sx={{ px: 1.5, py: 1.5, flex: 1, minHeight: 0, overflow: 'auto' }}>
            <Paper
              elevation={0}
              sx={{
                p: 2,
                borderRadius: '10px',
                border: '1px solid rgba(148,163,184,0.2)',
                bgcolor: '#020817',
                minHeight: 180,
              }}
            >
              <SqlHighlightedBlock sql={generatedSql} />
            </Paper>
          </Box>

          <Box sx={{ borderTop: '1px solid rgba(148,163,184,0.2)', p: 1.25, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              size="small"
              variant="contained"
              sx={{
                textTransform: 'none',
                bgcolor: '#166534',
                px: 1.5,
                '&:hover': { bgcolor: '#14532d' },
              }}
            >
              Validate SQL
            </Button>
          </Box>
        </Box>
      );
    }

    const emptyTitleByTab: Record<Exclude<MappingTab, 'mapping'>, string> = {
      sqlPreview: 'Sql Preview',
      dataPreview: 'Data Preview',
     // dataLineage: 'Data Lineage',
    };

    return (
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: '#fff',
          borderTop: '1px solid #f1f5f9',
        }}
      >
        <Box sx={{ textAlign: 'center', color: '#64748b' }}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: '#334155' }}>
            {emptyTitleByTab[activeTab]}
          </Typography>
        </Box>
      </Box>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <Box
        sx={{
          height: 42,
          px: 1.5,
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          borderBottom: '1px solid #e5e7eb',
          bgcolor: '#fff',
        }}
      >
        {mappingTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <Box
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              sx={{
                height: 28,
                px: 1.25,
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                cursor: 'pointer',
                border: isActive ? '1px solid #cbd5e1' : '1px solid transparent',
                bgcolor: isActive ? '#f8fafc' : 'transparent',
                color: isActive ? '#0f172a' : '#64748b',
                '&:hover': { bgcolor: isActive ? '#f8fafc' : '#f8fafc' },
              }}
            >
              {tab.icon}
              <Typography sx={{ fontSize: '0.76rem', fontWeight: isActive ? 700 : 600, lineHeight: 1 }}>
                {tab.label}
              </Typography>
            </Box>
          );
        })}
      </Box>

      <div className="min-h-0 flex-1 overflow-hidden">
        {renderTabPanel()}
      </div>

      <PreProcessModal />
    </div>
  );
}