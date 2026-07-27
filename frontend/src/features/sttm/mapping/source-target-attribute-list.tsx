'use client';
import { AiaBox, AiaButton, AiaCircularProgress } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import React, { useMemo, useState } from 'react';
import {
  AutoAwesomeRoundedIcon,
} from '@/utils/icons';

import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import { useAppDispatch } from '@/store/hooks';
import {
  fetchAttributes,
} from '@/features/sttm/store/sttm-builder-slice';
import { SelectedSourceHierarchyTree } from '@/features/sttm/shared/selected-source-hierarchy-tree';
import {
  getDerivedDisplayColumns,
} from '@/features/sttm/mapping/mapping-utils';
import type { Column, ColumnGroup } from '@/features/sttm/types/sttm.types';

import { useSidebarSlot } from '@/features/sttm/layout/sidebar-slot-context';
import { ResizableSidebarSections } from '@/features/sttm/layout/resizable-sidebar-sections';
import { SttmSidebarCollapseFooter } from '@/features/sttm/layout/sttm-sidebar-collapse-footer';
import { SttmSidebarCollapsedRail } from '@/features/sttm/layout/sttm-sidebar-collapsed-rail';
import { SttmSidebarSectionIcon } from '@/features/sttm/layout/sttm-sidebar-icons';
import { TOUR_TARGETS } from '@/features/tour/constants/tour-targets';
import { useTour } from '@/features/tour/engine/tour-context';
import { AiaSearchbox } from '@/components/ui/aia-searchbox';
import {
  sttmSidebarBodyTextMutedSx,
  sttmSidebarBodyTextSx,
  sttmSidebarSearchboxSx,
  sttmSidebarSearchInputSx,
} from '@/features/sttm/layout/sttm-sidebar-text-styles';

const primaryActionButtonSx = {
  boxShadow: 'none',
  '&:hover': {
    boxShadow: 'none',
  },
  '&.Mui-disabled': {
    color: '#ffffff',
    backgroundColor: '#64748b',
    borderColor: '#64748b',
    opacity: 0.7,
  },
} as const;

const stickyColumnControlsSx = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  px: 1.5,
  pt: 1,
  pb: 1,
  flexShrink: 0,
  backgroundColor: 'var(--color-surface)',
  borderBottom: '1px solid #eef2f7',
} as const;

type SourceTargetAttributeListProps = {
  embedded?: boolean;
};

const SourceTargetAttributeList = ({ embedded = false }: SourceTargetAttributeListProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [targetSearchTerm, setTargetSearchTerm] = useState('');
  const dispatch = useAppDispatch();
  const { setCollapsed, collapsed } = useSidebarSlot();

  const {
    fullData,
    sourceAttributeGroups,
    targetAttributeGroup,
    mappingSuggestions,
    sources,
    targets,
    loadState,
    errorState,
    derivedSources,
    runAutoMap,
    mappingLoading,
  } = useSttmBuilderContext();
  const { notifyTourContextChanged } = useTour();

  const selectedSources = sources.filter((t) => t.isSelected);
  const selectedTarget = targets.find((t) => t.isSelected);

  const sourceSidebarGroups = useMemo<ColumnGroup[]>(() => {
    const groups = new Map(
      sourceAttributeGroups.map((group) => [group.qualifiedName.toUpperCase(), group]),
    );
    for (const source of selectedSources) {
      if (!groups.has(source.qualifiedName.toUpperCase())) {
        groups.set(source.qualifiedName.toUpperCase(), {
          table: source.tableName,
          qualifiedName: source.qualifiedName,
          columns: source.columnItems ?? [],
        });
      }
    }
    for (const source of derivedSources.filter((item) => item.isSelected)) {
      const qualifiedName =
        source.physicalViewName || `DERIVED.DERIVED.${source.sourceName.replace(/\s+/g, '_')}`;
      groups.set(qualifiedName.toUpperCase(), {
        table: source.sourceName,
        qualifiedName,
        columns: getDerivedDisplayColumns(source),
      });
    }
    return Array.from(groups.values());
  }, [derivedSources, selectedSources, sourceAttributeGroups]);

  const targetSidebarGroups = useMemo<ColumnGroup[]>(() => {
    if (targetAttributeGroup) return [targetAttributeGroup];
    if (!selectedTarget) return [];
    return [{
      table: selectedTarget.tableName,
      qualifiedName: selectedTarget.qualifiedName,
      columns: selectedTarget.columnItems ?? [],
    }];
  }, [selectedTarget, targetAttributeGroup]);

  const hasSelectedSourceTables = selectedSources.length > 0;

  const hasAnySourceColumns = useMemo(
    () =>
      sourceSidebarGroups.some((group) => group.columns.length > 0) ||
      selectedSources.some((source) => (source.columnItems?.length ?? 0) > 0),
    [selectedSources, sourceSidebarGroups],
  );

  const suggestionByTarget = useMemo(() => {
    const map = new Map<string, (typeof mappingSuggestions)[number]>();
    for (const m of mappingSuggestions) {
      map.set(String(m.targetAttribute).toUpperCase(), m);
    }
    return map;
  }, [mappingSuggestions]);

  const retryLoadAttributes = () => {
    const sourceNames = selectedSources.map((table) => table.qualifiedName);
    if (sourceNames.length) {
      dispatch(fetchAttributes({ qualifiedNames: sourceNames, side: 'source' }));
    }
    if (selectedTarget) {
      dispatch(
        fetchAttributes({
          qualifiedNames: [selectedTarget.qualifiedName],
          side: 'target',
        }),
      );
    }
  };

  const attributesLoading = loadState.attributes === 'loading';
  const attributesError = errorState.attributes;
  const hasAvailableSourceColumns =
    hasSelectedSourceTables ||
    derivedSources.some((source) => source.isSelected && getDerivedDisplayColumns(source).length > 0);

  const hasTargetColumns = (targetAttributeGroup?.columns?.length ?? 0) > 0;

  const isTargetColumnMapped = (column: Column) => {
    const suggestion = suggestionByTarget.get(String(column.name || '').toUpperCase());
    return Boolean(suggestion && suggestion.sourceAttributes.length > 0);
  };

  const autoMapButton = (
    <AiaButton
      variant="contained"
      color="primary"
      data-tour={TOUR_TARGETS.sttmAutoMapButton}
      size="small"
      fullWidth
      disabled={mappingLoading || !hasAvailableSourceColumns}
      startIcon={<AutoAwesomeRoundedIcon sx={{ fontSize: 14 }} />}
      onClick={() => {
        void runAutoMap();
        window.setTimeout(() => notifyTourContextChanged(), 800);
      }}
      sx={{
        ...primaryActionButtonSx,
        width: '100%',
        height: 32,
        fontSize: '0.72rem',
        fontWeight: 700,
      }}
    >
      Auto
    </AiaButton>
  );

  const sourceColumnsContent = (
    <>
      <AiaBox sx={stickyColumnControlsSx}>
        <AiaBox sx={{ mb: 1 }}>{autoMapButton}</AiaBox>
        <AiaSearchbox
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search columns..."
          sx={sttmSidebarSearchboxSx}
          inputSx={sttmSidebarSearchInputSx}
        />
      </AiaBox>

      {attributesLoading && !hasAnySourceColumns ? (
        <AiaBox sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <AiaCircularProgress size={22} />
        </AiaBox>
      ) : null}

      {attributesError ? (
        <AiaBox sx={{ px: 1.5, py: 1 }}>
          <AiaText sx={{ ...sttmSidebarBodyTextSx, color: 'error.main' }}>{attributesError}</AiaText>
          <AiaButton
            size="small"
            onClick={() => retryLoadAttributes()}
            sx={{ mt: 1, textTransform: 'none', ...sttmSidebarBodyTextSx, color: 'var(--color-primary-save)' }}
          >
            Retry
          </AiaButton>
        </AiaBox>
      ) : null}

      {!attributesLoading && !hasSelectedSourceTables && !attributesError && !selectedSources.length ? (
        <AiaText sx={{ ...sttmSidebarBodyTextMutedSx, px: 1, py: 0.5 }}>
          Select one or more source tables in Step 1 to load columns here.
        </AiaText>
      ) : null}

      {!attributesLoading &&
      hasSelectedSourceTables &&
      !hasAnySourceColumns &&
      !attributesError &&
      !searchTerm.trim() ? (
        <AiaText sx={{ ...sttmSidebarBodyTextMutedSx, px: 1, py: 0.5 }}>
          Columns are still loading for the selected source tables.
        </AiaText>
      ) : null}

      <SelectedSourceHierarchyTree
        databases={fullData?.sources ?? []}
        attributeGroups={sourceSidebarGroups}
        searchText={searchTerm}
      />
    </>
  );

  const targetColumnsContent = (
    <>
      <AiaBox sx={stickyColumnControlsSx}>
        <AiaSearchbox
          value={targetSearchTerm}
          onChange={setTargetSearchTerm}
          placeholder="Search columns..."
          sx={sttmSidebarSearchboxSx}
          inputSx={sttmSidebarSearchInputSx}
        />
      </AiaBox>

      {attributesLoading && selectedTarget && !hasTargetColumns ? (
        <AiaBox sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <AiaCircularProgress size={22} />
        </AiaBox>
      ) : null}

      {attributesError ? (
        <AiaBox sx={{ px: 1.5, py: 1 }}>
          <AiaText sx={{ ...sttmSidebarBodyTextSx, color: 'error.main' }}>{attributesError}</AiaText>
          <AiaButton
            size="small"
            onClick={() => retryLoadAttributes()}
            sx={{ mt: 1, textTransform: 'none', ...sttmSidebarBodyTextSx, color: 'var(--color-primary-save)' }}
          >
            Retry
          </AiaButton>
        </AiaBox>
      ) : null}

      {!attributesLoading && !selectedTarget && !attributesError ? (
        <AiaText sx={{ ...sttmSidebarBodyTextMutedSx, px: 1, py: 0.5 }}>
          Select a target table in Step 1 to load columns here.
        </AiaText>
      ) : null}

      {!attributesLoading &&
      selectedTarget &&
      !hasTargetColumns &&
      !attributesError &&
      !targetSearchTerm.trim() ? (
        <AiaText sx={{ ...sttmSidebarBodyTextMutedSx, px: 1, py: 0.5 }}>
          Columns are still loading for the selected target table.
        </AiaText>
      ) : null}

      <SelectedSourceHierarchyTree
        databases={fullData?.targets ?? []}
        attributeGroups={targetSidebarGroups}
        searchText={targetSearchTerm}
        isColumnHighlighted={isTargetColumnMapped}
        showColumnMeta={false}
      />
    </>
  );

  if (embedded && collapsed) {
    return (
      <AiaBox
        sx={{
          width: '100%',
          height: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--color-surface)',
          overflow: 'hidden',
        }}
      >
        <SttmSidebarCollapsedRail
          items={[
            { kind: 'source', label: 'Selected Source' },
            { kind: 'target', label: 'Selected Target' },
          ]}
        />
      </AiaBox>
    );
  }

  return (
    <AiaBox
      data-tour={TOUR_TARGETS.sttmSourceColumnsPanel}
      sx={{
        width: '100%',
        minWidth: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--color-surface)',
        borderRight: embedded ? 'none' : '1px solid #e5e7eb',
        overflow: 'hidden',
      }}
    >
      <AiaBox sx={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <ResizableSidebarSections
          sections={[
            {
              id: 'source-columns',
              title: 'Source Selected',
              icon: <SttmSidebarSectionIcon kind="source" />,
              content: sourceColumnsContent,
            },
            {
              id: 'target-columns',
              title: 'Target Selected',
              icon: <SttmSidebarSectionIcon kind="target" />,
              content: targetColumnsContent,
            },
          ]}
          defaultExpanded={{ 'source-columns': true, 'target-columns': true }}
        />
      </AiaBox>

      <SttmSidebarCollapseFooter
        collapsed={false}
        collapseLabel="Collapse sidebar"
        onToggle={() => setCollapsed(true)}
      />
    </AiaBox>
  );
};

export default SourceTargetAttributeList;
