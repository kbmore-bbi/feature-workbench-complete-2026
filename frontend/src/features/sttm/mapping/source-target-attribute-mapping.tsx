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
import CheckBoxRoundedIcon from '@mui/icons-material/CheckBoxRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import type { MappingRuleType } from '@/features/sttm/types/sttm.types';
import MappingTableToolbar from './mapping-table-toolbar';
import {
  buildSourceColumnOptions,
  formatSqlType,
  generateMappingDescription,
  parseSourceColumns,
} from './mapping-utils';
import { FocusCheckbox } from '@/components/ui/focus-checkbox';
import { FocusCheckboxCell, FocusInputCell } from '@/components/ui/focus-table';
import {
  MappingRowIndexCell,
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

const headerCellSx = {
  color: '#9ca3af',
  fontWeight: 700,
  fontSize: '0.68rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase' as const,
  borderBottom: '1px solid #e5e7eb',
  bgcolor: '#fafafa',
  py: 1.25,
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
    relationships,
    mappingLoading,
    autoMapStatusMessage,
    sourceAttributeGroups,
    derivedSources,
  } = useSttmBuilderContext();

  const sortedMappings = mappings;
  const sourceColumnOptions = buildSourceColumnOptions(sourceAttributeGroups, derivedSources);

  const allSelected = mappings.length > 0 && selectedMappingIds.length === mappings.length;
  const someSelected = selectedMappingIds.length > 0 && selectedMappingIds.length < mappings.length;
  const mappedCount = mappings.filter((row) => row.status === 'MAPPED').length;
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
    <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <MappingTableToolbar
        rowCount={mappings.length}
        mappedCount={mappedCount}
        joinCount={relationships.length}
      />

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
            <CheckBoxRoundedIcon sx={{ fontSize: 20, color: '#22c55e' }} />
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

      <TableContainer
        component={Paper}
        elevation={0}
        sx={{ flex: 1, border: 'none', borderRadius: 0, overflowY: 'auto', overflowX: 'hidden' }}
      >
        <Table
          stickyHeader
          size="small"
          sx={{
            width: '100%',
            tableLayout: 'fixed',
            '& .MuiTableBody-root .MuiTableCell-root': {
              borderBottom: '1px solid #edf2f7',
              verticalAlign: 'top',
              py: 1.2,
              backgroundColor: 'transparent',
            },
            '& .MuiTableBody-root .MuiTableRow-root:last-of-type .MuiTableCell-root': {
              borderBottom: '1px solid #edf2f7',
            },
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" sx={{ ...headerCellSx, width: '2.5%' }}>
                <FocusCheckbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  checkHandler={(checked: boolean) =>
                    selectAllMappings(
                      mappings.map((row) => row.id),
                      checked,
                    )
                  }
                />
              </TableCell>
              <TableCell sx={{ ...headerCellSx, width: '2.5%' }}>#</TableCell>
              <TableCell sx={{ ...headerCellSx, width: '13.5%' }}>Target Column</TableCell>
              <TableCell sx={{ ...headerCellSx, width: '23%' }}>Source Column</TableCell>
              <TableCell sx={{ ...headerCellSx, width: '5.5%', whiteSpace: 'nowrap' }}>
                Type (Preview)
              </TableCell>
              <TableCell sx={{ ...headerCellSx, width: '14%' }}>Pre-processing Rule</TableCell>
              <TableCell sx={{ ...headerCellSx, width: '15.5%' }}>NL Rule</TableCell>
              <TableCell sx={{ ...headerCellSx, width: '5%' }}>Order</TableCell>
              <TableCell sx={{ ...headerCellSx, width: '13.5%' }}>
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
              <TableCell sx={{ ...headerCellSx, width: '5%' }} align="right">
                Status
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedMappings.map((row, index) => {
              const isSelected = selectedMappingIds.includes(row.id);
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
              const needsAttention =
                row.status !== 'MAPPED' ||
                !!row.unmatchedReason ||
                ((row.confidenceScore ?? 1) < 0.55 && !!row.sourceColumn);
              const rowTone =
                row.status === 'MAPPED'
                  ? needsAttention
                    ? 'warning'
                    : 'mapped'
                  : needsAttention
                    ? 'unmapped'
                    : 'neutral';

              return (
                <TableRow
                  key={row.id}
                  hover
                  sx={{
                    bgcolor: isSelected ? 'rgba(59, 130, 246, 0.04)' : '#fff',
                    '&:hover': {
                      bgcolor: isSelected ? 'rgba(59, 130, 246, 0.07)' : '#fafafa',
                    },
                  }}
                >
                  <FocusCheckboxCell
                    checked={isSelected}
                    onChange={() => toggleMappingSelection(row.id)}
                  />

                  <MappingRowIndexCell index={index + 1} tone={rowTone} />

                  <MappingTargetColumnCell
                    name={row.targetColumn}
                    type={formatSqlType(row.targetType)}
                    width="13.5%"
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
                    width="23%"
                    minWidth={0}
                    confidenceScore={row.confidenceScore}
                    confidenceReason={row.confidenceReason}
                    candidateSourceColumns={row.candidateSourceColumns}
                    unmatchedReason={row.unmatchedReason}
                  />

                  <MappingTypePreviewCell dataType={previewType} width="5.5%" minWidth={84} />

                  <MappingRuleCell
                    value={row.rule === 'Select...' ? 'Direct' : row.rule || 'Direct'}
                    options={RULE_OPTIONS}
                    configureValue={PREPROCESS_CONFIGURE_VALUE}
                    width="14%"
                    minWidth={0}
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
                    width="15.5%"
                    minWidth={0}
                    multiline
                    minRows={1}
                    maxRows={10}
                    inputSx={multilineCellInputSx}
                  />

                  <FocusInputCell
                    placeholder="Order..."
                    value={row.loadOrder ?? ''}
                    onChange={(value) => updateMapping(row.id, { loadOrder: value })}
                    width="5%"
                    minWidth={84}
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
                    width="13.5%"
                    minWidth={0}
                    multiline
                    minRows={1}
                    maxRows={10}
                    inputSx={multilineCellInputSx}
                  />

                  <MappingStatusCell status={row.status} width="5%" minWidth={92} />
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {mappingLoading && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            bgcolor: 'rgba(255,255,255,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 5,
          }}
        >
          <Typography sx={{ fontSize: '0.85rem', color: '#4b5563', fontWeight: 600 }}>
            {autoMapStatusMessage || 'Running auto-map...'}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default SourceTargetAttributeMapping;
