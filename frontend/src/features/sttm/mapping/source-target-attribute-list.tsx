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
  FiberManualRecord as DotIcon,
  TableChart as TableIcon,
} from '@mui/icons-material';
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import KeyboardDoubleArrowLeftRoundedIcon from '@mui/icons-material/KeyboardDoubleArrowLeftRounded';
import RadioButtonUncheckedRoundedIcon from "@mui/icons-material/RadioButtonUncheckedRounded";
import IconButton from "@mui/material/IconButton";
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import { useAppDispatch } from '@/store/hooks';
import { fetchAttributes } from '@/features/sttm/store/sttm-builder-slice';
import { getDerivedDisplayColumns, typeChipSx } from '@/features/sttm/mapping/mapping-utils';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import { useSidebarSlot } from '@/features/sttm/layout/sidebar-slot-context';

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

type SourceTargetAttributeListProps = {
  embedded?: boolean;
};

const SourceTargetAttributeList = ({ embedded = false }: SourceTargetAttributeListProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const dispatch = useAppDispatch();
  const { setCollapsed } = useSidebarSlot();

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
    runAutoMap,
    mappingLoading,
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
  const hasAvailableSourceColumns =
    sourceAttributeGroups.length > 0 ||
    derivedSources.some((source) => source.isSelected && getDerivedDisplayColumns(source).length > 0);

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
        borderRight: embedded ? 'none' : '1px solid #e0e0e0',
        borderBottom: embedded ? 'none' : undefined,
        overflow: 'hidden',
      }}
    >
      <Box sx={{ p: embedded ? 1.5 : 2, flexShrink: 0 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            mb: embedded ? 1.25 : 2,
          }}
        >
          <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#111827', minWidth: 0 }}>
            STTM Builder
          </Typography>
          <IconButton
            size="small"
            onClick={() => setCollapsed(true)}
            sx={{
              color: '#64748b',
              border: '1px solid #dbe2ea',
              borderRadius: '10px',
              flexShrink: 0,
            }}
          >
            <KeyboardDoubleArrowLeftRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>

        <Box className="flex h-[38px] items-center justify-between rounded-full bg-[#F3F4F6] px-4">
          <Typography className="text-[13px] font-medium" sx={{ color: "var(--color-text)" }}>
            Cortex
          </Typography>
          <KeyboardArrowDownRoundedIcon sx={{ fontSize: 18, color: '#4B5563' }} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mt: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#333' }}>
            Source columns
          </Typography>
          <Button
            size="small"
            variant="contained"
            disabled={mappingLoading || !hasAvailableSourceColumns}
            startIcon={<AutoAwesomeRoundedIcon sx={{ fontSize: 14 }} />}
            onClick={() => runAutoMap()}
            sx={{
              minWidth: 0,
              px: 1.25,
              height: 28,
              fontSize: '0.72rem',
              fontWeight: 700,
              textTransform: 'none',
              bgcolor: '#111827',
              color: '#ffffff',
              border: '1px solid #111827',
              boxShadow: 'none',
              '&:hover': {
                bgcolor: '#1f2937',
                borderColor: '#1f2937',
                boxShadow: 'none',
              },
              '&.Mui-disabled': {
                bgcolor: '#9ca3af',
                borderColor: '#9ca3af',
                color: '#ffffff',
              },
              '&:focus-visible': {
                outline: '2px solid #111827',
                outlineOffset: 1,
              },
            }}
          >
            Auto
          </Button>
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

      <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
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
                <Typography
                  sx={{
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    minWidth: 0,
                    whiteSpace: 'normal',
                    overflowWrap: 'anywhere',
                    lineHeight: 1.3,
                  }}
                >
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
                    sx={{ py: 0.75, px: 4, display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'flex-start' }}
                  >
                    <Typography
                      sx={{
                        fontSize: '0.75rem',
                        color: '#666',
                        pr: 1,
                        minWidth: 0,
                        whiteSpace: 'normal',
                        overflowWrap: 'anywhere',
                        lineHeight: 1.35,
                      }}
                    >
                      {col.name}
                    </Typography>
                    <Chip label={col.type || '—'} size="small" sx={typeChipSx(col.type)} />
                  </ListItem>
                ))}
              </List>
            </AccordionDetails>
          </Accordion>
        ))}

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
                    >
                      <IconButton
                        component="span"
                        size="small"
                        aria-label={source.isSelected ? 'Deselect derived source' : 'Select derived source'}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleDerivedSource(source.id);
                        }}
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
                            minWidth: 0,
                            whiteSpace: 'normal',
                            overflowWrap: 'anywhere',
                            lineHeight: 1.3,
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
                            sx={{ py: 0.45, px: 4, display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'flex-start' }}
                          >
                            <Typography
                              sx={{
                                fontSize: '0.75rem',
                                color: '#334155',
                                pr: 1,
                                minWidth: 0,
                                whiteSpace: 'normal',
                                overflowWrap: 'anywhere',
                                lineHeight: 1.35,
                              }}
                            >
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

      <Box sx={{ p: 2, flexShrink: 0, backgroundColor: "var(--color-header-bg)" }}>
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
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" sx={{ color: '#bbb', display: 'block', lineHeight: 1 }}>
              {targetInfo.dbName || '—'}
            </Typography>
            <Typography
              sx={{
                fontSize: '0.8rem',
                fontWeight: 700,
                whiteSpace: 'normal',
                overflowWrap: 'anywhere',
                lineHeight: 1.35,
              }}
            >
              {selectedTarget?.tableName ?? targetAttributeGroup?.table ?? 'Select a target table'}
            </Typography>
          </Box>
          <ExpandMoreIcon sx={{ color: '#ccc', flexShrink: 0 }} />
        </Paper>

        <Typography variant="overline" sx={{ color: '#bbb', fontSize: '0.65rem', display: 'block', mb: 0.5 }}>
          TARGET COLUMNS
        </Typography>
        <Box sx={{ maxHeight: 300, overflowY: 'auto', overflowX: 'hidden' }}>
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
                      whiteSpace: 'normal',
                      overflowWrap: 'anywhere',
                      lineHeight: 1.35,
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
