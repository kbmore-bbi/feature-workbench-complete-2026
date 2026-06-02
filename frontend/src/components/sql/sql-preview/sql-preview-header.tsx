'use client';
import { useCallback, useEffect, useState } from 'react';
import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { ContentCopyRoundedIcon } from '@/utils/icons';

import { SqlPreviewStatPills, type SqlPreviewStat } from './sql-preview-stat-pills';

const COPY_FEEDBACK_MS = 1500;

export type SqlPreviewHeaderProps = {
  title: string;
  subtitle?: string;
  stats?: SqlPreviewStat[];
  copyValue?: string;
  onCopy?: () => void | Promise<void>;
  showCopy?: boolean;
};

export function SqlPreviewHeader({
  title,
  subtitle,
  stats = [],
  copyValue = '',
  onCopy,
  showCopy = true,
}: SqlPreviewHeaderProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timeout = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const handleCopy = useCallback(async () => {
    if (onCopy) {
      await onCopy();
      setCopied(true);
      return;
    }

    if (!copyValue.trim()) {
      return;
    }

    try {
      await navigator.clipboard.writeText(copyValue);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [copyValue, onCopy]);

  return (
    <Box
      sx={{
        px: 2,
        py: 1.35,
        borderBottom: '1px solid rgba(148,163,184,0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        flexShrink: 0,
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: '#4ade80',
            flexShrink: 0,
          }}
        />
        <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color: '#f8fafc' }}>
          {title}
        </Typography>
        {subtitle ? (
          <Typography
            sx={{
              fontSize: '0.8rem',
              color: '#64748b',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            — {subtitle}
          </Typography>
        ) : null}
      </Stack>

      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ ml: 'auto', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}
      >
        <SqlPreviewStatPills stats={stats} />
        {showCopy ? (
          <Tooltip title={copied ? 'Copied' : 'Copy SQL'}>
            <span>
              <IconButton
                size="small"
                onClick={() => {
                  void handleCopy();
                }}
                disabled={!copyValue.trim() && !onCopy}
                sx={{
                  borderRadius: '12px',
                  border: '1px solid rgba(148,163,184,0.18)',
                  color: '#e2e8f0',
                  px: 1,
                  gap: 0.75,
                }}
              >
                <ContentCopyRoundedIcon sx={{ fontSize: 16 }} />
                <Typography sx={{ fontSize: '0.76rem', fontWeight: 700 }}>
                  {copied ? 'Copied' : 'Copy SQL'}
                </Typography>
              </IconButton>
            </span>
          </Tooltip>
        ) : null}
      </Stack>
    </Box>
  );
}
