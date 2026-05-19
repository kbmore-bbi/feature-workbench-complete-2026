'use client';

import React, { useMemo, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  Chip,
  Divider,
  Paper,
  InputAdornment,
  CircularProgress,
  Button,
} from '@mui/material';
import {
  Search as SearchIcon,
  ExpandMore as ExpandMoreIcon,
  TableChart as TableIcon,
  FiberManualRecord as DotIcon,
} from '@mui/icons-material';
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import RadioButtonUncheckedRoundedIcon from "@mui/icons-material/RadioButtonUncheckedRounded";
import IconButton from "@mui/material/IconButton";
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import { useAppDispatch } from '@/store/hooks';
import { fetchAttributes } from '@/features/sttm/store/sttm-builder-slice';
import type { DerivedSource } from '@/features/sttm/types/sttm.types';

function typeChipSx(dataType?: string) {
  const t = (dataType || '').toUpperCase();
  const isNumeric =
    t.includes('INT') ||
    t.includes('NUM') ||
    t.includes('DEC') ||
    t.includes('FLOAT') ||
    t.includes('DOUBLE') ||
    t === 'NUMBER';
  return {
    height: 18,
    fontSize: '0.65rem',
    borderRadius: '4px',
    bgcolor: isNumeric ? '#2c3e50' : '#f0f0f0',
    color: isNumeric ? '#fff' : '#666',
  } as const;
}

function derivedTypeChipSx() {
  return {
    height: 18,
    fontSize: '0.65rem',
    borderRadius: '4px',
    bgcolor: '#dcfce7',
    color: '#166534',
    border: '1px solid #bbf7d0',
  } as const;
}

function getDerivedDisplayColumns(source: DerivedSource): Array<{ name: string; type: string }> {
  if (source.previewColumns?.length) {
    return source.previewColumns.map((c) => ({
      name: c.name,
      type: c.dataType || '—',
    }));
  }
  return (source.columns ?? [])
    .filter((c) => c.name)
    .map((c) => ({
      name: String(c.name),
      type: c.type ?? '—',
    }));
}

const SourceTargetAttributeList = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const dispatch = useAppDispatch();

  const {
    sourceAttributeGroups,
    targetAttributeGroup,
    mappingSuggestions,
    sources,
    targets,
    sourceInfo,
    targetInfo,
    loadState,
    errorState,
    derivedSources,
    toggleDerivedSource,
  } = useSttmBuilderContext();

  const selectedSources = sources.filter((t) => t.isSelected);
  const selectedTarget = targets.find((t) => t.isSelected);

  const suggestionByTarget = useMemo(() => {
    const map = new Map<string, (typeof mappingSuggestions)[number]>();
    for (const m of mappingSuggestions) {
      map.set(String(m.targetAttribute).toUpperCase(), m);
    }
    return map;
  }, [mappingSuggestions]);

  const filteredSourceGroups = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) {
      return sourceAttributeGroups;
    }
    return sourceAttributeGroups
      .map((group) => {
        const tableMatch = (group.table || '').toLowerCase().includes(q);
        const columns = tableMatch
          ? group.columns
          : group.columns.filter((col) =>
              String(col.name || '').toLowerCase().includes(q)
            );
        return { ...group, columns };
      })
      .filter((group) => group.columns.length > 0);
  }, [sourceAttributeGroups, searchTerm]);

  const filteredDerivedSources = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) {
      return derivedSources;
    }
    return derivedSources.filter((d) => {
      if (d.sourceName.toLowerCase().includes(q)) {
        return true;
      }
      const cols = getDerivedDisplayColumns(d);
      return cols.some((c) => c.name.toLowerCase().includes(q));
    });
  }, [derivedSources, searchTerm]);

  const retryLoadAttributes = () => {
    const sourceNames = selectedSources.map((t) => t.qualifiedName);
    if (sourceNames.length) {
      dispatch(fetchAttributes({ qualifiedNames: sourceNames, side: 'source' }));
    }
    if (selectedTarget) {
      dispatch(
        fetchAttributes({
          qualifiedNames: [selectedTarget.qualifiedName],
          side: 'target',
        })
      );
    }
  };

  const attributesLoading = loadState.attributes === 'loading';
  const attributesError = errorState.attributes;

  const schemaLabel =
    sourceInfo.schemaName?.trim() ||
    (sourceAttributeGroups[0]?.qualifiedName
      ? sourceAttributeGroups[0].qualifiedName.split('.')[1]
      : '') ||
    '—';

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: '#fff',
        borderRight: '1px solid #e0e0e0',
      }}
    >
      {/* 1. HEADER & SEARCH */}
      <Box sx={{ p: 2, flexShrink: 0 }}>
        <Box sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#111827', mb: 2 }}>
            STTM Builder
          </Typography>

          <Box className="flex h-[38px] items-center justify-between rounded-full bg-[#F3F4F6] px-4">
            <Typography className="text-[13px] font-medium text-[var(--color-text)]">
              Cortex
            </Typography>
            <KeyboardArrowDownRoundedIcon sx={{ fontSize: 18, color: '#4B5563' }} />
          </Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: '0.9rem', color: '#333' }}>
            Source columns
          </Typography>
        </Box>
        <TextField
          fullWidth
          size="small"
          placeholder="Search columns..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 18, color: '#aaa' }} />
                </InputAdornment>
              ),
              sx: {
                fontSize: '0.8rem',
                bgcolor: '#f5f5f5',
                borderRadius: '8px',
                '& fieldset': { border: 'none' },
              },
            },
          }}
        />
      </Box>

      {/* 2. SCROLLABLE SOURCE LIST */}
      <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto' }}>
        <Typography
          variant="overline"
          sx={{
            px: 2,
            py: 1,
            display: 'block',
            color: '#bbb',
            fontWeight: 700,
            letterSpacing: 1,
          }}
        >
          {schemaLabel}
        </Typography>

        {attributesLoading && !sourceAttributeGroups.length ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : null}

        {attributesError ? (
          <Box sx={{ px: 2, py: 1 }}>
            <Typography sx={{ fontSize: '0.75rem', color: 'error.main' }}>{attributesError}</Typography>
            <Button size="small" onClick={() => retryLoadAttributes()} sx={{ mt: 1, textTransform: 'none' }}>
              Retry
            </Button>
          </Box>
        ) : null}

        {!attributesLoading &&
        !filteredSourceGroups.length &&
        !attributesError &&
        !selectedSources.length ? (
          <Typography sx={{ px: 2, py: 1, fontSize: '0.75rem', color: '#888' }}>
            Select one or more source tables in Step 1 to load columns here.
          </Typography>
        ) : null}

        {!attributesLoading &&
        !filteredSourceGroups.length &&
        selectedSources.length > 0 &&
        !attributesError ? (
          <Typography sx={{ px: 2, py: 1, fontSize: '0.75rem', color: '#888' }}>
            No columns match your search, or attributes are still loading for the selected tables.
          </Typography>
        ) : null}

        {filteredSourceGroups.map((group) => (
          <Accordion
            key={group.qualifiedName}
            disableGutters
            elevation={0}
            defaultExpanded
            sx={{ '&:before': { display: 'none' } }}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ fontSize: 18 }} />}
              sx={{ minHeight: 40, px: 2 }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', minWidth: 0 }}>
                <DotIcon sx={{ fontSize: 8, color: '#333', flexShrink: 0 }} />
                <Typography sx={{ fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {group.table}
                </Typography>
                <Typography sx={{ ml: 'auto', fontSize: '0.75rem', color: '#bbb', flexShrink: 0 }}>
                  {group.columns.length} cols
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
              <List dense disablePadding>
                {group.columns.map((col) => (
                  <ListItem
                    key={`${group.qualifiedName}:${col.name}`}
                    sx={{ py: 0.5, px: 4, display: 'flex', justifyContent: 'space-between' }}
                  >
                    <Typography sx={{ fontSize: '0.75rem', color: '#666', pr: 1 }}>{col.name}</Typography>
                    <Chip label={col.type || '—'} size="small" sx={typeChipSx(col.type)} />
                  </ListItem>
                ))}
              </List>
            </AccordionDetails>
          </Accordion>
        ))}

        {/* Derived sources (from Add derived modal / API) */}
        <Box sx={{ mt: 1.5, borderTop: '1px solid #f1f5f9', pt: 1 }}>
          <Typography
            variant="overline"
            sx={{
              px: 2,
              py: 0.75,
              display: 'block',
              color: '#64748b',
              fontWeight: 800,
              letterSpacing: '0.08em',
            }}
          >
            Derived sources
          </Typography>

          {!derivedSources.length ? (
            <Typography sx={{ px: 2, py: 0.5, fontSize: '0.75rem', color: '#94a3b8' }}>
              No derived tables yet. Create one from Step 1 (Add derived source).
            </Typography>
          ) : !filteredDerivedSources.length ? (
            <Typography sx={{ px: 2, py: 0.5, fontSize: '0.75rem', color: '#888' }}>
              No derived sources match your search.
            </Typography>
          ) : (
            filteredDerivedSources.map((source) => {
              const displayCols = getDerivedDisplayColumns(source);
              const colCount = displayCols.length;
              return (
                <Accordion
                  key={source.id}
                  disableGutters
                  elevation={0}
                  defaultExpanded={Boolean(source.isSelected)}
                  sx={{
                    '&:before': { display: 'none' },
                    bgcolor: source.isSelected ? 'rgba(220,252,231,0.35)' : 'transparent',
                  }}
                >
                  <AccordionSummary
                    expandIcon={<ExpandMoreIcon sx={{ fontSize: 18 }} />}
                    sx={{ minHeight: 44, px: 1, pr: 1.5 }}
                  >
                    <Box
                      sx={{ display: 'flex', alignItems: 'center', gap: 0.75, width: '100%', minWidth: 0 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <IconButton
                        size="small"
                        aria-label={source.isSelected ? 'Deselect derived source' : 'Select derived source'}
                        onClick={() => toggleDerivedSource(source.id)}
                        sx={{ p: 0.25 }}
                      >
                        {source.isSelected ? (
                          <CheckCircleRoundedIcon sx={{ fontSize: 18, color: '#16a34a' }} />
                        ) : (
                          <RadioButtonUncheckedRoundedIcon sx={{ fontSize: 18, color: '#22c55e' }} />
                        )}
                      </IconButton>
                      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                        <DotIcon sx={{ fontSize: 8, color: '#166534', flexShrink: 0 }} />
                        <Typography
                          sx={{
                            fontWeight: 700,
                            fontSize: '0.8rem',
                            color: '#14532d',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {source.sourceName}
                        </Typography>
                        <Chip
                          label="Derived"
                          size="small"
                          sx={{
                            height: 20,
                            fontSize: '0.6rem',
                            fontWeight: 800,
                            bgcolor: '#bbf7d0',
                            color: '#14532d',
                            border: 'none',
                          }}
                        />
                        <Typography sx={{ ml: 'auto', fontSize: '0.7rem', color: '#94a3b8', flexShrink: 0 }}>
                          {colCount} cols
                        </Typography>
                      </Box>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ p: 0, pt: 0, pb: 1 }}>
                    {colCount ? (
                      <List dense disablePadding>
                        {displayCols.map((col) => (
                          <ListItem
                            key={`${source.id}:${col.name}`}
                            sx={{ py: 0.45, px: 4, display: 'flex', justifyContent: 'space-between' }}
                          >
                            <Typography sx={{ fontSize: '0.75rem', color: '#334155', pr: 1 }}>
                              {col.name}
                            </Typography>
                            <Chip label={col.type} size="small" sx={derivedTypeChipSx()} />
                          </ListItem>
                        ))}
                      </List>
                    ) : (
                      <Typography sx={{ px: 4, py: 0.5, fontSize: '0.7rem', color: '#94a3b8' }}>
                        No columns loaded — open the derived source in Step 1 and validate SQL to preview columns.
                      </Typography>
                    )}
                  </AccordionDetails>
                </Accordion>
              );
            })
          )}
        </Box>
      </Box>

      <Divider />

      {/* 3. TARGET TABLE SECTION */}
      <Box className="bg-[var(--color-header-bg)]" sx={{ p: 2, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography
            variant="subtitle1"
            sx={{ fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 1 }}
          >
            <TableIcon sx={{ fontSize: 18 }} /> Target table
          </Typography>
          {selectedTarget && targetAttributeGroup?.columns?.length ? (
            <Chip label="Set" size="small" variant="outlined" color="success" sx={{ height: 20, fontSize: '0.7rem' }} />
          ) : (
            <Chip label="Pending" size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
          )}
        </Box>

        <Typography variant="overline" sx={{ color: '#bbb', fontSize: '0.65rem', display: 'block', mb: 0.5 }}>
          SELECTED TARGET
        </Typography>
        <Paper
          variant="outlined"
          sx={{
            p: 1,
            mb: 2,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            bgcolor: '#fff',
            borderRadius: '8px',
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" sx={{ color: '#bbb', display: 'block', lineHeight: 1 }}>
              {targetInfo.dbName || '—'}
            </Typography>
            <Typography sx={{ fontSize: '0.8rem', fontWeight: 700 }}>
              {selectedTarget?.tableName ?? targetAttributeGroup?.table ?? 'Select a target table'}
            </Typography>
          </Box>
          <ExpandMoreIcon sx={{ color: '#ccc', flexShrink: 0 }} />
        </Paper>

        <Typography variant="overline" sx={{ color: '#bbb', fontSize: '0.65rem', display: 'block', mb: 0.5 }}>
          TARGET COLUMNS
        </Typography>
        <Box sx={{ maxHeight: 300, overflowY: 'auto' }}>
          {attributesLoading && !targetAttributeGroup?.columns?.length ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={20} />
            </Box>
          ) : null}

          {!selectedTarget ? (
            <Typography sx={{ fontSize: '0.75rem', color: '#888' }}>
              Select a target table in Step 1 to load columns.
            </Typography>
          ) : null}

          {selectedTarget && !targetAttributeGroup?.columns?.length && !attributesLoading ? (
            <Typography sx={{ fontSize: '0.75rem', color: '#888' }}>
              No columns loaded yet for this target.
            </Typography>
          ) : null}

          {(targetAttributeGroup?.columns ?? []).map((col) => {
            const sug = suggestionByTarget.get(String(col.name || '').toUpperCase());
            const mapped = Boolean(sug && sug.sourceAttributes.length > 0);
            return (
              <Box
                key={col.name}
                sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                  <DotIcon sx={{ fontSize: 10, color: mapped ? '#2ecc71' : '#ddd', flexShrink: 0 }} />
                  <Typography
                    sx={{
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      color: mapped ? '#333' : '#999',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {col.name}
                  </Typography>
                </Box>
                <Typography sx={{ fontSize: '0.7rem', color: '#ccc', flexShrink: 0, ml: 1 }}>
                  {col.type || '—'}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
};

export default SourceTargetAttributeList;
