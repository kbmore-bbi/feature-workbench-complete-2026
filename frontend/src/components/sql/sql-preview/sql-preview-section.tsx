'use client';
import { AiaBox, AiaChip } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import { SqlEditorSurface } from '../sql-editor-surface';
import {
  SQL_PREVIEW_COUNT_CHIP_PROPS,
  SQL_PREVIEW_SECTION_HEADER_SX,
  SQL_PREVIEW_SECTION_SX,
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
    <AiaBox sx={SQL_PREVIEW_SECTION_SX}>
      <AiaBox sx={SQL_PREVIEW_SECTION_HEADER_SX}>
        <AiaBox>
          <AiaText sx={{ fontSize: '0.82rem', fontWeight: 800, color: '#f8fafc' }}>
            {title}
          </AiaText>
          {subtitle ? (
            <AiaText sx={{ fontSize: '0.76rem', color: '#94a3b8' }}>{subtitle}</AiaText>
          ) : null}
        </AiaBox>
        {badge ? <AiaChip label={badge} {...SQL_PREVIEW_COUNT_CHIP_PROPS} /> : null}
      </AiaBox>
      <SqlEditorSurface
        value={sql}
        readOnly
        showLineNumbers={false}
        compact
        emptyText={emptyText}
      />
    </AiaBox>
  );
}
