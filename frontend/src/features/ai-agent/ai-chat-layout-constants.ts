export const AI_CHAT_RAIL_WIDTH = 44;
export const AI_CHAT_RAIL_COLLAPSED_WIDTH = 32;
export const AI_CHAT_RAIL_EXPANDED_WIDTH = 52;
export const AI_CHAT_RAIL_DRAG_WIDTH = 18;
export const AI_CHAT_RAIL_HEIGHT = 72;
export const AI_CHAT_DEFAULT_SIDEBAR_WIDTH = 400;
export const AI_CHAT_MIN_SIDEBAR_WIDTH = 280;
export const AI_CHAT_MAX_SIDEBAR_WIDTH = 720;
export const AI_CHAT_MOBILE_BREAKPOINT = 640;
export const AI_CHAT_TABLET_BREAKPOINT = 900;

export const AI_CHAT_RAIL_COLOR = 'var(--color-primary, #0073a0)';
/** Keeps the rail above builder canvases, tables, and flow controls. */
export const AI_CHAT_SHELL_Z_INDEX = 1350;
/** Modals and blocking overlays that must sit above the expanded AI chat panel. */
export const MODAL_ABOVE_AI_CHAT_Z_INDEX = AI_CHAT_SHELL_Z_INDEX + 50;
export const AI_CHAT_RAIL_TOP_STORAGE_KEY = 'sttm-ai-rail-top';
export const AI_CHAT_SIDEBAR_WIDTH_STORAGE_KEY = 'sttm-ai-sidebar-width';

export function clampRailTop(top: number, containerHeight: number) {
    const minTop = 8;
    const maxTop = Math.max(minTop, containerHeight - AI_CHAT_RAIL_HEIGHT - 8);
    return Math.min(maxTop, Math.max(minTop, top));
}

export function getDefaultRailTop(containerHeight: number) {
    return Math.max(8, (containerHeight - AI_CHAT_RAIL_HEIGHT) / 2);
}

export function loadRailTop(containerHeight: number) {
    if (typeof window === 'undefined') return getDefaultRailTop(containerHeight);
    try {
        const raw = window.localStorage.getItem(AI_CHAT_RAIL_TOP_STORAGE_KEY);
        const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
        if (!Number.isFinite(parsed)) return getDefaultRailTop(containerHeight);

        // Migrate legacy viewport-based offsets from the fixed overlay layout.
        const headerRaw = getComputedStyle(document.documentElement)
            .getPropertyValue('--aia-header-height')
            .trim();
        const headerHeight = Number.parseFloat(headerRaw);
        const migrated =
            parsed > containerHeight && Number.isFinite(headerHeight)
                ? parsed - headerHeight
                : parsed;

        return clampRailTop(migrated, containerHeight);
    } catch {
        return getDefaultRailTop(containerHeight);
    }
}

export function loadSidebarWidth() {
    if (typeof window === 'undefined') return AI_CHAT_DEFAULT_SIDEBAR_WIDTH;
    try {
        const raw = window.localStorage.getItem(AI_CHAT_SIDEBAR_WIDTH_STORAGE_KEY);
        const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
        return Number.isFinite(parsed)
            ? Math.min(
                  AI_CHAT_MAX_SIDEBAR_WIDTH,
                  Math.max(AI_CHAT_MIN_SIDEBAR_WIDTH, parsed),
              )
            : AI_CHAT_DEFAULT_SIDEBAR_WIDTH;
    } catch {
        return AI_CHAT_DEFAULT_SIDEBAR_WIDTH;
    }
}
