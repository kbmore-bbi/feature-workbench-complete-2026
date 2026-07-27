'use client';
import { AiaBox, AiaIconButton, AiaTooltip } from '@/components/ui';

import { useCallback, useRef } from 'react';

import { ContentCopyRoundedIcon, UploadFileRoundedIcon } from '@/utils/icons';
import { SQL_TOOLBAR_ICON_BUTTON_SX } from './sql-styles';

export type SqlEditorActionsProps = {
  value: string;
  readOnly?: boolean;
  showCopy?: boolean;
  showUpload?: boolean;
  copyFeedback?: string | null;
  onCopy?: () => void | Promise<void>;
  onUpload?: (content: string, fileName: string) => void;
  onUploadError?: (message: string) => void;
  onCopySuccess?: (message: string) => void;
  onCopyError?: (message: string) => void;
  onCopyFeedback?: (message: string | null) => void;
};

export function SqlEditorActions({
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
}: SqlEditorActionsProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleCopy = useCallback(async () => {
    if (onCopy) {
      await onCopy();
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      onCopyFeedback?.('Copied');
      onCopySuccess?.('Copied');
    } catch {
      onCopyFeedback?.('Unable to copy');
      onCopyError?.('Unable to copy');
    }
  }, [onCopy, onCopyError, onCopyFeedback, onCopySuccess, value]);

  const handleUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !onUpload) return;

      try {
        const content = await file.text();
        onUpload(content, file.name);
      } catch {
        onUploadError?.('Unable to read that SQL file.');
      } finally {
        event.target.value = '';
      }
    },
    [onUpload, onUploadError],
  );

  if (!showCopy && !(showUpload && !readOnly)) {
    return null;
  }

  return (
    <AiaBox sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      {copyFeedback ? (
        <AiaBox component="span" sx={{ fontSize: '0.7rem', color: '#86efac', fontWeight: 600 }}>
          {copyFeedback}
        </AiaBox>
      ) : null}

      {showCopy ? (
        <AiaTooltip title="Copy SQL" arrow placement="top">
          <span>
            <AiaIconButton
              onClick={handleCopy}
              disabled={!value.trim()}
              aria-label="Copy SQL"
              sx={SQL_TOOLBAR_ICON_BUTTON_SX}
            >
              <ContentCopyRoundedIcon sx={{ fontSize: 18 }} />
            </AiaIconButton>
          </span>
        </AiaTooltip>
      ) : null}

      {!readOnly && showUpload ? (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept=".sql,.txt"
            hidden
            onChange={handleUpload}
          />
          <AiaTooltip title="Upload SQL file" arrow placement="top">
            <AiaIconButton
              onClick={() => fileInputRef.current?.click()}
              aria-label="Upload SQL file"
              sx={SQL_TOOLBAR_ICON_BUTTON_SX}
            >
              <UploadFileRoundedIcon sx={{ fontSize: 18 }} />
            </AiaIconButton>
          </AiaTooltip>
        </>
      ) : null}
    </AiaBox>
  );
}
