"use client";
import { AiaBox, AiaPaper } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import type { ReactNode } from "react";
import { SECONDARY_TEXT_SX } from '@/config/typography-tokens';

type StatCardProps = {
  icon: ReactNode;
  label: string;
  value: string | number;
};

export default function StatCard({ icon, label, value }: StatCardProps) {
  return (
    <AiaPaper
      elevation={0}
      className="rounded-[20px] border border-[#EEF2F7] bg-[#FAFBFC] px-5 py-4"
    >
      <AiaBox className="flex items-center justify-between gap-3">
        <AiaText
          sx={{
            fontSize: "48px",
            fontWeight: 600,
            lineHeight: 1,
            color: "#111827",
          }}
        >
          {value}
        </AiaText>

        <AiaBox
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            p: 1.25,
            borderRadius: "12px",
            border: "1px solid #DCE3EC",
            bgcolor: "#FFFFFF",
            color: "#111827",
          }}
        >
          {icon}
        </AiaBox>
      </AiaBox>

      <AiaText sx={{ ...SECONDARY_TEXT_SX, mt: 3, fontWeight: 500 }}>
        {label}
      </AiaText>
    </AiaPaper>
  );
}
