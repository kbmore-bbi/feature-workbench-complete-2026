import type { TextStyleToken } from "@/types/client-config";
import { CLIENT_CONFIG } from "@/config/client.config";
import type { SxProps, Theme } from "@mui/material/styles";
/** Active client typography tokens. */
export const TYPOGRAPHY_TOKENS = CLIENT_CONFIG.theme.typography;

/**
 * Config line heights are either unitless multipliers (<= 4) or absolute px paired with fontSize.
 * Always emit a unitless CSS line-height so text scales when font-size is overridden.
 */
export function tokenLineHeight(token: Pick<TextStyleToken, 'fontSize' | 'lineHeight'>): number {
  if (token.lineHeight <= 4) {
    return token.lineHeight;
  }
  if (token.fontSize <= 0) {
    return 1.2;
  }
  return token.lineHeight / token.fontSize;
}

export function textStyleSx(token: TextStyleToken): SxProps<Theme> {
  return {
    fontSize: `${token.fontSize}px`,
    fontWeight: token.fontWeight,
    lineHeight: tokenLineHeight(token),
    color: token.color,
  };
}

const TYPOGRAPHY_CSS_VAR_PREFIX: Record<keyof typeof TYPOGRAPHY_TOKENS, string> = {
  pageTitle: "--aia-page-title",
  sectionTitle: "--aia-section-title",
  subtitle: "--aia-subtitle",
  cardTitle: "--aia-card-title",
  body: "--aia-body",
  secondaryText: "--aia-type-secondary-text",
  caption: "--aia-caption",
};

export function textStyleCssVars(tokenKey: keyof typeof TYPOGRAPHY_TOKENS): SxProps<Theme> {
  const prefix = TYPOGRAPHY_CSS_VAR_PREFIX[tokenKey];
  return {
    fontSize: `var(${prefix}-font-size)`,
    fontWeight: `var(${prefix}-font-weight)`,
    lineHeight: `var(${prefix}-line-height)`,
    color: `var(${prefix}-color)`,
  };
}

export const PAGE_TITLE_SX = textStyleSx(TYPOGRAPHY_TOKENS.pageTitle);
export const SECTION_TITLE_SX = textStyleSx(TYPOGRAPHY_TOKENS.sectionTitle);
export const SUBTITLE_SX = textStyleSx(TYPOGRAPHY_TOKENS.subtitle);
export const CARD_TITLE_SX = textStyleSx(TYPOGRAPHY_TOKENS.cardTitle);
export const BODY_SX = textStyleSx(TYPOGRAPHY_TOKENS.body);
export const SECONDARY_TEXT_SX = textStyleSx(TYPOGRAPHY_TOKENS.secondaryText);
export const CAPTION_SX = textStyleSx(TYPOGRAPHY_TOKENS.caption);
