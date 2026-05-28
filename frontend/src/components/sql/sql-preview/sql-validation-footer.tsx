'use client';

import { Box, Button, Typography } from '@mui/material';
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
    <Box sx={SQL_PREVIEW_VALIDATION_FOOTER_SX}>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc' }}>
          {title}
        </Typography>
        <Typography sx={{ fontSize: '0.74rem', color: '#94a3b8' }}>{message}</Typography>
      </Box>
      <Button
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
      </Button>
    </Box>
  );
}
