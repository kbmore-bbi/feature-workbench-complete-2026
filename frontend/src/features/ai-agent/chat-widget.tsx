'use client';
import React, { useState } from 'react';
import { AutoAwesomeRoundedIcon } from '@/utils/icons';
import { Fab, Popover, Typography } from '@mui/material';

import AIAgentPanel from '@/features/ai-agent/ai-agent-panel';

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
                <AutoAwesomeRoundedIcon
                    className="ai-assistant-icon"
                    sx={{
                        fontSize: 26,
                        flexShrink: 0,
                        transition: 'font-size 220ms ease',
                    }}
                />
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
