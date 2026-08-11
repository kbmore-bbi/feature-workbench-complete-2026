'use client';
import { AiaBox, AiaButton, AiaIconButton, AiaChip, AiaPaper, AiaTableBody, AiaTableCellPrimitive, AiaTableContainer, AiaTableHead, AiaTablePagination, AiaTablePrimitive, AiaTableRowPrimitive } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowForwardRoundedIcon, CheckRoundedIcon, CloseRoundedIcon, FileUploadOutlinedIcon } from '@/utils/icons';
import { TOUR_TARGETS } from '@/features/tour/constants/tour-targets';
import { useTour } from '@/features/tour/engine/tour-context';

import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import type { MappingMode, MappingRuleType } from '@/features/sttm/types/sttm.types';
import {
  listProjectAttributes,
  type ProjectAttributeRecord,
} from '@/services/projectService';
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
  MappingConfidenceCell,
  MappingRuleCell,
  MappingSourceColumnsCell,
  MappingStatusCell,
  MappingTargetColumnCell,
  MappingTypePreviewCell,
} from './cells';
import type { FIRMappingCandidate } from './cells/mapping-source-columns-cell';
import {
  recommendationService,
  type ApplicableRecommendation,
} from '@/services/recommendationService';
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
import { MappingResizableHeaderCell } from './mapping-resizable-header-cell';
import { mappingColumnDividerSx } from './mapping-column-divider';
import {
  getVisibleMappingColumnKeys,
  useMappingColumnWidths,
} from './use-mapping-column-widths';
import {
  countMappingsByConfidenceGroup,
  getConfidenceGroup,
  hasConfidenceScore,
  sortMappingsByConfidenceGroups,
} from './mapping-confidence-groups';
import { MappingConfidenceGroupHeaderRow } from './mapping-confidence-group-header';

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
  checkbox: 52,
  targetColumn: 168,
  sourceColumn: 300,
  preProcessRule: 400,
  confidence: 120,
  typePreview: 112,
  nlRule: 220,
  order: 96,
  description: 240,
  status: 136,
  dataPreview: 168,
} as const;

const FROZEN_CHECKBOX_LEFT = 0;

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
  ...mappingColumnDividerSx,
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
    autoMapGroupingEnabled,
    sourceAttributeGroups,
    derivedSources,
    activeProjectId,
    activeProjectName,
    activeSttmId,
    flushWorkspace,
    getWorkspaceSnapshot,
  } = useSttmBuilderContext();
  const { notifyTourContextChanged } = useTour();

  const [columnFilters, setColumnFilters] = useState<MappingColumnFilters>(EMPTY_COLUMN_FILTERS);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);
  const [applicableRecommendations, setApplicableRecommendations] = useState<ApplicableRecommendation[]>([]);
  const [recommendationUndoByRow, setRecommendationUndoByRow] = useState<Record<string, {
    sourceColumn: string | null;
    sourceColumns: string[];
    status: "MAPPED" | "UNMAPPED" | "PROCESSING";
    confidenceScore: number | null;
    confidenceReason: string | null;
    usedRecommendationIds: string[];
  }>>({});
  const [recommendationActionErrors, setRecommendationActionErrors] = useState<Record<string, string>>({});
  const [projectAttributes, setProjectAttributes] = useState<ProjectAttributeRecord[]>([]);
  const showConfidenceColumn = useMemo(
    () =>
      autoMapGroupingEnabled
      || mappings.some((row) => hasConfidenceScore(row.confidenceScore)),
    [autoMapGroupingEnabled, mappings],
  );
  const confidenceGroupingActive = showConfidenceColumn;
  const visibleColumnKeys = useMemo(
    () => getVisibleMappingColumnKeys(showConfidenceColumn),
    [showConfidenceColumn],
  );
  const { columnWidths, onResizeStart, tableMinWidth, frozenTargetColumnLeft } =
    useMappingColumnWidths(MAPPING_COLUMN_MIN_WIDTH, MAPPING_COLUMN_MIN_WIDTH, visibleColumnKeys);

  const sortedMappings = mappings;
  const sourceColumnOptions = buildSourceColumnOptions(sourceAttributeGroups, derivedSources);
  useEffect(() => {
    if (!activeProjectId) {
      setProjectAttributes([]);
      return;
    }
    let cancelled = false;
    listProjectAttributes(activeProjectId)
      .then((records) => {
        if (!cancelled) setProjectAttributes(records);
      })
      .catch(() => {
        if (!cancelled) setProjectAttributes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, activeProjectName]);
  const attributeOptions = useMemo(
    () => projectAttributes.map((attribute) => ({
      label: attribute.attribute_name,
      value: attribute.attribute_name,
    })),
    [projectAttributes],
  );

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
          row.mappingMode === "constant"
            ? row.constantValue
            : row.mappingMode === "attribute"
              ? row.attributeName
              : row.sourceColumn,
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
    if (selectedMappingIds.length > 0) {
      notifyTourContextChanged();
    }
  }, [notifyTourContextChanged, selectedMappingIds.length]);

  const sortedForDisplay = useMemo(() => {
    if (!confidenceGroupingActive) {
      return filteredMappings;
    }
    return sortMappingsByConfidenceGroups(filteredMappings);
  }, [confidenceGroupingActive, filteredMappings]);

  const confidenceGroupCounts = useMemo(
    () => countMappingsByConfidenceGroup(filteredMappings),
    [filteredMappings],
  );

  useEffect(() => {
    if (confidenceGroupingActive) {
      setPage(0);
    }
  }, [confidenceGroupingActive]);

  const maxPage = Math.max(0, Math.ceil(sortedForDisplay.length / rowsPerPage) - 1);
  const safePage = Math.min(page, maxPage);

  const paginatedMappings = useMemo(() => {
    const start = safePage * rowsPerPage;
    return sortedForDisplay.slice(start, start + rowsPerPage);
  }, [sortedForDisplay, safePage, rowsPerPage]);

  useEffect(() => {
    if (!activeProjectId || !activeSttmId || !paginatedMappings.length) {
      return;
    }
    const controller = new AbortController();
    void recommendationService.listApplicable({
      projectId: activeProjectId,
      sttmId: activeSttmId,
      workflowStage: 'mapping',
      targetColumns: paginatedMappings.map((row) => row.targetColumn),
      limit: Math.min(200, paginatedMappings.length * 3),
      signal: controller.signal,
    }).then(setApplicableRecommendations).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setApplicableRecommendations([]);
      }
    });
    return () => controller.abort();
  }, [activeProjectId, activeSttmId, paginatedMappings]);

  const firCandidatesByTarget = useMemo(() => {
    const result = new Map<string, FIRMappingCandidate[]>();
    if (!activeProjectId || !activeSttmId) return result;
    for (const recommendation of applicableRecommendations) {
      const target = String(
        recommendation.target_entity.target_column
        ?? recommendation.target_entity.column
        ?? '',
      ).toUpperCase();
      if (!target) continue;
      const payload = recommendation.action_payload;
      const rawSources = payload.source_columns
        ?? payload.candidate_source_columns
        ?? (payload.source_column
          ? [payload.source_column]
          : recommendation.candidate_sources);
      const sources = Array.isArray(rawSources) ? rawSources : [rawSources];
      const sourceColumn = sources
        .map((item) => (
          typeof item === 'string'
            ? item
            : item && typeof item === 'object'
              ? String(
                  (item as Record<string, unknown>).source_column
                  ?? (item as Record<string, unknown>).column
                  ?? (item as Record<string, unknown>).fqn
                  ?? '',
                )
              : ''
        ))
        .find(Boolean);
      const candidate: FIRMappingCandidate = {
        recommendationId: recommendation.recommendation_id,
        sourceColumn: sourceColumn ?? null,
        title: recommendation.title,
        businessRationale: recommendation.business_rationale,
        evidenceSummary: recommendation.evidence_summary,
        confidence: recommendation.confidence,
        compatibilityTier: recommendation.compatibility_tier,
        missingDependencies: recommendation.missing_dependencies,
        canApply: recommendation.can_apply,
        blockedReasons: recommendation.blocked_reasons,
        actionKind: recommendation.action_kind,
        expectedWorkspaceHash: recommendation.expected_workspace_hash,
      };
      result.set(target, [...(result.get(target) ?? []), candidate].slice(0, 3));
    }
    return result;
  }, [activeProjectId, activeSttmId, applicableRecommendations]);

  const updateColumnFilter = (key: keyof MappingColumnFilters, value: string) => {
    setPage(0);
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
            sx={mappingTableSx(tableMinWidth)}
          >
          <colgroup>
            {visibleColumnKeys.map((key) => (
              <col key={key} style={{ width: columnWidths[key] }} />
            ))}
          </colgroup>
          <AiaTableHead>
            <AiaTableRowPrimitive>
              <MappingResizableHeaderCell
                padding="none"
                width={columnWidths.checkbox}
                minWidth={MAPPING_COLUMN_MIN_WIDTH.checkbox}
                resizeKey="checkbox"
                onResizeStart={onResizeStart}
                sx={{
                  ...headerCellSx,
                  ...mappingFrozenCellSx(FROZEN_CHECKBOX_LEFT, { header: true }),
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
              </MappingResizableHeaderCell>
              <MappingResizableHeaderCell
                data-tour={TOUR_TARGETS.sttmTargetColumn}
                width={columnWidths.targetColumn}
                minWidth={MAPPING_COLUMN_MIN_WIDTH.targetColumn}
                resizeKey="targetColumn"
                onResizeStart={onResizeStart}
                sx={{
                  ...headerCellSx,
                  ...mappingFrozenCellSx(frozenTargetColumnLeft, {
                    header: true,
                    lastFrozen: true,
                  }),
                }}
              >
                Target Column
              </MappingResizableHeaderCell>
              <MappingResizableHeaderCell
                width={columnWidths.sourceColumn}
                minWidth={MAPPING_COLUMN_MIN_WIDTH.sourceColumn}
                resizeKey="sourceColumn"
                onResizeStart={onResizeStart}
                sx={{
                  ...headerCellSx,
                  ...scrollableHeaderCellSx,
                }}
              >
                Source Column
              </MappingResizableHeaderCell>
              <MappingResizableHeaderCell
                width={columnWidths.preProcessRule}
                minWidth={MAPPING_COLUMN_MIN_WIDTH.preProcessRule}
                resizeKey="preProcessRule"
                onResizeStart={onResizeStart}
                sx={{
                  ...headerCellSx,
                  ...scrollableHeaderCellSx,
                }}
              >
                Pre-processing Rule
              </MappingResizableHeaderCell>
              {showConfidenceColumn ? (
                <MappingResizableHeaderCell
                  width={columnWidths.confidence}
                  minWidth={MAPPING_COLUMN_MIN_WIDTH.confidence}
                  resizeKey="confidence"
                  onResizeStart={onResizeStart}
                  sx={{
                    ...headerCellSx,
                    ...scrollableHeaderCellSx,
                  }}
                >
                  Confidence
                </MappingResizableHeaderCell>
              ) : null}
              <MappingResizableHeaderCell
                width={columnWidths.typePreview}
                minWidth={MAPPING_COLUMN_MIN_WIDTH.typePreview}
                resizeKey="typePreview"
                onResizeStart={onResizeStart}
                sx={{
                  ...headerCellSx,
                  ...scrollableHeaderCellSx,
                  whiteSpace: 'nowrap',
                }}
              >
                Type (Preview)
              </MappingResizableHeaderCell>
              <MappingResizableHeaderCell
                width={columnWidths.nlRule}
                minWidth={MAPPING_COLUMN_MIN_WIDTH.nlRule}
                resizeKey="nlRule"
                onResizeStart={onResizeStart}
                sx={{
                  ...headerCellSx,
                  ...scrollableHeaderCellSx,
                }}
              >
                NL Rule
              </MappingResizableHeaderCell>
              <MappingResizableHeaderCell
                width={columnWidths.order}
                minWidth={MAPPING_COLUMN_MIN_WIDTH.order}
                resizeKey="order"
                onResizeStart={onResizeStart}
                sx={{
                  ...headerCellSx,
                  ...scrollableHeaderCellSx,
                }}
              >
                Order
              </MappingResizableHeaderCell>
              <MappingResizableHeaderCell
                data-tour={TOUR_TARGETS.sttmDescriptionAi}
                width={columnWidths.description}
                minWidth={MAPPING_COLUMN_MIN_WIDTH.description}
                resizeKey="description"
                onResizeStart={onResizeStart}
                sx={{
                  ...headerCellSx,
                  ...scrollableHeaderCellSx,
                }}
              >
                <AiaBox sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  Description
                  <AiaChip label="AI" size="small" color="primary" sx={{ height: 22, fontSize: '0.6rem', fontWeight: 800 }} />
                </AiaBox>
              </MappingResizableHeaderCell>
              <MappingResizableHeaderCell
                data-tour={TOUR_TARGETS.sttmMappedStatus}
                width={columnWidths.status}
                minWidth={MAPPING_COLUMN_MIN_WIDTH.status}
                resizeKey="status"
                onResizeStart={onResizeStart}
                sx={{
                  ...headerCellSx,
                  ...scrollableHeaderCellSx,
                }}
              >
                Status
              </MappingResizableHeaderCell>
              <MappingResizableHeaderCell
                width={columnWidths.dataPreview}
                minWidth={MAPPING_COLUMN_MIN_WIDTH.dataPreview}
                resizeKey="dataPreview"
                onResizeStart={onResizeStart}
                sx={{
                  ...headerCellSx,
                  ...scrollableHeaderCellSx,
                  whiteSpace: 'nowrap',
                }}
              >
                Data Preview
              </MappingResizableHeaderCell>
            </AiaTableRowPrimitive>
            <AiaTableRowPrimitive>
              <AiaTableCellPrimitive
                padding="none"
                sx={{
                  ...searchRowCellSx,
                  ...mappingColumnDividerSx,
                  ...mappingFrozenCellSx(FROZEN_CHECKBOX_LEFT, { searchRow: true }),
                  width: columnWidths.checkbox,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.checkbox,
                  px: 0.5,
                }}
              />
              <AiaTableCellPrimitive
                sx={{
                  ...searchRowCellSx,
                  ...mappingColumnDividerSx,
                  ...mappingFrozenCellSx(frozenTargetColumnLeft, {
                    searchRow: true,
                    lastFrozen: true,
                  }),
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.targetColumn,
                  width: columnWidths.targetColumn,
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
                  ...mappingColumnDividerSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.sourceColumn,
                  width: columnWidths.sourceColumn,
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
                  ...mappingColumnDividerSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.preProcessRule,
                  width: columnWidths.preProcessRule,
                }}
              >
                <PreProcessRuleColumnFilter
                  value={columnFilters.preProcessRule}
                  options={RULE_FILTER_OPTIONS}
                  onChange={(value) => updateColumnFilter('preProcessRule', value)}
                />
              </AiaTableCellPrimitive>
              {showConfidenceColumn ? (
                <AiaTableCellPrimitive
                  sx={{
                    ...searchRowCellSx,
                    ...mappingColumnDividerSx,
                    ...scrollableSearchHeaderCellSx,
                    minWidth: MAPPING_COLUMN_MIN_WIDTH.confidence,
                    width: columnWidths.confidence,
                  }}
                />
              ) : null}
              <AiaTableCellPrimitive
                sx={{
                  ...searchRowCellSx,
                  ...mappingColumnDividerSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.typePreview,
                  width: columnWidths.typePreview,
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
                  ...mappingColumnDividerSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.nlRule,
                  width: columnWidths.nlRule,
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
                  ...mappingColumnDividerSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.order,
                  width: columnWidths.order,
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
                  ...mappingColumnDividerSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.description,
                  width: columnWidths.description,
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
                  ...mappingColumnDividerSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.status,
                  width: columnWidths.status,
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
                  ...mappingColumnDividerSx,
                  ...scrollableSearchHeaderCellSx,
                  minWidth: MAPPING_COLUMN_MIN_WIDTH.dataPreview,
                  width: columnWidths.dataPreview,
                }}
              />
            </AiaTableRowPrimitive>
          </AiaTableHead>
          <AiaTableBody>
            {paginatedMappings.map((row, rowIndex) => {
              const pageStart = safePage * rowsPerPage;
              const globalIndex = pageStart + rowIndex;
              const currentConfidenceGroup = confidenceGroupingActive
                ? getConfidenceGroup(row.confidenceScore, row.status)
                : null;
              const previousConfidenceGroup =
                confidenceGroupingActive && globalIndex > 0
                  ? getConfidenceGroup(
                      sortedForDisplay[globalIndex - 1].confidenceScore,
                      sortedForDisplay[globalIndex - 1].status,
                    )
                  : null;
              const showConfidenceGroupHeader =
                confidenceGroupingActive
                && currentConfidenceGroup != null
                && currentConfidenceGroup !== previousConfidenceGroup;

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
                <React.Fragment key={row.id}>
                  {showConfidenceGroupHeader ? (
                    <MappingConfidenceGroupHeaderRow
                      groupId={currentConfidenceGroup}
                      rowCount={confidenceGroupCounts[currentConfidenceGroup]}
                      colSpan={visibleColumnKeys.length}
                    />
                  ) : null}
                <AiaTableRowPrimitive
                  sx={MAPPING_TABLE_ROW_SX}
                >
                  <AiaCheckboxCell
                    checked={isSelected}
                    onChange={() => toggleMappingSelection(row.id)}
                    width={columnWidths.checkbox}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.checkbox}
                    checkboxSx={MAPPING_TABLE_CHECKBOX_SX}
                    sx={{
                      ...mappingFrozenCellSx(FROZEN_CHECKBOX_LEFT),
                      ...mappingColumnDividerSx,
                    }}
                  />

                  <MappingTargetColumnCell
                    name={row.targetColumn}
                    isMapped={row.status === 'MAPPED'}
                    isProcessing={isProcessing}
                    width={columnWidths.targetColumn}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.targetColumn}
                    sx={{
                      ...mappingFrozenCellSx(frozenTargetColumnLeft, {
                        lastFrozen: true,
                      }),
                      ...mappingColumnDividerSx,
                    }}
                  />

                  <MappingSourceColumnsCell
                    value={row.sourceColumn}
                    options={sourceColumnOptions}
                    disabled={!resolvedRule && row.mappingMode !== "constant" && row.mappingMode !== "attribute"}
                    displayAsPlainText={resolvedRule === 'Custom' && row.mappingMode !== "constant" && row.mappingMode !== "attribute"}
                    mappingMode={row.mappingMode ?? "source"}
                    constantValue={row.constantValue}
                    attributeName={row.attributeName}
                    attributeOptions={attributeOptions}
                    onMappingModeChange={(mode: MappingMode) => {
                      const isConstant = mode === "constant";
                      const isAttribute = mode === "attribute";
                      updateMapping(row.id, {
                        mappingMode: mode,
                        constantValue: isConstant ? row.constantValue ?? "" : null,
                        attributeName: isAttribute ? row.attributeName ?? null : null,
                        sourceColumn: isConstant || isAttribute ? null : row.sourceColumn,
                        sourceColumns: isConstant || isAttribute ? [] : row.sourceColumns,
                        sourceType: isConstant || isAttribute ? null : row.sourceType,
                        expression: isConstant || isAttribute ? null : row.expression,
                        rule: isConstant || isAttribute ? "Direct" : row.rule,
                        status:
                          isConstant && (row.constantValue ?? "").trim()
                            ? "MAPPED"
                            : isAttribute && (row.attributeName ?? "").trim()
                              ? "MAPPED"
                              : !isConstant && !isAttribute && (row.sourceColumns?.length || row.sourceColumn)
                                ? "MAPPED"
                                : "UNMAPPED",
                        confidenceScore: null,
                        confidenceReason: isConstant
                          ? "A hard-coded value was assigned manually."
                          : isAttribute
                            ? "A project value was assigned manually."
                            : null,
                        usedInferenceIds: [],
                        usedRecommendationIds: [],
                        usedLearningIds: [],
                        description: row.descriptionEdited
                          ? row.description
                          : isConstant
                            ? `Assign a hard-coded value to ${row.targetColumn}.`
                            : isAttribute
                              ? `Assign a project value to ${row.targetColumn}.`
                              : null,
                      });
                    }}
                    onConstantValueChange={(constantValue) => {
                      updateMapping(row.id, {
                        mappingMode: "constant",
                        constantValue,
                        attributeName: null,
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
                    onAttributeChange={(nextAttributeName) => {
                      const selectedAttribute = projectAttributes.find(
                        (attribute) => attribute.attribute_name === nextAttributeName,
                      );
                      updateMapping(row.id, {
                        mappingMode: "attribute",
                        attributeName: nextAttributeName || null,
                        constantValue: selectedAttribute?.attribute_value ?? null,
                        sourceColumn: null,
                        sourceColumns: [],
                        sourceType: selectedAttribute?.attribute_type ?? null,
                        expression: null,
                        rule: "Direct",
                        status: nextAttributeName.trim() ? "MAPPED" : "UNMAPPED",
                        confidenceScore: null,
                        confidenceReason: nextAttributeName.trim()
                          ? "A project value was assigned manually."
                          : null,
                        usedInferenceIds: [],
                        usedRecommendationIds: [],
                        usedLearningIds: [],
                        description: row.descriptionEdited
                          ? row.description
                          : nextAttributeName.trim()
                            ? `Assign the project value ${nextAttributeName.trim()} to ${row.targetColumn}.`
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
                        attributeName: null,
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
                    firCandidates={firCandidatesByTarget.get(row.targetColumn.toUpperCase()) ?? []}
                    onApplyFirCandidate={(candidate) => {
                      if (!candidate.sourceColumn) return;
                      void (async () => {
                        try {
                          await flushWorkspace();
                          const refreshed = await recommendationService.listApplicable({
                            projectId: activeProjectId || '',
                            sttmId: activeSttmId || '',
                            workflowStage: 'mapping',
                            targetColumns: [row.targetColumn],
                            limit: 3,
                          });
                          const currentRecommendation = refreshed.find(
                            (item) => item.recommendation_id === candidate.recommendationId,
                          );
                          const expectedWorkspaceHash =
                            currentRecommendation?.expected_workspace_hash
                            || candidate.expectedWorkspaceHash
                            || '';
                          if (!expectedWorkspaceHash) {
                            throw new Error('The current workspace hash is unavailable. Refresh the mapping and try again.');
                          }
                          const workspaceSnapshot = {
                            ...getWorkspaceSnapshot(),
                            context_hash: expectedWorkspaceHash,
                          };
                          const preview = await recommendationService.preview(
                            candidate.recommendationId,
                            {
                              sttm_id: activeSttmId || '',
                              workspace_snapshot: workspaceSnapshot,
                              expected_workspace_hash: expectedWorkspaceHash,
                            },
                          );
                          if (!preview.can_apply) {
                            throw new Error(preview.blocked_reasons.join(' '));
                          }
                          setRecommendationUndoByRow((current) => ({
                            ...current,
                            [row.id]: {
                              sourceColumn: row.sourceColumn,
                              sourceColumns: row.sourceColumns ?? [],
                              status: row.status,
                              confidenceScore: row.confidenceScore ?? null,
                              confidenceReason: row.confidenceReason ?? null,
                              usedRecommendationIds: row.usedRecommendationIds ?? [],
                            },
                          }));
                          const nextColumns = parseSourceColumns(candidate.sourceColumn!);
                          updateMapping(row.id, {
                            sourceColumn: candidate.sourceColumn,
                            sourceColumns: nextColumns,
                            mappingMode: "source",
                            constantValue: null,
                            status: nextColumns.length ? "MAPPED" : "UNMAPPED",
                            confidenceScore: candidate.confidence ?? null,
                            confidenceReason:
                              candidate.businessRationale
                              || candidate.evidenceSummary
                              || candidate.title,
                            usedRecommendationIds: Array.from(new Set([
                              ...(row.usedRecommendationIds ?? []),
                              candidate.recommendationId,
                            ])),
                          });
                          setRecommendationActionErrors((current) => {
                            const next = { ...current };
                            delete next[row.id];
                            return next;
                          });
                        } catch (error) {
                          setRecommendationActionErrors((current) => ({
                            ...current,
                            [row.id]: error instanceof Error
                              ? error.message
                              : 'The recommendation could not be previewed against the current workspace.',
                          }));
                        }
                      })();
                    }}
                    onPrepareSource={(candidate) => {
                      window.dispatchEvent(new CustomEvent('sttm:prepare-source', {
                        detail: {
                          targetColumn: row.targetColumn,
                          recommendationId: candidate.recommendationId,
                          missingDependencies: candidate.missingDependencies,
                        },
                      }));
                    }}
                    onKeepUnresolved={() => undefined}
                    recommendationUndoAvailable={Boolean(recommendationUndoByRow[row.id])}
                    recommendationActionError={recommendationActionErrors[row.id] ?? null}
                    onUndoRecommendation={() => {
                      const previous = recommendationUndoByRow[row.id];
                      if (!previous) return;
                      updateMapping(row.id, previous);
                      setRecommendationUndoByRow((current) => {
                        const next = { ...current };
                        delete next[row.id];
                        return next;
                      });
                    }}
                    width={columnWidths.sourceColumn}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.sourceColumn}
                    confidenceReason={row.confidenceReason}
                    businessMeaning={row.description ?? row.nlRule ?? null}
                    candidateSourceColumns={row.candidateSourceColumns}
                    sx={scrollableBodyCellSx}
                  />

                  <MappingRuleCell
                    value={resolveMappingRuleSelectValue(row.rule)}
                    options={RULE_OPTIONS}
                    configureValue={PREPROCESS_CONFIGURE_VALUE}
                    placeholder="Select rule..."
                    width={columnWidths.preProcessRule}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.preProcessRule}
                    preProcessDisabled={resolveMappingRuleSelectValue(row.rule) !== 'Custom'}
                    onRuleChange={(value) => handleRuleChange(row.id, value)}
                    onPreProcess={() => setPreProcessModalOpen(true, row.id)}
                    sx={scrollableBodyCellSx}
                  />

                  {showConfidenceColumn ? (
                    <MappingConfidenceCell
                      confidenceScore={row.confidenceScore}
                      status={row.status}
                      reason={row.confidenceReason}
                      businessMeaning={row.description ?? row.nlRule ?? null}
                      width={columnWidths.confidence}
                      minWidth={MAPPING_COLUMN_MIN_WIDTH.confidence}
                      sx={scrollableBodyCellSx}
                    />
                  ) : null}

                  <MappingTypePreviewCell
                    dataType={previewType}
                    width={columnWidths.typePreview}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.typePreview}
                    sx={scrollableBodyCellSx}
                  />

                  <AiaInputCell
                    placeholder="Add NL rule..."
                    value={row.nlRule ?? ''}
                    onChange={(value) => updateMapping(row.id, { nlRule: value })}
                    width={columnWidths.nlRule}
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
                    width={columnWidths.order}
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
                    width={columnWidths.description}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.description}
                    multiline
                    minRows={1}
                    maxRows={10}
                    inputSx={multilineCellInputSx}
                    sx={scrollableBodyCellSx}
                  />

                  <MappingStatusCell
                    status={isProcessing ? 'PROCESSING' : row.status}
                    width={columnWidths.status}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.status}
                    sx={scrollableBodyCellSx}
                  />

                  <MappingDataPreviewCell
                    mapping={row}
                    width={columnWidths.dataPreview}
                    minWidth={MAPPING_COLUMN_MIN_WIDTH.dataPreview}
                    sx={scrollableBodyCellSx}
                  />
                </AiaTableRowPrimitive>
                </React.Fragment>
              );
            })}
            {!paginatedMappings.length ? (
              <AiaTableRowPrimitive>
                <AiaTableCellPrimitive colSpan={visibleColumnKeys.length} sx={{ py: 4, textAlign: 'center' }}>
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
        page={safePage}
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
