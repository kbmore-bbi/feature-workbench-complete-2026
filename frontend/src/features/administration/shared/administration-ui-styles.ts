import { BODY_SX, SECONDARY_TEXT_SX, TYPOGRAPHY_TOKENS } from '@/config/typography-tokens';

export const ADMIN_BORDER_RADIUS = '10px';

export const adminHeaderCellSx = {
  ...BODY_SX,
  color: TYPOGRAPHY_TOKENS.secondaryText.color,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
  fontWeight: 600,
};

export const adminBodyCellSx = {
  ...SECONDARY_TEXT_SX,
  color: TYPOGRAPHY_TOKENS.body.color,
};

export const adminMutedTextSx = {
  ...SECONDARY_TEXT_SX,
  color: TYPOGRAPHY_TOKENS.secondaryText.color,
};

export const adminBodyEmphasisSx = {
  ...SECONDARY_TEXT_SX,
  color: TYPOGRAPHY_TOKENS.body.color,
  fontWeight: 600,
};

export const adminTableContainerSx = {
  overflow: 'auto',
  '& table': {
    minWidth: 960,
  },
  '& .MuiTableCell-root': {
    borderBottom: '1px solid #edf2f7',
    py: 1.5,
    px: 1.5,
    verticalAlign: 'middle',
    ...adminBodyCellSx,
  },
  '& .MuiTableHead-root .MuiTableCell-root': {
    borderBottom: '1px solid #e5e7eb',
    py: 1.25,
    ...adminHeaderCellSx,
    backgroundColor: '#fafafa',
    position: 'sticky',
    top: 0,
    zIndex: 1,
  },
} as const;

export const adminPageShellSx = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  flexDirection: 'column',
  overflow: 'hidden',
  bgcolor: '#F7F8FA',
} as const;

export const adminContentScrollSx = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
} as const;
