'use client';
import { AiaBox, AiaButton } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import { SQL_PREVIEW_VALIDATION_FOOTER_SX } from './sql-preview-styles';

export type SqlValidationFooterProps = {
  title?: string;
  message: string;
  actionLabel?: string;
  onValidate?: () => void;
  validateDisabled?: boolean;
};

export function SqlValidationFooter({
  title = 'SQL validation',
  message,
  actionLabel = 'Validate SQL',
  onValidate,
  validateDisabled = false,
}: SqlValidationFooterProps) {
  return (
    <AiaBox sx={SQL_PREVIEW_VALIDATION_FOOTER_SX}>
      <AiaBox sx={{ minWidth: 0 }}>
        <AiaText sx={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc' }}>
          {title}
        </AiaText>
        <AiaText sx={{ fontSize: '0.74rem', color: '#94a3b8' }}>{message}</AiaText>
      </AiaBox>
      <AiaButton
        variant="contained"
        size="small"
        disabled={validateDisabled}
        onClick={onValidate}
        sx={{
          minWidth: 118,
          borderRadius: '10px',
          textTransform: 'none',
          fontWeight: 700,
          bgcolor: '#133d5b',
          boxShadow: 'none',
          '&:hover': {
            bgcolor: '#1d4f74',
            boxShadow: 'none',
          },
        }}
      >
        {actionLabel}
      </AiaButton>
    </AiaBox>
  );
}
