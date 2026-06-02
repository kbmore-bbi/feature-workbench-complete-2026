"use client";

import type { ReactElement } from "react";
import type { SxProps, Theme } from "@mui/material/styles";
import {
  AccountTreeOutlinedIcon,
  AutoAwesomeRoundedIcon,
  ForwardOutlinedIcon,
  KeyboardBackspaceOutlinedIcon,
} from "@/utils/icons";

export type SttmSidebarIconKind = "source" | "target" | "derived" | "ai";

const ICON_BY_KIND = {
  source: KeyboardBackspaceOutlinedIcon,
  target: ForwardOutlinedIcon,
  derived: AccountTreeOutlinedIcon,
  ai: AutoAwesomeRoundedIcon,
} as const;

const COLOR_BY_KIND: Record<SttmSidebarIconKind, string> = {
  source: "var(--color-muted)",
  target: "var(--color-muted)",
  derived: "#16a34a",
  ai: "#6366f1",
};

export function SttmSidebarSectionIcon({
  kind,
  sx,
  fontSize = 14,
}: {
  kind: SttmSidebarIconKind;
  sx?: SxProps<Theme>;
  fontSize?: number;
}): ReactElement {
  const Icon = ICON_BY_KIND[kind];

  return (
    <Icon
      sx={[
        { fontSize, flexShrink: 0, color: COLOR_BY_KIND[kind] },
        ...(sx ? (Array.isArray(sx) ? sx : [sx]) : []),
      ]}
    />
  );
}
