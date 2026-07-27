'use client';
import { AiaBox, AiaButton, AiaIconButton, AiaChip, AiaPaper, AiaTableBody, AiaTableCellPrimitive, AiaTableContainer, AiaTableHead, AiaTablePagination, AiaTablePrimitive, AiaTableRowPrimitive } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowForwardRoundedIcon, CheckRoundedIcon, CloseRoundedIcon, FileUploadOutlinedIcon } from '@/utils/icons';
import { TOUR_TARGETS } from '@/features/tour/constants/tour-targets';
import { useTour } from '@/features/tour/engine/tour-context';

import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import type { MappingRuleType } from '@/features/sttm/types/sttm.types';
import {
  buildSourceColumnOptions,
  formatSqlType,
  generateMappingDescription,
  parseSourceColumns,
} from './mapping-utils';
import { AiaCheckbox } from '@/components/ui/aia-checkbox';
import { AiaInput } from '@/components/ui/aia-input';
import { AiaSelect } from '@/components/ui/aia-select';
import { AiaAutocomplete } from '@/components/ui/aia-auto-complete';
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
  MAPPING_TABLE_CHECKBOX_SX,
  MAPPING_TABLE_CONTAINER_SX,
  MAPPING_SELECTION_BAR_SX,
  MAPPING_TABLE_FILTER_CONTROL_ROOT_SX,
  MAPPING_TABLE_FILTER_INPUT_SX,
  MAPPING_TABLE_FILTER_SELECT_SX,
  MAPPING_TABLE_HEADER_CELL_SX,
  MAPPING_TABLE_HEADER_ROW_HEIGHT,
  MAPPING_TABLE_PAGINATION_SX,
  MAPPING_TABLE_ROW_SX,
  MAPPING_TABLE_SEARCH_ROW_CELL_SX,
  MAPPING_TABLE_SECONDARY_INPUT_SX,
  MAPPING_TABLE_SECONDARY_INPUT_TYPOGRAPHY,
  MAPPING_PREPROCESS_RULE_BUTTON_SPACER_SX,
  MAPPING_PREPROCESS_RULE_FILTER_SX,
  MAPPING_PREPROCESS_RULE_ROW_SX,
  MAPPING_PREPROCESS_RULE_SELECT_WRAPPER_SX,
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

const headerCellSx = MAPPING_TABLE_HEADER_CELL_SX;
const searchRowCellSx = MAPPING_TABLE_SEARCH_ROW_CELL_SX;

const columnFilterAutocompleteSx = {
  '& .MuiOutlinedInput-root': {
    ...MAPPING_TABLE_FILTER_CONTROL_ROOT_SX,
    display: 'flex',
    alignItems: 'center',
    py: '0 !important',
    pr: '4px !important',
  },
  '& .MuiInputBase-input, & .MuiAutocomplete-input': {
    py: '4px !important',
    pl: '2px !important',
    fontSize: '0.72rem',
    lineHeight: 1.3,
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: '#e5e7eb',
  },
} as const;

const columnFilterAutocompleteFitContentSx = {
  ...columnFilterAutocompleteSx,
  width: 'max-content',
  minWidth: 'max-content',
  '& .MuiOutlinedInput-root': {
    ...columnFilterAutocompleteSx['& .MuiOutlinedInput-root'],
    width: 'max-content',
    minWidth: 'max-content',
  },
  '& .MuiInputBase-input, & .MuiAutocomplete-input': {
    ...columnFilterAutocompleteSx['& .MuiInputBase-input, & .MuiAutocomplete-input'],
    width: 'auto !important',
    minWidth: '12ch',
    whiteSpace: 'nowrap',
  },
} as const;

function PreProcessRuleColumnFilter({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <AiaBox sx={MAPPING_PREPROCESS_RULE_ROW_SX}>
      <AiaBox sx={MAPPING_PREPROCESS_RULE_SELECT_WRAPPER_SX}>
        <AiaAutocomplete
          hideLabel
          value={value}
          options={options}
          onChange={(next) => onChange(Array.isArray(next) ? next[0] ?? '' : next)}
          placeholder="All"
          size="small"
          fullWidth
          sx={MAPPING_PREPROCESS_RULE_FILTER_SX}
        />
      </AiaBox>
      <AiaBox sx={MAPPING_PREPROCESS_RULE_BUTTON_SPACER_SX} aria-hidden />
    </AiaBox>
  );
}

/** Minimum column widths — table scrolls horizontally when viewport is narrower. */
const MAPPING_COLUMN_MIN_WIDTH = {
  checkbox: 64,
  targetColumn: 168,
  preProcessRule: 400,
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

const multilineCellInputSx = {
  ...MAPPING_TABLE_SECONDARY_INPUT_SX,
  '& .MuiOutlinedInput-root': {
    ...MAPPING_TABLE_SECONDARY_INPUT_TYPOGRAPHY,
    alignItems: 'flex-start',
    minHeight: 44,
  },
  '& .MuiInputBase-input, & .MuiInputBase-inputMultiline': {
    ...MAPPING_TABLE_SECONDARY_INPUT_TYPOGRAPHY,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    overflow: 'hidden !important',
  },
} as const;

const mappingBodyInputSx = {
  ...MAPPING_TABLE_SECONDARY_INPUT_SX,
  '& .MuiOutlinedInput-root': {
    ...MAPPING_TABLE_SECONDARY_INPUT_TYPOGRAPHY,
    minHeight: 36,
    borderRadius: '6px',
    bgcolor: '#fff',
  },
  '& .MuiInputBase-input': {
    ...MAPPING_TABLE_SECONDARY_INPUT_TYPOGRAPHY,
    paddingY: '8px !important',
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
    top: header ? 0 : searchRow ? MAPPING_TABLE_HEADER_ROW_HEIGHT : undefined,
    zIndex,
    bgcolor: backgroundColor,
    backgroundColor,
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
  top: MAPPING_TABLE_HEADER_ROW_HEIGHT,
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
    <AiaInput
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      size="small"
      fullWidth
      inputProps={{ 'aria-label': placeholder }}
      sx={MAPPING_TABLE_FILTER_INPUT_SX}
    />
  );
}

function ColumnFilterSelect({
  value,
  options,
  onChange,
  searchable = false,
  fitContent = false,
}: {
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
  searchable?: boolean;
  fitContent?: boolean;
}) {
  if (searchable) {
    return (
      <AiaAutocomplete
        hideLabel
        value={value}
        options={options}
        onChange={(next) => onChange(Array.isArray(next) ? next[0] ?? '' : next)}
        placeholder="All"
        size="small"
        fullWidth={!fitContent}
        sx={fitContent ? columnFilterAutocompleteFitContentSx : columnFilterAutocompleteSx}
      />
    );
  }

  return (
    <AiaSelect
      value={value}
      options={options}
      onChange={(next) => onChange(Array.isArray(next) ? next[0] ?? '' : next)}
      placeholder="All"
      size="small"
      fullWidth
      sx={MAPPING_TABLE_FILTER_SELECT_SX}
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
  const { notifyTourContextChanged } = useTour();

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
      if (
        columnFilters.sourceColumn
        && !includes(
          row.mappingMode === "constant" ? row.constantValue : row.sourceColumn,
          columnFilters.sourceColumn,
        )
      ) {
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
    if (selectedMappingIds.length > 0) {
      notifyTourContextChanged();
    }
  }, [notifyTourContextChanged, selectedMappingIds.length]);

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
    <AiaBox
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
        <AiaBox data-tour={TOUR_TARGETS.sttmRowSelectionBar} sx={MAPPING_SELECTION_BAR_SX}>
          <AiaBox sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
            <AiaBox
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
              <CheckRoundedIcon sx={{ fontSize: 15, color: 'var(--color-primary)' }} />
            </AiaBox>
            <AiaText sx={{ fontSize: '0.85rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
              {selectedMappingIds.length} row{selectedMappingIds.length === 1 ? '' : 's'} selected
            </AiaText>
            <AiaText
              sx={{ fontSize: '0.78rem', fontWeight: 500, color: '#94a3b8', whiteSpace: 'nowrap' }}
            >
              ({selectedMappedCount} mapped)
            </AiaText>
            {selectedMappedCount > 0 && (
              <AiaChip
                size="small"
                color="success"
                label={`${selectedMappedCount} Mapped`}
              />
            )}
          </AiaBox>

          <AiaBox sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <AiaButton
              data-tour={TOUR_TARGETS.sttmMarkMapped}
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
            </AiaButton>
            <AiaButton
              data-tour={TOUR_TARGETS.sttmSetDirect}
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
            </AiaButton>
            <AiaButton
              data-tour={TOUR_TARGETS.sttmPublishRowMapping}
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
            </AiaButton>
            <AiaIconButton
              size="small"
              onClick={clearSelection}
              sx={{ color: '#94a3b8', ml: 0.25, '&:hover': { color: '#fff' } }}
            >
              <CloseRoundedIcon sx={{ fontSize: 18 }} />
            </AiaIconButton>
          </AiaBox>
        </AiaBox>
      )}

      <AiaTableContainer
        component={AiaPaper}
        elevation={0}
        data-tour={TOUR_TARGETS.sttmMappingGrid}
        sx={MAPPING_TABLE_CONTAINER_SX}
      >
          <AiaTablePrimitive
            stickyHeader
            size="small"
            sx={mappingTableSx(MAPPING_TABLE_MIN_WIDTH)}
          >
          <colgroup>
            {Object.values(MAPPING_COLUMN_MIN_WIDTH).map((columnWidth, index) => (
              <col key={`mapping-col-${index}`} style={{ width: columnWidth }} />
            ))}
          </colgroup>
          <AiaTableHead>
            <AiaTableRowPrimitive>
              <AiaTableCellPrimitive
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
                <AiaBox
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    minHeight: MAPPING_TABLE_HEADER_ROW_HEIGHT,
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
                    sx={MAPPING_TABLE_CHECKBOX_SX}
                  />
                </AiaBox>
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive
                data-tour={TOUR_TARGETS.sttmTargetColumn}
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
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive
                sx={{
                  ...headerCellSx,
                  ...scrollableHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.preProcessRule,
                  width: MAPPING_COLUMN_MIN_WIDTH.preProcessRule,
                }}
              >
                Pre-processing Rule
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive
                sx={{
                  ...headerCellSx,
                  ...scrollableHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.sourceColumn,
                  width: MAPPING_COLUMN_MIN_WIDTH.sourceColumn,
                }}
              >
                Source Column
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive
                sx={{
                  ...headerCellSx,
                  ...scrollableHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.typePreview,
                  width: MAPPING_COLUMN_MIN_WIDTH.typePreview,
                  whiteSpace: 'nowrap',
                }}
              >
                Type (Preview)
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive
                sx={{
                  ...headerCellSx,
                  ...scrollableHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.nlRule,
                  width: MAPPING_COLUMN_MIN_WIDTH.nlRule,
                }}
              >
                NL Rule
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive
                sx={{
                  ...headerCellSx,
                  ...scrollableHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.order,
                  width: MAPPING_COLUMN_MIN_WIDTH.order,
                }}
              >
                Order
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive
                data-tour={TOUR_TARGETS.sttmDescriptionAi}
                sx={{
                  ...headerCellSx,
                  ...scrollableHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.description,
                  width: MAPPING_COLUMN_MIN_WIDTH.description,
                }}
              >
                <AiaBox sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  Description
                  <AiaChip label="AI" size="small" color="primary" sx={{ height: 22, fontSize: '0.6rem', fontWeight: 800 }} />
                </AiaBox>
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive
                data-tour={TOUR_TARGETS.sttmMappedStatus}
                sx={{
                  ...headerCellSx,
                  ...scrollableHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.status,
                  width: MAPPING_COLUMN_MIN_WIDTH.status,
                }}
              >
                Status
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive
                sx={{
                  ...headerCellSx,
                  ...scrollableHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.dataPreview,
                  width: MAPPING_COLUMN_MIN_WIDTH.dataPreview,
                  whiteSpace: 'nowrap',
                }}
              >
                Data Preview
              </AiaTableCellPrimitive>
            </AiaTableRowPrimitive>
            <AiaTableRowPrimitive>
              <AiaTableCellPrimitive
                padding="none"
                sx={{
                  ...searchRowCellSx,
                  ...mappingFrozenCellSx(FROZEN_COLUMN_LEFT.checkbox, { searchRow: true }),
                  width: MAPPING_COLUMN_MIN_WIDTH.checkbox,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.checkbox,
                  maxWidth: MAPPING_COLUMN_MIN_WIDTH.checkbox,
                  px: 0.5,
                }}
              />
              <AiaTableCellPrimitive
                sx={{
                  ...searchRowCellSx,
                  ...mappingFrozenCellSx(FROZEN_COLUMN_LEFT.targetColumn, {
                    searchRow: true,
                    lastFrozen: true,
                  }),
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.targetColumn,
                  width: MAPPING_COLUMN_MIN_WIDTH.targetColumn,
                }}
              >
                <ColumnFilterInput
                  value={columnFilters.targetColumn}
                  placeholder="Search..."
                  onChange={(value) => updateColumnFilter('targetColumn', value)}
                />
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive
                sx={{
                  ...searchRowCellSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.preProcessRule,
                  width: MAPPING_COLUMN_MIN_WIDTH.preProcessRule,
                }}
              >
                <PreProcessRuleColumnFilter
                  value={columnFilters.preProcessRule}
                  options={RULE_FILTER_OPTIONS}
                  onChange={(value) => updateColumnFilter('preProcessRule', value)}
                />
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive
                sx={{
                  ...searchRowCellSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.sourceColumn,
                  width: MAPPING_COLUMN_MIN_WIDTH.sourceColumn,
                }}
              >
                <ColumnFilterInput
                  value={columnFilters.sourceColumn}
                  placeholder="Search..."
                  onChange={(value) => updateColumnFilter('sourceColumn', value)}
                />
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive
                sx={{
                  ...searchRowCellSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.typePreview,
                  width: MAPPING_COLUMN_MIN_WIDTH.typePreview,
                }}
              >
                <ColumnFilterInput
                  value={columnFilters.typePreview}
                  placeholder="Search..."
                  onChange={(value) => updateColumnFilter('typePreview', value)}
                />
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive
                sx={{
                  ...searchRowCellSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.nlRule,
                  width: MAPPING_COLUMN_MIN_WIDTH.nlRule,
                }}
              >
                <ColumnFilterInput
                  value={columnFilters.nlRule}
                  placeholder="Search..."
                  onChange={(value) => updateColumnFilter('nlRule', value)}
                />
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive
                sx={{
                  ...searchRowCellSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.order,
                  width: MAPPING_COLUMN_MIN_WIDTH.order,
                }}
              >
                <ColumnFilterInput
                  value={columnFilters.order}
                  placeholder="Search..."
                  onChange={(value) => updateColumnFilter('order', value)}
                />
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive
                sx={{
                  ...searchRowCellSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.description,
                  width: MAPPING_COLUMN_MIN_WIDTH.description,
                }}
              >
                <ColumnFilterInput
                  value={columnFilters.description}
                  placeholder="Search..."
                  onChange={(value) => updateColumnFilter('description', value)}
                />
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive
                sx={{
                  ...searchRowCellSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.status,
                  width: MAPPING_COLUMN_MIN_WIDTH.status,
                }}
              >
                <ColumnFilterSelect
                  value={columnFilters.status}
                  options={STATUS_FILTER_OPTIONS}
                  onChange={(value) => updateColumnFilter('status', value)}
                />
              </AiaTableCellPrimitive>
              <AiaTableCellPrimitive
                sx={{
                  ...searchRowCellSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.dataPreview,
                  width: MAPPING_COLUMN_MIN_WIDTH.dataPreview,
                }}
              />
            </AiaTableRowPrimitive>
          </AiaTableHead>
          <AiaTableBody>
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
                <AiaTableRowPrimitive
                  key={row.id}
                  sx={MAPPING_TABLE_ROW_SX}
                >
                  <AiaCheckboxCell
                    checked={isSelected}
                    onChange={() => toggleMappingSelection(row.id)}
                    width={MAPPING_COLUMN_MIN_WIDTH.checkbox}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.checkbox}
                    checkboxSx={MAPPING_TABLE_CHECKBOX_SX}
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
                    disabled={!resolvedRule && row.mappingMode !== "constant"}
                    displayAsPlainText={resolvedRule === 'Custom' && row.mappingMode !== "constant"}
                    mappingMode={row.mappingMode ?? "source"}
                    constantValue={row.constantValue}
                    onMappingModeChange={(mode) => {
                      const isConstant = mode === "constant";
                      updateMapping(row.id, {
                        mappingMode: mode,
                        constantValue: isConstant ? row.constantValue ?? "" : null,
                        sourceColumn: isConstant ? null : row.sourceColumn,
                        sourceColumns: isConstant ? [] : row.sourceColumns,
                        sourceType: isConstant ? null : row.sourceType,
                        expression: isConstant ? null : row.expression,
                        rule: isConstant ? "Direct" : row.rule,
                        status:
                          isConstant && (row.constantValue ?? "").trim()
                            ? "MAPPED"
                            : !isConstant && (row.sourceColumns?.length || row.sourceColumn)
                              ? "MAPPED"
                              : "UNMAPPED",
                        confidenceScore: null,
                        confidenceReason: isConstant
                          ? "A hard-coded value was assigned manually."
                          : null,
                        usedInferenceIds: [],
                        usedRecommendationIds: [],
                        usedLearningIds: [],
                        description: row.descriptionEdited
                          ? row.description
                          : isConstant
                            ? `Assign a hard-coded value to ${row.targetColumn}.`
                            : null,
                      });
                    }}
                    onConstantValueChange={(constantValue) => {
                      updateMapping(row.id, {
                        mappingMode: "constant",
                        constantValue,
                        status: constantValue.trim() ? "MAPPED" : "UNMAPPED",
                        confidenceScore: null,
                        confidenceReason: constantValue.trim()
                          ? "A hard-coded value was assigned manually."
                          : null,
                        usedInferenceIds: [],
                        usedRecommendationIds: [],
                        usedLearningIds: [],
                        description: row.descriptionEdited
                          ? row.description
                          : constantValue.trim()
                            ? `Assign the hard-coded value ${constantValue.trim()} to ${row.targetColumn}.`
                            : null,
                      });
                    }}
                    onChange={(nextValue) => {
                      const nextColumns = parseSourceColumns(nextValue);
                      const rule = resolveMappingRuleSelectValue(row.rule);
                      const updates: Partial<typeof row> = {
                        sourceColumn: nextValue.trim() || null,
                        sourceColumns: nextColumns,
                        mappingMode: "source",
                        constantValue: null,
                        status: nextColumns.length > 0 ? 'MAPPED' : 'UNMAPPED',
                        confidenceScore: null,
                        confidenceReason: nextColumns.length
                          ? 'Source columns were edited manually after the AI suggestion.'
                          : null,
                        usedInferenceIds: [],
                        usedRecommendationIds: [],
                        usedLearningIds: [],
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
                    businessMeaning={row.description ?? row.nlRule ?? null}
                    candidateSourceColumns={row.candidateSourceColumns}
                    usedInferenceIds={row.usedInferenceIds}
                    usedRecommendationIds={row.usedRecommendationIds}
                    usedLearningIds={row.usedLearningIds}
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
                    inputSx={mappingBodyInputSx}
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
                </AiaTableRowPrimitive>
              );
            })}
            {!paginatedMappings.length ? (
              <AiaTableRowPrimitive>
                <AiaTableCellPrimitive colSpan={10} sx={{ py: 4, textAlign: 'center' }}>
                  <AiaText sx={{ fontSize: '0.82rem', color: '#64748b' }}>
                    No mapping rows match the current column filters.
                  </AiaText>
                </AiaTableCellPrimitive>
              </AiaTableRowPrimitive>
            ) : null}
          </AiaTableBody>
        </AiaTablePrimitive>
      </AiaTableContainer>

      <AiaTablePagination
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
        <AiaBox
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
          <AiaBox
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
            <AiaBox
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
          </AiaBox>
          <AiaText sx={{ fontSize: '0.8rem', color: '#e2e8f0', fontWeight: 600 }}>
            {autoMapStatusMessage || 'Running auto-map...'}
          </AiaText>
        </AiaBox>
      )}
    </AiaBox>
  );
};

export default SourceTargetAttributeMapping;
