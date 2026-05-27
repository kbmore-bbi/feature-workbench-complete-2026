'use client';
import React, { useRef, useState } from 'react';
import {
    Badge, Box, Fab, Paper, Popover, Typography
} from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import AIAgentPanel from '@/features/ai-agent/ai-agent-panel';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';

export default function AIAgentPopover() {
    const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
    const [expanded, setExpanded] = useState(false);
    const fabRef = useRef<HTMLButtonElement | null>(null);
    const { assistantSignals, assistantUnreadCount } = useSttmBuilderContext();
    const previewSignal = assistantSignals.find((item) => item.status === 'new') ?? assistantSignals[0] ?? null;

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
            {previewSignal ? (
                <Paper
                    elevation={6}
                    onClick={() => fabRef.current?.click()}
                    sx={{
                        position: 'fixed',
                        right: 24,
                        bottom: 88,
                        zIndex: 1200,
                        width: 320,
                        px: 2,
                        py: 1.5,
                        borderRadius: '14px',
                        border: '1px solid #fecaca',
                        backgroundColor: '#fff7f7',
                        cursor: 'pointer',
                    }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <Badge
                            color="error"
                            variant="dot"
                            invisible={assistantUnreadCount === 0}
                        >
                            <SmartToyIcon sx={{ fontSize: 18, color: '#b91c1c' }} />
                        </Badge>
                        <Typography sx={{ fontSize: 12, fontWeight: 800, color: '#7f1d1d' }}>
                            AI assistant notification
                        </Typography>
                    </Box>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                        {previewSignal.title}
                    </Typography>
                    <Typography sx={{ mt: 0.5, fontSize: 12, color: '#475569', lineHeight: 1.5 }}>
                        {previewSignal.message}
                    </Typography>
                </Paper>
            ) : null}
            <Fab
            ref={fabRef}
            variant="extended"
                color="primary"
                aria-describedby={id}
                onClick={handleClick}
                sx={{
                    borderRadius: '8px',
                    position: 'fixed',
                    bottom: 24,
                    right: 24,
                    bgcolor: 'var(--aia-secondary-button-color)',
                    '&:hover': { bgcolor: 'var(--aia-secondary-button-colorHover)' }
                }}
            >
                <Badge
                    color="error"
                    badgeContent={assistantUnreadCount > 0 ? assistantUnreadCount : null}
                    sx={{ '& .MuiBadge-badge': { right: -8, top: 6 } }}
                >
                    <SmartToyIcon />
                </Badge>
                &nbsp;&nbsp;
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
