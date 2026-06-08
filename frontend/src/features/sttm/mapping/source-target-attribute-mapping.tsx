'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowForwardRoundedIcon, CheckRoundedIcon, CloseRoundedIcon, FileUploadOutlinedIcon } from '@/utils/icons';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Paper,
  Typography,
  Box,
  Button,
  Chip,
  IconButton,
  InputBase,
} from '@mui/material';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import type { MappingRuleType } from '@/features/sttm/types/sttm.types';
import {
  buildSourceColumnOptions,
  formatSqlType,
  generateMappingDescription,
  parseSourceColumns,
} from './mapping-utils';
import { AiaCheckbox } from '@/components/ui/aia-checkbox';
import { AiaSelect } from '@/components/ui/aia-select';
import { AiaCheckboxCell, AiaInputCell } from '@/components/ui/aia-table';
import {
  MappingRuleCell,
  MappingSourceColumnsCell,
  MappingStatusCell,
  MappingTargetColumnCell,
  MappingTypePreviewCell,
} from './cells';
import { MappingDataPreviewCell } from './data-preview';
import {
  MAPPING_TABLE_CONTAINER_SX,
  MAPPING_TABLE_HEADER_CELL_SX,
  MAPPING_TABLE_PAGINATION_SX,
  MAPPING_TABLE_ROW_SX,
  mappingTableSx,
} from './mapping-table-styles';

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

const RULE_FILTER_OPTIONS = [{ label: 'All', value: '' }, ...RULE_OPTIONS];

function resolveMappingRuleSelectValue(rule: string | null | undefined): string {
  return rule && rule !== 'Select...' ? rule : '';
}

function resolveMappingDescription(
  row: {
    targetColumn: string;
    expression?: string | null;
    description?: string | null;
    descriptionEdited?: boolean;
  },
  sourceColumns: string[],
  resolvedRule: string,
): string {
  const autoDescription = resolvedRule
    ? generateMappingDescription({
        rule: resolvedRule,
        sourceColumns,
        targetColumn: row.targetColumn,
        expression: row.expression,
      })
    : '';

  return row.descriptionEdited ? (row.description ?? '') : autoDescription;
}

const DEFAULT_ROWS_PER_PAGE = 25;
const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

type MappingColumnFilters = {
  targetColumn: string;
  sourceColumn: string;
  typePreview: string;
  preProcessRule: string;
  nlRule: string;
  order: string;
  description: string;
  status: string;
};

const EMPTY_COLUMN_FILTERS: MappingColumnFilters = {
  targetColumn: '',
  sourceColumn: '',
  typePreview: '',
  preProcessRule: '',
  nlRule: '',
  order: '',
  description: '',
  status: '',
};

const STATUS_FILTER_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'Mapped', value: 'MAPPED' },
  { label: 'Unmapped', value: 'UNMAPPED' },
];

const columnFilterControlSx = {
  width: '100%',
  minWidth: 0,
  height: 28,
  fontSize: '0.72rem',
  lineHeight: 1.3,
  borderRadius: '4px',
  border: '1px solid #e5e7eb',
  bgcolor: '#fff',
  color: '#111827',
  textAlign: 'left' as const,
} as const;

const columnFilterInputSx = {
  ...columnFilterControlSx,
  px: 0.75,
  py: 0.35,
  '&::placeholder': {
    color: '#9ca3af',
    opacity: 1,
  },
  '&:focus': {
    outline: 'none',
    borderColor: '#94a3b8',
    boxShadow: '0 0 0 1px rgba(148, 163, 184, 0.35)',
  },
} as const;

const columnFilterSelectSx = {
  '& .MuiOutlinedInput-root': {
    ...columnFilterControlSx,
    display: 'flex',
    alignItems: 'center',
  },
  '& .MuiSelect-select': {
    py: '4px !important',
    pl: '6px !important',
    pr: '28px !important',
    fontSize: '0.72rem',
    lineHeight: 1.3,
    textAlign: 'left',
    display: 'flex',
    alignItems: 'center',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  '& .MuiSelect-icon': {
    right: 4,
    fontSize: '1.1rem',
    color: '#64748b',
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: '#e5e7eb',
  },
} as const;

/** Minimum column widths — table scrolls horizontally when viewport is narrower. */
const MAPPING_COLUMN_MIN_WIDTH = {
  checkbox: 64,
  targetColumn: 168,
  preProcessRule: 248,
  sourceColumn: 300,
  typePreview: 112,
  nlRule: 220,
  order: 96,
  description: 240,
  status: 136,
  dataPreview: 168,
} as const;

const MAPPING_TABLE_MIN_WIDTH = Object.values(MAPPING_COLUMN_MIN_WIDTH).reduce(
  (total, width) => total + width,
  0,
);

const headerCellSx = MAPPING_TABLE_HEADER_CELL_SX;

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
  options: { header?: boolean; lastFrozen?: boolean; searchRow?: boolean } = {},
) {
  const { header = false, lastFrozen = false, searchRow = false } = options;
  const backgroundColor = header || searchRow ? '#fafafa' : '#fff';

  const zIndex = (() => {
    if (header) {
      return lastFrozen ? 9 : 8;
    }
    if (searchRow) {
      return lastFrozen ? 9 : 8;
    }
    return lastFrozen ? 5 : 4;
  })();

  return {
    position: 'sticky' as const,
    left,
    top: header ? 0 : searchRow ? 32 : undefined,
    zIndex,
    bgcolor: backgroundColor,
    backgroundColor,
    ...(lastFrozen
      ? { boxShadow: '4px 0 8px -4px rgba(15, 23, 42, 0.12)' }
      : {}),
  };
}

const scrollableBodyCellSx = {
  position: 'relative' as const,
  zIndex: 1,
  bgcolor: '#fff',
  backgroundColor: '#fff',
} as const;

const scrollableHeaderCellSx = {
  position: 'sticky' as const,
  top: 0,
  zIndex: 2,
  bgcolor: '#fafafa',
  backgroundColor: '#fafafa',
} as const;

const scrollableSearchHeaderCellSx = {
  position: 'sticky' as const,
  top: 32,
  zIndex: 2,
  bgcolor: '#fafafa',
  backgroundColor: '#fafafa',
} as const;

function ColumnFilterInput({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <InputBase
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      inputProps={{ 'aria-label': placeholder }}
      sx={columnFilterInputSx}
    />
  );
}

function ColumnFilterSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <AiaSelect
      value={value}
      options={options}
      onChange={(next) => onChange(Array.isArray(next) ? next[0] ?? '' : next)}
      placeholder="All"
      size="small"
      fullWidth
      sx={columnFilterSelectSx}
    />
  );
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

  const [columnFilters, setColumnFilters] = useState<MappingColumnFilters>(EMPTY_COLUMN_FILTERS);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);

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
      updates.description =
        generateMappingDescription({
          rule: newRule,
          sourceColumns,
          targetColumn: row.targetColumn,
          expression: row.expression,
        }) || null;
    }
    updateMapping(id, updates);
  };

  const filteredMappings = useMemo(() => {
    const includes = (value: string | null | undefined, query: string) =>
      String(value ?? '').toLowerCase().includes(query.trim().toLowerCase());

    return sortedMappings.filter((row) => {
      const previewType = formatSqlType(row.sourceType ?? row.targetType ?? undefined);
      const sourceColumns =
        row.sourceColumns && row.sourceColumns.length
          ? row.sourceColumns
          : parseSourceColumns(row.sourceColumn);
      const resolvedRule = resolveMappingRuleSelectValue(row.rule);
      const descriptionValue = resolveMappingDescription(row, sourceColumns, resolvedRule);

      if (columnFilters.targetColumn && !includes(row.targetColumn, columnFilters.targetColumn)) {
        return false;
      }
      if (columnFilters.sourceColumn && !includes(row.sourceColumn, columnFilters.sourceColumn)) {
        return false;
      }
      if (columnFilters.typePreview && !includes(previewType, columnFilters.typePreview)) {
        return false;
      }
      if (columnFilters.preProcessRule) {
        const rowRule = resolveMappingRuleSelectValue(row.rule);
        if (rowRule !== columnFilters.preProcessRule) {
          return false;
        }
      }
      if (columnFilters.nlRule && !includes(row.nlRule, columnFilters.nlRule)) {
        return false;
      }
      if (columnFilters.order && !includes(row.loadOrder, columnFilters.order)) {
        return false;
      }
      if (columnFilters.description && !includes(descriptionValue, columnFilters.description)) {
        return false;
      }
      if (columnFilters.status && row.status !== columnFilters.status) {
        return false;
      }
      return true;
    });
  }, [columnFilters, sortedMappings]);

  useEffect(() => {
    setPage(0);
  }, [columnFilters, rowsPerPage]);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(filteredMappings.length / rowsPerPage) - 1);
    if (page > maxPage) {
      setPage(maxPage);
    }
  }, [filteredMappings.length, page, rowsPerPage]);

  const paginatedMappings = useMemo(() => {
    const start = page * rowsPerPage;
    return filteredMappings.slice(start, start + rowsPerPage);
  }, [filteredMappings, page, rowsPerPage]);

  const updateColumnFilter = (key: keyof MappingColumnFilters, value: string) => {
    setColumnFilters((current) => ({
      ...current,
      [key]: value,
    }));
  };

  return (
    <Box
      sx={{
        width: '100%',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
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

      <TableContainer
        component={Paper}
        elevation={0}
        sx={MAPPING_TABLE_CONTAINER_SX}
      >
          <Table
            stickyHeader
            size="small"
            sx={mappingTableSx(MAPPING_TABLE_MIN_WIDTH)}
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
                  <AiaCheckbox
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
                  ...scrollableHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.preProcessRule,
                  width: MAPPING_COLUMN_MIN_WIDTH.preProcessRule,
                }}
              >
                Pre-processing Rule
              </TableCell>
              <TableCell
                sx={{
                  ...headerCellSx,
                  ...scrollableHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.sourceColumn,
                  width: MAPPING_COLUMN_MIN_WIDTH.sourceColumn,
                }}
              >
                Source Column
              </TableCell>
              <TableCell
                sx={{
                  ...headerCellSx,
                  ...scrollableHeaderCellSx,
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
                  ...scrollableHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.nlRule,
                  width: MAPPING_COLUMN_MIN_WIDTH.nlRule,
                }}
              >
                NL Rule
              </TableCell>
              <TableCell
                sx={{
                  ...headerCellSx,
                  ...scrollableHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.order,
                  width: MAPPING_COLUMN_MIN_WIDTH.order,
                }}
              >
                Order
              </TableCell>
              <TableCell
                sx={{
                  ...headerCellSx,
                  ...scrollableHeaderCellSx,
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
                  ...scrollableHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.status,
                  width: MAPPING_COLUMN_MIN_WIDTH.status,
                }}
              >
                Status
              </TableCell>
              <TableCell
                sx={{
                  ...headerCellSx,
                  ...scrollableHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.dataPreview,
                  width: MAPPING_COLUMN_MIN_WIDTH.dataPreview,
                  whiteSpace: 'nowrap',
                }}
              >
                Data Preview
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell
                padding="none"
                sx={{
                  ...headerCellSx,
                  ...mappingFrozenCellSx(FROZEN_COLUMN_LEFT.checkbox, { searchRow: true }),
                  width: MAPPING_COLUMN_MIN_WIDTH.checkbox,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.checkbox,
                  maxWidth: MAPPING_COLUMN_MIN_WIDTH.checkbox,
                  px: 0.5,
                  py: 0.45,
                }}
              />
              <TableCell
                sx={{
                  ...headerCellSx,
                  ...mappingFrozenCellSx(FROZEN_COLUMN_LEFT.targetColumn, {
                    searchRow: true,
                    lastFrozen: true,
                  }),
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.targetColumn,
                  width: MAPPING_COLUMN_MIN_WIDTH.targetColumn,
                  px: 1,
                  py: 0.45,
                }}
              >
                <ColumnFilterInput
                  value={columnFilters.targetColumn}
                  placeholder="Search..."
                  onChange={(value) => updateColumnFilter('targetColumn', value)}
                />
              </TableCell>
              <TableCell
                sx={{
                  ...headerCellSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.preProcessRule,
                  width: MAPPING_COLUMN_MIN_WIDTH.preProcessRule,
                  px: 1,
                  py: 0.45,
                }}
              >
                <ColumnFilterSelect
                  value={columnFilters.preProcessRule}
                  options={RULE_FILTER_OPTIONS}
                  onChange={(value) => updateColumnFilter('preProcessRule', value)}
                />
              </TableCell>
              <TableCell
                sx={{
                  ...headerCellSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.sourceColumn,
                  width: MAPPING_COLUMN_MIN_WIDTH.sourceColumn,
                  px: 1,
                  py: 0.45,
                }}
              >
                <ColumnFilterInput
                  value={columnFilters.sourceColumn}
                  placeholder="Search..."
                  onChange={(value) => updateColumnFilter('sourceColumn', value)}
                />
              </TableCell>
              <TableCell
                sx={{
                  ...headerCellSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.typePreview,
                  width: MAPPING_COLUMN_MIN_WIDTH.typePreview,
                  px: 1,
                  py: 0.45,
                }}
              >
                <ColumnFilterInput
                  value={columnFilters.typePreview}
                  placeholder="Search..."
                  onChange={(value) => updateColumnFilter('typePreview', value)}
                />
              </TableCell>
              <TableCell
                sx={{
                  ...headerCellSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.nlRule,
                  width: MAPPING_COLUMN_MIN_WIDTH.nlRule,
                  px: 1,
                  py: 0.45,
                }}
              >
                <ColumnFilterInput
                  value={columnFilters.nlRule}
                  placeholder="Search..."
                  onChange={(value) => updateColumnFilter('nlRule', value)}
                />
              </TableCell>
              <TableCell
                sx={{
                  ...headerCellSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.order,
                  width: MAPPING_COLUMN_MIN_WIDTH.order,
                  px: 1,
                  py: 0.45,
                }}
              >
                <ColumnFilterInput
                  value={columnFilters.order}
                  placeholder="Search..."
                  onChange={(value) => updateColumnFilter('order', value)}
                />
              </TableCell>
              <TableCell
                sx={{
                  ...headerCellSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.description,
                  width: MAPPING_COLUMN_MIN_WIDTH.description,
                  px: 1,
                  py: 0.45,
                }}
              >
                <ColumnFilterInput
                  value={columnFilters.description}
                  placeholder="Search..."
                  onChange={(value) => updateColumnFilter('description', value)}
                />
              </TableCell>
              <TableCell
                sx={{
                  ...headerCellSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.status,
                  width: MAPPING_COLUMN_MIN_WIDTH.status,
                  px: 1,
                  py: 0.45,
                }}
              >
                <ColumnFilterSelect
                  value={columnFilters.status}
                  options={STATUS_FILTER_OPTIONS}
                  onChange={(value) => updateColumnFilter('status', value)}
                />
              </TableCell>
              <TableCell
                sx={{
                  ...headerCellSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.dataPreview,
                  width: MAPPING_COLUMN_MIN_WIDTH.dataPreview,
                  px: 1,
                  py: 0.45,
                }}
              />
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedMappings.map((row) => {
              const isSelected = selectedMappingIds.includes(row.id);
              const isProcessing =
                autoMapProcessingIds.includes(row.id) || row.status === 'PROCESSING';
              const previewType = row.sourceType ?? row.targetType ?? undefined;
              const sourceColumns =
                row.sourceColumns && row.sourceColumns.length
                  ? row.sourceColumns
                  : parseSourceColumns(row.sourceColumn);
              const resolvedRule = resolveMappingRuleSelectValue(row.rule);
              const descriptionValue = resolveMappingDescription(row, sourceColumns, resolvedRule);
              const descriptionPlaceholder = 'Add description...';
              return (
                <TableRow
                  key={row.id}
                  sx={MAPPING_TABLE_ROW_SX}
                >
                  <AiaCheckboxCell
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

                  <MappingRuleCell
                    value={resolveMappingRuleSelectValue(row.rule)}
                    options={RULE_OPTIONS}
                    configureValue={PREPROCESS_CONFIGURE_VALUE}
                    placeholder="Select rule..."
                    width={MAPPING_COLUMN_MIN_WIDTH.preProcessRule}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.preProcessRule}
                    preProcessDisabled={resolveMappingRuleSelectValue(row.rule) !== 'Custom'}
                    onRuleChange={(value) => handleRuleChange(row.id, value)}
                    onPreProcess={() => setPreProcessModalOpen(true, row.id)}
                    sx={scrollableBodyCellSx}
                  />

                  <MappingSourceColumnsCell
                    value={row.sourceColumn}
                    options={sourceColumnOptions}
                    disabled={!resolvedRule}
                    displayAsPlainText={resolvedRule === 'Custom'}
                    onChange={(nextValue) => {
                      const nextColumns = parseSourceColumns(nextValue);
                      const rule = resolveMappingRuleSelectValue(row.rule);
                      const updates: Partial<typeof row> = {
                        sourceColumn: nextValue.trim() || null,
                        sourceColumns: nextColumns,
                        status: nextColumns.length > 0 ? 'MAPPED' : 'UNMAPPED',
                        sourceType:
                          sourceColumnOptions.find(
                            (option) => option.value.toLowerCase() === nextColumns[0]?.toLowerCase(),
                          )?.dataType ?? row.sourceType ?? null,
                      };

                      if (!row.descriptionEdited && rule) {
                        updates.description =
                          generateMappingDescription({
                            rule,
                            sourceColumns: nextColumns,
                            targetColumn: row.targetColumn,
                            expression: row.expression,
                          }) || null;
                      }

                      updateMapping(row.id, updates);
                    }}
                    width={MAPPING_COLUMN_MIN_WIDTH.sourceColumn}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.sourceColumn}
                    confidenceScore={row.confidenceScore}
                    confidenceReason={row.confidenceReason}
                    candidateSourceColumns={row.candidateSourceColumns}
                    unmatchedReason={row.unmatchedReason}
                    sx={scrollableBodyCellSx}
                  />

                  <MappingTypePreviewCell
                    dataType={previewType}
                    width={MAPPING_COLUMN_MIN_WIDTH.typePreview}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.typePreview}
                    sx={scrollableBodyCellSx}
                  />

                  <AiaInputCell
                    placeholder="Add NL rule..."
                    value={row.nlRule ?? ''}
                    onChange={(value) => updateMapping(row.id, { nlRule: value })}
                    width={MAPPING_COLUMN_MIN_WIDTH.nlRule}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.nlRule}
                    multiline
                    minRows={1}
                    maxRows={10}
                    inputSx={multilineCellInputSx}
                    sx={scrollableBodyCellSx}
                  />

                  <AiaInputCell
                    placeholder="Order..."
                    value={row.loadOrder ?? ''}
                    onChange={(value) => updateMapping(row.id, { loadOrder: value })}
                    width={MAPPING_COLUMN_MIN_WIDTH.order}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.order}
                    sx={scrollableBodyCellSx}
                  />

                  <AiaInputCell
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
                    sx={scrollableBodyCellSx}
                  />

                  <MappingStatusCell
                    status={isProcessing ? 'PROCESSING' : row.status}
                    width={MAPPING_COLUMN_MIN_WIDTH.status}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.status}
                    sx={scrollableBodyCellSx}
                  />

                  <MappingDataPreviewCell
                    mapping={row}
                    width={MAPPING_COLUMN_MIN_WIDTH.dataPreview}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.dataPreview}
                    sx={scrollableBodyCellSx}
                  />
                </TableRow>
              );
            })}
            {!paginatedMappings.length ? (
              <TableRow>
                <TableCell colSpan={10} sx={{ py: 4, textAlign: 'center' }}>
                  <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>
                    No mapping rows match the current column filters.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>

      <TablePagination
        component="div"
        count={filteredMappings.length}
        page={page}
        onPageChange={(_, nextPage) => setPage(nextPage)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(event) => {
          setRowsPerPage(Number.parseInt(event.target.value, 10));
          setPage(0);
        }}
        rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
        sx={MAPPING_TABLE_PAGINATION_SX}
      />

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
