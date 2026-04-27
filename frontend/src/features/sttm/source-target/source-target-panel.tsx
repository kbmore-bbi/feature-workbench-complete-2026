'use client';
import React, { useState } from 'react';
import SourceTargetList from './source-target-list';
import {
    Box, Typography,
    Paper, Stack, InputBase, Divider
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import FilterListIcon from '@mui/icons-material/FilterList';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import {FocusButton} from '@/components/ui/focus-button';

export default function SourceTargetPanel({ type }: any) {
    const { clearSources, clearTargets }: any = useSttmBuilderContext();

    const title = type === 'source' ? 'SOURCE TABLES' : 'TARGET TABLES';

    return (
        <Paper elevation={0} sx={{
            width: '100%', maxWidth: '100%', height: '100%', borderRadius: '8px', border: '1px solid #e0e0e0', backgroundColor: '#f9f9f9', p: 2
        }}>
            {/* HEADER */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="overline" sx={{ fontWeight: 700, color: 'text.secondary', letterSpacing: 1 }}>
                    {title}
                </Typography>
                <FocusButton
                    variant="text"
                    size="small"
                    startIcon={<DeleteSweepIcon sx={{ fontSize: 16 }} />}
                    color="info"
                    onClick={() => {
                        if (type === 'source') {
                            clearSources();
                        } else {
                            clearTargets();
                        }
                    }}>Clear all</FocusButton>
            </Box>
            {/* SEARCH & FILTERS */}
            <Paper
                variant="outlined"
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    px: 1,
                    height: 36, // Compact height
                    mb: 2,
                    borderRadius: '8px',
                    backgroundColor: 'white',
                    borderColor: '#e0e0e0', // Light gray border
                    '&:focus-within': {
                        borderColor: '#3b82f6', // Optional blue highlight like your Tailwind code
                    },
                }}
            >
                {/* 1. Search Icon */}
                <SearchIcon sx={{ color: 'text.disabled', fontSize: 18, mr: 1 }} />

                {/* 2. Input Field (InputBase removes default MUI borders) */}
                <InputBase
                    placeholder="Search tables, schemas, or tags..."
                    fullWidth
                    sx={{
                        fontSize: '0.875rem',
                        flex: 1
                    }}
                />

                {/* 3. Vertical Divider */}
                <Divider sx={{ height: 20, mx: 1 }} orientation="vertical" />

                {/* 4. Filter Section */}
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        cursor: 'pointer',
                        gap: 0.5,
                        color: 'text.primary',
                        '&:hover': { opacity: 0.7 }
                    }}
                >
                    <FilterListIcon sx={{ fontSize: 18 }} />
                    <Typography sx={{ fontSize: '0.875rem', fontWeight: 500 }}>
                        Filters
                    </Typography>
                </Box>
            </Paper>

            {/* LIST CONTAINER */}
            <Stack spacing={1}>
                <SourceTargetList type={type} />
            </Stack>
        </Paper>
    );
  
}
