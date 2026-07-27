"use client";
import { AiaBox } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

type ProjectProgressBarProps = {
  label?: string;
  percent: number;
  barColor: string;
};

export default function ProjectProgressBar({
  label = "Avg. mapping coverage",
  percent,
  barColor,
}: ProjectProgressBarProps) {
  return (
    <AiaBox>
      <AiaBox sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.75 }}>
        <AiaText sx={{ fontSize: 11, color: "#94A3B8" }}>{label}</AiaText>
        <AiaText sx={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>{percent}%</AiaText>
      </AiaBox>
      <AiaBox
        sx={{
          height: 5,
          borderRadius: "999px",
          bgcolor: "#E5E7EB",
          overflow: "hidden",
        }}
      >
        <AiaBox
          sx={{
            width: `${percent}%`,
            height: "100%",
            borderRadius: "999px",
            bgcolor: barColor,
          }}
        />
      </AiaBox>
    </AiaBox>
  );
}
