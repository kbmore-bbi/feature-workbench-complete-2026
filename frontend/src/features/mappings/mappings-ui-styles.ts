import { BODY_SX, SECONDARY_TEXT_SX, TYPOGRAPHY_TOKENS } from '@/config/typography-tokens';

export const MAPPINGS_BORDER_RADIUS = '10px';

/** @deprecated Use mappingsBodyCellSx */
export const MAPPINGS_FONT_SIZE = `${TYPOGRAPHY_TOKENS.secondaryText.fontSize}px`;

/** Primary brand color from client config (e.g. BBI #003d59). */
export const mappingsPrimaryColor = 'var(--color-primary)';
export const mappingsPrimaryHoverColor = 'var(--aia-button-hover-color)';
export const mappingsPrimaryTextColor = 'var(--aia-button-text-color)';

export const mappingsFilterButtonSx = (active: boolean) => ({
  minWidth: 0,
  px: 1.5,
  py: 0.65,
  borderRadius: MAPPINGS_BORDER_RADIUS,
  textTransform: 'none' as const,
  fontSize: MAPPINGS_FONT_SIZE,
  fontWeight: 600,
  boxShadow: 'none',
  border: active ? `1px solid ${mappingsPrimaryColor}` : '1px solid #E5E7EB',
  bgcolor: active ? mappingsPrimaryColor : '#FFFFFF',
  color: active ? mappingsPrimaryTextColor : '#374151',
  '&:hover': {
    bgcolor: active ? mappingsPrimaryHoverColor : '#F9FAFB',
    borderColor: active ? mappingsPrimaryHoverColor : '#D1D5DB',
    boxShadow: 'none',
  },
});

/** Header cells — body typography token, secondary text color (matches mapping table). */
export const mappingsHeaderCellSx = {
  ...BODY_SX,
  color: TYPOGRAPHY_TOKENS.secondaryText.color,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
  fontWeight: 600,
};

/** Body cells — secondary text typography token, body color (matches mapping table). */
export const mappingsBodyCellSx = {
  ...SECONDARY_TEXT_SX,
  color: TYPOGRAPHY_TOKENS.body.color,
};

export const mappingsMutedTextSx = {
  ...SECONDARY_TEXT_SX,
  color: TYPOGRAPHY_TOKENS.secondaryText.color,
};

export const mappingsBodyEmphasisSx = {
  ...SECONDARY_TEXT_SX,
  color: TYPOGRAPHY_TOKENS.body.color,
  fontWeight: 600,
};

/** @deprecated Use mappingsBodyCellSx */
export const MAPPINGS_CELL_FONT_SIZE = `${TYPOGRAPHY_TOKENS.secondaryText.fontSize}px`;
/** @deprecated Use mappingsHeaderCellSx */
export const mappingsHeaderTextSx = mappingsHeaderCellSx;
/** @deprecated Use mappingsBodyCellSx */
export const mappingsCellTextSx = mappingsBodyCellSx;
