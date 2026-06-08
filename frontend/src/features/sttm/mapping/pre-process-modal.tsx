'use client';

import React, { useEffect, useMemo, useState } from 'react';
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
import FunctionsRoundedIcon from '@mui/icons-material/FunctionsRounded';
import VpnKeyRoundedIcon from '@mui/icons-material/VpnKeyRounded';
import StorageRoundedIcon from '@mui/icons-material/StorageRounded';
import {
  SqlEditor,
  SQL_FUNCTION_CATEGORIES,
  SQL_FUNCTIONS_BY_CATEGORY,
  SQL_QUICK_ACTIONS,
  SQL_EDITOR_PANEL_MIN_HEIGHT,
  type SqlFunctionCategoryId,
} from '@/components/sql';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import type { ColumnGroup } from '@/features/sttm/types/sttm.types';
import { generateMappingDescription, parseSourceColumns } from './mapping-utils';

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

function looksLikeSqlExpression(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return false;

  const upper = trimmed.toUpperCase();
  if (
    [
      'DIRECT',
      'UPPER',
      'LOWER',
      'TRIM',
      'CAST',
      'COALESCE',
      'DATE_FORMAT',
      'SUBSTRING',
      'REPLACE',
      'NULLIF',
      'CONCATENATE',
    ].includes(upper)
  ) {
    return false;
  }

  return /[().\s,]/.test(trimmed);
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
  } = useSttmBuilderContext();

  const [expression, setExpression] = useState('');
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [columnSearch, setColumnSearch] = useState('');
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [functionTab, setFunctionTab] = useState<SqlFunctionCategoryId>('string');

  const activeMapping = mappings.find((m) => m.id === activeMappingId);
  const joinCount = relationships.length;

  const groupedSources = useMemo(
    () => groupBySchema(sourceAttributeGroups),
    [sourceAttributeGroups],
  );

  useEffect(() => {
    if (activeMapping) {
      const suggestedExpression =
        !activeMapping.expression && looksLikeSqlExpression(activeMapping.aiSuggestedRule)
          ? activeMapping.aiSuggestedRule?.trim() ?? ''
          : '';
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpression(activeMapping.expression || suggestedExpression || activeMapping.sourceColumn || '');
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
  }, [activeMapping, isPreProcessModalOpen]);

  useEffect(() => {
    if (!isPreProcessModalOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const joinSubtitle =
    joinCount > 0 ? `${joinCount} join${joinCount === 1 ? '' : 's'} from Step 1` : undefined;

  return (
    <Dialog
      open={isPreProcessModalOpen}
      onClose={handleClose}
      maxWidth="xl"
      fullWidth
      sx={{
        '& .MuiDialog-paper': {
          height: '90vh',
          borderRadius: '16px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
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

      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Box
          sx={{
            width: 300,
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

        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            p: 3,
            bgcolor: '#f8fafc',
            overflow: 'hidden',
          }}
        >
          <SqlEditor
            value={expression}
            onChange={setExpression}
            title="SQL Preview"
            subtitle={joinSubtitle}
            placeholder={`-- Type or click a column from the left panel\n-- e.g. UPPER(a.NAME)   or   ROW_NUMBER() OVER(ORDER BY a.DATE_KEY)`}
            showFunctionLibrary
            showCopy
            fillHeight
            minHeight={SQL_EDITOR_PANEL_MIN_HEIGHT}
            maxHeight="100%"
            sx={{ width: '100%', flex: 1, minHeight: 0 }}
          />
        </Box>

        {/* Function Library */}
        <Box
          sx={{
            width: 280,
            flexShrink: 0,
            borderLeft: '1px solid #e5e7eb',
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
              {SQL_FUNCTION_CATEGORIES.map((tab) => {
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
            {SQL_QUICK_ACTIONS.map((action) => (
              <Chip
                key={action.id}
                label={action.label}
                size="small"
                onClick={() => insertText(action.snippet, action.wrapExisting ?? action.snippet.includes('()'))}
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
            {SQL_FUNCTIONS_BY_CATEGORY[functionTab].map((fn) => (
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
      </Box>
    </Dialog>
  );
}
