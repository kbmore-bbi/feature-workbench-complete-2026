'use client';
import { AiaBox } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import { SQL_PREVIEW_META_BOX_SX } from './sql-preview-styles';

export type SqlPreviewMetaBoxProps = {
  lines: string[];
};

export function SqlPreviewMetaBox({ lines }: SqlPreviewMetaBoxProps) {
  if (!lines.length) {
    return null;
  }

  return (
    <AiaBox sx={SQL_PREVIEW_META_BOX_SX}>
      {lines.map((line, index) => (
        <AiaText
          key={`${index}-${line}`}
          sx={{
            fontSize: '0.82rem',
            color: index === 0 ? '#64748b' : '#94a3b8',
          }}
        >
          {line}
        </AiaText>
      ))}
    </AiaBox>
  );
}
