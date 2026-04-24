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
  Select,
  MenuItem,
  Button,
  Chip,
  TextField,
} from '@mui/material';
import { Star as StarIcon } from '@mui/icons-material';

const mappingData = [
  { id: 1, target: 'ORDER_ID', targetType: 'BIGINT', source: 'orders.order_id', sourceType: 'BIGINT', rule: 'Direct', status: 'MAPPED' },
  { id: 2, target: 'CUSTOMER_KEY', targetType: 'INT', source: '', sourceType: '', rule: 'Select...', status: 'UNMAPPED' },
  { id: 3, target: 'DATE_KEY', targetType: 'INT', source: '', sourceType: '', rule: 'Select...', status: 'UNMAPPED' },
  { id: 4, target: 'PRODUCT_KEY', targetType: 'INT', source: '', sourceType: '', rule: 'Select...', status: 'UNMAPPED' },
  { id: 5, target: 'AMOUNT', targetType: 'DECIMAL', source: '', sourceType: '', rule: 'Select...', status: 'UNMAPPED' },
  { id: 6, target: 'QUANTITY', targetType: 'INT', source: '', sourceType: '', rule: 'Select...', status: 'UNMAPPED' },
  { id: 7, target: 'DISCOUNT', targetType: 'DECIMAL', source: '', sourceType: '', rule: 'Select...', status: 'UNMAPPED' },
  { id: 8, target: 'SALES_REP', targetType: 'VARCHAR', source: '', sourceType: '', rule: 'Select...', status: 'UNMAPPED' },
  { id: 9, target: 'REGION', targetType: 'VARCHAR', source: '', sourceType: '', rule: 'Select...', status: 'UNMAPPED' },
  { id: 10, target: 'ORDER_DATE', targetType: 'DATE', source: '', sourceType: '', rule: 'Select...', status: 'UNMAPPED' },
];

const SourceTargetAttributeMapping = () => {
  return (
    <TableContainer 
      component={Paper} 
      elevation={0} 
      sx={{ 
        width: '100%', // Occupies full container width
        border: '1px solid #ececec', 
        borderRadius: 0,
        overflowX: 'auto' 
      }}
    >
      <Table sx={{ minWidth: 800 }} aria-label="mapping table" size="small">
        <TableHead sx={{ bgcolor: '#fcfcfc' }}>
          <TableRow>
            <TableCell sx={{ color: '#bbb', fontWeight: 600, fontSize: '0.7rem', width: 40 }}>#</TableCell>
            <TableCell sx={{ color: '#bbb', fontWeight: 600, fontSize: '0.7rem' }}>TARGET COLUMN</TableCell>
            <TableCell sx={{ color: '#bbb', fontWeight: 600, fontSize: '0.7rem' }}>SOURCE COLUMN</TableCell>
            <TableCell sx={{ color: '#bbb', fontWeight: 600, fontSize: '0.7rem' }}>TYPE (PREVIEW)</TableCell>
            <TableCell sx={{ color: '#bbb', fontWeight: 600, fontSize: '0.7rem' }}>TRANSFORM RULE</TableCell>
            <TableCell sx={{ color: '#bbb', fontWeight: 600, fontSize: '0.7rem' }}>NL RULE</TableCell>
            <TableCell sx={{ color: '#bbb', fontWeight: 600, fontSize: '0.7rem' }}>PRE-PROCESSING ORDER</TableCell>
            <TableCell sx={{ color: '#bbb', fontWeight: 600, fontSize: '0.7rem' }} align="right">STATUS</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {mappingData.map((row) => (
            <TableRow key={row.id} sx={{ '&:last-child td, &:last-child th': { border: 0 }, height: 60 }}>
              <TableCell sx={{ color: '#ccc', fontSize: '0.75rem' }}>{row.id}</TableCell>

              <TableCell>
                <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: '#333' }}>{row.target}</Typography>
                <Typography sx={{ fontSize: '0.7rem', color: '#bbb' }}>{row.targetType}</Typography>
              </TableCell>

              <TableCell>
                <TextField
                  fullWidth
                  variant="standard"
                  placeholder="Map source..."
                  value={row.source}
                  slotProps={{
                    input: {
                      disableUnderline: true,
                      sx: { 
                        fontSize: '0.8rem', 
                        color: row.source ? '#333' : '#ccc',
                        '&::placeholder': { color: '#ccc', opacity: 1 }
                      }
                    }
                  }}
                />
              </TableCell>

              <TableCell>
                {row.sourceType && (
                  <Chip
                    label={row.sourceType}
                    size="small"
                    sx={{ bgcolor: '#1a1a1a', color: '#fff', borderRadius: '4px', fontSize: '0.65rem', height: 20 }}
                  />
                )}
              </TableCell>

              <TableCell>
                <Select
                  value={row.rule}
                  size="small"
                  sx={{ height: 32, fontSize: '0.8rem', width: '100%', maxWidth: 140, borderRadius: '6px', bgcolor: '#fff' }}
                >
                  <MenuItem value="Direct">Direct</MenuItem>
                  <MenuItem value="Select...">Select...</MenuItem>
                </Select>
              </TableCell>

              <TableCell>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<StarIcon sx={{ fontSize: '10px !important' }} />}
                  sx={{
                    bgcolor: '#1a1a1a',
                    color: '#fff',
                    textTransform: 'none',
                    fontSize: '0.75rem',
                    borderRadius: '6px',
                    whiteSpace: 'nowrap',
                    '&:hover': { bgcolor: '#333' },
                  }}
                >
                  Custom
                </Button>
              </TableCell>

              <TableCell>
                <Typography sx={{ fontSize: '0.75rem', color: '#eee' }}>Order...</Typography>
              </TableCell>

              <TableCell align="right">
                <Typography
                  sx={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    color: row.status === 'MAPPED' ? '#4caf50' : '#ddd',
                    letterSpacing: 0.5,
                  }}
                >
                  {row.status}
                </Typography>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default SourceTargetAttributeMapping;
