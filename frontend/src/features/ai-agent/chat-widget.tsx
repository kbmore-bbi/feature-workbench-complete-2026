'use client';
import React, { useRef, useState } from 'react';
import {
    Badge, Box, Fab, IconButton, Paper, Popover, Typography
} from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import AIAgentPanel from '@/features/ai-agent/ai-agent-panel';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';

function shouldSuppressSignalForCurrentState(
    signal: {
        attributes?: Record<string, unknown>;
        status: string;
    },
    relationshipCount: number,
) {
    if (relationshipCount === 0) return false;
    const actionType = typeof signal.attributes?.action_type === 'string' ? signal.attributes.action_type : '';
    return actionType === 'refresh_semantic_context';
}

export default function AIAgentPopover() {
    const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
    const [expanded, setExpanded] = useState(false);
    const fabRef = useRef<HTMLButtonElement | null>(null);
    const { assistantSignals, assistantUnreadCount, respondToAssistantSignal, relationships } = useSttmBuilderContext();
    const previewSignal =
        assistantSignals.find(
            (item) => item.status === 'new' && !shouldSuppressSignalForCurrentState(item, relationships.length),
        ) ?? null;

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
                        width: 420,
                        maxWidth: 'calc(100vw - 48px)',
                        px: 2,
                        py: 1.5,
                        borderRadius: '14px',
                        border: '1px solid #fecaca',
                        backgroundColor: '#fff7f7',
                        cursor: 'pointer',
                    }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 0.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0 }}>
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
                        <IconButton
                            size="small"
                            onClick={(event) => {
                                event.stopPropagation();
                                respondToAssistantSignal({ signalId: previewSignal.signal_id, status: 'dismissed' });
                            }}
                            sx={{ mt: -0.5, mr: -0.5, color: '#991b1b' }}
                        >
                            <CloseRoundedIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                    </Box>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                        {previewSignal.title}
                    </Typography>
                    <Typography
                        sx={{
                            mt: 0.5,
                            fontSize: 12,
                            color: '#475569',
                            lineHeight: 1.5,
                            overflowWrap: 'anywhere',
                            wordBreak: 'break-word',
                        }}
                    >
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
                    badgeContent={assistantUnreadCount > 0 ? 1 : null}
                    anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
                    sx={{ '& .MuiBadge-badge': { left: 2, top: 2 } }}
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
