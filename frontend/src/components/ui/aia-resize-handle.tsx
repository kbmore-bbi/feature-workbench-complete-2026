"use client";

import type { MouseEvent } from "react";
import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";

/** VS Code-style sash hit area (4px). */
export const AIA_RESIZE_HANDLE_THICKNESS = 4;

const SASH_ACCENT = "var(--color-primary-save, #0073a0)";
const SASH_DIVIDER = "#e5e7eb";

type AiaResizeHandleProps = {
  direction: "horizontal" | "vertical";
  active?: boolean;
  onMouseDown?: (event: MouseEvent<HTMLDivElement>) => void;
  sx?: SxProps<Theme>;
  className?: string;
};

export function AiaResizeHandle({
  direction,
  active = true,
  onMouseDown,
  sx,
  className,
}: AiaResizeHandleProps) {
  const isHorizontal = direction === "horizontal";

  return (
    <Box
      className={className}
      onMouseDown={active ? onMouseDown : undefined}
      role="separator"
      aria-orientation={isHorizontal ? "vertical" : "horizontal"}
      aria-label={isHorizontal ? "Resize width" : "Resize height"}
      sx={[
        {
          position: "relative",
          flexShrink: 0,
          p: 0,
          backgroundColor: "transparent",
          touchAction: "none",
          cursor: active ? (isHorizontal ? "col-resize" : "row-resize") : "default",
          ...(isHorizontal
            ? {
                width: AIA_RESIZE_HANDLE_THICKNESS,
                minWidth: AIA_RESIZE_HANDLE_THICKNESS,
              }
            : {
                height: AIA_RESIZE_HANDLE_THICKNESS,
                minHeight: AIA_RESIZE_HANDLE_THICKNESS,
                width: "100%",
              }),
          "&::before": {
            content: '""',
            position: "absolute",
            pointerEvents: "none",
            transition: "background-color 120ms ease",
            ...(isHorizontal
              ? {
                  top: 0,
                  bottom: 0,
                  left: "50%",
                  width: "1px",
                  transform: "translateX(-50%)",
                  backgroundColor: "transparent",
                }
              : {
                  left: 0,
                  right: 0,
                  top: "50%",
                  height: "1px",
                  transform: "translateY(-50%)",
                  backgroundColor: SASH_DIVIDER,
                }),
          },
          ...(active
            ? {
                "&:hover::before, &:active::before": {
                  backgroundColor: SASH_ACCENT,
                },
              }
            : {}),
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    />
  );
}

export type { AiaResizeHandleProps };
