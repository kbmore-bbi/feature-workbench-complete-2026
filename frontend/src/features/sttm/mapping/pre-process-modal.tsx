'use client';
import { AiaAccordion, AiaAccordionDetails, AiaAccordionSummary, AiaBox, AiaButton, AiaCheckbox, AiaChip, AiaDialog } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import React, { useEffect, useMemo, useState } from 'react';
import { ExpandMoreIcon, KeyIcon, LinkIcon, StorageRoundedIcon } from '@/utils/icons';

import {
  SqlEditor,
  SQL_EDITOR_PANEL_MIN_HEIGHT,
} from '@/components/sql';
import { AiaSearchbox } from '@/components/ui/aia-searchbox';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import { useAiChatLayout } from '@/features/ai-agent/ai-chat-layout-context';
import { useTour } from '@/features/tour/engine/tour-context';
import { TOUR_TARGETS } from '@/features/tour/constants/tour-targets';
import type { ColumnGroup } from '@/features/sttm/types/sttm.types';
import { formatSqlType, generateMappingDescription, parseSourceColumns } from './mapping-utils';
import {
  sttmSidebarBodyTextSx,
  sttmSidebarColumnTypeSx,
  sttmSidebarSearchInputSx,
  sttmSidebarSecondaryTextSx,
} from '@/features/sttm/layout/sttm-sidebar-text-styles';
import { textStyleCssVars } from '@/config/typography-tokens';

const modalCloseButtonSx = {
  minWidth: 28,
  width: 28,
  height: 28,
  p: 0,
  fontSize: 14,
  lineHeight: 1,
  boxShadow: 'none',
  color: 'var(--aia-button-color)',
  '&:hover': {
    bgcolor: 'transparent',
    color: 'var(--aia-button-hover-color)',
  },
} as const;

const modalPrimaryButtonColors = {
  customBackgroundColor: 'var(--aia-primary-bg-color)',
  customColor: 'var(--aia-primary-bg-text-color)',
  customBorderColor: 'var(--aia-primary-bg-color)',
  customHoverBackgroundColor: 'var(--aia-primary-bg-hover-color)',
} as const;

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
    refreshAssistantSignals,
  } = useSttmBuilderContext();
  const {
    isOpen: isAssistantOpen,
    effectiveSidebarWidth,
    isMobile,
    isTablet,
  } = useAiChatLayout();
  const { registerModalTour, startTour } = useTour();

  const [expression, setExpression] = useState('');
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [columnSearch, setColumnSearch] = useState('');
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});

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

  useEffect(() => {
    if (!isPreProcessModalOpen) {
      registerModalTour(null);
      return;
    }
    registerModalTour('sttm-preprocess');
    return () => registerModalTour(null);
  }, [isPreProcessModalOpen, registerModalTour]);

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
    window.setTimeout(() => refreshAssistantSignals('on_transformation_review'), 0);
    handleClose();
  };

  const insertText = (text: string, wrapExisting = false) => {
    if (wrapExisting && text.includes('()')) {
      setExpression((prev) => (prev ? text.replace('()', `(${prev})`) : text));
    } else {
      setExpression((prev) => prev + (prev && !prev.endsWith(' ') ? ' ' : '') + text);
    }
  };

  const toggleColumnSelection = (group: ColumnGroup, columnName: string, checked?: boolean) => {
    const fullValue = `${tableAlias(group.table)}.${columnName}`;
    const lower = fullValue.toLowerCase();
    const isCurrentlySelected = selectedColumns.some((item) => item.toLowerCase() === lower);
    const shouldSelect = checked !== undefined ? checked : !isCurrentlySelected;

    if (shouldSelect) {
      setSelectedColumns((prev) => {
        if (prev.find((item) => item.toLowerCase() === lower)) return prev;
        return [...prev, fullValue];
      });
      insertText(fullValue);
      return;
    }

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

  const joinSubtitle =
    joinCount > 0 ? `${joinCount} join${joinCount === 1 ? '' : 's'} from Step 1` : undefined;
  const assistantDockWidth =
    isAssistantOpen && !isMobile && !isTablet ? effectiveSidebarWidth : 0;

  return (
    <AiaDialog
      open={isPreProcessModalOpen}
      onClose={handleClose}
      maxWidth="xl"
      fullWidth
      sx={{
        right: `${assistantDockWidth}px`,
        transition: 'right 220ms ease',
        '& .MuiDialog-paper': {
          height: '90vh',
          maxWidth: assistantDockWidth
            ? `min(1536px, calc(100vw - ${assistantDockWidth + 48}px))`
            : undefined,
          borderRadius: '16px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <AiaBox sx={{ p: 3, borderBottom: '1px solid #f1f5f9' }}>
        <AiaBox sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <AiaBox sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, flex: 1 }}>
            <AiaBox
              sx={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                bgcolor: 'var(--color-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <StorageRoundedIcon sx={{ fontSize: 18, color: '#fff' }} />
            </AiaBox>
            <AiaBox sx={{ minWidth: 0 }}>
              <AiaText
                sx={{
                  ...textStyleCssVars('cardTitle'),
                  textTransform: 'capitalize',
                  letterSpacing: '-0.01em',
                }}
              >
                Pre-Processing Rule
              </AiaText>
              {activeMapping ? (
                <AiaBox sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.25, mt: 0.25 }}>
                  <AiaText sx={{ ...textStyleCssVars('secondaryText') }}>
                    Target:{' '}
                    <AiaBox component="span" sx={{ fontWeight: 700, color: '#111827' }}>
                      {activeMapping.targetColumn}
                    </AiaBox>
                  </AiaText>
                  <AiaText sx={{ ...textStyleCssVars('secondaryText') }}>
                    Type:{' '}
                    <AiaBox component="span" sx={{ fontWeight: 600, color: '#374151' }}>
                      {formatSqlType(activeMapping.targetType)}
                    </AiaBox>
                  </AiaText>
                  {joinCount > 0 ? (
                    <AiaChip
                      size="small"
                      color="success"
                      label={`++ ${joinCount} join${joinCount === 1 ? '' : 's'} in FROM`}
                    />
                  ) : null}
                </AiaBox>
              ) : null}
            </AiaBox>
          </AiaBox>
          <AiaBox sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
            <AiaButton
              variant="contained"
              size="small"
              onClick={() => startTour('sttm-preprocess')}
              aria-label="Start Pre-Processing Rule tour guide"
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                fontSize: 13,
                borderRadius: '10px',
                px: 1.5,
                py: 0.6,
                minHeight: 34,
                backgroundColor: 'var(--aia-primary-bg-color)',
                color: 'var(--aia-primary-bg-text-color)',
                boxShadow: 'none',
                '&:hover': {
                  backgroundColor: 'var(--aia-primary-bg-hover-color)',
                },
              }}
            >
              Tour Guide
            </AiaButton>
            <AiaButton
              variant="text"
              size="small"
              onClick={handleClose}
              sx={modalCloseButtonSx}
              aria-label="Close"
            >
              ✕
            </AiaButton>
          </AiaBox>
        </AiaBox>
      </AiaBox>

      <AiaBox sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <AiaBox
          data-tour={TOUR_TARGETS.preprocessSourceTables}
          sx={{
            width: 300,
            flexShrink: 0,
            borderRight: '1px solid #e5e7eb',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: '#fff',
          }}
        >
          <AiaBox
            sx={{
              px: 2,
              py: 1.25,
              borderBottom: '1px solid #e5e7eb',
            }}
          >
            <AiaBox sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <StorageRoundedIcon sx={{ fontSize: 16, color: '#374151' }} />
              <AiaText sx={{ ...sttmSidebarBodyTextSx, fontWeight: 600 }}>Source Tables</AiaText>
            </AiaBox>
          </AiaBox>

          <AiaBox sx={{ p: 1.5, borderBottom: '1px solid #e5e7eb' }}>
            <AiaSearchbox
              value={columnSearch}
              onChange={setColumnSearch}
              placeholder="Search columns..."
              inputSx={sttmSidebarSearchInputSx}
            />
          </AiaBox>

          <AiaBox sx={{ flex: 1, overflowY: 'auto', px: 1, py: 1 }}>
            {filteredGroups.map(([category, groups]) => (
              <AiaBox key={category} sx={{ mb: 1.5 }}>
                <AiaText
                  sx={{
                    px: 1,
                    py: 0.5,
                    ...sttmSidebarSecondaryTextSx,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}
                >
                  {category}
                </AiaText>
                {groups.map((group) => {
                  const isExpanded = expandedTables[group.qualifiedName] ?? true;
                  return (
                    <AiaAccordion
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
                      <AiaAccordionSummary
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
                        <AiaText sx={{ ...sttmSidebarBodyTextSx, fontWeight: 400 }}>{group.table}</AiaText>
                      </AiaAccordionSummary>
                      <AiaAccordionDetails sx={{ p: 0, pb: 0.5 }}>
                        {group.columns.map((col) => {
                          const colName = col.name ?? '';
                          const isSelected = isColumnSelected(group, colName);
                          const typeLabel = (col.type ? formatSqlType(col.type) : '—').toLowerCase();

                          return (
                            <AiaBox
                              key={`${group.qualifiedName}-${colName}`}
                              onClick={() => toggleColumnSelection(group, colName)}
                              sx={{
                                px: 1.25,
                                py: 0.45,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 1,
                                cursor: 'pointer',
                                borderRadius: '6px',
                                '&:hover': { bgcolor: '#f3f4f6' },
                              }}
                            >
                              <AiaBox
                                sx={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 0.75,
                                  minWidth: 0,
                                  flex: 1,
                                }}
                              >
                                <AiaCheckbox
                                  checked={isSelected}
                                  checkHandler={(checked) =>
                                    toggleColumnSelection(group, colName, checked)
                                  }
                                  uncheckedColor="var(--aia-primary-bg-color)"
                                  checkedColor="var(--aia-primary-bg-color)"
                                />
                                <AiaBox
                                  sx={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 0.5,
                                    flexWrap: 'wrap',
                                    minWidth: 0,
                                  }}
                                >
                                  <AiaText
                                    sx={{
                                      ...sttmSidebarSecondaryTextSx,
                                      color: 'var(--color-text)',
                                    }}
                                  >
                                    {colName}
                                  </AiaText>
                                  {col.isPrimaryKey ? (
                                    <KeyIcon sx={{ fontSize: 16, color: '#ca8a04', flexShrink: 0 }} />
                                  ) : null}
                                  {col.isForeignKey ? (
                                    <LinkIcon sx={{ fontSize: 16, color: '#9ca3af', flexShrink: 0 }} />
                                  ) : null}
                                </AiaBox>
                              </AiaBox>
                              <AiaText
                                sx={{
                                  ...sttmSidebarColumnTypeSx,
                                  display: 'block',
                                  mt: 0,
                                  flexShrink: 0,
                                  textAlign: 'right',
                                }}
                              >
                                {typeLabel}
                              </AiaText>
                            </AiaBox>
                          );
                        })}
                      </AiaAccordionDetails>
                    </AiaAccordion>
                  );
                })}
              </AiaBox>
            ))}
            {filteredGroups.length === 0 && (
              <AiaText
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
              </AiaText>
            )}
          </AiaBox>
        </AiaBox>

        <AiaBox
          data-tour={TOUR_TARGETS.preprocessSqlEditor}
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
            functionLibraryTourTargets={{
              library: TOUR_TARGETS.preprocessFunctionLibrary,
              tabs: TOUR_TARGETS.preprocessFunctionTabs,
              panel: TOUR_TARGETS.preprocessFunctionLibrary,
            }}
            fillHeight
            minHeight={SQL_EDITOR_PANEL_MIN_HEIGHT}
            maxHeight="100%"
            sx={{ width: '100%', flex: 1, minHeight: 0 }}
          />
        </AiaBox>
      </AiaBox>

      <AiaBox
        sx={{
          px: 3,
          py: 2.25,
          borderTop: '1px solid #f1f5f9',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <AiaText sx={{ fontSize: 12, color: '#64748b' }}>
          {selectedColumns.length} columns selected
        </AiaText>
        <AiaBox sx={{ display: 'flex', gap: 1.5 }}>
          <AiaButton
            variant="outlined"
            size="large"
            onClick={handleClose}
            data-tour={TOUR_TARGETS.preprocessCancel}
            customBorderColor="var(--aia-primary-bg-color)"
            customColor="var(--aia-primary-bg-color)"
          >
            Cancel
          </AiaButton>
          <AiaButton
            variant="contained"
            size="large"
            color="primary"
            onClick={handleApply}
            data-tour={TOUR_TARGETS.preprocessApplyRule}
            disabled={!expression.trim() && selectedColumns.length === 0}
            {...modalPrimaryButtonColors}
          >
            Apply Rule
          </AiaButton>
        </AiaBox>
      </AiaBox>
    </AiaDialog>
  );
}
