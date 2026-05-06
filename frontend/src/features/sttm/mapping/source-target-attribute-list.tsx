'use client';

import React, { useState } from 'react';
import { 
  Box, Typography, TextField, Accordion, AccordionSummary, 
  AccordionDetails, List, ListItem, Chip, Divider, Paper, 
  InputAdornment, Button
} from '@mui/material';
import { 
  Search as SearchIcon, 
  ExpandMore as ExpandMoreIcon, 
  AutoFixHigh as AutoIcon, 
  TableChart as TableIcon,
  FiberManualRecord as DotIcon
} from '@mui/icons-material';
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";

const SourceTargetAttributeList = () => {
  const [searchTerm, setSearchTerm] = useState('');

  const sourceData = [
    {
      table: 'Customers',
      columns: [
        { name: 'CUST_ID', type: 'INT' },
        { name: 'NAME', type: 'VARCHAR' },
        { name: 'Phone Num', type: 'BIGINT' },
        { name: 'LOCATION', type: 'VARCHAR' }
      ]
    },
    {
      table: 'Orders',
      columns: [
        { name: 'DATE_KEY', type: 'INT' },
        { name: 'FULL_DATE', type: 'DATE' },
        { name: 'YEAR', type: 'INT' },
        { name: 'QUARTER', type: 'INT' },
        { name: 'MONTH', type: 'INT' },
        { name: 'WEEK', type: 'INT' }
      ]
    }
  ];

  const targetColumns = [
    { name: 'ORDER_ID', type: 'BIGINT', status: 'mapped' },
    { name: 'CUSTOMER_KEY', type: 'INT', status: 'unmapped' },
    { name: 'DATE_KEY', type: 'INT', status: 'unmapped' },
    { name: 'PRODUCT_KEY', type: 'INT', status: 'unmapped' },
    { name: 'AMOUNT', type: 'DECIMAL', status: 'unmapped' },
    { name: 'QUANTITY', type: 'INT', status: 'unmapped' },
    { name: 'DISCOUNT', type: 'DECIMAL', status: 'unmapped' }
  ];

  return (
    <Box sx={{ 
      // Changed width to 100% so it adapts to whatever parent container you put it in
      width: '100%', 
      height: '100vh', 
      display: 'flex', 
      flexDirection: 'column', 
      bgcolor: '#fff', 
      borderRight: '1px solid #e0e0e0' 
    }}>
      
      {/* 1. HEADER & SEARCH */}
      <Box sx={{ p: 2 }}>
        <Box sx={{justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
           <Typography sx={{ fontSize: 16, fontWeight: 800, color: "#111827", mb: 2 }}>
          STTM Builder
        </Typography>
        

        <Box className="flex h-[38px] items-center justify-between rounded-full bg-[#F3F4F6] px-4">
          <Typography className="text-[13px] font-medium text-[var(--color-text)]">
            Cortex
          </Typography>
          <KeyboardArrowDownRoundedIcon sx={{ fontSize: 18, color: "#4B5563" }} />
        </Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: '0.9rem', color: '#333' }}>
            Source Columns
          </Typography>
          {/* <Button 
            size="small" 
            variant="text" 
            startIcon={<AutoIcon sx={{ fontSize: 16 }} />} 
            sx={{ 
              textTransform: 'none', 
              fontSize: '0.7rem', 
              color: '#666', 
              border: '1px solid #e0e0e0', 
              px: 1, py: 0,
              borderRadius: '6px'
            }}
          >
            Auto
          </Button> */}
        </Box>
        <TextField
          fullWidth
          size="small"
          placeholder="Search columns..."
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
                '& fieldset': { border: 'none' } 
              }
            },
          }}
        />
      </Box>

      {/* 2. SCROLLABLE SOURCE LIST (Expands to fill available space) */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
        <Typography variant="overline" sx={{ px: 2, py: 1, display: 'block', color: '#bbb', fontWeight: 700, letterSpacing: 1 }}>
          SALES
        </Typography>
        
        {sourceData.map((group) => (
          <Accordion key={group.table} disableGutters elevation={0} defaultExpanded sx={{ '&:before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ fontSize: 18 }} />} sx={{ minHeight: 40, px: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                <DotIcon sx={{ fontSize: 8, color: '#333' }} />
                <Typography sx={{ fontWeight: 600, fontSize: '0.85rem' }}>{group.table}</Typography>
                <Typography sx={{ ml: 'auto', fontSize: '0.75rem', color: '#bbb' }}>0/{group.columns.length}</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
              <List dense disablePadding>
                {group.columns.map((col) => (
                  <ListItem key={col.name} sx={{ py: 0.5, px: 4, display: 'flex', justifyContent: 'space-between' }}>
                    <Typography sx={{ fontSize: '0.75rem', color: '#666' }}>{col.name}</Typography>
                    <Chip 
                      label={col.type} 
                      size="small" 
                      sx={{ 
                        height: 18, 
                        fontSize: '0.65rem', 
                        borderRadius: '4px', 
                        bgcolor: col.type === 'INT' || col.type === 'BIGINT' ? '#2c3e50' : '#f0f0f0',
                        color: col.type === 'INT' || col.type === 'BIGINT' ? '#fff' : '#666'
                      }} 
                    />
                  </ListItem>
                ))}
              </List>
            </AccordionDetails>
          </Accordion>
        ))}
      </Box>

      <Divider />

      {/* 3. TARGET TABLE SECTION (Fixed at bottom) */}
      <Box className="bg-[var(--color-header-bg)]" sx={{ p: 2}}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 1 }}>
            <TableIcon sx={{ fontSize: 18 }} /> Target Table
          </Typography>
          <Chip label="Set" size="small" variant="outlined" color="success" sx={{ height: 20, fontSize: '0.7rem' }} />
        </Box>

        <Typography variant="overline" sx={{ color: '#bbb', fontSize: '0.65rem', display: 'block', mb: 0.5 }}>
          SELECTED TARGET
        </Typography>
        <Paper variant="outlined" sx={{ p: 1, mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: '#fff', borderRadius: '8px' }}>
          <Box>
            <Typography variant="caption" sx={{ color: '#bbb', display: 'block', lineHeight: 1 }}>DWH</Typography>
            <Typography sx={{ fontSize: '0.8rem', fontWeight: 700 }}>FACT_SALES_UNIFIED</Typography>
          </Box>
          <ExpandMoreIcon sx={{ color: '#ccc' }} />
        </Paper>

        <Typography variant="overline" sx={{ color: '#bbb', fontSize: '0.65rem', display: 'block', mb: 0.5 }}>
          TARGET COLUMNS
        </Typography>
        <Box sx={{ maxHeight: 300, overflowY: 'auto' }}>
          {targetColumns.map((col) => (
            <Box key={col.name} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <DotIcon sx={{ fontSize: 10, color: col.status === 'mapped' ? '#2ecc71' : '#ddd' }} />
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 500, color: col.status === 'mapped' ? '#333' : '#999' }}>
                  {col.name}
                </Typography>
              </Box>
              <Typography sx={{ fontSize: '0.7rem', color: '#ccc' }}>{col.type}</Typography>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
};

export default SourceTargetAttributeList;
  
