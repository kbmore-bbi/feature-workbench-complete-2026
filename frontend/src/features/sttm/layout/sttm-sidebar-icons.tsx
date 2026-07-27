"use client";

import { AiaIcon } from '@/components/ui';
import type { ReactElement } from "react";
import type { SxProps, Theme } from "@mui/material/styles";
import {
  AccountTreeRoundedIcon,
  AutoAwesomeRoundedIcon,
  ForwardIcon,
} from "@/utils/icons";
import { SIDEBAR_NAV_TOKENS } from "@/config/sidebar-nav-tokens";

export type SttmSidebarIconKind = "source" | "target" | "derived" | "ai";

const ICON_BY_KIND = {
  source: ForwardIcon,
  target: ForwardIcon,
  derived: AccountTreeRoundedIcon,
  ai: AutoAwesomeRoundedIcon,
} as const;

export function SttmSidebarSectionIcon({
  kind,
  sx,
  fontSize = SIDEBAR_NAV_TOKENS.iconSize,
}: {
  kind: SttmSidebarIconKind;
  sx?: SxProps<Theme>;
  fontSize?: number;
}): ReactElement {
  const Icon = ICON_BY_KIND[kind];

  return (
    <AiaIcon
      component={Icon}
      inheritViewBox={kind !== "derived"}
      sx={[
        {
          fontSize,
          flexShrink: 0,
          display: "block",
          lineHeight: 1,
          overflow: "visible",
          color: "var(--aia-sidebar-nav-icon-color)",
          ...(kind === "source" ? { transform: "scaleX(-1)" } : {}),
        },
        ...(sx ? (Array.isArray(sx) ? sx : [sx]) : []),
      ]}
    />
  );
}
