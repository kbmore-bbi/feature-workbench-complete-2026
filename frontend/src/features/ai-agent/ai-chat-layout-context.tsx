'use client';

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import {
    AI_CHAT_DEFAULT_SIDEBAR_WIDTH,
    AI_CHAT_MAX_SIDEBAR_WIDTH,
    AI_CHAT_MIN_SIDEBAR_WIDTH,
    AI_CHAT_MOBILE_BREAKPOINT,
    AI_CHAT_RAIL_TOP_STORAGE_KEY,
    AI_CHAT_SIDEBAR_WIDTH_STORAGE_KEY,
    AI_CHAT_TABLET_BREAKPOINT,
    clampRailTop,
    getDefaultRailTop,
    loadRailTop,
    loadSidebarWidth,
} from '@/features/ai-agent/ai-chat-layout-constants';
import {
    createChatSessionId,
    deriveSessionTitle,
    loadStoredChatSessions,
    persistChatSessions,
    type StoredChatSession,
} from '@/features/ai-agent/ai-chat-session-utils';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';

type PanelView = 'chat' | 'history' | 'notifications';

type AiChatLayoutContextValue = {
    isOpen: boolean;
    panelView: PanelView;
    historySearch: string;
    sessions: StoredChatSession[];
    activeSessionId: string | null;
    selectedRecommendationId: string | null;
    resolvedRecommendationIds: ReadonlySet<string>;
    recentSessions: StoredChatSession[];
    railTop: number;
    effectiveSidebarWidth: number;
    isResizing: boolean;
    isMobile: boolean;
    isTablet: boolean;
    layoutHeight: number;
    setLayoutMetrics: (width: number, height: number) => void;
    setHistorySearch: (value: string) => void;
    setPanelView: (view: PanelView) => void;
    openChat: () => void;
    closeChat: () => void;
    handleNewChat: () => void;
    handleShowHistory: () => void;
    handleShowNotifications: () => void;
    handleSelectRecommendation: (recommendationId: string) => void;
    markRecommendationResolved: (recommendationId: string) => void;
    handleSelectSession: (session: StoredChatSession) => void;
    beginRailDrag: (event: React.MouseEvent<HTMLDivElement>) => void;
    beginRailTouchDrag: (event: React.TouchEvent<HTMLDivElement>) => void;
    beginSidebarResize: (event: React.MouseEvent<HTMLDivElement>) => void;
};

const AiChatLayoutContext = createContext<AiChatLayoutContextValue | null>(null);

function hasUserMessages(messages: { role: string }[]) {
    return messages.some((message) => message.role === 'user');
}

export function AiChatLayoutProvider({ children }: { children: ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);
    const [panelView, setPanelView] = useState<PanelView>('chat');
    const [sidebarWidth, setSidebarWidth] = useState(AI_CHAT_DEFAULT_SIDEBAR_WIDTH);
    const [isResizing, setIsResizing] = useState(false);
    const [historySearch, setHistorySearch] = useState('');
    const [sessions, setSessions] = useState<StoredChatSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [selectedRecommendationId, setSelectedRecommendationId] = useState<string | null>(null);
    const [resolvedRecommendationIds, setResolvedRecommendationIds] = useState<Set<string>>(
        () => new Set(),
    );
    const [railTop, setRailTop] = useState(0);
    const [layoutWidth, setLayoutWidth] = useState(1200);
    const [layoutHeight, setLayoutHeight] = useState(600);
    const [hydrated, setHydrated] = useState(false);
    const isDraggingRailRef = useRef(false);

    const {
        chatMessages,
        resetChatSession,
        restoreChatSession,
        session,
        activeProjectId,
        activeSttmId,
    } = useSttmBuilderContext();
    const chatScope = `${session?.user_id ?? 'anonymous'}::${activeProjectId ?? 'new'}::${activeSttmId ?? 'new'}`;

    const isMobile = layoutWidth < AI_CHAT_MOBILE_BREAKPOINT;
    const isTablet =
        layoutWidth >= AI_CHAT_MOBILE_BREAKPOINT && layoutWidth < AI_CHAT_TABLET_BREAKPOINT;

    const effectiveSidebarWidth = useMemo(() => {
        if (isMobile) {
            return Math.max(AI_CHAT_MIN_SIDEBAR_WIDTH, layoutWidth);
        }
        if (isTablet) {
            return Math.min(380, Math.max(AI_CHAT_MIN_SIDEBAR_WIDTH, layoutWidth - 16));
        }
        return Math.min(
            AI_CHAT_MAX_SIDEBAR_WIDTH,
            Math.max(
                AI_CHAT_MIN_SIDEBAR_WIDTH,
                Math.min(sidebarWidth, layoutWidth - 16),
            ),
        );
    }, [isMobile, isTablet, layoutWidth, sidebarWidth]);

    const setLayoutMetrics = useCallback((width: number, height: number) => {
        setLayoutWidth(width);
        setLayoutHeight(height);
        setRailTop((current) => clampRailTop(current || getDefaultRailTop(height), height));
    }, []);

    useEffect(() => {
        setSessions(loadStoredChatSessions(chatScope));
        setActiveSessionId(null);
        setSelectedRecommendationId(null);
        setResolvedRecommendationIds(new Set());
        setSidebarWidth(loadSidebarWidth());
        setHydrated(true);
    }, [chatScope]);

    useEffect(() => {
        if (!hydrated || layoutHeight <= 0) return;
        setRailTop((current) => {
            if (current > 0) return clampRailTop(current, layoutHeight);
            return loadRailTop(layoutHeight);
        });
    }, [hydrated, layoutHeight]);

    useEffect(() => {
        if (!hydrated) return;
        try {
            window.localStorage.setItem(AI_CHAT_RAIL_TOP_STORAGE_KEY, String(railTop));
        } catch {
            // Ignore storage errors.
        }
    }, [railTop, hydrated]);

    useEffect(() => {
        if (!hydrated || isMobile || isTablet) return;
        try {
            window.localStorage.setItem(AI_CHAT_SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
        } catch {
            // Ignore storage errors.
        }
    }, [sidebarWidth, hydrated, isMobile, isTablet]);

    const upsertCurrentSession = useCallback(() => {
        if (!hasUserMessages(chatMessages)) return;

        const sessionId = activeSessionId ?? createChatSessionId();
        const nextSession: StoredChatSession = {
            id: sessionId,
            title: deriveSessionTitle(chatMessages),
            messages: chatMessages.map((message) => ({ ...message })),
            updatedAt: Date.now(),
        };

        setSessions((previous) => {
            const filtered = previous.filter((session) => session.id !== sessionId);
            const next = [nextSession, ...filtered].slice(0, 30);
            persistChatSessions(chatScope, next);
            return next;
        });
        setActiveSessionId(sessionId);
    }, [activeSessionId, chatMessages, chatScope]);

    useEffect(() => {
        if (!hasUserMessages(chatMessages)) return;
        const timeout = window.setTimeout(() => {
            upsertCurrentSession();
        }, 400);
        return () => window.clearTimeout(timeout);
    }, [chatMessages, upsertCurrentSession]);

    const openChat = useCallback(() => {
        setIsOpen(true);
    }, []);

    const closeChat = useCallback(() => {
        setIsOpen(false);
        setPanelView('chat');
        setHistorySearch('');
    }, []);

    const handleNewChat = useCallback(() => {
        upsertCurrentSession();
        setActiveSessionId(null);
        resetChatSession();
        setPanelView('chat');
        setHistorySearch('');
    }, [resetChatSession, upsertCurrentSession]);

    const handleShowHistory = useCallback(() => {
        upsertCurrentSession();
        setPanelView('history');
    }, [upsertCurrentSession]);

    const handleShowNotifications = useCallback(() => {
        setPanelView('notifications');
    }, []);

    const handleSelectRecommendation = useCallback((recommendationId: string) => {
        setSelectedRecommendationId(recommendationId);
        setPanelView('chat');
        setIsOpen(true);
    }, []);

    const markRecommendationResolved = useCallback((recommendationId: string) => {
        setResolvedRecommendationIds((current) => {
            const next = new Set(current);
            next.add(recommendationId);
            return next;
        });
        setSelectedRecommendationId((current) =>
            current === recommendationId ? null : current,
        );
    }, []);

    const handleSelectSession = useCallback(
        (session: StoredChatSession) => {
            setActiveSessionId(session.id);
            restoreChatSession({ messages: session.messages });
            setPanelView('chat');
        },
        [restoreChatSession],
    );

    const beginRailDrag = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            event.preventDefault();
            event.stopPropagation();
            isDraggingRailRef.current = false;

            const startY = event.clientY;
            const startTop = railTop;

            const onMove = (moveEvent: MouseEvent) => {
                const deltaY = moveEvent.clientY - startY;
                if (Math.abs(deltaY) > 4) {
                    isDraggingRailRef.current = true;
                }
                setRailTop(clampRailTop(startTop + deltaY, layoutHeight));
            };

            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                window.setTimeout(() => {
                    isDraggingRailRef.current = false;
                }, 0);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        },
        [layoutHeight, railTop],
    );

    const beginRailTouchDrag = useCallback(
        (event: React.TouchEvent<HTMLDivElement>) => {
            event.stopPropagation();
            isDraggingRailRef.current = false;

            const startY = event.touches[0]?.clientY ?? 0;
            const startTop = railTop;

            const onMove = (moveEvent: TouchEvent) => {
                const clientY = moveEvent.touches[0]?.clientY;
                if (clientY == null) return;
                const deltaY = clientY - startY;
                if (Math.abs(deltaY) > 4) {
                    isDraggingRailRef.current = true;
                }
                setRailTop(clampRailTop(startTop + deltaY, layoutHeight));
            };

            const onEnd = () => {
                document.removeEventListener('touchmove', onMove);
                document.removeEventListener('touchend', onEnd);
                window.setTimeout(() => {
                    isDraggingRailRef.current = false;
                }, 0);
            };

            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onEnd);
        },
        [layoutHeight, railTop],
    );

    const beginSidebarResize = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            if (isMobile || isTablet) return;
            event.preventDefault();
            setIsResizing(true);
            const startX = event.clientX;
            const startWidth = sidebarWidth;

            const onMove = (moveEvent: MouseEvent) => {
                const nextWidth = Math.min(
                    Math.min(AI_CHAT_MAX_SIDEBAR_WIDTH, layoutWidth - 16),
                    Math.max(AI_CHAT_MIN_SIDEBAR_WIDTH, startWidth + (startX - moveEvent.clientX)),
                );
                setSidebarWidth(nextWidth);
            };

            const onUp = () => {
                setIsResizing(false);
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        },
        [isMobile, isTablet, layoutWidth, sidebarWidth],
    );

    const value = useMemo(
        () => ({
            isOpen,
            panelView,
            historySearch,
            sessions,
            activeSessionId,
            selectedRecommendationId,
            resolvedRecommendationIds,
            recentSessions: sessions.slice(0, 3),
            railTop,
            effectiveSidebarWidth,
            isResizing,
            isMobile,
            isTablet,
            layoutHeight,
            setLayoutMetrics,
            setHistorySearch,
            setPanelView,
            openChat,
            closeChat,
            handleNewChat,
            handleShowHistory,
            handleShowNotifications,
            handleSelectRecommendation,
            markRecommendationResolved,
            handleSelectSession,
            beginRailDrag,
            beginRailTouchDrag,
            beginSidebarResize,
        }),
        [
            isOpen,
            panelView,
            historySearch,
            sessions,
            activeSessionId,
            selectedRecommendationId,
            resolvedRecommendationIds,
            railTop,
            effectiveSidebarWidth,
            isResizing,
            isMobile,
            isTablet,
            layoutHeight,
            setLayoutMetrics,
            openChat,
            closeChat,
            handleNewChat,
            handleShowHistory,
            handleShowNotifications,
            handleSelectRecommendation,
            markRecommendationResolved,
            handleSelectSession,
            beginRailDrag,
            beginRailTouchDrag,
            beginSidebarResize,
        ],
    );

    return <AiChatLayoutContext.Provider value={value}>{children}</AiChatLayoutContext.Provider>;
}

export function useAiChatLayout() {
    const context = useContext(AiChatLayoutContext);
    if (!context) {
        throw new Error('useAiChatLayout must be used within AiChatLayoutProvider');
    }
    return context;
}
