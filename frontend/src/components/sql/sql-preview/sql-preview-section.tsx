'use client';

import { Box, Typography } from '@mui/material';
import { SqlEditorSurface } from '../sql-editor-surface';
import {
  SQL_PREVIEW_SECTION_HEADER_SX,
  SQL_PREVIEW_SECTION_SX,
  SQL_PREVIEW_STAT_PILL_SX,
} from './sql-preview-styles';

export type SqlPreviewSectionProps = {
  title: string;
  subtitle?: string;
  badge?: string;
  sql: string;
  emptyText?: string;
};

export function SqlPreviewSection({
  title,
  subtitle,
  badge,
  sql,
  emptyText = '-- No SQL to display',
}: SqlPreviewSectionProps) {
  return (
    <Box sx={SQL_PREVIEW_SECTION_SX}>
      <Box sx={SQL_PREVIEW_SECTION_HEADER_SX}>
        <Box>
          <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: '#f8fafc' }}>
            {title}
          </Typography>
          {subtitle ? (
            <Typography sx={{ fontSize: '0.76rem', color: '#94a3b8' }}>{subtitle}</Typography>
          ) : null}
        </Box>
        {badge ? <Box sx={SQL_PREVIEW_STAT_PILL_SX}>{badge}</Box> : null}
      </Box>
      <SqlEditorSurface
        value={sql}
        readOnly
        showLineNumbers={false}
        compact
        emptyText={emptyText}
      />
    </Box>
  );
}
