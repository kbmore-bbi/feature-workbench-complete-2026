'use client';
import React, { useState } from 'react';
import {
    Box, Paper, Typography, Avatar, IconButton, Stack, InputBase,
    Fab, Popover
} from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import AIAgentPanel from '@/components/sttm-builder/AIAgentPanel';

export default function AIAgentPopover() {
    const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
        setAnchorEl(null);
    };

    const open = Boolean(anchorEl);
    const id = open ? 'chat-popover' : undefined;

    return (
        <>
            <Fab
            variant="extended"
                color="primary"
                aria-describedby={id}
                onClick={handleClick}
                sx={{
                    borderRadius: '8px',
                    position: 'fixed',
                    bottom: 24,
                    right: 24,
                    bgcolor: '#000',
                    '&:hover': { bgcolor: '#333' }
                }}
            >
                <SmartToyIcon />&nbsp;&nbsp;
                {'AI Assistant'}
            </Fab>

            <Popover
                id={id}
                open={open}
                anchorEl={anchorEl}
                onClose={handleClose}
                anchorOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                }}
                transformOrigin={{
                    vertical: 'bottom',
                    horizontal: 'right',
                }}
                slotProps={{
                    paper: {
                        sx: {
                            borderRadius: '12px',
                            mt: -2, // Small gap from FAB
                            boxShadow: '0px 8px 24px rgba(0,0,0,0.15)',
                            overflow: 'hidden'
                        }
                    }
                }}
            >
                <AIAgentPanel />
            </Popover>
        </>
    );
}
