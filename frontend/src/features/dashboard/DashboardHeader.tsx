"use client";
import { AiaBox } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { SECTION_TITLE_SX, SECONDARY_TEXT_SX } from '@/config/typography-tokens';

export default function DashboardHeader() {
  return (
    <AiaBox>
      <AiaText sx={{ ...SECTION_TITLE_SX, letterSpacing: "-0.02em" }}>
        Dashboard
      </AiaText>
      <AiaText sx={{ ...SECONDARY_TEXT_SX, mt: 1 }}>
        Source-to-Target Mapping overview for all projects
      </AiaText>
    </AiaBox>
  );
}
