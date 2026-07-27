'use client';
import { AiaBox } from '@/components/ui';


import { SqlEditorSurface } from '../sql-editor-surface';

export type SqlPreviewSqlBlockProps = {
  sql: string;
  emptyText?: string;
  readOnly?: boolean;
  onChange?: (sql: string) => void;
};

export function SqlPreviewSqlBlock({
  sql,
  emptyText = '-- No columns mapped yet. Map columns to generate SQL.',
  readOnly = true,
  onChange,
}: SqlPreviewSqlBlockProps) {
  return (
    <AiaBox sx={{ minHeight: 0 }}>
      <SqlEditorSurface
        value={sql}
        readOnly={readOnly}
        onChange={onChange}
        showLineNumbers={false}
        compact
        emptyText={emptyText}
      />
    </AiaBox>
  );
}
