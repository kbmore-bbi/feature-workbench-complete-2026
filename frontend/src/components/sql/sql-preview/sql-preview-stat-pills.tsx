'use client';
import { AiaChip } from '@/components/ui';

import { SQL_PREVIEW_COUNT_CHIP_PROPS } from './sql-preview-styles';

export type SqlPreviewStat = {
  id: string;
  label: string;
};

type SqlPreviewStatPillsProps = {
  stats: SqlPreviewStat[];
};

export function SqlPreviewStatPills({ stats }: SqlPreviewStatPillsProps) {
  if (!stats.length) {
    return null;
  }

  return (
    <>
      {stats.map((stat) => (
        <AiaChip key={stat.id} label={stat.label} {...SQL_PREVIEW_COUNT_CHIP_PROPS} />
      ))}
    </>
  );
}
