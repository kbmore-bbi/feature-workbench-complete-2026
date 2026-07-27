import type { SxProps, Theme } from "@mui/material/styles";
import { SIDEBAR_NAV_TOKENS } from "@/config/sidebar-nav-tokens";

export const sttmSidebarIconSlotSx: SxProps<Theme> = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: SIDEBAR_NAV_TOKENS.iconSlotSize,
  height: SIDEBAR_NAV_TOKENS.iconSlotSize,
  minWidth: SIDEBAR_NAV_TOKENS.iconSlotSize,
  minHeight: SIDEBAR_NAV_TOKENS.iconSlotSize,
  flexShrink: 0,
  overflow: "visible",
  "& .MuiSvgIcon-root": {
    display: "block",
    overflow: "visible",
    fontSize: "var(--aia-sidebar-nav-icon-size)",
    lineHeight: 1,
  },
};
