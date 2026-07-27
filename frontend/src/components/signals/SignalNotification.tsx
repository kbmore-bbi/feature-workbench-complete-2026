'use client';

/**
 * Signal Notification component for displaying real-time FIR signals.
 */

import { useCallback, useMemo } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  IconButton,
  Slide,
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import type { Signal, SignalPriority } from '@/hooks/useSignals';

export interface SignalNotificationProps {
  signal: Signal;
  onDismiss?: (signalId: string) => void;
  onOptionSelect?: (signalId: string, optionId: string, action?: string) => void;
}

const priorityConfig: Record<
  SignalPriority,
  { severity: 'error' | 'warning' | 'info' | 'success'; icon: React.ReactNode }
> = {
  critical: { severity: 'error', icon: <ErrorOutlineIcon /> },
  high: { severity: 'warning', icon: <WarningAmberIcon /> },
  medium: { severity: 'info', icon: <InfoOutlinedIcon /> },
  low: { severity: 'success', icon: <LightbulbOutlinedIcon /> },
  informational: { severity: 'info', icon: <CheckCircleOutlineIcon /> },
};

export function SignalNotification({
  signal,
  onDismiss,
  onOptionSelect,
}: SignalNotificationProps) {
  const config = useMemo(
    () => priorityConfig[signal.priority] || priorityConfig.medium,
    [signal.priority]
  );

  const handleDismiss = useCallback(() => {
    onDismiss?.(signal.signal_id);
  }, [signal.signal_id, onDismiss]);

  const handleOptionClick = useCallback(
    (optionId: string, action?: string) => {
      onOptionSelect?.(signal.signal_id, optionId, action);
      if (action === 'dismiss') {
        handleDismiss();
      }
    },
    [signal.signal_id, onOptionSelect, handleDismiss]
  );

  return (
    <Slide direction="left" in mountOnEnter unmountOnExit>
      <Alert
        severity={config.severity}
        icon={config.icon}
        sx={{
          width: '100%',
          maxWidth: 400,
          boxShadow: 2,
          borderRadius: 1,
          '& .MuiAlert-message': {
            width: '100%',
          },
        }}
        action={
          <IconButton
            aria-label="dismiss"
            color="inherit"
            size="small"
            onClick={handleDismiss}
          >
            <CloseIcon fontSize="inherit" />
          </IconButton>
        }
      >
        <AlertTitle sx={{ fontWeight: 600, fontSize: '0.875rem' }}>
          {signal.title}
        </AlertTitle>
        <Typography variant="body2" sx={{ mb: signal.options?.length ? 1 : 0 }}>
          {signal.message}
        </Typography>

        {signal.options && signal.options.length > 0 && (
          <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
            {signal.options.map((option) => (
              <Button
                key={option.id}
                size="small"
                variant={option.action === 'dismiss' ? 'text' : 'outlined'}
                onClick={() => handleOptionClick(option.id, option.action)}
                sx={{ fontSize: '0.75rem', py: 0.25, px: 1 }}
              >
                {option.label}
              </Button>
            ))}
          </Stack>
        )}

        {Boolean(signal.metadata?.trigger) && (
          <Chip
            label={String(signal.metadata?.trigger)}
            size="small"
            variant="outlined"
            sx={{ mt: 1, fontSize: '0.65rem', height: 18 }}
          />
        )}
      </Alert>
    </Slide>
  );
}

export interface SignalNotificationStackProps {
  signals: Signal[];
  onDismiss?: (signalId: string) => void;
  onOptionSelect?: (signalId: string, optionId: string, action?: string) => void;
  maxVisible?: number;
}

export function SignalNotificationStack({
  signals,
  onDismiss,
  onOptionSelect,
  maxVisible = 3,
}: SignalNotificationStackProps) {
  const visibleSignals = useMemo(
    () => signals.slice(0, maxVisible),
    [signals, maxVisible]
  );

  const hiddenCount = Math.max(0, signals.length - maxVisible);

  if (visibleSignals.length === 0) {
    return null;
  }

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 72,
        right: 16,
        zIndex: 1300,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        maxWidth: 400,
      }}
    >
      {visibleSignals.map((signal) => (
        <SignalNotification
          key={signal.signal_id}
          signal={signal}
          onDismiss={onDismiss}
          onOptionSelect={onOptionSelect}
        />
      ))}

      {hiddenCount > 0 && (
        <Typography
          variant="caption"
          sx={{
            textAlign: 'right',
            color: 'text.secondary',
            pr: 1,
          }}
        >
          +{hiddenCount} more notification{hiddenCount > 1 ? 's' : ''}
        </Typography>
      )}
    </Box>
  );
}
