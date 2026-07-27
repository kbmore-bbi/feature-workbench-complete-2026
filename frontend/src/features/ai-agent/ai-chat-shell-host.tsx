'use client';

import { useMemo, useState, type MouseEvent } from 'react';
import { AiaBadge, AiaBox } from '@/components/ui';
import { AiaResizeHandle } from '@/components/ui/aia-resize-handle';
import {
    AI_CHAT_RAIL_COLLAPSED_WIDTH,
    AI_CHAT_RAIL_COLOR,
    AI_CHAT_RAIL_DRAG_WIDTH,
    AI_CHAT_RAIL_EXPANDED_WIDTH,
    AI_CHAT_RAIL_HEIGHT,
    AI_CHAT_SHELL_Z_INDEX,
} from '@/features/ai-agent/ai-chat-layout-constants';
import { useAiChatLayout } from '@/features/ai-agent/ai-chat-layout-context';
import AIAgentPanel from '@/features/ai-agent/ai-agent-panel';
import { AiChatHistoryPanel } from '@/features/ai-agent/ai-chat-history-panel';
import { AiChatNotificationsPanel } from '@/features/ai-agent/ai-chat-notifications-panel';
import { AiChatSidebarHeader } from '@/features/ai-agent/ai-chat-sidebar-header';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import { TOUR_TARGETS } from '@/features/tour/constants/tour-targets';
import { AutoAwesomeRoundedIcon } from '@/utils/icons';

function RailDragDots() {
    return (
        <AiaBox
            sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 4px)',
                gap: '3px',
                px: 0.5,
            }}
        >
            {Array.from({ length: 6 }).map((_, index) => (
                <AiaBox
                    key={index}
                    sx={{
                        width: 4,
                        height: 4,
                        borderRadius: '50%',
                        backgroundColor: 'rgba(255, 255, 255, 0.9)',
                    }}
                />
            ))}
        </AiaBox>
    );
}

export function AiChatRailTab() {
    const {
        railTop,
        openChat,
        beginRailDrag,
        beginRailTouchDrag,
        resolvedRecommendationIds,
    } = useAiChatLayout();
    const { firRecommendations, firPrimaryQuestion } = useSttmBuilderContext();
    const [railHovered, setRailHovered] = useState(false);
    const isRailExpanded = railHovered;
    const notificationCount = useMemo(() => {
        const ids = new Set(
            firRecommendations
                .filter((item) => !resolvedRecommendationIds.has(item.recommendation_id))
                .map((item) => item.recommendation_id),
        );
        if (
            firPrimaryQuestion
            && !resolvedRecommendationIds.has(firPrimaryQuestion.recommendation_id)
        ) {
            ids.add(firPrimaryQuestion.recommendation_id);
        }
        return ids.size;
    }, [firPrimaryQuestion, firRecommendations, resolvedRecommendationIds]);

    const handleOpen = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        openChat();
    };

    return (
        <AiaBox
            onMouseEnter={() => setRailHovered(true)}
            onMouseLeave={() => setRailHovered(false)}
            sx={{
                position: 'absolute',
                top: railTop,
                right: 0,
                zIndex: AI_CHAT_SHELL_Z_INDEX,
                display: 'flex',
                alignItems: 'stretch',
                width: isRailExpanded ? AI_CHAT_RAIL_EXPANDED_WIDTH : AI_CHAT_RAIL_COLLAPSED_WIDTH,
                height: AI_CHAT_RAIL_HEIGHT,
                borderTopLeftRadius: '10px',
                borderBottomLeftRadius: '10px',
                overflow: 'hidden',
                boxShadow: '-4px 0 16px rgba(0, 0, 0, 0.16)',
                backgroundColor: AI_CHAT_RAIL_COLOR,
                color: '#ffffff',
                pointerEvents: 'auto',
                transition: 'width 180ms ease, box-shadow 180ms ease',
                ...(isRailExpanded
                    ? {
                          boxShadow: '-6px 0 20px rgba(0, 0, 0, 0.2)',
                      }
                    : {}),
            }}
        >
            <AiaBox
                onMouseDown={beginRailDrag}
                onTouchStart={beginRailTouchDrag}
                title="Drag to move"
                aria-hidden={!isRailExpanded}
                sx={{
                    width: isRailExpanded ? AI_CHAT_RAIL_DRAG_WIDTH : 0,
                    opacity: isRailExpanded ? 1 : 0,
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: isRailExpanded ? 'grab' : 'default',
                    flexShrink: 0,
                    touchAction: 'none',
                    pointerEvents: isRailExpanded ? 'auto' : 'none',
                    transition: 'width 180ms ease, opacity 150ms ease',
                    '&:active': { cursor: 'grabbing' },
                }}
            >
                <RailDragDots />
            </AiaBox>
            <AiaBox
                data-tour={TOUR_TARGETS.sttmAiAssistant}
                component="button"
                type="button"
                aria-label="Open AI Assistant"
                title="Open AI Assistant"
                onClick={handleOpen}
                sx={{
                    flex: 1,
                    minWidth: 0,
                    border: 'none',
                    cursor: 'pointer',
                    p: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'transparent',
                    color: 'inherit',
                    pointerEvents: 'auto',
                    '&:hover': {
                        filter: 'brightness(1.05)',
                    },
                }}
            >
                <AiaBadge
                    color="error"
                    badgeContent={notificationCount || null}
                    anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
                    sx={{ pointerEvents: 'none', '& .MuiBadge-badge': { left: 2, top: 2 } }}
                >
                    <AutoAwesomeRoundedIcon sx={{ fontSize: 22, pointerEvents: 'none' }} />
                </AiaBadge>
            </AiaBox>
        </AiaBox>
    );
}

export function AiChatSidebarPanel() {
    const {
        panelView,
        historySearch,
        sessions,
        activeSessionId,
        recentSessions,
        resolvedRecommendationIds,
        effectiveSidebarWidth,
        isResizing,
        isMobile,
        isTablet,
        setHistorySearch,
        setPanelView,
        closeChat,
        handleNewChat,
        handleShowHistory,
        handleShowNotifications,
        handleSelectRecommendation,
        handleSelectSession,
        beginSidebarResize,
    } = useAiChatLayout();
    const { firRecommendations, firPrimaryQuestion } = useSttmBuilderContext();
    const openRecommendations = useMemo(() => {
        const byId = new Map(
            firRecommendations
                .filter((item) => !resolvedRecommendationIds.has(item.recommendation_id))
                .map((item) => [item.recommendation_id, item]),
        );
        if (
            firPrimaryQuestion
            && !resolvedRecommendationIds.has(firPrimaryQuestion.recommendation_id)
        ) {
            byId.set(firPrimaryQuestion.recommendation_id, firPrimaryQuestion);
        }
        return Array.from(byId.values()).sort(
            (left, right) =>
                Number(right.question_id != null) - Number(left.question_id != null)
                || Number(right.recommendation_priority ?? 0)
                    - Number(left.recommendation_priority ?? 0),
        );
    }, [firPrimaryQuestion, firRecommendations, resolvedRecommendationIds]);

    return (
        <AiaBox
            component="aside"
            aria-label="STTM AI Assistant"
            sx={{
                width: effectiveSidebarWidth,
                minWidth: effectiveSidebarWidth,
                maxWidth: '100%',
                flexShrink: 0,
                height: '100%',
                minHeight: 0,
                display: 'flex',
                flexDirection: 'row',
                position: 'relative',
                zIndex: AI_CHAT_SHELL_Z_INDEX,
                transition: isResizing ? 'none' : 'width 220ms ease',
                backgroundColor: '#ffffff',
                borderLeft: '1px solid #e2e8f0',
                overflow: 'hidden',
            }}
        >
            {!isMobile && !isTablet ? (
                <AiaResizeHandle
                    direction="horizontal"
                    onMouseDown={beginSidebarResize}
                    sx={{ alignSelf: 'stretch', height: '100%', width: 6, minWidth: 6 }}
                />
            ) : null}
            <AiaBox
                sx={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    backgroundColor: '#ffffff',
                }}
            >
                <AiChatSidebarHeader
                    mode={panelView}
                    onNewChat={handleNewChat}
                    onShowHistory={handleShowHistory}
                    onShowNotifications={handleShowNotifications}
                    onBackToChat={() => setPanelView('chat')}
                    onClose={closeChat}
                    notificationCount={openRecommendations.length}
                    historySearch={historySearch}
                    onHistorySearchChange={setHistorySearch}
                />
                {panelView === 'history' ? (
                    <AiChatHistoryPanel
                        sessions={sessions}
                        searchQuery={historySearch}
                        activeSessionId={activeSessionId}
                        onSelectSession={handleSelectSession}
                    />
                ) : panelView === 'notifications' ? (
                    <AiChatNotificationsPanel
                        recommendations={openRecommendations}
                        onSelectRecommendation={handleSelectRecommendation}
                    />
                ) : (
                    <AIAgentPanel variant="sidebar" />
                )}
            </AiaBox>
        </AiaBox>
    );
}
