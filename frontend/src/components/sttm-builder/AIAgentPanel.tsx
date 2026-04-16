import React from 'react';
import { Box, Paper, Typography, Avatar, TextField, InputAdornment, IconButton, Stack, InputBase } from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import TableChartIcon from '@mui/icons-material/TableChart';
import SendIcon from '@mui/icons-material/Send';

export default function AIAgentPanel() {
    return (
        <Paper
            elevation={0}
            sx={{
                width: '100%',
                height: '100%',
                minHeight: '80vh',
                display: 'flex',
                flexDirection: 'column',
                borderRadius: '12px',
                border: '1px solid #e0e0e0',
                overflow: 'hidden',
                backgroundColor: '#f9f9f9',
            }}
        >
            {/* HEADER SECTION (Dark) */}
            <Box sx={{ p: 2, backgroundColor: '#000', color: '#fff' }}>
                <Stack sx={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start'
                }}>
                    <Stack sx={{
                        flexDirection: 'row',
                        gap: 1.5, // Replaces spacing={1.5}
                        alignItems: 'center'
                    }}>
                        <Avatar sx={{ bgcolor: '#333', width: 32, height: 32 }}>
                            <SmartToyIcon sx={{ fontSize: 20 }} />
                        </Avatar>
                        <Box>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                                STTM AI Agent
                            </Typography>
                            <Typography variant="caption" sx={{ color: '#888', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#4caf50' }} />
                                Active · Cortex 4.0
                            </Typography>
                        </Box>
                    </Stack>
                    <IconButton size="small" sx={{ color: '#888' }}>
                        <VolumeUpIcon fontSize="small" />
                    </IconButton>
                </Stack>

                {/* Stats Sub-header */}
                <Box
                    sx={{
                        mt: 2,
                        p: 1,
                        borderRadius: '8px',
                        backgroundColor: '#1a1a1a',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                    }}
                >
                    <TableChartIcon sx={{ fontSize: 16, color: '#888' }} />
                    <Typography variant="caption" sx={{ color: '#888' }}>
                        0 tables · 0 mapping
                    </Typography>
                </Box>
            </Box>

            {/* CHAT AREA */}
            <Box sx={{ p: 2, flexGrow: 1 }}>
                <Stack direction="row" spacing={1.5}>
                    <Avatar sx={{ bgcolor: '#000', width: 28, height: 28 }}>
                        <SmartToyIcon sx={{ fontSize: 16 }} />
                    </Avatar>

                    {/* Chat Bubble */}
                    <Paper
                        elevation={0}
                        sx={{
                            p: 1.5,
                            borderRadius: '0 12px 12px 12px',
                            border: '1px solid #e0e0e0',
                            maxWidth: '85%',
                            backgroundColor: '#fff',
                        }}
                    >
                        <Typography variant="body2" sx={{ lineHeight: 1.5 }}>
                            👋 Hi! I'm your <strong>STTM AI Assistant</strong>. How can I help you today?
                        </Typography>
                    </Paper>
                </Stack>
            </Box>
            {/* CHAT INPUT AREA */}
            <Box sx={{ p: 1, backgroundColor: '#fff', borderTop: '1px solid #e0e0e0' }}>
                <Paper
                    elevation={0}
                    sx={{
                        p: '2px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        borderRadius: '16px',
                        backgroundColor: '#f9f9f9',
                        border: '1px solid #e0e0e0',
                        height: '32px', // Forces it to be very small
                    }}
                >
                    <InputBase
                        sx={{
                            ml: 1,
                            flex: 1,
                            fontSize: '0.75rem', // Smaller text
                            '& .MuiInputBase-input::placeholder': { opacity: 0.6 }
                        }}
                        placeholder="Ask STTM AI..."
                    />
                    <IconButton
                        size="small"
                        sx={{
                            p: '2px',
                            color: 'red', // Matches the red icon in your screenshot
                            '&:hover': { backgroundColor: 'transparent' }
                        }}
                    >
                        <SendIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                </Paper>
            </Box>
        </Paper>
    );
}
