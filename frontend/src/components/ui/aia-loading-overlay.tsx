"use client";

import { AiaCircularProgress } from "./aia-feedback";
import { AiaBox, AiaPaper } from "./aia-layout";
import { AiaText } from "./aia-text";

type AiaLoadingOverlayProps = {
  open: boolean;
  label: string;
};

export function AiaLoadingOverlay({ open, label }: AiaLoadingOverlayProps) {
  if (!open) return null;

  return (
    <AiaBox
      role="status"
      aria-live="polite"
      aria-label={label}
      sx={{
        position: "absolute",
        inset: 0,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "rgba(247, 248, 250, 0.78)",
        backdropFilter: "blur(1px)",
      }}
    >
      <AiaPaper
        elevation={3}
        sx={{
          px: 3.5,
          py: 3,
          minWidth: 220,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 1.75,
          borderRadius: 2,
        }}
      >
        <AiaCircularProgress size={30} />
        <AiaText sx={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
          {label}
        </AiaText>
      </AiaPaper>
    </AiaBox>
  );
}
