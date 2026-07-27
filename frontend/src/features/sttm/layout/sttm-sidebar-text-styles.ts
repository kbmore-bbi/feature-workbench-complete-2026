import type { SxProps, Theme } from '@mui/material/styles';
import { BODY_SX, SECONDARY_TEXT_SX, TYPOGRAPHY_TOKENS, tokenLineHeight } from '@/config/typography-tokens';

export const sttmSidebarBodyTextSx: SxProps<Theme> = {
  ...BODY_SX,
};

export const sttmSidebarBodyTextMutedSx: SxProps<Theme> = {
  ...BODY_SX,
  color: 'var(--color-muted)',
};

export const sttmSidebarSecondaryTextSx: SxProps<Theme> = {
  ...SECONDARY_TEXT_SX,
  color: 'var(--color-muted)',
};

export const sttmSidebarSearchInputSx: SxProps<Theme> = {
  '& .MuiInputBase-input': {
    fontSize: `${TYPOGRAPHY_TOKENS.body.fontSize}px`,
    fontWeight: TYPOGRAPHY_TOKENS.body.fontWeight,
    lineHeight: tokenLineHeight(TYPOGRAPHY_TOKENS.body),
    '&::placeholder': {
      fontSize: `${TYPOGRAPHY_TOKENS.body.fontSize}px`,
      lineHeight: tokenLineHeight(TYPOGRAPHY_TOKENS.body),
    },
  },
};

export const sttmSidebarSearchboxSx: SxProps<Theme> = {
  mt: '10px',
};

export const sttmSidebarChevronSx: SxProps<Theme> = {
  fontSize: TYPOGRAPHY_TOKENS.body.fontSize + 4,
  color: 'var(--color-muted)',
  flexShrink: 0,
};

export const sttmSidebarHierarchyIconSx = {
  fontSize: TYPOGRAPHY_TOKENS.body.fontSize,
  flexShrink: 0,
} as const;

export const sttmSidebarColumnNameSx: SxProps<Theme> = {
  ...BODY_SX,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export const sttmSidebarColumnTypeSx: SxProps<Theme> = {
  ...SECONDARY_TEXT_SX,
  display: 'block',
  mt: 0,
  color: 'var(--color-muted)',
  textTransform: 'lowercase',
};

export const sttmSidebarColumnMetaSx: SxProps<Theme> = {
  ...SECONDARY_TEXT_SX,
  color: 'var(--color-muted)',
  flexShrink: 0,
  maxWidth: '42%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'right',
};
