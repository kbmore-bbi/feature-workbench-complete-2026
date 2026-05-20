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
  Tabs,
  Tab,
  InputAdornment,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import type { ColumnGroup } from '@/features/sttm/types/sttm.types';
import { dbService } from '@/services/dbService';
import { getApiErrorMessage } from '@/api/axiosInstance';
import {
  buildPreProcessSql,
  buildPreProcessValidatePayload,
  evaluatePreProcessChecks,
  type PreProcessValidationChecks,
} from './pre-process-sql';
import { generateMappingDescription, parseSourceColumns } from './mapping-utils';

type FunctionTab = 'string' | 'numeric' | 'date' | 'conversion' | 'logic' | 'window';

const QUICK_ACTIONS = ['CAST()', 'COALESCE()', 'CONCAT()', 'CASE WHEN ... END'];

const FUNCTION_LIBRARY: Record<FunctionTab, string[]> = {
  string: [
    'UPPER()', 'LOWER()', 'TRIM()', 'LTRIM()', 'RTRIM()', 'SUBSTRING()',
    'REPLACE()', 'CONCAT()', 'LENGTH()', 'LEFT()', 'RIGHT()', 'INITCAP()',
  ],
  numeric: [
    'ABS()', 'ROUND()', 'CEIL()', 'FLOOR()', 'MOD()', 'POWER()', 'SQRT()',
    'GREATEST()', 'LEAST()', 'SIGN()', 'RANDOM()',
  ],
  date: [
    'CURRENT_DATE()', 'CURRENT_TIMESTAMP()', 'DATEADD()', 'DATEDIFF()',
    'DATE_TRUNC()', 'EXTRACT()', 'TO_DATE()', 'TO_TIMESTAMP()',
  ],
  conversion: [
    'CAST()', 'TRY_CAST()', 'TO_VARCHAR()', 'TO_NUMBER()', 'TO_BOOLEAN()',
    'COALESCE()', 'NULLIF()', 'IFF()', 'DECODE()',
  ],
  logic: [
    'CASE WHEN ... END', 'IFF()', 'COALESCE()', 'NULLIF()', 'NVL()',
    'AND()', 'OR()', 'NOT()',
  ],
  window: [
    'ROW_NUMBER() OVER()', 'RANK() OVER()', 'DENSE_RANK() OVER()',
    'LAG() OVER()', 'LEAD() OVER()', 'SUM() OVER()', 'COUNT() OVER()',
  ],
};

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
    sendChatMessage,
  } = useSttmBuilderContext();

  const [expression, setExpression] = useState('');
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [columnSearch, setColumnSearch] = useState('');
  const [functionTab, setFunctionTab] = useState<FunctionTab>('string');
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [validationStatus, setValidationStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [validationChecks, setValidationChecks] = useState<PreProcessValidationChecks | null>(null);
  const [footerMessage, setFooterMessage] = useState('No expression defined yet');
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

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
    setValidationStatus('idle');
    setValidationChecks(null);
    setColumnSearch('');
    setFooterMessage('No expression defined yet');
  }, [activeMapping, isPreProcessModalOpen]);

  useEffect(() => {
    if (!isPreProcessModalOpen) return;
    setExpandedTables(
      Object.fromEntries(
        sourceAttributeGroups.map((group) => [group.qualifiedName, true]),
      ),
    );
  }, [isPreProcessModalOpen, sourceAttributeGroups]);

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
    setValidationStatus('idle');
    setValidationChecks(null);
    setFooterMessage('Expression updated — validate when ready');
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
    // Also insert into expression so users see the column referenced.
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
    setValidationStatus('idle');
    setValidationChecks(null);
  };

  const clearSelectedColumns = () => {
    setSelectedColumns([]);
    setValidationStatus('idle');
    setValidationChecks(null);
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

  const handleValidate = async () => {
    const trimmed = expression.trim();
    if (!trimmed) {
      setValidationStatus('idle');
      setValidationChecks(null);
      setFooterMessage('No expression defined yet');
      return;
    }

    const checks = evaluatePreProcessChecks(
      trimmed,
      sourceAttributeGroups,
      activeMapping?.sourceColumn,
    );
    setValidationChecks(checks);

    if (!checks.expressionDefined || !checks.noPlaceholderTokens) {
      setValidationStatus('error');
      setFooterMessage('Fix the expression before validating.');
      return;
    }

    if (!generatedSql) {
      setValidationStatus('error');
      setFooterMessage('Unable to build SQL preview for validation.');
      return;
    }

    setValidationStatus('loading');
    setFooterMessage('Validating expression with backend...');

    try {
      const payload = buildPreProcessValidatePayload(
        generatedSql,
        sources,
        relationships,
        sourceAttributeGroups,
        drivingTableId,
      );
      const result = await dbService.validatePreProcessExpression(payload);
      if (result.valid) {
        setValidationStatus('success');
        setFooterMessage('Expression validated successfully');
      } else {
        setValidationStatus('error');
        setFooterMessage(result.message || 'Expression validation failed.');
      }
    } catch (error) {
      setValidationStatus('error');
      setFooterMessage(getApiErrorMessage(error, 'Unable to validate the expression right now.'));
    }
  };

  const handleCopy = async () => {
    if (!generatedSql) return;
    try {
      await navigator.clipboard.writeText(generatedSql);
      setFooterMessage('SQL copied to clipboard');
    } catch {
      setFooterMessage('Unable to copy SQL');
    }
  };

  const handleAskAi = () => {
    if (!activeMapping) return;
    const prompt = `Help me write a pre-processing rule for target column ${activeMapping.targetColumn} (${activeMapping.targetType}). Current expression: ${expression.trim() || '(empty)'}`;
    sendChatMessage(prompt);
    setFooterMessage('Sent request to AI Agent');
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
          height: 'min(760px, 92vh)',
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
          py: 2,
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 2,
          bgcolor: '#fff',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '1.05rem', fontWeight: 700, color: '#111827', mb: 0.75 }}>
            Pre-Processing Rule
          </Typography>
          {activeMapping && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.25 }}>
              <Typography sx={{ fontSize: '0.8rem', color: '#6b7280' }}>
                Target:{' '}
                <Box component="span" sx={{ fontWeight: 700, color: '#111827' }}>
                  {activeMapping.targetColumn}
                </Box>
              </Typography>
              <Typography sx={{ fontSize: '0.8rem', color: '#d1d5db' }}>|</Typography>
              <Typography sx={{ fontSize: '0.8rem', color: '#6b7280' }}>
                Type:{' '}
                <Box component="span" sx={{ fontWeight: 600, color: '#374151' }}>
                  {formatSqlType(activeMapping.targetType)}
                </Box>
              </Typography>
              <Typography sx={{ fontSize: '0.8rem', color: '#d1d5db' }}>|</Typography>
              <Typography sx={{ fontSize: '0.8rem', color: '#6b7280' }}>
                Source:{' '}
                <Box component="span" sx={{ fontWeight: 600, color: '#374151', fontFamily: 'monospace' }}>
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

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          <Button
            variant="contained"
            size="small"
            startIcon={<AutoAwesomeRoundedIcon sx={{ fontSize: 16 }} />}
            endIcon={<KeyboardArrowDownRoundedIcon sx={{ fontSize: 16 }} />}
            onClick={handleAskAi}
            sx={{
              bgcolor: '#111827',
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '0.8rem',
              boxShadow: 'none',
              '&:hover': { bgcolor: '#1f2937', boxShadow: 'none' },
            }}
          >
            Ask AI Agent
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
            width: 260,
            flexShrink: 0,
            borderRight: '1px solid #e5e7eb',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: '#f9fafb',
          }}
        >
          <Box
            sx={{
              px: 2,
              py: 1.5,
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: '#374151' }}>
              Source Tables
            </Typography>
            <Typography sx={{ fontSize: '0.68rem', color: '#9ca3af' }}>click to insert</Typography>
          </Box>

          {selectedColumns.length > 0 && (
            <Box
              sx={{
                px: 1.5,
                py: 1.25,
                borderBottom: '1px solid #e5e7eb',
                bgcolor: '#fff',
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
                      bgcolor: '#fef3c7',
                      color: '#92400e',
                      border: '1px solid #f59e0b',
                      borderRadius: '6px',
                      '& .MuiChip-deleteIcon': {
                        color: '#92400e',
                        fontSize: 14,
                        '&:hover': { color: '#7c2d12' },
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
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon sx={{ fontSize: 16, color: '#9ca3af' }} />
                  </InputAdornment>
                ),
              }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  bgcolor: '#fff',
                  fontSize: '0.8rem',
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
                          '& .MuiAccordionSummary-content': { my: 0.5 },
                        }}
                      >
                        <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: '#111827' }}>
                          {group.table}
                        </Typography>
                      </AccordionSummary>
                      <AccordionDetails sx={{ p: 0, pb: 0.5 }}>
                        {group.columns.map((col) => {
                          const colName = col.name ?? '';
                          const isSelected = isColumnSelected(group, colName);
                          const showKeyIcon = col.isPrimaryKey || col.isForeignKey;

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
                                bgcolor: isSelected ? '#fef3c7' : 'transparent',
                                '&:hover': { bgcolor: isSelected ? '#fde68a' : '#e5e7eb' },
                              }}
                            >
                              {isSelected ? (
                                <CheckCircleRoundedIcon sx={{ fontSize: 14, color: '#f59e0b' }} />
                              ) : showKeyIcon ? (
                                <FiberManualRecordIcon sx={{ fontSize: 10, color: '#3b82f6' }} />
                              ) : (
                                <Box sx={{ width: 14 }} />
                              )}
                              <Typography
                                sx={{
                                  flex: 1,
                                  fontSize: '0.78rem',
                                  color: '#374151',
                                  fontFamily: 'monospace',
                                }}
                              >
                                {colName}
                              </Typography>
                              <Typography sx={{ fontSize: '0.65rem', color: '#9ca3af' }}>
                                {formatSqlType(col.type)}
                              </Typography>
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

        {/* Expression Editor */}
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid #e5e7eb',
            bgcolor: '#fff',
          }}
        >
          <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid #e5e7eb' }}>
            <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: '#374151' }}>
              Expression Editor
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: '#9ca3af', mt: 0.25 }}>
              build your rule manually
            </Typography>
          </Box>

          <Box sx={{ px: 2, py: 1.25, display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {QUICK_ACTIONS.map((action) => (
              <Chip
                key={action}
                label={action}
                size="small"
                onClick={() => insertText(action, action.includes('()'))}
                sx={{
                  height: 26,
                  borderRadius: '6px',
                  bgcolor: '#f3f4f6',
                  border: '1px solid #e5e7eb',
                  fontFamily: 'monospace',
                  fontSize: '0.72rem',
                  cursor: 'pointer',
                  '&:hover': { bgcolor: '#e5e7eb' },
                }}
              />
            ))}
          </Box>

          <Box sx={{ px: 2, pb: 1.5, flex: 1, minHeight: 0 }}>
            <Box
              component="textarea"
              ref={editorRef}
              value={expression}
              onChange={(e) => {
                setExpression(e.target.value);
                setValidationStatus('idle');
                setValidationChecks(null);
                setFooterMessage(
                  e.target.value.trim()
                    ? 'Expression updated — validate when ready'
                    : 'No expression defined yet',
                );
              }}
              placeholder={`-- Type or click a column from the left panel\n-- e.g. UPPER(a.NAME) or ROW_NUMBER() OVER(ORDER BY a.DATE_KEY)`}
              sx={{
                width: '100%',
                height: '100%',
                minHeight: 180,
                resize: 'none',
                border: '1px solid #374151',
                borderRadius: '8px',
                bgcolor: '#111827',
                color: '#e5e7eb',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '0.85rem',
                lineHeight: 1.6,
                p: 2,
                outline: 'none',
                boxSizing: 'border-box',
                '&::placeholder': { color: '#6b7280' },
                '&:focus': { borderColor: '#60a5fa' },
              }}
            />
          </Box>

          <Box sx={{ borderTop: '1px solid #e5e7eb', bgcolor: '#f9fafb' }}>
            <Tabs
              value={functionTab}
              onChange={(_, value: FunctionTab) => setFunctionTab(value)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                minHeight: 36,
                px: 1,
                '& .MuiTab-root': {
                  minHeight: 36,
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  textTransform: 'capitalize',
                  color: '#6b7280',
                },
                '& .Mui-selected': { color: '#1d4ed8' },
                '& .MuiTabs-indicator': { bgcolor: '#1d4ed8' },
              }}
            >
              {(Object.keys(FUNCTION_LIBRARY) as FunctionTab[]).map((tab) => (
                <Tab key={tab} value={tab} label={tab} />
              ))}
            </Tabs>
            <Box sx={{ px: 2, py: 1.25, display: 'flex', flexWrap: 'wrap', gap: 0.75, maxHeight: 110, overflowY: 'auto' }}>
              {FUNCTION_LIBRARY[functionTab].map((fn) => (
                <Chip
                  key={fn}
                  label={fn}
                  size="small"
                  onClick={() => insertText(fn, fn.includes('()'))}
                  sx={{
                    height: 24,
                    borderRadius: '6px',
                    bgcolor: '#fff',
                    border: '1px solid #e5e7eb',
                    fontFamily: 'monospace',
                    fontSize: '0.7rem',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: '#eff6ff', borderColor: '#bfdbfe' },
                  }}
                />
              ))}
            </Box>
          </Box>
        </Box>

        {/* SQL Preview */}
        <Box
          sx={{
            width: 380,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            bgcolor: '#111827',
            color: '#fff',
          }}
        >
          <Box
            sx={{
              px: 2,
              py: 1.5,
              borderBottom: '1px solid #374151',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography sx={{ fontSize: '0.8rem', fontWeight: 700 }}>SQL Preview</Typography>
              {joinCount > 0 && (
                <Chip
                  size="small"
                  label={`${joinCount} join${joinCount === 1 ? '' : 's'}`}
                  sx={{
                    height: 20,
                    fontSize: '0.65rem',
                    bgcolor: '#1f2937',
                    color: '#93c5fd',
                    border: '1px solid #374151',
                  }}
                />
              )}
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Button
                size="small"
                startIcon={<ContentCopyRoundedIcon sx={{ fontSize: 14 }} />}
                onClick={handleCopy}
                disabled={!generatedSql}
                sx={{ color: '#93c5fd', textTransform: 'none', fontSize: '0.72rem', minWidth: 0, px: 1 }}
              >
                Copy
              </Button>
              <Button
                size="small"
                onClick={handleValidate}
                disabled={validationStatus === 'loading' || !expression.trim()}
                sx={{
                  color: '#fff',
                  textTransform: 'none',
                  fontSize: '0.72rem',
                  bgcolor: '#1d4ed8',
                  px: 1.25,
                  '&:hover': { bgcolor: '#1e40af' },
                }}
              >
                {validationStatus === 'loading' ? 'Validating...' : 'Validate'}
              </Button>
            </Box>
          </Box>
          <Box sx={{ p: 2, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {generatedSql ? (
              <Typography
                component="pre"
                sx={{
                  m: 0,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: '0.8rem',
                  color: '#d1d5db',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {generatedSql}
              </Typography>
            ) : (
              <Typography sx={{ fontSize: '0.8rem', color: '#6b7280', fontStyle: 'italic' }}>
                Type an expression to preview SQL.
              </Typography>
            )}

            {validationStatus === 'success' && validationChecks && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1.25,
                    py: 1,
                    borderRadius: '8px',
                    bgcolor: '#052e16',
                    border: '1px solid #22c55e',
                  }}
                >
                  <CheckCircleRoundedIcon sx={{ fontSize: 18, color: '#22c55e' }} />
                  <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: '#86efac' }}>
                    Expression validated successfully!
                  </Typography>
                </Box>

                {[
                  { key: 'expressionDefined' as const, label: 'Expression defined' },
                  { key: 'sourceColumnReferenced' as const, label: 'Source column referenced' },
                  { key: 'noPlaceholderTokens' as const, label: 'No placeholder tokens' },
                ].map((item) => {
                  const passed = validationChecks[item.key];
                  return (
                    <Box
                      key={item.key}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        px: 1.25,
                        py: 0.85,
                        borderRadius: '8px',
                        bgcolor: '#1f2937',
                        border: '1px solid #374151',
                      }}
                    >
                      <CheckCircleRoundedIcon
                        sx={{ fontSize: 16, color: passed ? '#22c55e' : '#6b7280' }}
                      />
                      <Typography sx={{ fontSize: '0.75rem', color: passed ? '#e5e7eb' : '#9ca3af' }}>
                        {item.label}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            )}

            {validationStatus === 'error' && (
              <Typography sx={{ fontSize: '0.78rem', color: '#fca5a5', fontWeight: 600 }}>
                {footerMessage}
              </Typography>
            )}
          </Box>
        </Box>
      </Box>

      {/* Footer */}
      <Box
        sx={{
          px: 2.5,
          py: 1.5,
          borderTop: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          bgcolor: '#fff',
        }}
      >
        <Typography sx={{ fontSize: '0.8rem', color: '#6b7280' }}>{footerMessage}</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            onClick={handleClose}
            sx={{ color: '#4b5563', textTransform: 'none', fontWeight: 600 }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            variant="contained"
            disabled={!expression.trim() && selectedColumns.length === 0}
            sx={{
              bgcolor: '#1d4ed8',
              boxShadow: 'none',
              textTransform: 'none',
              fontWeight: 600,
              '&:hover': { bgcolor: '#1e40af', boxShadow: 'none' },
              '&.Mui-disabled': { bgcolor: '#e5e7eb', color: '#9ca3af' },
            }}
          >
            Apply Rule
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
}
