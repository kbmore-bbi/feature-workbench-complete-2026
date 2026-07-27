"use client";
import { AiaBox, AiaPaper } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { CAPTION_SX, SECONDARY_TEXT_SX } from '@/config/typography-tokens';

const quickStats = [
    { label: "Completion Rate", value: 48, color: "#6B7280" },
    { label: "Published", value: 62, color: "#6B7280" },
    { label: "In Progress", value: 23, color: "#F97316" },
];

export default function QuickStatsPanel() {
    return (
        <AiaPaper
            elevation={0}
            className="rounded-[20px] border border-[#EEF2F7] bg-white p-5"
        >
            <AiaText sx={{ ...CAPTION_SX, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Quick Stats
            </AiaText>

            <AiaBox className="mt-5 flex flex-col gap-5">
                {quickStats.map((item) => (
                    <AiaBox key={item.label}>
                        <AiaBox className="mb-2 flex items-center justify-between">
                            <AiaText sx={{ ...SECONDARY_TEXT_SX, fontWeight: 500, color: "#4B5563" }}>
                                {item.label}
                            </AiaText>
                            <AiaText sx={{ ...CAPTION_SX, fontWeight: 600, color: "#111827" }}>
                                {item.value}%
                            </AiaText>
                        </AiaBox>

                        <AiaBox className="h-[6px] rounded-full bg-[#ECEFF3]">
                            <AiaBox
                                className="h-[6px] rounded-full"
                                sx={{
                                    width: `${item.value}%`,
                                    backgroundColor: item.color,
                                }}
                            />
                        </AiaBox>
                    </AiaBox>
                ))}
            </AiaBox>
        </AiaPaper>
    );
}
