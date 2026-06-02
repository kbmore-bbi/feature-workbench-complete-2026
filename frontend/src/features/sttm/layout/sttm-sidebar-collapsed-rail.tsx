"use client";

import { Box, IconButton, Tooltip } from "@mui/material";
import {
  SttmSidebarSectionIcon,
  type SttmSidebarIconKind,
} from "./sttm-sidebar-icons";

export type SttmSidebarCollapsedRailItem = {
  kind: SttmSidebarIconKind;
  label: string;
};

type SttmSidebarCollapsedRailProps = {
  items: SttmSidebarCollapsedRailItem[];
};

export function SttmSidebarCollapsedRail({ items }: SttmSidebarCollapsedRailProps) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0.75,
        py: 1.25,
        px: 0.5,
        width: "100%",
      }}
    >
      {items.map((item) => (
        <Tooltip key={`${item.kind}-${item.label}`} title={item.label} placement="right">
          <IconButton
            size="small"
            aria-label={item.label}
            sx={{
              width: 32,
              height: 32,
              p: 0,
              border: "1px solid #eef2f7",
              borderRadius: "8px",
              backgroundColor: "#fafafa",
              flexShrink: 0,
              "&:hover": {
                backgroundColor: "#f1f5f9",
              },
            }}
          >
            <SttmSidebarSectionIcon kind={item.kind} fontSize={16} />
          </IconButton>
        </Tooltip>
      ))}
    </Box>
  );
}
