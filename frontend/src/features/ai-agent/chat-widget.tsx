'use client';
import React, { useState } from 'react';
import {
    Fab, Popover
} from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import AIAgentPanel from '@/features/ai-agent/ai-agent-panel';

export default function AIAgentPopover() {
    const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
    const [expanded, setExpanded] = useState(false);

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
        setAnchorEl(null);
        setExpanded(false);
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
                            display: 'flex',
                            borderRadius: '12px',
                            mt: -2, // Small gap from FAB
                            boxShadow: '0px 8px 24px rgba(0,0,0,0.15)',
                            overflow: 'hidden',
                            width: expanded ? 'min(1040px, calc(100vw - 40px))' : 'min(720px, calc(100vw - 40px))',
                            height: expanded ? 'min(88vh, 980px)' : 'min(82vh, 900px)',
                            maxHeight: 'calc(100vh - 48px)',
                        }
                    }
                }}
            >
                <AIAgentPanel
                    expanded={expanded}
                    onToggleExpanded={() => setExpanded((prev) => !prev)}
                />
            </Popover>
        </>
    );
}
