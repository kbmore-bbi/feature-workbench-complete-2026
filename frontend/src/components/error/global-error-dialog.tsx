'use client';

import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Button,
  Typography,
  Box,
  Stack,
} from '@mui/material';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
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
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="global-error-dialog-title"
    >
      <DialogTitle id="global-error-dialog-title" sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <Box sx={{ pt: 0.25 }}>
            <ErrorIcon icon={payload.icon} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
              {payload.title}
            </Typography>
            {payload.subHeader ? (
              <Typography sx={{ fontSize: '0.82rem', color: '#64748b', mt: 0.35 }}>
                {payload.subHeader}
              </Typography>
            ) : null}
          </Box>
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ pt: 0 }}>
        <Typography sx={{ fontSize: '0.92rem', color: '#334155', lineHeight: 1.55 }}>
          {payload.message}
        </Typography>
        {payload.subMessage ? (
          <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', mt: 1.25, lineHeight: 1.45 }}>
            {payload.subMessage}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button
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
        </Button>
      </DialogActions>
    </Dialog>
  );
}
