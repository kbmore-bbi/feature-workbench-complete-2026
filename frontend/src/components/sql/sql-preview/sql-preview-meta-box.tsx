'use client';

import { Box, Typography } from '@mui/material';
import { SQL_PREVIEW_META_BOX_SX } from './sql-preview-styles';

export type SqlPreviewMetaBoxProps = {
  lines: string[];
};

export function SqlPreviewMetaBox({ lines }: SqlPreviewMetaBoxProps) {
  if (!lines.length) {
    return null;
  }

  return (
    <Box sx={SQL_PREVIEW_META_BOX_SX}>
      {lines.map((line, index) => (
        <Typography
          key={`${index}-${line}`}
          sx={{
            fontSize: '0.82rem',
            color: index === 0 ? '#64748b' : '#94a3b8',
          }}
        >
          {line}
        </Typography>
      ))}
    </Box>
  );
}
