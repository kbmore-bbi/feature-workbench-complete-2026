'use client';

import React, { useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  Divider,
  InputAdornment,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Search as SearchIcon,
  TableChart as TableIcon,
  FiberManualRecord as DotIcon,
} from '@mui/icons-material';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';

import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';

const SourceTargetAttributeList = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const { sourceAttributeGroups, targetAttributeGroup, mappingSuggestions } = useSttmBuilderContext();

  const filteredGroups = useMemo(() => {
    const lowered = searchTerm.trim().toLowerCase();
    if (!lowered) {
      return sourceAttributeGroups;
    }

    return sourceAttributeGroups
      .map((group) => ({
        ...group,
        columns: group.columns.filter(
          (column) =>
            column.name.toLowerCase().includes(lowered) ||
            group.table.toLowerCase().includes(lowered)
        ),
      }))
      .filter((group) => group.columns.length > 0);
  }, [searchTerm, sourceAttributeGroups]);

  return (
    <Box
      sx={{
        width: '100%',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: '#fff',
        borderRight: '1px solid #e0e0e0',
      }}
    >
      <Box sx={{ p: 2 }}>
        <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#111827', mb: 2 }}>
          STTM Builder
        </Typography>

        <Box className="flex h-[38px] items-center justify-between rounded-full bg-[#F3F4F6] px-4">
          <Typography className="text-[13px] font-medium text-[var(--color-text)]">
            Cortex
          </Typography>
          <KeyboardArrowDownRoundedIcon sx={{ fontSize: 18, color: '#4B5563' }} />
        </Box>

        <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: '0.9rem', color: '#333', mt: 2 }}>
          Source Columns
        </Typography>

        <TextField
          fullWidth
          size="small"
          placeholder="Search columns..."
          onChange={(event) => setSearchTerm(event.target.value)}
          sx={{ mt: 1.5 }}
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

      <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
        <Typography variant="overline" sx={{ px: 2, py: 1, display: 'block', color: '#bbb', fontWeight: 700, letterSpacing: 1 }}>
          SELECTED SOURCE TABLES
        </Typography>

        {filteredGroups.map((group) => {
          const mappedCount = mappingSuggestions.reduce((count, suggestion) => {
            return count + suggestion.sourceAttributes.filter((value) => value.startsWith(group.qualifiedName)).length;
          }, 0);

          return (
            <Accordion key={group.qualifiedName} disableGutters elevation={0} defaultExpanded sx={{ '&:before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ fontSize: 18 }} />} sx={{ minHeight: 40, px: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                  <DotIcon sx={{ fontSize: 8, color: '#333' }} />
                  <Typography sx={{ fontWeight: 600, fontSize: '0.85rem' }}>{group.table}</Typography>
                  <Typography sx={{ ml: 'auto', fontSize: '0.75rem', color: '#bbb' }}>
                    {mappedCount}/{group.columns.length}
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ p: 0 }}>
                {group.columns.map((column) => (
                  <Box key={`${group.qualifiedName}.${column.name}`} sx={{ py: 0.5, px: 4, display: 'flex', justifyContent: 'space-between' }}>
                    <Typography sx={{ fontSize: '0.75rem', color: '#666' }}>{column.name}</Typography>
                    <Chip
                      label={column.type}
                      size="small"
                      sx={{
                        height: 18,
                        fontSize: '0.65rem',
                        borderRadius: '4px',
                        bgcolor: ['INT', 'BIGINT', 'NUMBER', 'DECIMAL'].includes(column.type) ? '#2c3e50' : '#f0f0f0',
                        color: ['INT', 'BIGINT', 'NUMBER', 'DECIMAL'].includes(column.type) ? '#fff' : '#666',
                      }}
                    />
                  </Box>
                ))}
              </AccordionDetails>
            </Accordion>
          );
        })}
      </Box>

      <Divider />

      <Box className="bg-[var(--color-header-bg)]" sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 1 }}>
            <TableIcon sx={{ fontSize: 18 }} /> Target Table
          </Typography>
          <Chip
            label={targetAttributeGroup ? 'Set' : 'Missing'}
            size="small"
            variant="outlined"
            color={targetAttributeGroup ? 'success' : 'warning'}
            sx={{ height: 20, fontSize: '0.7rem' }}
          />
        </Box>

        <Typography variant="overline" sx={{ color: '#bbb', fontSize: '0.65rem', display: 'block', mb: 0.5 }}>
          SELECTED TARGET
        </Typography>
        <Paper variant="outlined" sx={{ p: 1, mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: '#fff', borderRadius: '8px' }}>
          <Box>
            <Typography variant="caption" sx={{ color: '#bbb', display: 'block', lineHeight: 1 }}>
              {targetAttributeGroup?.qualifiedName.split('.').slice(0, 2).join('.') ?? 'No target selected'}
            </Typography>
            <Typography sx={{ fontSize: '0.8rem', fontWeight: 700 }}>
              {targetAttributeGroup?.table ?? 'Choose a target table'}
            </Typography>
          </Box>
          <ExpandMoreIcon sx={{ color: '#ccc' }} />
        </Paper>

        <Typography variant="overline" sx={{ color: '#bbb', fontSize: '0.65rem', display: 'block', mb: 0.5 }}>
          TARGET COLUMNS
        </Typography>
        <Box sx={{ maxHeight: 300, overflowY: 'auto' }}>
          {targetAttributeGroup?.columns.map((column) => {
            const isMapped = mappingSuggestions.some(
              (suggestion) => suggestion.targetAttribute === column.name && suggestion.sourceAttributes.length > 0
            );
            return (
              <Box key={column.name} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <DotIcon sx={{ fontSize: 10, color: isMapped ? '#2ecc71' : '#ddd' }} />
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 500, color: isMapped ? '#333' : '#999' }}>
                    {column.name}
                  </Typography>
                </Box>
                <Typography sx={{ fontSize: '0.7rem', color: '#ccc' }}>{column.type}</Typography>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
};

export default SourceTargetAttributeList;
