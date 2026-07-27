"use client";
import { AiaBox } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

type BuilderHeaderStat = {
  value: number;
  label: string;
};

type BuilderHeaderStatsPillProps = {
  items: [BuilderHeaderStat, BuilderHeaderStat];
};

function StatSegment({ value, label }: BuilderHeaderStat) {
  return (
    <AiaText
      component="span"
      sx={{ fontSize: "12px", whiteSpace: "nowrap", color: "#64748b", lineHeight: 1.2 }}
    >
      <AiaBox component="span" sx={{ fontWeight: 700, color: "#111827" }}>
        {value}
      </AiaBox>{" "}
      {label}
    </AiaText>
  );
}

export function BuilderHeaderStatsPill({ items }: BuilderHeaderStatsPillProps) {
  return (
    <AiaBox
      sx={{
        px: 1.5,
        py: 0.75,
        borderRadius: "999px",
        border: "1px solid #e5e7eb",
        backgroundColor: "#ffffff",
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        flexShrink: 0,
      }}
    >
      <StatSegment value={items[0].value} label={items[0].label} />
      <AiaText component="span" sx={{ fontSize: "12px", color: "#cbd5e1", lineHeight: 1 }}>
        ·
      </AiaText>
      <StatSegment value={items[1].value} label={items[1].label} />
    </AiaBox>
  );
}
