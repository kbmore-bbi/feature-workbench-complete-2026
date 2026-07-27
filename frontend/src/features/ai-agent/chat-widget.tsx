'use client';
import { AiaBadge, AiaBox, AiaFab, AiaIconButton, AiaPaper, AiaPopover } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import React, { useRef, useState } from 'react';
import { AutoAwesomeRoundedIcon, CloseRoundedIcon, SmartToyIcon } from '@/utils/icons';

import AIAgentPanel from '@/features/ai-agent/ai-agent-panel';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import { TOUR_TARGETS } from '@/features/tour/constants/tour-targets';

const FAB_EDGE_OFFSET = 60;
const AI_ASSISTANT_BUTTON_RADIUS = '4px';
const AI_ASSISTANT_COLLAPSED_SIZE = 65;

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
            (item) =>
                item.source !== 'conversation_agent' &&
                item.status === 'new' &&
                !shouldSuppressSignalForCurrentState(item, relationships.length),
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
            {previewSignal && !open ? (
                <AiaPaper
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
                    <AiaBox sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 0.5 }}>
                        <AiaBox sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0 }}>
                            <AiaBadge
                                color="error"
                                variant="dot"
                                invisible={assistantUnreadCount === 0}
                            >
                                <SmartToyIcon sx={{ fontSize: 18, color: '#b91c1c' }} />
                            </AiaBadge>
                            <AiaText sx={{ fontSize: 12, fontWeight: 800, color: '#7f1d1d' }}>
                                AI assistant notification
                            </AiaText>
                        </AiaBox>
                        <AiaIconButton
                            size="small"
                            onClick={(event) => {
                                event.stopPropagation();
                                respondToAssistantSignal({ signalId: previewSignal.signal_id, status: 'dismissed' });
                            }}
                            sx={{ mt: -0.5, mr: -0.5, color: '#991b1b' }}
                        >
                            <CloseRoundedIcon sx={{ fontSize: 16 }} />
                        </AiaIconButton>
                    </AiaBox>
                    <AiaText sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                        {previewSignal.title}
                    </AiaText>
                    <AiaText
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
                    </AiaText>
                </AiaPaper>
            ) : null}
            <AiaFab
                ref={fabRef}
                data-tour={TOUR_TARGETS.sttmAiAssistant}
                color="primary"
                aria-label="AI Assistant"
                aria-describedby={id}
                onClick={handleClick}
                sx={{
                    borderRadius: AI_ASSISTANT_BUTTON_RADIUS,
                    '&.MuiFab-root': {
                        borderRadius: AI_ASSISTANT_BUTTON_RADIUS,
                    },
                    position: 'fixed',
                    bottom: FAB_EDGE_OFFSET,
                    right: FAB_EDGE_OFFSET,
                    width: AI_ASSISTANT_COLLAPSED_SIZE,
                    height: AI_ASSISTANT_COLLAPSED_SIZE,
                    minWidth: AI_ASSISTANT_COLLAPSED_SIZE,
                    minHeight: AI_ASSISTANT_COLLAPSED_SIZE,
                    maxHeight: AI_ASSISTANT_COLLAPSED_SIZE,
                    px: 1.75,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 0,
                    overflow: 'hidden',
                    bgcolor: 'var(--aia-button-color)',
                    color: 'var(--aia-button-text-color)',
                    boxShadow: AI_ASSISTANT_FAB_SHADOW,
                    transition:
                        'width 220ms ease, min-width 220ms ease, height 220ms ease, min-height 220ms ease, max-height 220ms ease, padding 220ms ease, gap 220ms ease, box-shadow 220ms ease',
                    '&:hover': {
                        bgcolor: 'var(--aia-button-hover-color)',
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
                <AiaBadge
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
                </AiaBadge>
                <AiaText
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
                </AiaText>
            </AiaFab>

            <AiaPopover
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
            </AiaPopover>
        </>
    );
}
