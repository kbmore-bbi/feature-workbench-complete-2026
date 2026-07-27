"use client";
import { AiaBox, AiaIconButton, AiaTooltip } from '@/components/ui';

import {
  KeyboardDoubleArrowLeftRoundedIcon,
  KeyboardDoubleArrowRightRoundedIcon,
} from "@/utils/icons";


const toggleButtonSx = {
  width: 32,
  height: 32,
  p: 0,
  color: "#64748b",
  border: "1px solid #dbe2ea",
  borderRadius: "50%",
  backgroundColor: "#ffffff",
  "&:hover": {
    backgroundColor: "#f8fafc",
  },
} as const;

type SttmSidebarCollapseFooterProps = {
  collapsed: boolean;
  onToggle: () => void;
  expandLabel?: string;
  collapseLabel?: string;
  centered?: boolean;
};

export function SttmSidebarCollapseFooter({
  collapsed,
  onToggle,
  expandLabel = "Expand sidebar",
  collapseLabel = "Collapse sidebar",
  centered = false,
}: SttmSidebarCollapseFooterProps) {
  const label = collapsed ? expandLabel : collapseLabel;

  const button = (
    <AiaIconButton
      size="small"
      aria-label={label}
      onClick={onToggle}
      sx={toggleButtonSx}
    >
      {collapsed ? (
        <KeyboardDoubleArrowRightRoundedIcon sx={{ fontSize: 18 }} />
      ) : (
        <KeyboardDoubleArrowLeftRoundedIcon sx={{ fontSize: 18 }} />
      )}
    </AiaIconButton>
  );

  return (
    <AiaBox
      sx={{
        px: centered ? 1 : 1.5,
        py: 1,
        display: "flex",
        justifyContent: centered ? "center" : "flex-start",
        alignItems: "center",
        flexShrink: 0,
        borderTop: "1px solid #eef2f7",
        backgroundColor: "var(--color-surface, #ffffff)",
      }}
    >
      {collapsed ? (
        <AiaTooltip title={expandLabel} placement="right" arrow>
          {button}
        </AiaTooltip>
      ) : (
        button
      )}
    </AiaBox>
  );
}
