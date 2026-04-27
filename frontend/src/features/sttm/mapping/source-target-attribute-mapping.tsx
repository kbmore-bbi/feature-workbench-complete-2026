'use client';

import React, { useMemo } from 'react';
import {
  Box,
  Button,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { AutoFixHigh as AutoFixHighIcon } from '@mui/icons-material';

import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';

const SourceTargetAttributeMapping = () => {
  const {
    mappingLoading,
    mappingSuggestions,
    runAutoMap,
    sourceAttributeGroups,
    targetAttributeGroup,
  } = useSttmBuilderContext();

  const mappingByTarget = useMemo(
    () =>
      new Map(
        mappingSuggestions.map((item) => [
          item.targetAttribute,
          item,
        ])
      ),
    [mappingSuggestions]
  );

  const rows = targetAttributeGroup?.columns ?? [];
  const selectedTableNames = sourceAttributeGroups.map((group) => group.table).join(', ');

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: '#111827' }}>
            Attribute Mapping
          </Typography>
          <Typography sx={{ fontSize: '0.8rem', color: '#6B7280' }}>
            Source tables: {selectedTableNames || 'none selected'}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AutoFixHighIcon />}
          onClick={() => void runAutoMap()}
          disabled={mappingLoading || !rows.length || !sourceAttributeGroups.length}
          sx={{
            bgcolor: '#111827',
            textTransform: 'none',
            '&:hover': { bgcolor: '#1F2937' },
          }}
        >
          {mappingLoading ? 'Running Auto Map...' : 'Run Auto Map'}
        </Button>
      </Box>

      <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #ececec', borderRadius: 2 }}>
        <Table sx={{ minWidth: 760 }} aria-label="mapping table" size="small">
          <TableHead sx={{ bgcolor: '#fcfcfc' }}>
            <TableRow>
              <TableCell sx={{ color: '#bbb', fontWeight: 600, fontSize: '0.7rem', width: 40 }}>#</TableCell>
              <TableCell sx={{ color: '#bbb', fontWeight: 600, fontSize: '0.7rem' }}>TARGET COLUMN</TableCell>
              <TableCell sx={{ color: '#bbb', fontWeight: 600, fontSize: '0.7rem' }}>SOURCE COLUMN(S)</TableCell>
              <TableCell sx={{ color: '#bbb', fontWeight: 600, fontSize: '0.7rem' }}>TYPE</TableCell>
              <TableCell sx={{ color: '#bbb', fontWeight: 600, fontSize: '0.7rem' }}>CONFIDENCE</TableCell>
              <TableCell sx={{ color: '#bbb', fontWeight: 600, fontSize: '0.7rem' }} align="right">STATUS</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, index) => {
              const suggestion = mappingByTarget.get(row.name);
              const sourceColumns = suggestion?.sourceAttributes ?? [];
              const isMapped = sourceColumns.length > 0;

              return (
                <TableRow key={row.name} sx={{ '&:last-child td, &:last-child th': { border: 0 }, height: 60 }}>
                  <TableCell sx={{ color: '#ccc', fontSize: '0.75rem' }}>{index + 1}</TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: '#333' }}>{row.name}</Typography>
                    <Typography sx={{ fontSize: '0.7rem', color: '#bbb' }}>{row.type}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: '0.8rem', color: isMapped ? '#333' : '#9CA3AF' }}>
                      {isMapped ? sourceColumns.join(', ') : 'No mapping suggestion yet'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={row.type}
                      size="small"
                      sx={{
                        bgcolor: ['INT', 'BIGINT', 'NUMBER', 'DECIMAL'].includes(row.type) ? '#494747' : '#f3f4f6',
                        color: ['INT', 'BIGINT', 'NUMBER', 'DECIMAL'].includes(row.type) ? '#fff' : '#374151',
                        borderRadius: '4px',
                        fontSize: '0.65rem',
                        height: 20,
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: '0.8rem', color: '#374151' }}>
                      {suggestion ? `${Math.round(suggestion.confidenceScore * 100)}%` : '--'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography
                      sx={{
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        color: isMapped ? '#4caf50' : '#ddd',
                        letterSpacing: 0.5,
                      }}
                    >
                      {isMapped ? 'MAPPED' : 'UNMAPPED'}
                    </Typography>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default SourceTargetAttributeMapping;
