'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  Button,
  Box,
  Typography,
  IconButton,
  TextField,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  InputAdornment,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import VpnKeyRoundedIcon from '@mui/icons-material/VpnKeyRounded';
import FunctionsRoundedIcon from '@mui/icons-material/FunctionsRounded';
import StorageRoundedIcon from '@mui/icons-material/StorageRounded';
import TerminalRoundedIcon from '@mui/icons-material/TerminalRounded';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import type { ColumnGroup } from '@/features/sttm/types/sttm.types';
import { buildPreProcessSql } from './pre-process-sql';
import { generateMappingDescription, parseSourceColumns } from './mapping-utils';

type FunctionTab = 'string' | 'numeric' | 'date' | 'conversion' | 'logic' | 'window';

const FUNCTION_TABS: { id: FunctionTab; label: string }[] = [
  { id: 'string', label: 'String' },
  { id: 'numeric', label: 'Numeric' },
  { id: 'date', label: 'Date' },
  { id: 'conversion', label: 'Conversion' },
  { id: 'logic', label: 'Logic' },
  { id: 'window', label: 'Window +' },
];

const QUICK_ACTIONS = ['CAST()', 'COALESCE()', 'CONCAT()', 'CASE WHEN ...'];

const FUNCTION_LIBRARY: Record<FunctionTab, string[]> = {
  string: [
    'UPPER()', 'LOWER()', 'TRIM()', 'LTRIM()',
    'RTRIM()', 'SUBSTRING()', 'REPLACE()',
    'CONCAT()', 'LENGTH()', 'REGEXP_REPLACE()',
    'LPAD()', 'RPAD()', 'INITCAP()',
  ],
  numeric: [
    'ROUND()', 'FLOOR()', 'CEIL()', 'ABS()',
    'MOD()', 'POWER()', 'SQRT()', 'SIGN()',
    'TRUNC()',
  ],
  date: [
    'CURRENT_DATE()', 'CURRENT_TIMESTAMP()', 'DATEADD()',
    'DATEDIFF()', 'DATE_TRUNC()', 'EXTRACT()',
    'TO_DATE()', 'TO_TIMESTAMP()',
    'DATE_FORMAT()', 'NOW()', 'DATE_ADD()', 'DATE_SUB()',
    'YEAR()', 'MONTH()', 'DAY()', 'CURRENT_DATE',
  ],
  conversion: [
    'CAST()', 'TRY_CAST()', 'TO_VARCHAR()', 'TO_NUMBER()',
    'TO_BOOLEAN()', 'COALESCE()', 'NULLIF()', 'IFF()', 'DECODE()',
    'CONVERT()', 'ISNULL()', 'TO_CHAR()', 'NVL()',
  ],
  logic: [
    'CASE WHEN ...', 'IFF()', 'COALESCE()', 'NULLIF()',
    'NVL()', 'AND', 'OR', 'NOT',
    'IIF()', 'DECODE()', 'GREATEST()', 'LEAST()',
  ],
  window: [
    'ROW_NUMBER() OVER()', 'RANK() OVER()', 'DENSE_RANK() OVER()',
    'LAG() OVER()', 'LEAD() OVER()', 'SUM() OVER()', 'COUNT() OVER()',
    'NTILE() OVER()', 'FIRST_VALUE() OVER()', 'LAST_VALUE() OVER()',
    'AVG() OVER()', 'MIN() OVER()', 'MAX() OVER()',
    'PERCENT_RANK() OVER()', 'CUME_DIST() OVER()',
  ],
};

const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'FULL', 'CROSS',
  'ON', 'AS', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'BY', 'ORDER', 'GROUP', 'HAVING',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'DISTINCT', 'UNION', 'ALL', 'OVER', 'PARTITION',
  'LIMIT', 'OFFSET', 'ASC', 'DESC', 'LIKE', 'BETWEEN', 'EXISTS', 'INTO', 'WITH', 'USING',
  'TRUE', 'FALSE',
]);

type SqlTokenType =
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'function'
  | 'identifier'
  | 'punctuation'
  | 'space'
  | 'other';

type SqlToken = { type: SqlTokenType; value: string };

const SQL_TOKEN_COLORS: Record<SqlTokenType, string> = {
  comment: '#6b7280',
  string: '#86efac',
  number: '#fbbf24',
  keyword: '#f87171',
  function: '#fb7185',
  identifier: '#e5e7eb',
  punctuation: '#cbd5e1',
  space: 'inherit',
  other: '#e5e7eb',
};

const SQL_TOKEN_PATTERN =
  /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)|([=<>!+\-*/(),;.])|(\s+)|([^\s])/g;

function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  if (!sql) return tokens;
  SQL_TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SQL_TOKEN_PATTERN.exec(sql)) !== null) {
    const [, comment, str, num, word, punct, space, other] = match;
    if (comment != null) {
      tokens.push({ type: 'comment', value: comment });
    } else if (str != null) {
      tokens.push({ type: 'string', value: str });
    } else if (num != null) {
      tokens.push({ type: 'number', value: num });
    } else if (word != null) {
      const upper = word.toUpperCase();
      const nextChar = sql[match.index + word.length];
      if (SQL_KEYWORDS.has(upper)) {
        tokens.push({ type: 'keyword', value: word });
      } else if (nextChar === '(' && !word.includes('.')) {
        tokens.push({ type: 'function', value: word });
      } else {
        tokens.push({ type: 'identifier', value: word });
      }
    } else if (punct != null) {
      tokens.push({ type: 'punctuation', value: punct });
    } else if (space != null) {
      tokens.push({ type: 'space', value: space });
    } else {
      tokens.push({ type: 'other', value: other ?? '' });
    }
  }
  return tokens;
}

function HighlightedSql({ text }: { text: string }) {
  const tokens = useMemo(() => tokenizeSql(text), [text]);
  if (!text) return null;
  return (
    <>
      {tokens.map((token, idx) => (
        <span
          key={idx}
          style={{
            color: SQL_TOKEN_COLORS[token.type],
            fontWeight:
              token.type === 'keyword' || token.type === 'function' ? 600 : 400,
          }}
        >
          {token.value}
        </span>
      ))}
    </>
  );
}

function tableAlias(tableName: string) {
  return tableName.toLowerCase();
}

function schemaCategory(qualifiedName: string) {
  const schema = qualifiedName.split('.')[1] ?? qualifiedName;
  return schema.split('_')[0] || schema;
}

function groupBySchema(groups: ColumnGroup[]) {
  const map = new Map<string, ColumnGroup[]>();
  for (const group of groups) {
    const key = schemaCategory(group.qualifiedName);
    const bucket = map.get(key) ?? [];
    bucket.push(group);
    map.set(key, bucket);
  }
  return Array.from(map.entries());
}

function formatSqlType(type?: string) {
  if (!type) return 'VARCHAR';
  const upper = type.toUpperCase();
  if (upper.includes('NUMBER') || upper === 'INT') return 'BIGINT';
  if (upper.includes('VARCHAR') || upper.includes('TEXT')) return 'VARCHAR';
  if (upper.includes('DATE') && !upper.includes('TIME')) return 'DATE';
  if (upper.includes('TIMESTAMP')) return 'TIMESTAMP';
  return upper;
}

export default function PreProcessModal() {
  const {
    isPreProcessModalOpen,
    setPreProcessModalOpen,
    activeMappingId,
    mappings,
    updateMapping,
    sourceAttributeGroups,
    relationships,
    sources,
    drivingTableId,
    derivedSources,
  } = useSttmBuilderContext();

  const [expression, setExpression] = useState('');
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [columnSearch, setColumnSearch] = useState('');
  const [functionTab, setFunctionTab] = useState<FunctionTab>('string');
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const activeMapping = mappings.find((m) => m.id === activeMappingId);
  const joinCount = relationships.length;

  const groupedSources = useMemo(
    () => groupBySchema(sourceAttributeGroups),
    [sourceAttributeGroups],
  );

  useEffect(() => {
    if (activeMapping) {
      setExpression(activeMapping.expression || activeMapping.sourceColumn || '');
      const initialColumns =
        activeMapping.sourceColumns && activeMapping.sourceColumns.length
          ? activeMapping.sourceColumns
          : parseSourceColumns(activeMapping.sourceColumn);
      setSelectedColumns(initialColumns);
    } else {
      setExpression('');
      setSelectedColumns([]);
    }
    setColumnSearch('');
    setCopyFeedback(null);
  }, [activeMapping, isPreProcessModalOpen]);

  useEffect(() => {
    if (!isPreProcessModalOpen) return;
    setExpandedTables(
      Object.fromEntries(
        sourceAttributeGroups.map((group) => [group.qualifiedName, true]),
      ),
    );
  }, [isPreProcessModalOpen, sourceAttributeGroups]);

  useEffect(() => {
    if (!copyFeedback) return;
    const timeout = setTimeout(() => setCopyFeedback(null), 1500);
    return () => clearTimeout(timeout);
  }, [copyFeedback]);

  const handleClose = () => {
    setPreProcessModalOpen(false);
  };

  const handleApply = () => {
    if (!activeMappingId) return;
    const trimmedExpression = expression.trim();
    const targetColumn = activeMapping?.targetColumn ?? '';
    const nextRule = trimmedExpression ? 'Custom' : (activeMapping?.rule || 'Direct');
    const description = generateMappingDescription({
      rule: nextRule,
      sourceColumns: selectedColumns,
      targetColumn,
      expression: trimmedExpression,
    });

    const hasContent = trimmedExpression || selectedColumns.length > 0;

    updateMapping(activeMappingId, {
      expression: trimmedExpression || null,
      sourceColumns: selectedColumns,
      sourceColumn: selectedColumns.join(', ') || null,
      rule: nextRule,
      status: hasContent ? 'MAPPED' : 'UNMAPPED',
      ...(activeMapping?.descriptionEdited ? {} : { description }),
    });
    handleClose();
  };

  const insertText = (text: string, wrapExisting = false) => {
    if (wrapExisting && text.includes('()')) {
      setExpression((prev) => (prev ? text.replace('()', `(${prev})`) : text));
    } else {
      setExpression((prev) => prev + (prev && !prev.endsWith(' ') ? ' ' : '') + text);
    }
    requestAnimationFrame(() => editorRef.current?.focus());
  };

  const toggleColumnSelection = (group: ColumnGroup, columnName: string) => {
    const fullValue = `${tableAlias(group.table)}.${columnName}`;
    const lower = fullValue.toLowerCase();
    setSelectedColumns((prev) => {
      const already = prev.find((item) => item.toLowerCase() === lower);
      if (already) {
        return prev.filter((item) => item.toLowerCase() !== lower);
      }
      return [...prev, fullValue];
    });
    insertText(fullValue);
  };

  const removeSelectedColumn = (value: string) => {
    const lower = value.toLowerCase();
    setSelectedColumns((prev) => prev.filter((item) => item.toLowerCase() !== lower));
    setExpression((prev) =>
      prev
        .split(/(\s+)/)
        .filter((part) => part.trim().toLowerCase() !== lower)
        .join('')
        .replace(/\s{2,}/g, ' ')
        .trim(),
    );
  };

  const clearSelectedColumns = () => {
    setSelectedColumns([]);
  };

  const isColumnSelected = (group: ColumnGroup, columnName: string) => {
    const lower = `${tableAlias(group.table)}.${columnName}`.toLowerCase();
    return selectedColumns.some((item) => item.toLowerCase() === lower);
  };

  const generatedSql = useMemo(() => {
    if (!activeMapping) return '';
    return buildPreProcessSql({
      expression,
      targetColumn: activeMapping.targetColumn,
      sourceAttributeGroups,
      relationships,
      sources,
      drivingTableId,
      derivedSources,
    });
  }, [
    activeMapping,
    expression,
    sourceAttributeGroups,
    relationships,
    sources,
    drivingTableId,
    derivedSources,
  ]);

  const expressionLineNumbers = useMemo(() => {
    const count = Math.max(1, expression.split('\n').length);
    return Array.from({ length: count }, (_, i) => i + 1);
  }, [expression]);

  const handleCopy = async () => {
    if (!generatedSql) return;
    try {
      await navigator.clipboard.writeText(generatedSql);
      setCopyFeedback('Copied');
    } catch {
      setCopyFeedback('Copy failed');
    }
  };

  const filteredGroups = useMemo(() => {
    const query = columnSearch.trim().toLowerCase();
    if (!query) return groupedSources;

    return groupedSources
      .map(([category, groups]) => {
        const filtered = groups
          .map((group) => ({
            ...group,
            columns: group.columns.filter(
              (col) =>
                col.name?.toLowerCase().includes(query) ||
                group.table.toLowerCase().includes(query),
            ),
          }))
          .filter((group) => group.columns.length > 0);
        return [category, filtered] as const;
      })
      .filter(([, groups]) => groups.length > 0);
  }, [groupedSources, columnSearch]);

  const sourceLabel =
    selectedColumns.length > 0
      ? selectedColumns.join(', ')
      : activeMapping?.sourceColumn || 'not mapped';

  return (
    <Dialog
      open={isPreProcessModalOpen}
      onClose={handleClose}
      maxWidth={false}
      fullWidth
      sx={{
        '& .MuiDialog-paper': {
          width: 'min(1280px, 96vw)',
          height: 'min(740px, 92vh)',
          maxWidth: 'none',
          borderRadius: '12px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 2.5,
          py: 1.5,
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          bgcolor: '#fff',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              bgcolor: '#111827',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <StorageRoundedIcon sx={{ fontSize: 18, color: '#fff' }} />
          </Box>

          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: '#111827', mb: 0.25 }}>
              Pre-Processing Rule
            </Typography>
            {activeMapping && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.25 }}>
                <Typography sx={{ fontSize: '0.78rem', color: '#6b7280' }}>
                  Target:{' '}
                  <Box component="span" sx={{ fontWeight: 700, color: '#111827' }}>
                    {activeMapping.targetColumn}
                  </Box>
                </Typography>
                <Typography sx={{ fontSize: '0.78rem', color: '#6b7280' }}>
                  Type:{' '}
                  <Box component="span" sx={{ fontWeight: 600, color: '#374151' }}>
                    {formatSqlType(activeMapping.targetType)}
                  </Box>
                </Typography>
                <Typography sx={{ fontSize: '0.78rem', color: '#6b7280' }}>
                  Source:{' '}
                  <Box
                    component="span"
                    sx={{
                      fontWeight: 600,
                      color: '#374151',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    }}
                  >
                    {sourceLabel}
                  </Box>
                </Typography>
                {joinCount > 0 && (
                  <Chip
                    size="small"
                    label={`++ ${joinCount} join${joinCount === 1 ? '' : 's'} in FROM`}
                    sx={{
                      height: 22,
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      bgcolor: '#ecfdf5',
                      color: '#047857',
                      border: '1px solid #a7f3d0',
                    }}
                  />
                )}
              </Box>
            )}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          <Button
            onClick={handleClose}
            sx={{
              color: '#4b5563',
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '0.85rem',
              px: 1.5,
              '&:hover': { bgcolor: '#f3f4f6' },
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            variant="contained"
            startIcon={<CheckCircleRoundedIcon sx={{ fontSize: 18, color: '#22c55e' }} />}
            disabled={!expression.trim() && selectedColumns.length === 0}
            sx={{
              bgcolor: '#111827',
              color: '#fff',
              textTransform: 'none',
              fontWeight: 700,
              fontSize: '0.85rem',
              borderRadius: '999px',
              boxShadow: 'none',
              px: 2,
              '&:hover': { bgcolor: '#1f2937', boxShadow: 'none' },
              '&.Mui-disabled': {
                bgcolor: '#374151',
                color: '#9ca3af',
              },
            }}
          >
            Apply Rule
          </Button>
          <IconButton onClick={handleClose} size="small" sx={{ color: '#6b7280' }}>
            <CloseRoundedIcon />
          </IconButton>
        </Box>
      </Box>

      {/* Body */}
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Source Tables */}
        <Box
          sx={{
            width: 270,
            flexShrink: 0,
            borderRight: '1px solid #e5e7eb',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: '#fff',
          }}
        >
          <Box
            sx={{
              px: 2,
              py: 1.25,
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <StorageRoundedIcon sx={{ fontSize: 16, color: '#374151' }} />
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: '#111827' }}>
                Source Tables
              </Typography>
            </Box>
            <Typography sx={{ fontSize: '0.68rem', color: '#9ca3af' }}>click to insert</Typography>
          </Box>

          {selectedColumns.length > 0 && (
            <Box
              sx={{
                px: 1.5,
                py: 1.25,
                borderBottom: '1px solid #e5e7eb',
                bgcolor: '#f8fafc',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  mb: 0.75,
                }}
              >
                <Typography
                  sx={{
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    color: '#0f172a',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                  }}
                >
                  <FiberManualRecordIcon sx={{ fontSize: 8, color: '#3b82f6' }} />
                  {selectedColumns.length} columns selected
                </Typography>
                <Button
                  size="small"
                  onClick={clearSelectedColumns}
                  sx={{
                    color: '#3b82f6',
                    textTransform: 'none',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    minWidth: 0,
                    px: 0.75,
                    '&:hover': { bgcolor: 'transparent', color: '#2563eb' },
                  }}
                >
                  Clear
                </Button>
              </Box>
              <Box
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 0.5,
                  maxHeight: 96,
                  overflowY: 'auto',
                  pr: 0.5,
                  '&::-webkit-scrollbar': { width: 6 },
                  '&::-webkit-scrollbar-thumb': {
                    bgcolor: '#cbd5e1',
                    borderRadius: 3,
                  },
                }}
              >
                {selectedColumns.map((column) => (
                  <Chip
                    key={column}
                    label={column}
                    size="small"
                    onDelete={() => removeSelectedColumn(column)}
                    sx={{
                      height: 22,
                      fontSize: '0.7rem',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontWeight: 700,
                      bgcolor: '#eef2ff',
                      color: '#3730a3',
                      border: '1px solid #c7d2fe',
                      borderRadius: '6px',
                      '& .MuiChip-deleteIcon': {
                        color: '#6366f1',
                        fontSize: 14,
                        '&:hover': { color: '#3730a3' },
                      },
                    }}
                  />
                ))}
              </Box>
            </Box>
          )}

          <Box sx={{ p: 1.5, borderBottom: '1px solid #e5e7eb' }}>
            <TextField
              size="small"
              fullWidth
              placeholder="Search columns..."
              value={columnSearch}
              onChange={(e) => setColumnSearch(e.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRoundedIcon sx={{ fontSize: 16, color: '#9ca3af' }} />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  bgcolor: '#fff',
                  fontSize: '0.8rem',
                  borderRadius: '8px',
                },
              }}
            />
          </Box>

          <Box sx={{ flex: 1, overflowY: 'auto', px: 1, py: 1 }}>
            {filteredGroups.map(([category, groups]) => (
              <Box key={category} sx={{ mb: 1.5 }}>
                <Typography
                  sx={{
                    px: 1,
                    py: 0.5,
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    color: '#9ca3af',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}
                >
                  {category}
                </Typography>
                {groups.map((group) => {
                  const isExpanded = expandedTables[group.qualifiedName] ?? true;
                  return (
                    <Accordion
                      key={group.qualifiedName}
                      expanded={isExpanded}
                      onChange={(_, expanded) =>
                        setExpandedTables((prev) => ({
                          ...prev,
                          [group.qualifiedName]: expanded,
                        }))
                      }
                      disableGutters
                      elevation={0}
                      sx={{
                        bgcolor: 'transparent',
                        '&:before': { display: 'none' },
                        boxShadow: 'none',
                      }}
                    >
                      <AccordionSummary
                        expandIcon={<ExpandMoreIcon sx={{ fontSize: 18, color: '#6b7280' }} />}
                        sx={{
                          minHeight: 34,
                          px: 0.5,
                          '& .MuiAccordionSummary-content': {
                            my: 0.5,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.75,
                          },
                        }}
                      >
                        <StorageRoundedIcon sx={{ fontSize: 14, color: '#6b7280' }} />
                        <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: '#111827' }}>
                          {group.table}
                        </Typography>
                      </AccordionSummary>
                      <AccordionDetails sx={{ p: 0, pb: 0.5 }}>
                        {group.columns.map((col) => {
                          const colName = col.name ?? '';
                          const isSelected = isColumnSelected(group, colName);
                          const isKey = col.isPrimaryKey || col.isForeignKey;

                          return (
                            <Box
                              key={`${group.qualifiedName}-${colName}`}
                              onClick={() => toggleColumnSelection(group, colName)}
                              sx={{
                                px: 1.25,
                                py: 0.75,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.75,
                                cursor: 'pointer',
                                borderRadius: '6px',
                                bgcolor: isSelected ? '#eef2ff' : 'transparent',
                                '&:hover': { bgcolor: isSelected ? '#e0e7ff' : '#f3f4f6' },
                              }}
                            >
                              {isKey ? (
                                <VpnKeyRoundedIcon sx={{ fontSize: 12, color: '#f59e0b' }} />
                              ) : (
                                <FiberManualRecordIcon
                                  sx={{ fontSize: 8, color: '#cbd5e1' }}
                                />
                              )}
                              <Typography
                                sx={{
                                  flex: 1,
                                  fontSize: '0.78rem',
                                  color: '#374151',
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                }}
                              >
                                {colName}
                              </Typography>
                              <Typography
                                sx={{
                                  fontSize: '0.62rem',
                                  fontWeight: 700,
                                  color: '#9ca3af',
                                  letterSpacing: '0.04em',
                                }}
                              >
                                {formatSqlType(col.type)}
                              </Typography>
                              {isSelected && (
                                <CheckCircleRoundedIcon
                                  sx={{ fontSize: 14, color: '#22c55e' }}
                                />
                              )}
                            </Box>
                          );
                        })}
                      </AccordionDetails>
                    </Accordion>
                  );
                })}
              </Box>
            ))}
            {filteredGroups.length === 0 && (
              <Typography
                sx={{
                  p: 2,
                  fontSize: '0.8rem',
                  color: '#9ca3af',
                  fontStyle: 'italic',
                  textAlign: 'center',
                }}
              >
                {sourceAttributeGroups.length === 0
                  ? 'No source attributes available. Select tables first.'
                  : 'No columns match your search.'}
              </Typography>
            )}
          </Box>
        </Box>

        {/* Function Library */}
        <Box
          sx={{
            width: 280,
            flexShrink: 0,
            borderRight: '1px solid #e5e7eb',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: '#fff',
          }}
        >
          <Box
            sx={{
              px: 2,
              py: 1.25,
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
            }}
          >
            <FunctionsRoundedIcon sx={{ fontSize: 16, color: '#374151' }} />
            <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: '#111827' }}>
              Function Library
            </Typography>
          </Box>

          <Box sx={{ px: 1.5, pt: 1.25, pb: 1 }}>
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 0.5,
                p: 0.5,
                bgcolor: '#f3f4f6',
                borderRadius: '10px',
              }}
            >
              {FUNCTION_TABS.map((tab) => {
                const isActive = functionTab === tab.id;
                return (
                  <Box
                    key={tab.id}
                    onClick={() => setFunctionTab(tab.id)}
                    sx={{
                      px: 1.25,
                      py: 0.5,
                      borderRadius: '7px',
                      cursor: 'pointer',
                      fontSize: '0.74rem',
                      fontWeight: 600,
                      color: isActive ? '#111827' : '#6b7280',
                      bgcolor: isActive ? '#ffffff' : 'transparent',
                      boxShadow: isActive
                        ? '0 1px 2px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(15, 23, 42, 0.04)'
                        : 'none',
                      transition:
                        'background-color 120ms ease, color 120ms ease, box-shadow 120ms ease',
                      '&:hover': {
                        bgcolor: isActive ? '#ffffff' : 'rgba(255,255,255,0.55)',
                        color: '#111827',
                      },
                    }}
                  >
                    {tab.label}
                  </Box>
                );
              })}
            </Box>
          </Box>

          <Box
            sx={{
              px: 1.5,
              py: 1.25,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 0.5,
              borderBottom: '1px solid #f1f5f9',
            }}
          >
            {QUICK_ACTIONS.map((action) => (
              <Chip
                key={action}
                label={action}
                size="small"
                onClick={() => insertText(action, action.includes('()'))}
                sx={{
                  height: 26,
                  borderRadius: '999px',
                  bgcolor: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  color: '#374151',
                  cursor: 'pointer',
                  '&:hover': { bgcolor: '#f3f4f6', borderColor: '#d1d5db' },
                }}
              />
            ))}
          </Box>

          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              px: 1.5,
              py: 1.25,
              display: 'flex',
              flexWrap: 'wrap',
              alignContent: 'flex-start',
              gap: 0.5,
            }}
          >
            {FUNCTION_LIBRARY[functionTab].map((fn) => (
              <Chip
                key={fn}
                label={fn}
                size="small"
                onClick={() => insertText(fn, fn.includes('()'))}
                sx={{
                  height: 26,
                  borderRadius: '999px',
                  bgcolor: '#faf5ff',
                  border: '1px solid #ddd6fe',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: '#6d28d9',
                  cursor: 'pointer',
                  '&:hover': {
                    bgcolor: '#f3e8ff',
                    borderColor: '#c4b5fd',
                  },
                }}
              />
            ))}
          </Box>
        </Box>

        {/* SQL Preview */}
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            bgcolor: '#0b1220',
            color: '#e5e7eb',
          }}
        >
          <Box
            sx={{
              px: 2,
              py: 1.25,
              borderBottom: '1px solid #1f2937',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 1,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <FiberManualRecordIcon sx={{ fontSize: 10, color: '#22c55e' }} />
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: '#fff' }}>
                SQL Preview
              </Typography>
              {joinCount > 0 && (
                <Typography sx={{ fontSize: '0.72rem', color: '#9ca3af' }}>
                  {joinCount} join{joinCount === 1 ? '' : 's'} from Step 1
                </Typography>
              )}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              {copyFeedback && (
                <Typography sx={{ fontSize: '0.7rem', color: '#86efac', fontWeight: 600 }}>
                  {copyFeedback}
                </Typography>
              )}
              <Button
                size="small"
                startIcon={<ContentCopyRoundedIcon sx={{ fontSize: 14 }} />}
                onClick={handleCopy}
                disabled={!generatedSql}
                sx={{
                  color: '#cbd5e1',
                  textTransform: 'none',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  px: 1.25,
                  py: 0.25,
                  '&:hover': { bgcolor: '#1f2937', borderColor: '#475569' },
                  '&.Mui-disabled': { color: '#475569', borderColor: '#1f2937' },
                }}
              >
                Copy
              </Button>
            </Box>
          </Box>

          {/* Expression Editor */}
          <Box sx={{ px: 2, pt: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.75 }}>
              <Typography
                sx={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  color: '#9ca3af',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                Expression
              </Typography>
              <Typography sx={{ fontSize: '0.7rem', color: '#6b7280' }}>
                — type or click a column / function
              </Typography>
            </Box>

            <Box
              sx={{
                display: 'flex',
                borderRadius: '8px',
                border: '1px solid #1f2937',
                bgcolor: '#020617',
                overflow: 'hidden',
              }}
            >
              <Box
                sx={{
                  width: 32,
                  flexShrink: 0,
                  bgcolor: '#0b1220',
                  borderRight: '1px solid #1f2937',
                  py: 1.25,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: '0.75rem',
                  lineHeight: 1.6,
                  color: '#475569',
                  pointerEvents: 'none',
                  userSelect: 'none',
                }}
              >
                {expressionLineNumbers.map((line) => (
                  <Box key={line}>{line}</Box>
                ))}
              </Box>
              <Box sx={{ position: 'relative', flex: 1, minWidth: 0 }}>
                <Box
                  ref={overlayRef}
                  aria-hidden
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    overflow: 'hidden',
                    px: 1.5,
                    py: 1.25,
                    pointerEvents: 'none',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: '0.82rem',
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: '#e5e7eb',
                  }}
                >
                  {expression ? <HighlightedSql text={expression} /> : null}
                </Box>
                <Box
                  component="textarea"
                  ref={editorRef}
                  value={expression}
                  onChange={(e) => setExpression(e.target.value)}
                  onScroll={(e) => {
                    if (overlayRef.current) {
                      overlayRef.current.scrollTop = e.currentTarget.scrollTop;
                      overlayRef.current.scrollLeft = e.currentTarget.scrollLeft;
                    }
                  }}
                  placeholder={`-- Type or click a column from the left panel\n-- e.g. UPPER(a.NAME)   or   ROW_NUMBER() OVER(ORDER BY a.DATE_KEY)`}
                  spellCheck={false}
                  sx={{
                    position: 'relative',
                    width: '100%',
                    minHeight: 120,
                    resize: 'none',
                    border: 'none',
                    bgcolor: 'transparent',
                    color: 'transparent',
                    caretColor: '#e5e7eb',
                    WebkitTextFillColor: 'transparent',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: '0.82rem',
                    lineHeight: 1.6,
                    px: 1.5,
                    py: 1.25,
                    outline: 'none',
                    boxSizing: 'border-box',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    '&::placeholder': {
                      color: '#475569',
                      WebkitTextFillColor: '#475569',
                    },
                    '&::selection': {
                      bgcolor: 'rgba(96, 165, 250, 0.35)',
                      WebkitTextFillColor: 'transparent',
                    },
                  }}
                />
              </Box>
            </Box>
          </Box>

          {/* Compiled SQL */}
          <Box
            sx={{
              px: 2,
              pt: 1.75,
              pb: 2,
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <TerminalRoundedIcon sx={{ fontSize: 14, color: '#9ca3af' }} />
              <Typography
                sx={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  color: '#9ca3af',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                Compiled SQL
              </Typography>
            </Box>

            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                borderRadius: '8px',
                bgcolor: 'transparent',
                overflow: 'auto',
              }}
            >
              {generatedSql ? (
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: '0.82rem',
                    color: '#cbd5e1',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    lineHeight: 1.65,
                  }}
                >
                  <HighlightedSql text={generatedSql} />
                </Box>
              ) : (
                <Typography
                  sx={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: '0.78rem',
                    color: '#475569',
                    fontStyle: 'italic',
                  }}
                >
                  -- Write an expression in the editor above
                </Typography>
              )}
            </Box>
          </Box>
        </Box>
      </Box>
    </Dialog>
  );
}
