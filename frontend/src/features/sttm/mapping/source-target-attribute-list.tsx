'use client';
import React, { useMemo, useState } from 'react';
import {
  AutoAwesomeRoundedIcon,
  KeyboardDoubleArrowLeftRoundedIcon,
  TableChartOutlinedIcon,
} from '@/utils/icons';
import {
  Box,
  Typography,
  List,
  ListItem,
  CircularProgress,
  Button,
} from '@mui/material';



import IconButton from "@mui/material/IconButton";
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import { useAppDispatch } from '@/store/hooks';
import {
  collectSelectedSourceQualifiedNames,
  fetchAttributes,
} from '@/features/sttm/store/sttm-builder-slice';
import { SelectedSourceHierarchyTree } from '@/features/sttm/shared/selected-source-hierarchy-tree';
import {
  formatSqlType,
  getDerivedDisplayColumns,
} from '@/features/sttm/mapping/mapping-utils';
import type { Column } from '@/features/sttm/types/sttm.types';

import { useSidebarSlot } from '@/features/sttm/layout/sidebar-slot-context';
import { ResizableSidebarSections } from '@/features/sttm/layout/resizable-sidebar-sections';
import { AiaSearchbox } from '@/components/ui/aia-searchbox';
import { AiaButton } from '@/components/ui/aia-button';

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

type SourceTargetAttributeListProps = {
  embedded?: boolean;
};

function AttributeColumnRow({
  column,
  mapped = false,
}: {
  column: Column;
  mapped?: boolean;
}) {
  const typeLabel = (column.type ? formatSqlType(column.type) : '—').toLowerCase();

  return (
    <ListItem
      sx={{
        py: 0.65,
        px: 2,
        display: 'flex',
        alignItems: 'flex-start',
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              fontSize: 12,
              fontWeight: mapped ? 600 : 500,
              color: mapped ? 'var(--color-text)' : 'var(--color-text)',
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {column.name}
          </Typography>
          <Typography
            sx={{
              mt: 0.15,
              fontSize: 10,
              color: 'var(--color-muted)',
              lineHeight: 1.2,
              textTransform: 'lowercase',
              letterSpacing: '0.05em',
            }}
          >
            {typeLabel}
          </Typography>
        </Box>
      </Box>
    </ListItem>
  );
}

const SourceTargetAttributeList = ({ embedded = false }: SourceTargetAttributeListProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const dispatch = useAppDispatch();
  const { setCollapsed } = useSidebarSlot();

  const {
    fullData,
    sourceAttributeGroups,
    targetAttributeGroup,
    mappingSuggestions,
    sources,
    targets,
    targetInfo,
    loadState,
    errorState,
    derivedSources,
    runAutoMap,
    mappingLoading,
  } = useSttmBuilderContext();

  const selectedSources = sources.filter((t) => t.isSelected);
  const selectedTarget = targets.find((t) => t.isSelected);

  const hasSelectedSourceTables = selectedSources.length > 0;

  const hasAnySourceColumns = useMemo(
    () =>
      sourceAttributeGroups.some((group) => group.columns.length > 0) ||
      selectedSources.some((source) => (source.columnItems?.length ?? 0) > 0),
    [sourceAttributeGroups, selectedSources],
  );

  const suggestionByTarget = useMemo(() => {
    const map = new Map<string, (typeof mappingSuggestions)[number]>();
    for (const m of mappingSuggestions) {
      map.set(String(m.targetAttribute).toUpperCase(), m);
    }
    return map;
  }, [mappingSuggestions]);

  const retryLoadAttributes = () => {
    const sourceNames = collectSelectedSourceQualifiedNames(fullData?.sources ?? []);
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

  const autoMapButton = (
    <AiaButton
      size="small"
      fullWidth
      disabled={mappingLoading || !hasAvailableSourceColumns}
      startIcon={<AutoAwesomeRoundedIcon sx={{ fontSize: 14 }} />}
      onClick={() => runAutoMap()}
      customColor="#ffffff"
      customBackgroundColor="#0f172a"
      customHoverBackgroundColor="#1e293b"
      customBorderColor="#0f172a"
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
      <Box sx={{ px: 1, pt: 0.5, pb: 1, flexShrink: 0 }}>
        <Box sx={{ mb: 1 }}>{autoMapButton}</Box>
        <AiaSearchbox
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search columns..."
          inputSx={{
            '& .MuiInputBase-input': {
              fontSize: '0.8rem',
            },
          }}
        />
      </Box>

      {attributesLoading && !hasSelectedSourceTables ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={24} />
        </Box>
      ) : null}

      {attributesError ? (
        <Box sx={{ px: 1.5, py: 1 }}>
          <Typography sx={{ fontSize: '0.75rem', color: 'error.main' }}>{attributesError}</Typography>
          <Button size="small" onClick={() => retryLoadAttributes()} sx={{ mt: 1, textTransform: 'none' }}>
            Retry
          </Button>
        </Box>
      ) : null}

      {!attributesLoading && !hasSelectedSourceTables && !attributesError && !selectedSources.length ? (
        <Typography sx={{ px: 1.5, py: 1, fontSize: 11, color: 'var(--color-muted)' }}>
          Select one or more source tables in Step 1 to load columns here.
        </Typography>
      ) : null}

      {!attributesLoading &&
      hasSelectedSourceTables &&
      !hasAnySourceColumns &&
      !attributesError &&
      !searchTerm.trim() ? (
        <Typography sx={{ px: 1.5, py: 1, fontSize: 11, color: 'var(--color-muted)' }}>
          Columns are still loading for the selected source tables.
        </Typography>
      ) : null}

      <SelectedSourceHierarchyTree
        databases={fullData?.sources ?? []}
        attributeGroups={sourceAttributeGroups}
        searchText={searchTerm}
      />

    </>
  );

  const targetColumnCount = targetAttributeGroup?.columns?.length ?? 0;

  const targetTableContent = (
    <>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 0.75,
          minHeight: 40,
          mx: 0.5,
          mb: 0.5,
          borderRadius: '6px',
          borderLeft: selectedTarget ? '3px solid var(--color-primary-save)' : '3px solid transparent',
          backgroundColor: selectedTarget ? 'var(--color-surface-muted)' : 'transparent',
        }}
      >
        <TableChartOutlinedIcon
          sx={{
            fontSize: 14,
            color: selectedTarget ? 'var(--color-primary-save)' : 'var(--color-muted)',
            flexShrink: 0,
          }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {selectedTarget ? (
            <>
              <Typography
                sx={{
                  fontSize: 10,
                  color: 'var(--color-muted)',
                  lineHeight: 1.2,
                  letterSpacing: '0.02em',
                }}
              >
                {[targetInfo.dbName, targetInfo.schemaName].filter(Boolean).join(' · ') || '—'}
              </Typography>
              <Typography
                sx={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--color-text)',
                  lineHeight: 1.3,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {selectedTarget.tableName}
              </Typography>
            </>
          ) : (
            <Typography sx={{ fontSize: 12, color: 'var(--color-muted)' }}>
              Select a target table
            </Typography>
          )}
        </Box>
        {selectedTarget ? (
          <Typography sx={{ fontSize: 11, color: 'var(--color-muted)', flexShrink: 0 }}>
            {targetColumnCount} cols
          </Typography>
        ) : null}
      </Box>

      <Box sx={{ px: 0.5, pb: 0.5 }}>
        {attributesLoading && !targetAttributeGroup?.columns?.length ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={20} />
          </Box>
        ) : null}

        {!selectedTarget ? (
          <Typography sx={{ px: 1, py: 0.5, fontSize: 11, color: 'var(--color-muted)' }}>
            Select a target table in Step 1 to load columns.
          </Typography>
        ) : null}

        {selectedTarget && !targetAttributeGroup?.columns?.length && !attributesLoading ? (
          <Typography sx={{ px: 1, py: 0.5, fontSize: 11, color: 'var(--color-muted)' }}>
            No columns loaded yet for this target.
          </Typography>
        ) : null}

        {(targetAttributeGroup?.columns ?? []).length > 0 ? (
          <List dense disablePadding>
            {(targetAttributeGroup?.columns ?? []).map((col) => {
              const sug = suggestionByTarget.get(String(col.name || '').toUpperCase());
              const mapped = Boolean(sug && sug.sourceAttributes.length > 0);
              return (
                <AttributeColumnRow
                  key={col.name}
                  column={col}
                  mapped={mapped}
                />
              );
            })}
          </List>
        ) : null}
      </Box>
    </>
  );

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--color-surface)',
        borderRight: embedded ? 'none' : '1px solid #e5e7eb',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <ResizableSidebarSections
          sections={[
            {
              id: 'source-columns',
              title: 'Source Columns',
              content: sourceColumnsContent,
            },
            {
              id: 'target-table',
              title: 'Target Table',
              content: targetTableContent,
            },
          ]}
          defaultExpanded={{ 'source-columns': true, 'target-table': true }}
        />
      </Box>

      <Box
        sx={{
          px: 1.5,
          py: 1,
          display: 'flex',
          justifyContent: 'flex-start',
          alignItems: 'center',
          flexShrink: 0,
          borderTop: '1px solid #eef2f7',
          backgroundColor: 'var(--color-surface)',
        }}
      >
        <IconButton
          size="small"
          aria-label="Collapse sidebar"
          onClick={() => setCollapsed(true)}
          sx={{
            width: 32,
            height: 32,
            color: '#64748b',
            border: '1px solid #dbe2ea',
            borderRadius: '50%',
            p: 0,
          }}
        >
          <KeyboardDoubleArrowLeftRoundedIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Box>
    </Box>
  );
};

export default SourceTargetAttributeList;
