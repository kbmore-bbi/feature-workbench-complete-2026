'use client';

import React, { useState } from 'react';


import SourceTargetList from './SourceTargetList';
import AddSourcePlaceholder from "./AddSourcePlaceholder";
import DbSchemaSelection from "./DbSchemaSelection";

import { Box, Typography, Button, TextField, Paper, InputAdornment, Stack, InputBase, Divider } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import FilterListIcon from '@mui/icons-material/FilterList';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import { useDataContext } from '../../contexts/DataContext';


export default function SourceTargetPanel({ type }: any) {
    const { clearSources, clearTargets }: any = useDataContext();

    const title = type === 'source' ? 'SOURCE TABLES' : 'TARGET TABLES';

    return (
        <Paper elevation={0} sx={{
            width: '100%', maxWidth: 400, borderRadius: '8px', border: '1px solid #e0e0e0', backgroundColor: '#f9f9f9', p: 2
        }}>
            {/* HEADER */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="overline" sx={{ fontWeight: 700, color: 'text.secondary', letterSpacing: 1 }}>
                    {title}
                </Typography>
                <Button
                    variant="text"
                    size="small"
                    startIcon={<DeleteSweepIcon sx={{ fontSize: 16 }} />}
                    onClick={() => {
                        if (type === 'source') {
                            clearSources();
                        } else {
                            clearTargets();
                        }
                    }}
                    sx={{ textTransform: 'none', color: 'text.disabled', fontSize: '0.75rem' }}
                >
                    Clear all
                </Button>
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
    // const [title, setTitle] = useState(type == 'source' ? 'Source' : 'Target')

    // const setItems = (e: any) => {
    //     console.log(e)
    // }


    // return (
    //     <div className="relative w-full border border-blue-200 rounded-xl p-4" 
    //     style={{'backgroundColor': '#e8e8e8'}}>

    //         <div className="flex justify-between items-center mb-2">
    //             <h2 className="font-semibold text-sm">{title}</h2>
    //             <button
    //                 className="text-xs text-blue-600"

    //             >
    //                 Clear all
    //             </button>

    //         </div>


    //         <DbSchemaSelection />


    //         <div className="flex gap-2 mb-4">
    //             <input
    //                 className="flex-1 border rounded-md px-3 py-1 text-sm"
    //                 placeholder="Search tables, schemas, or tags..."
    //             />
    //             <button className="border rounded-md px-3 py-1 text-sm">
    //                 Filters
    //             </button>
    //         </div>


    //         <SourceTargetList
    //             type={type}
    //             items={SOURCE_TABLES}
    //             setItems={setItems}

    //         />




    //     </div>
    // );
}
