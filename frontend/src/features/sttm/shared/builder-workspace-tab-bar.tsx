"use client";
import { AiaBox, AiaButton } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import type { ReactNode } from "react";

export type BuilderWorkspaceTab<T extends string> = {
  key: T;
  label: string;
  icon?: ReactNode;
  badge?: string | number;
  tourTarget?: string;
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
    <AiaBox
      component="span"
      sx={{
        ml: 0.35,
        width: label.length > 1 ? "auto" : 18,
        minWidth: 18,
        height: 18,
        px: label.length > 1 ? 0.35 : 0,
        borderRadius: "999px",
        bgcolor: "var(--color-primary)",
        color: "#ffffff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <AiaText
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
      </AiaText>
    </AiaBox>
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
          <AiaButton
            key={tab.key}
            variant="text"
            data-tour={tab.tourTarget}
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
              color: selected ? "var(--color-primary)" : "#64748b",
              backgroundColor: "transparent",
              border: "none",
              borderBottom: selected ? "2px solid var(--color-primary)" : "2px solid transparent",
              boxShadow: "none",
              mb: "-1px",
              "& .MuiSvgIcon-root": {
                color: "inherit",
              },
              "&:hover": {
                backgroundColor: "transparent",
                color: selected ? "var(--color-primary)" : "#475569",
                boxShadow: "none",
              },
            }}
          >
            {tab.icon}
            {tab.label}
            {tab.badge !== undefined ? <TabBadge value={tab.badge} /> : null}
          </AiaButton>
        );
      })}
      {afterTabs}
      {trailing ? (
        <AiaBox sx={{ ml: "auto", display: "flex", alignItems: "center", minWidth: 0, flexShrink: 0 }}>
          {trailing}
        </AiaBox>
      ) : null}
    </>
  );

  if (embedded) {
    return (
      <AiaBox sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0, flexWrap: "wrap" }}>
        {content}
      </AiaBox>
    );
  }

  return (
    <AiaBox
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
    </AiaBox>
  );
}
