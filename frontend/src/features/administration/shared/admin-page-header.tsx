'use client';

import { AiaBox } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { SECTION_TITLE_SX, SECONDARY_TEXT_SX } from '@/config/typography-tokens';
import type { ReactNode } from 'react';

type AdminPageHeaderProps = {
  title: string;
  subtitle: string;
  actions?: ReactNode;
};

export default function AdminPageHeader({ title, subtitle, actions }: AdminPageHeaderProps) {
  return (
    <AiaBox
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 2,
        flexWrap: 'wrap',
      }}
    >
      <AiaBox>
        <AiaText sx={{ ...SECTION_TITLE_SX, letterSpacing: '-0.02em' }}>{title}</AiaText>
        <AiaText sx={{ ...SECONDARY_TEXT_SX, mt: 0.5 }}>{subtitle}</AiaText>
      </AiaBox>
      {actions ? <AiaBox sx={{ flexShrink: 0 }}>{actions}</AiaBox> : null}
    </AiaBox>
  );
}
