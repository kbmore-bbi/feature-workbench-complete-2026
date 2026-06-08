'use client';

import { Box } from '@mui/material';
import { SqlEditorSurface } from '../sql-editor-surface';

export type SqlPreviewSqlBlockProps = {
  sql: string;
  emptyText?: string;
};

export function SqlPreviewSqlBlock({
  sql,
  emptyText = '-- No columns mapped yet. Map columns to generate SQL.',
}: SqlPreviewSqlBlockProps) {
  return (
    <Box sx={{ minHeight: 0 }}>
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
