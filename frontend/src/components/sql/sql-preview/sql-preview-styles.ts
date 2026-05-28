export const SQL_PREVIEW_WORKSPACE_BG = '#0b1220';

export const SQL_PREVIEW_STAT_PILL_SX = {
  px: 1,
  py: 0.45,
  borderRadius: '999px',
  border: '1px solid rgba(148,163,184,0.18)',
  backgroundColor: 'rgba(15,23,42,0.72)',
  color: '#cbd5e1',
  fontSize: '0.73rem',
  fontWeight: 800,
  whiteSpace: 'nowrap',
} as const;

export const SQL_PREVIEW_SECTION_SX = {
  mb: 2.25,
  borderRadius: 3,
  border: '1px solid rgba(148,163,184,0.16)',
  backgroundColor: 'rgba(15,23,42,0.42)',
  overflow: 'hidden',
} as const;

export const SQL_PREVIEW_SECTION_HEADER_SX = {
  px: 1.5,
  py: 1.15,
  borderBottom: '1px solid rgba(148,163,184,0.12)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 1.5,
} as const;

export const SQL_PREVIEW_META_BOX_SX = {
  mb: 2,
  display: 'inline-grid',
  gap: 0.25,
  px: 1.5,
  py: 1.2,
  borderRadius: 2,
  border: '1px solid rgba(148,163,184,0.18)',
  backgroundColor: 'rgba(15,23,42,0.5)',
} as const;

export const SQL_PREVIEW_VALIDATION_FOOTER_SX = {
  px: 2,
  py: 1.2,
  borderTop: '1px solid rgba(148,163,184,0.12)',
  backgroundColor: 'rgba(15,23,42,0.96)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 2,
  flexShrink: 0,
  position: 'sticky',
  bottom: 0,
  zIndex: 2,
} as const;
