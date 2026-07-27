'use client';
import { AiaBox } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import { FiberManualRecordIcon } from '@/utils/icons';
import { SqlEditorActions } from './sql-editor-actions';
import type { SqlEditorActionsProps } from './sql-editor-actions';
import type { ReactNode } from 'react';

type SqlEditorToolbarProps = {
  title?: string;
  subtitle?: string;
  toolbarActions?: ReactNode;
  value: string;
  readOnly?: boolean;
  showCopy?: boolean;
  showUpload?: boolean;
  copyFeedback?: string | null;
  onCopy?: SqlEditorActionsProps['onCopy'];
  onUpload?: SqlEditorActionsProps['onUpload'];
  onUploadError?: SqlEditorActionsProps['onUploadError'];
  onCopySuccess?: SqlEditorActionsProps['onCopySuccess'];
  onCopyError?: SqlEditorActionsProps['onCopyError'];
  onCopyFeedback?: SqlEditorActionsProps['onCopyFeedback'];
};

export function SqlEditorToolbar({
  title = 'SQL Preview',
  subtitle,
  toolbarActions,
  value,
  readOnly = false,
  showCopy = false,
  showUpload = false,
  copyFeedback,
  onCopy,
  onUpload,
  onUploadError,
  onCopySuccess,
  onCopyError,
  onCopyFeedback,
}: SqlEditorToolbarProps) {
  return (
    <AiaBox
      sx={{
        px: 3,
        py: 2,
        borderBottom: '1px solid #1f2937',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 1,
        flexShrink: 0,
      }}
    >
      <AiaBox sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <FiberManualRecordIcon sx={{ fontSize: 10, color: '#22c55e' }} />
        <AiaText sx={{ fontSize: '0.82rem', fontWeight: 700, color: '#fff' }}>
          {title}
        </AiaText>
        {subtitle ? (
          <AiaText sx={{ fontSize: '0.72rem', color: '#9ca3af' }}>{subtitle}</AiaText>
        ) : null}
      </AiaBox>

      <AiaBox sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        {toolbarActions}
        <SqlEditorActions
          value={value}
          readOnly={readOnly}
          showCopy={showCopy}
          showUpload={showUpload}
          copyFeedback={copyFeedback}
          onCopy={onCopy}
          onUpload={onUpload}
          onUploadError={onUploadError}
          onCopySuccess={onCopySuccess}
          onCopyError={onCopyError}
          onCopyFeedback={onCopyFeedback}
        />
      </AiaBox>
    </AiaBox>
  );
}
