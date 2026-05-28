"use client";

import type { ReactNode } from "react";
import { Box, Button, Typography } from "@mui/material";

export type BuilderWorkspaceTab<T extends string> = {
  key: T;
  label: string;
  icon?: ReactNode;
  badge?: string | number;
};

type BuilderWorkspaceTabBarProps<T extends string> = {
  tabs: Array<BuilderWorkspaceTab<T>>;
  activeTab: T;
  onTabChange: (tab: T) => void;
  trailing?: ReactNode;
  afterTabs?: ReactNode;
  embedded?: boolean;
  backgroundColor?: string;
};

function TabBadge({ value }: { value: string | number }) {
  const label = String(value);

  return (
    <Box
      component="span"
      sx={{
        ml: 0.35,
        width: label.length > 1 ? "auto" : 18,
        minWidth: 18,
        height: 18,
        px: label.length > 1 ? 0.35 : 0,
        borderRadius: "999px",
        bgcolor: "#0f172a",
        color: "#ffffff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Typography
        component="span"
        sx={{
          fontSize: "0.62rem",
          fontWeight: 700,
          lineHeight: 1,
          display: "block",
          transform: "translateY(0.5px)",
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}

export function BuilderWorkspaceTabBar<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  trailing,
  afterTabs,
  embedded = false,
  backgroundColor = "#fff",
}: BuilderWorkspaceTabBarProps<T>) {
  const content = (
    <>
      {tabs.map((tab) => {
        const selected = activeTab === tab.key;
        return (
          <Button
            key={tab.key}
            variant="text"
            onClick={() => onTabChange(tab.key)}
            sx={{
              minWidth: 0,
              px: 0.75,
              py: 1.2,
              minHeight: 42,
              borderRadius: 0,
              textTransform: "none",
              fontSize: "0.82rem",
              fontWeight: selected ? 600 : 400,
              display: "inline-flex",
              gap: 0.55,
              alignItems: "center",
              color: selected ? "#0f172a" : "#64748b",
              backgroundColor: "transparent",
              border: "none",
              borderBottom: selected ? "2px solid #0f172a" : "2px solid transparent",
              boxShadow: "none",
              mb: "-1px",
              "&:hover": {
                backgroundColor: "transparent",
                color: selected ? "#0f172a" : "#475569",
                boxShadow: "none",
              },
            }}
          >
            {tab.icon}
            {tab.label}
            {tab.badge !== undefined ? <TabBadge value={tab.badge} /> : null}
          </Button>
        );
      })}
      {afterTabs}
      {trailing ? (
        <Box sx={{ ml: "auto", display: "flex", alignItems: "center", minWidth: 0, flexShrink: 0 }}>
          {trailing}
        </Box>
      ) : null}
    </>
  );

  if (embedded) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0, flexWrap: "wrap" }}>
        {content}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        px: 2,
        py: 0,
        borderBottom: "1px solid #e5e7eb",
        backgroundColor,
        minWidth: 0,
        flexWrap: "wrap",
      }}
    >
      {content}
    </Box>
  );
}
