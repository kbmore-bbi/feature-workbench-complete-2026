'use client';
import React, { useRef, useState } from 'react';
import { AutoAwesomeRoundedIcon, CloseRoundedIcon, SmartToyIcon } from '@/utils/icons';
import { Badge, Box, Fab, IconButton, Paper, Popover, Typography } from '@mui/material';
import AIAgentPanel from '@/features/ai-agent/ai-agent-panel';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';

const FAB_EDGE_OFFSET = 60;

const AI_ASSISTANT_FAB_SHADOW =
    '0 0 0 1px rgba(255, 255, 255, 0.14), 0 4px 16px rgba(0, 0, 0, 0.45), 0 0 24px rgba(255, 255, 255, 0.1)';

const AI_ASSISTANT_FAB_SHADOW_HOVER =
    '0 0 0 1px rgba(255, 255, 255, 0.2), 0 6px 20px rgba(0, 0, 0, 0.5), 0 0 32px rgba(255, 255, 255, 0.14)';

const FAB_EXPANDED_SX = {
    width: 'auto',
    minWidth: 156,
    height: 60,
    minHeight: 60,
    maxHeight: 60,
    px: 2.25,
    boxShadow: AI_ASSISTANT_FAB_SHADOW_HOVER,
} as const;

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
                color="primary"
                aria-label="AI Assistant"
                aria-describedby={id}
                onClick={handleClick}
                sx={{
                    borderRadius: '999px',
                    position: 'fixed',
                    bottom: FAB_EDGE_OFFSET,
                    right: FAB_EDGE_OFFSET,
                    width: 56,
                    height: 56,
                    minWidth: 56,
                    minHeight: 56,
                    maxHeight: 56,
                    px: 1.75,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 0,
                    overflow: 'hidden',
                    bgcolor: 'var(--aia-secondary-button-color)',
                    color: '#ffffff',
                    boxShadow: AI_ASSISTANT_FAB_SHADOW,
                    transition:
                        'width 220ms ease, min-width 220ms ease, height 220ms ease, min-height 220ms ease, max-height 220ms ease, padding 220ms ease, gap 220ms ease, box-shadow 220ms ease',
                    '&:hover': {
                        bgcolor: 'var(--aia-secondary-button-colorHover)',
                        ...FAB_EXPANDED_SX,
                        gap: 1,
                        '& .ai-assistant-icon': {
                            fontSize: 28,
                        },
                        '& .ai-assistant-label': {
                            maxWidth: 120,
                            opacity: 1,
                            ml: 0.25,
                        },
                    },
                    ...(open ? {
                        ...FAB_EXPANDED_SX,
                        gap: 1,
                        '& .ai-assistant-icon': {
                            fontSize: 28,
                        },
                        '& .ai-assistant-label': {
                            maxWidth: 120,
                            opacity: 1,
                            ml: 0.25,
                        },
                    } : {}),
                }}
            >
                <Badge
                    color="error"
                    badgeContent={assistantUnreadCount > 0 ? 1 : null}
                    anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
                    sx={{ '& .MuiBadge-badge': { left: 2, top: 2 } }}
                >
                    <AutoAwesomeRoundedIcon
                        className="ai-assistant-icon"
                        sx={{
                            fontSize: 26,
                            flexShrink: 0,
                            transition: 'font-size 220ms ease',
                        }}
                    />
                </Badge>
                <Typography
                    className="ai-assistant-label"
                    component="span"
                    sx={{
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        lineHeight: 1,
                        whiteSpace: 'nowrap',
                        maxWidth: 0,
                        opacity: 0,
                        overflow: 'hidden',
                        transition: 'max-width 220ms ease, opacity 220ms ease, margin 220ms ease',
                    }}
                >
                    AI Assistant
                </Typography>
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
                            mt: -2,
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
