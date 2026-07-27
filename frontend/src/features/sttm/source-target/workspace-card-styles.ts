export function workspaceCardSx(isSelected: boolean) {
  return {
    display: "flex",
    alignItems: "center",
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    boxSizing: "border-box",
    px: 1.25,
    py: 0.9,
    mb: 0.9,
    gap: 1,
    cursor: "pointer",
    borderRadius: "10px",
    borderColor: isSelected ? "var(--color-primary-save, #0073a0)" : "#e5e7eb",
    backgroundColor: isSelected ? "var(--aia-selection-bg)" : "#ffffff",
    color: "#111827",
    transition: "120ms ease",
    boxShadow: "none",
    "&:last-child": {
      mb: 0,
    },
    "&:hover": {
      borderColor: isSelected
        ? "var(--color-primary-save, #0073a0)"
        : "#d1d5db",
      backgroundColor: isSelected
        ? "var(--aia-selection-bg)"
        : "color-mix(in srgb, var(--aia-selection-bg) 45%, #ffffff)",
      boxShadow: "none",
    },
  } as const;
}
