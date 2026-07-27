'use client';
import { AiaBox, AiaChip, AiaStack, AiaTooltip } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { ContentCopyRoundedIcon } from '@/utils/icons';
import { TOUR_TARGETS } from '@/features/tour/constants/tour-targets';
import { SQL_PREVIEW_CHIP_PROPS } from './sql-preview-styles';
import { SqlPreviewStatPills, type SqlPreviewStat } from './sql-preview-stat-pills';

const COPY_FEEDBACK_MS = 1500;

export type SqlPreviewHeaderProps = {
  title: string;
  subtitle?: string;
  stats?: SqlPreviewStat[];
  copyValue?: string;
  onCopy?: () => void | Promise<void>;
  showCopy?: boolean;
  actions?: ReactNode;
};

export function SqlPreviewHeader({
  title,
  subtitle,
  stats = [],
  copyValue = '',
  onCopy,
  showCopy = true,
  actions,
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
    <AiaBox
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
      <AiaStack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
        <AiaBox
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: '#4ade80',
            flexShrink: 0,
          }}
        />
        <AiaText sx={{ fontSize: '0.95rem', fontWeight: 800, color: '#f8fafc' }}>
          {title}
        </AiaText>
        {subtitle ? (
          <AiaText
            sx={{
              fontSize: '0.8rem',
              color: '#64748b',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            — {subtitle}
          </AiaText>
        ) : null}
      </AiaStack>

      <AiaStack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ ml: 'auto', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}
      >
        <SqlPreviewStatPills stats={stats} />
        {actions}
        {showCopy ? (
          <AiaTooltip title={copied ? 'Copied' : 'Copy SQL'}>
            <span data-tour={TOUR_TARGETS.sttmCopySql}>
              <AiaChip
                label={copied ? 'Copied' : 'Copy SQL'}
                icon={<ContentCopyRoundedIcon />}
                clickable={Boolean(copyValue.trim() || onCopy)}
                onClick={() => {
                  void handleCopy();
                }}
                {...SQL_PREVIEW_CHIP_PROPS}
                sx={
                  !copyValue.trim() && !onCopy
                    ? { opacity: 0.45, pointerEvents: 'none' }
                    : undefined
                }
              />
            </span>
          </AiaTooltip>
        ) : null}
      </AiaStack>
    </AiaBox>
  );
}
