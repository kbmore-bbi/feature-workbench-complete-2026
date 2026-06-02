'use client';
import { Box, Typography } from '@mui/material';
import { FiberManualRecordIcon } from '@/utils/icons';

import { SqlEditorActions } from './sql-editor-actions';
import type { SqlEditorActionsProps } from './sql-editor-actions';

type SqlEditorToolbarProps = {
  title?: string;
  subtitle?: string;
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
    <Box
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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <FiberManualRecordIcon sx={{ fontSize: 10, color: '#22c55e' }} />
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: '#fff' }}>
          {title}
        </Typography>
        {subtitle ? (
          <Typography sx={{ fontSize: '0.72rem', color: '#9ca3af' }}>{subtitle}</Typography>
        ) : null}
      </Box>

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
    </Box>
  );
}
