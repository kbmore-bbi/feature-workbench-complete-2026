export const SQL_MONO_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

export const SQL_EDITOR_COLORS = {
  panelBg: '#0b1220',
  surfaceBg: '#020617',
  border: '#1f2937',
  frameBorder: '#e2e8f0',
  text: '#e5e7eb',
  muted: '#475569',
  placeholder: '#475569',
  selection: 'rgba(96, 165, 250, 0.35)',
} as const;

/** Outer frame border used on dev playground and derived-source SQL editor. */
export const SQL_EDITOR_FRAME_SX = {
  border: `1px solid ${SQL_EDITOR_COLORS.frameBorder}`,
  borderRadius: 2,
  overflow: 'hidden',
  display: 'flex',
} as const;

export const SQL_EDITOR_DEFAULT_HEIGHT = 280;
export const SQL_EDITOR_PREVIEW_HEIGHT = 220;
export const SQL_EDITOR_DERIVED_HEIGHT = 520;
export const SQL_EDITOR_PREPROCESS_EXPRESSION_HEIGHT = 580;
export const SQL_EDITOR_PANEL_MIN_HEIGHT = 240;
export const SQL_FUNCTION_LIBRARY_MIN_HEIGHT = 200;

/** Light-panel scrollbar styling (function library, etc.). */
export const SQL_PANEL_SCROLL_SX = {
  overflowY: 'auto',
  overflowX: 'hidden',
  scrollbarWidth: 'thin',
  scrollbarColor: '#cbd5e1 transparent',
  '&::-webkit-scrollbar': {
    width: 8,
  },
  '&::-webkit-scrollbar-button': {
    display: 'none',
    height: 0,
    width: 0,
  },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: '#cbd5e1',
    borderRadius: 999,
  },
  '&::-webkit-scrollbar-track': {
    backgroundColor: 'transparent',
  },
} as const;

/** Scrollbar styling: transparent track, no arrow buttons. */
export const SQL_EDITOR_SCROLL_SX = {
  overflow: 'auto',
  scrollbarWidth: 'thin',
  scrollbarColor: '#475569 transparent',
  '&::-webkit-scrollbar': {
    width: 8,
    height: 8,
  },
  '&::-webkit-scrollbar-button': {
    display: 'none',
    height: 0,
    width: 0,
  },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: '#475569',
    borderRadius: 999,
  },
  '&::-webkit-scrollbar-track': {
    backgroundColor: 'transparent',
  },
} as const;

export const SQL_EDITOR_METRICS = {
  fontSize: '0.82rem',
  lineHeight: 1.6,
  paddingX: 1.5,
  paddingY: 1.25,
  lineNumberWidth: 32,
} as const;

export const SQL_FUNCTION_CHIP_SX = {
  height: 'auto',
  borderRadius: '999px',
  bgcolor: '#f9fafb',
  border: '1px solid #e5e7eb',
  fontFamily: SQL_MONO_FONT,
  fontSize: '0.72rem',
  fontWeight: 600,
  color: '#374151',
  cursor: 'pointer',
  maxWidth: '100%',
  '&:hover': { bgcolor: '#f3f4f6', borderColor: '#d1d5db' },
} as const;

export const SQL_TOOLBAR_ICON_BUTTON_SX = {
  width: 34,
  height: 34,
  border: '1px solid #334155',
  borderRadius: 2,
  color: '#cbd5e1',
  backgroundColor: 'rgba(30,41,59,0.7)',
  '&:hover': { backgroundColor: 'rgba(51,65,85,0.78)' },
  '&.Mui-disabled': { color: '#475569', borderColor: '#1f2937' },
} as const;

/** Delay before re-highlighting while the user is typing. */
export const SQL_HIGHLIGHT_DEBOUNCE_MS = 120;
