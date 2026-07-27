"use client";
import { AiaBox, AiaButton, AiaStack } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import { GridViewRoundedIcon } from "@/utils/icons";

export type LineageLegendItem = {
  id: string;
  label: string;
  color: string;
};

export type LineageWorkspaceStats = {
  mapped: number;
  unmapped: number;
  transformed: number;
};

type LineageWorkspaceHeaderProps = {
  stats: LineageWorkspaceStats;
  legend: LineageLegendItem[];
  onExpandAll?: () => void;
};

const STAT_ITEMS = [
  { key: "mapped" as const, label: "mapped", color: "#22c55e" },
  { key: "unmapped" as const, label: "unmapped", color: "#94a3b8" },
  { key: "transformed" as const, label: "transformed", color: "#f97316" },
];

export function LineageWorkspaceHeader({
  stats,
  legend,
  onExpandAll,
}: LineageWorkspaceHeaderProps) {
  return (
    <AiaBox
      sx={{
        px: 2.25,
        py: 1.5,
        borderBottom: "1px solid #e2e8f0",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 2,
        flexWrap: "wrap",
        backgroundColor: "#fff",
      }}
    >
      <AiaBox sx={{ minWidth: 0 }}>
        <AiaText sx={{ fontSize: 15, fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>
          Data Lineage
        </AiaText>
        <AiaText sx={{ fontSize: 12.5, color: "#64748b", mt: 0.35, lineHeight: 1.45 }}>
          Expand cards to see column mappings · click a connection to inspect it
        </AiaText>
        <AiaStack direction="row" spacing={1.75} useFlexGap sx={{ flexWrap: "wrap", mt: 1.1 }}>
          {STAT_ITEMS.map(({ key, label, color }) => (
            <AiaStack key={key} direction="row" spacing={0.6} sx={{ alignItems: "center" }}>
              <AiaBox
                sx={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  bgcolor: color,
                  flexShrink: 0,
                }}
              />
              <AiaText sx={{ fontSize: 12, color: "#64748b", fontWeight: 500 }}>
                {stats[key]} {label}
              </AiaText>
            </AiaStack>
          ))}
        </AiaStack>
      </AiaBox>

      <AiaStack
        direction="row"
        spacing={1.5}
        useFlexGap
        sx={{ flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}
      >
        {legend.map((item) => (
          <AiaStack key={item.id} direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
            <AiaBox
              sx={{
                width: 10,
                height: 10,
                borderRadius: "2px",
                bgcolor: item.color,
                flexShrink: 0,
              }}
            />
            <AiaText sx={{ fontSize: 12.5, fontWeight: 600, color: "#334155" }}>
              {item.label}
            </AiaText>
          </AiaStack>
        ))}
        <AiaButton
          size="small"
          variant="outlined"
          startIcon={<GridViewRoundedIcon sx={{ fontSize: 16 }} />}
          onClick={onExpandAll}
          sx={{
            textTransform: "none",
            fontSize: "0.78rem",
            fontWeight: 600,
            color: "#334155",
            borderColor: "#dbe2ea",
            borderRadius: "8px",
            px: 1.25,
            py: 0.55,
            bgcolor: "#fff",
            "&:hover": {
              bgcolor: "#f8fafc",
              borderColor: "#cbd5e1",
            },
          }}
        >
          Expand All
        </AiaButton>
      </AiaStack>
    </AiaBox>
  );
}
