import { CLIENT_CONFIG } from "@/config/client.config";
import type { ButtonSizeToken } from "@/types/client-config";
import type { SxProps, Theme } from "@mui/material/styles";

export type AiaButtonSize = "small" | "medium" | "large";

export const BUTTON_SIZE_TOKENS = CLIENT_CONFIG.theme.button;

export function buttonSizeTokenToSx(token: ButtonSizeToken): SxProps<Theme> {
  return {
    fontSize: `${token.fontSize}px`,
    fontWeight: token.fontWeight,
    paddingTop: `${token.paddingTop}px`,
    paddingBottom: `${token.paddingBottom}px`,
    paddingLeft: `${token.paddingX}px`,
    paddingRight: `${token.paddingX}px`,
    minHeight: `${token.minHeight}px`,
    letterSpacing: `${token.letterSpacing}px`,
    lineHeight: 1.2,
  };
}

export function getButtonSizeSx(size: AiaButtonSize): SxProps<Theme> {
  return buttonSizeTokenToSx(BUTTON_SIZE_TOKENS[size]);
}
