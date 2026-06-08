'use client';

import { Box } from '@mui/material';
import { SQL_PREVIEW_STAT_PILL_SX } from './sql-preview-styles';

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
        <Box key={stat.id} sx={SQL_PREVIEW_STAT_PILL_SX}>
          {stat.label}
        </Box>
      ))}
    </>
  );
}
