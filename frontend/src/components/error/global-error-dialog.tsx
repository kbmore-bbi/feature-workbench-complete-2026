'use client';
import { AiaBox, AiaButton, AiaDialog, AiaDialogActions, AiaDialogContent, AiaDialogTitle, AiaStack } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { ErrorOutlineRoundedIcon, InfoOutlinedIcon, WarningAmberRoundedIcon } from '@/utils/icons';

import type { AppErrorIcon, AppErrorPayload } from '@/api/errors/app-error';

type GlobalErrorDialogProps = {
  open: boolean;
  payload: AppErrorPayload | null;
  onClose: () => void;
};

function ErrorIcon({ icon }: { icon?: AppErrorIcon }) {
  const sx = { fontSize: 28 };

  if (icon === 'warning') {
    return <WarningAmberRoundedIcon sx={{ ...sx, color: '#d97706' }} />;
  }
  if (icon === 'info') {
    return <InfoOutlinedIcon sx={{ ...sx, color: '#2563eb' }} />;
  }
  return <ErrorOutlineRoundedIcon sx={{ ...sx, color: '#dc2626' }} />;
}

export function GlobalErrorDialog({ open, payload, onClose }: GlobalErrorDialogProps) {
  if (!payload) {
    return null;
  }

  return (
    <AiaDialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="global-error-dialog-title"
    >
      <AiaDialogTitle id="global-error-dialog-title" sx={{ pb: 1 }}>
        <AiaStack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <AiaBox sx={{ pt: 0.25 }}>
            <ErrorIcon icon={payload.icon} />
          </AiaBox>
          <AiaBox sx={{ minWidth: 0 }}>
            <AiaText sx={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
              {payload.title}
            </AiaText>
            {payload.subHeader ? (
              <AiaText sx={{ fontSize: '0.82rem', color: '#64748b', mt: 0.35 }}>
                {payload.subHeader}
              </AiaText>
            ) : null}
          </AiaBox>
        </AiaStack>
      </AiaDialogTitle>
      <AiaDialogContent sx={{ pt: 0 }}>
        <AiaText sx={{ fontSize: '0.92rem', color: '#334155', lineHeight: 1.55 }}>
          {payload.message}
        </AiaText>
        {payload.subMessage ? (
          <AiaText sx={{ fontSize: '0.78rem', color: '#94a3b8', mt: 1.25, lineHeight: 1.45 }}>
            {payload.subMessage}
          </AiaText>
        ) : null}
      </AiaDialogContent>
      <AiaDialogActions sx={{ px: 3, pb: 2.5 }}>
        <AiaButton
          onClick={onClose}
          variant="contained"
          sx={{
            textTransform: 'none',
            fontWeight: 700,
            borderRadius: '8px',
            boxShadow: 'none',
          }}
        >
          Close
        </AiaButton>
      </AiaDialogActions>
    </AiaDialog>
  );
}
