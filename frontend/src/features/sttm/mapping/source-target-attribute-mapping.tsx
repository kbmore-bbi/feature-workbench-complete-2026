'use client';

import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Typography,
  Box,
  Button,
  Chip,
  IconButton,
} from '@mui/material';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import type { MappingRuleType } from '@/features/sttm/types/sttm.types';
import {
  buildSourceColumnOptions,
  formatSqlType,
  generateMappingDescription,
  parseSourceColumns,
} from './mapping-utils';
import { FocusCheckbox } from '@/components/ui/focus-checkbox';
import { FocusCheckboxCell, FocusInputCell } from '@/components/ui/focus-table';
import {
  MappingRuleCell,
  MappingSourceColumnsCell,
  MappingStatusCell,
  MappingTargetColumnCell,
  MappingTypePreviewCell,
} from './cells';

const BUILT_IN_RULES = [
  'Direct',
  'Custom',
  'Concatenate',
  'UPPER',
  'LOWER',
  'TRIM',
  'CAST',
  'COALESCE',
  'DATE_FORMAT',
  'SUBSTRING',
  'REPLACE',
  'NULLIF',
];

const PREPROCESS_CONFIGURE_VALUE = 'Configure Pre-processing Rule...';

const RULE_OPTIONS = BUILT_IN_RULES.map((rule) => ({ label: rule, value: rule }));

/** Minimum column widths — table scrolls horizontally when viewport is narrower. */
const MAPPING_COLUMN_MIN_WIDTH = {
  checkbox: 64,
  targetColumn: 168,
  sourceColumn: 300,
  typePreview: 112,
  preProcessRule: 248,
  nlRule: 220,
  order: 96,
  description: 240,
  status: 108,
} as const;

const MAPPING_TABLE_MIN_WIDTH = Object.values(MAPPING_COLUMN_MIN_WIDTH).reduce(
  (total, width) => total + width,
  0,
);

const tableScrollbarSx = {
  scrollbarWidth: 'thin',
  scrollbarColor: '#cbd5e1 transparent',
  '&::-webkit-scrollbar': { width: 8, height: 8 },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: '#cbd5e1',
    borderRadius: 999,
  },
  '&::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
} as const;

const headerCellSx = {
  color: '#4b5563',
  fontWeight: 700,
  fontSize: '0.68rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase' as const,
  borderBottom: '1px solid #e5e7eb',
  bgcolor: '#fafafa',
  py: 0.65,
};

const multilineCellInputSx = {
  '& .MuiOutlinedInput-root': {
    alignItems: 'flex-start',
    minHeight: 44,
  },
  '& .MuiInputBase-input, & .MuiInputBase-inputMultiline': {
    lineHeight: 1.45,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    overflow: 'hidden !important',
  },
} as const;

const FROZEN_COLUMN_LEFT = {
  checkbox: 0,
  targetColumn: MAPPING_COLUMN_MIN_WIDTH.checkbox,
} as const;

function mappingFrozenCellSx(
  left: number,
  options: { header?: boolean; lastFrozen?: boolean } = {},
) {
  const { header = false, lastFrozen = false } = options;
  const backgroundColor = header ? '#fafafa' : '#fff';

  return {
    position: 'sticky' as const,
    left,
    top: header ? 0 : undefined,
    zIndex: header ? 5 : 2,
    bgcolor: backgroundColor,
    backgroundColor,
    ...(lastFrozen
      ? { boxShadow: '4px 0 8px -4px rgba(15, 23, 42, 0.12)' }
      : {}),
  };
}

const SourceTargetAttributeMapping = () => {
  const {
    mappings,
    selectedMappingIds,
    toggleMappingSelection,
    selectAllMappings,
    bulkMarkMapped,
    bulkSetDirect,
    updateMapping,
    setPreProcessModalOpen,
    mappingLoading,
    autoMapStatusMessage,
    autoMapProcessingIds,
    sourceAttributeGroups,
    derivedSources,
  } = useSttmBuilderContext();

  const sortedMappings = mappings;
  const sourceColumnOptions = buildSourceColumnOptions(sourceAttributeGroups, derivedSources);

  const allSelected = mappings.length > 0 && selectedMappingIds.length === mappings.length;
  const someSelected = selectedMappingIds.length > 0 && selectedMappingIds.length < mappings.length;
  const selectedMappedCount = mappings.filter(
    (row) => selectedMappingIds.includes(row.id) && row.status === 'MAPPED',
  ).length;
  const clearSelection = () =>
    selectAllMappings(
      mappings.map((row) => row.id),
      false,
    );

  const handleRuleChange = (id: string, newRule: string) => {
    if (newRule === PREPROCESS_CONFIGURE_VALUE) {
      setPreProcessModalOpen(true, id);
      return;
    }

    const row = mappings.find((mapping) => mapping.id === id);
    if (!row) return;
    const sourceColumns =
      row.sourceColumns && row.sourceColumns.length
        ? row.sourceColumns
        : parseSourceColumns(row.sourceColumn);

    const updates: Partial<typeof row> = { rule: newRule as MappingRuleType };
    if (!row.descriptionEdited) {
      updates.description = generateMappingDescription({
        rule: newRule,
        sourceColumns,
        targetColumn: row.targetColumn,
        expression: row.expression,
      });
    }
    updateMapping(id, updates);
  };

  return (
    <Box sx={{ width: '100%', height: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {selectedMappingIds.length > 0 && (
        <Box
          sx={{
            px: 2,
            py: 1,
            bgcolor: '#0f172a',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            borderBottom: '1px solid #1f2937',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
            <Box
              sx={{
                width: 20,
                height: 20,
                borderRadius: '4px',
                bgcolor: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <CheckRoundedIcon sx={{ fontSize: 15, color: '#111827' }} />
            </Box>
            <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
              {selectedMappingIds.length} row{selectedMappingIds.length === 1 ? '' : 's'} selected
            </Typography>
            <Typography
              sx={{ fontSize: '0.78rem', fontWeight: 500, color: '#94a3b8', whiteSpace: 'nowrap' }}
            >
              ({selectedMappedCount} mapped)
            </Typography>
            {selectedMappedCount > 0 && (
              <Chip
                size="small"
                label={`${selectedMappedCount} Mapped`}
                sx={{
                  height: 22,
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  bgcolor: '#052e16',
                  color: '#4ade80',
                  border: '1px solid #166534',
                  borderRadius: '999px',
                }}
              />
            )}
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Button
              size="small"
              startIcon={<CheckRoundedIcon sx={{ fontSize: 16 }} />}
              onClick={() => bulkMarkMapped(selectedMappingIds)}
              sx={{
                color: '#e2e8f0',
                textTransform: 'none',
                fontSize: '0.78rem',
                fontWeight: 600,
                px: 1.25,
                border: '1px solid #334155',
                borderRadius: '8px',
                bgcolor: 'transparent',
                '&:hover': { bgcolor: '#1e293b', borderColor: '#475569' },
              }}
            >
              Mark Mapped
            </Button>
            <Button
              size="small"
              startIcon={<ArrowForwardRoundedIcon sx={{ fontSize: 16 }} />}
              onClick={() => bulkSetDirect(selectedMappingIds)}
              sx={{
                color: '#e2e8f0',
                textTransform: 'none',
                fontSize: '0.78rem',
                fontWeight: 600,
                px: 1.25,
                border: '1px solid #334155',
                borderRadius: '8px',
                bgcolor: 'transparent',
                '&:hover': { bgcolor: '#1e293b', borderColor: '#475569' },
              }}
            >
              Set Direct
            </Button>
            <Button
              size="small"
              startIcon={<FileUploadOutlinedIcon sx={{ fontSize: 16 }} />}
              sx={{
                color: '#0f172a',
                bgcolor: '#fff',
                textTransform: 'none',
                fontSize: '0.78rem',
                fontWeight: 700,
                px: 1.5,
                ml: 0.5,
                borderRadius: '8px',
                boxShadow: 'none',
                '&:hover': { bgcolor: '#e2e8f0', boxShadow: 'none' },
              }}
            >
              Publish {selectedMappingIds.length} Mapping{selectedMappingIds.length === 1 ? '' : 's'}
            </Button>
            <IconButton
              size="small"
              onClick={clearSelection}
              sx={{ color: '#94a3b8', ml: 0.25, '&:hover': { color: '#fff' } }}
            >
              <CloseRoundedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        </Box>
      )}

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          width: '100%',
          overflowY: 'auto',
          overflowX: 'hidden',
          ...tableScrollbarSx,
        }}
      >
        <TableContainer
          component={Paper}
          elevation={0}
          sx={{
            width: '100%',
            border: 'none',
            borderRadius: 0,
            overflowX: 'auto',
            overflowY: 'visible',
            ...tableScrollbarSx,
          }}
        >
          <Table
            stickyHeader
            size="small"
            sx={{
              width: '100%',
              minWidth: MAPPING_TABLE_MIN_WIDTH,
              tableLayout: 'fixed',
              '& .MuiTableBody-root .MuiTableCell-root': {
              borderBottom: '1px solid #edf2f7',
              verticalAlign: 'top',
              py: 1.2,
            },
            '& .MuiTableBody-root .MuiTableRow-root:last-of-type .MuiTableCell-root': {
              borderBottom: '1px solid #edf2f7',
            },
          }}
        >
          <colgroup>
            {Object.values(MAPPING_COLUMN_MIN_WIDTH).map((columnWidth, index) => (
              <col key={`mapping-col-${index}`} style={{ width: columnWidth }} />
            ))}
          </colgroup>
          <TableHead>
            <TableRow>
              <TableCell
                padding="none"
                sx={{
                  ...headerCellSx,
                  ...mappingFrozenCellSx(FROZEN_COLUMN_LEFT.checkbox, { header: true }),
                  width: MAPPING_COLUMN_MIN_WIDTH.checkbox,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.checkbox,
                  maxWidth: MAPPING_COLUMN_MIN_WIDTH.checkbox,
                  px: 0,
                  textAlign: 'center',
                  verticalAlign: 'middle',
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    minHeight: 30,
                  }}
                >
                  <FocusCheckbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    checkHandler={(checked: boolean) =>
                      selectAllMappings(
                        mappings.map((row) => row.id),
                        checked,
                      )
                    }
                    sx={{
                      color: '#cbd5e1',
                      '&.Mui-checked': {
                        color: '#fff',
                        bgcolor: '#111827',
                        borderRadius: '4px',
                      },
                      '&.MuiCheckbox-indeterminate': {
                        color: '#fff',
                        bgcolor: '#111827',
                        borderRadius: '4px',
                      },
                    }}
                  />
                </Box>
              </TableCell>
              <TableCell
                sx={{
                  ...headerCellSx,
                  ...mappingFrozenCellSx(FROZEN_COLUMN_LEFT.targetColumn, {
                    header: true,
                    lastFrozen: true,
                  }),
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.targetColumn,
                  width: MAPPING_COLUMN_MIN_WIDTH.targetColumn,
                }}
              >
                Target Column
              </TableCell>
              <TableCell
                sx={{
                  ...headerCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.sourceColumn,
                  width: MAPPING_COLUMN_MIN_WIDTH.sourceColumn,
                }}
              >
                Source Column
              </TableCell>
              <TableCell
                sx={{
                  ...headerCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.typePreview,
                  width: MAPPING_COLUMN_MIN_WIDTH.typePreview,
                  whiteSpace: 'nowrap',
                }}
              >
                Type (Preview)
              </TableCell>
              <TableCell
                sx={{
                  ...headerCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.preProcessRule,
                  width: MAPPING_COLUMN_MIN_WIDTH.preProcessRule,
                }}
              >
                Pre-processing Rule
              </TableCell>
              <TableCell
                sx={{
                  ...headerCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.nlRule,
                  width: MAPPING_COLUMN_MIN_WIDTH.nlRule,
                }}
              >
                NL Rule
              </TableCell>
              <TableCell
                sx={{
                  ...headerCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.order,
                  width: MAPPING_COLUMN_MIN_WIDTH.order,
                }}
              >
                Order
              </TableCell>
              <TableCell
                sx={{
                  ...headerCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.description,
                  width: MAPPING_COLUMN_MIN_WIDTH.description,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  Description
                  <Chip
                    label="AI"
                    size="small"
                    sx={{
                      height: 18,
                      fontSize: '0.6rem',
                      fontWeight: 800,
                      bgcolor: '#dbeafe',
                      color: '#1d4ed8',
                    }}
                  />
                </Box>
              </TableCell>
              <TableCell
                sx={{
                  ...headerCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.status,
                  width: MAPPING_COLUMN_MIN_WIDTH.status,
                }}
                align="right"
              >
                Status
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedMappings.map((row) => {
              const isSelected = selectedMappingIds.includes(row.id);
              const isProcessing =
                autoMapProcessingIds.includes(row.id) || row.status === 'PROCESSING';
              const previewType = row.sourceType ?? row.targetType ?? undefined;
              const sourceColumns =
                row.sourceColumns && row.sourceColumns.length
                  ? row.sourceColumns
                  : parseSourceColumns(row.sourceColumn);
              const autoDescription = generateMappingDescription({
                rule: row.rule || 'Direct',
                sourceColumns,
                targetColumn: row.targetColumn,
                expression: row.expression,
              });
              const descriptionValue = row.description ?? autoDescription ?? '';
              const descriptionPlaceholder =
                autoDescription || 'Add description...';
              return (
                <TableRow
                  key={row.id}
                  sx={{
                    bgcolor: '#fff',
                    '&.MuiTableRow-root:hover': {
                      bgcolor: '#fff',
                    },
                  }}
                >
                  <FocusCheckboxCell
                    checked={isSelected}
                    onChange={() => toggleMappingSelection(row.id)}
                    width={MAPPING_COLUMN_MIN_WIDTH.checkbox}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.checkbox}
                    sx={mappingFrozenCellSx(FROZEN_COLUMN_LEFT.checkbox)}
                  />

                  <MappingTargetColumnCell
                    name={row.targetColumn}
                    isMapped={row.status === 'MAPPED'}
                    isProcessing={isProcessing}
                    width={MAPPING_COLUMN_MIN_WIDTH.targetColumn}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.targetColumn}
                    sx={mappingFrozenCellSx(FROZEN_COLUMN_LEFT.targetColumn, {
                      lastFrozen: true,
                    })}
                  />

                  <MappingSourceColumnsCell
                    value={row.sourceColumn}
                    options={sourceColumnOptions}
                    onChange={(nextValue) => {
                      const nextColumns = parseSourceColumns(nextValue);
                      updateMapping(row.id, {
                        sourceColumn: nextValue.trim() || null,
                        sourceColumns: nextColumns,
                        status: nextColumns.length > 0 ? 'MAPPED' : 'UNMAPPED',
                        sourceType:
                          sourceColumnOptions.find(
                            (option) => option.value.toLowerCase() === nextColumns[0]?.toLowerCase(),
                          )?.dataType ?? row.sourceType ?? null,
                      });
                    }}
                    width={MAPPING_COLUMN_MIN_WIDTH.sourceColumn}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.sourceColumn}
                    confidenceScore={row.confidenceScore}
                    confidenceReason={row.confidenceReason}
                    candidateSourceColumns={row.candidateSourceColumns}
                    unmatchedReason={row.unmatchedReason}
                  />

                  <MappingTypePreviewCell
                    dataType={previewType}
                    width={MAPPING_COLUMN_MIN_WIDTH.typePreview}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.typePreview}
                  />

                  <MappingRuleCell
                    value={row.rule === 'Select...' ? 'Direct' : row.rule || 'Direct'}
                    options={RULE_OPTIONS}
                    configureValue={PREPROCESS_CONFIGURE_VALUE}
                    width={MAPPING_COLUMN_MIN_WIDTH.preProcessRule}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.preProcessRule}
                    highlighted={
                      !!row.rule &&
                      row.rule !== 'Select...' &&
                      row.rule !== 'Direct'
                    }
                    onRuleChange={(value) => handleRuleChange(row.id, value)}
                    onPreProcess={() => setPreProcessModalOpen(true, row.id)}
                  />

                  <FocusInputCell
                    placeholder="Add NL rule..."
                    value={row.nlRule ?? ''}
                    onChange={(value) => updateMapping(row.id, { nlRule: value })}
                    width={MAPPING_COLUMN_MIN_WIDTH.nlRule}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.nlRule}
                    multiline
                    minRows={1}
                    maxRows={10}
                    inputSx={multilineCellInputSx}
                  />

                  <FocusInputCell
                    placeholder="Order..."
                    value={row.loadOrder ?? ''}
                    onChange={(value) => updateMapping(row.id, { loadOrder: value })}
                    width={MAPPING_COLUMN_MIN_WIDTH.order}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.order}
                  />

                  <FocusInputCell
                    placeholder={descriptionPlaceholder}
                    value={descriptionValue}
                    onChange={(value) =>
                      updateMapping(row.id, {
                        description: value,
                        descriptionEdited: value.trim().length > 0,
                      })
                    }
                    width={MAPPING_COLUMN_MIN_WIDTH.description}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.description}
                    multiline
                    minRows={1}
                    maxRows={10}
                    inputSx={multilineCellInputSx}
                  />

                  <MappingStatusCell
                    status={isProcessing ? 'PROCESSING' : row.status}
                    width={MAPPING_COLUMN_MIN_WIDTH.status}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.status}
                  />
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        </TableContainer>
      </Box>

      {mappingLoading && (
        <Box
          sx={{
            position: 'absolute',
            top: 12,
            right: 16,
            maxWidth: 320,
            px: 1.5,
            py: 1,
            bgcolor: 'rgba(15,23,42,0.92)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            gap: 1,
            zIndex: 5,
            borderRadius: '12px',
            boxShadow: '0 12px 28px rgba(15,23,42,0.18)',
            pointerEvents: 'none',
          }}
        >
          <Box
            sx={{
              width: 18,
              height: 18,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '999px',
              bgcolor: 'rgba(37,99,235,0.16)',
              flexShrink: 0,
            }}
          >
            <Box
              component="span"
              sx={{
                width: 10,
                height: 10,
                borderRadius: '999px',
                border: '2px solid #93c5fd',
                borderTopColor: '#eff6ff',
                display: 'inline-block',
                animation: 'sttm-auto-map-spin 0.9s linear infinite',
                '@keyframes sttm-auto-map-spin': {
                  from: { transform: 'rotate(0deg)' },
                  to: { transform: 'rotate(360deg)' },
                },
              }}
            />
          </Box>
          <Typography sx={{ fontSize: '0.8rem', color: '#e2e8f0', fontWeight: 600 }}>
            {autoMapStatusMessage || 'Running auto-map...'}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default SourceTargetAttributeMapping;
