'use client';

import { AiaBox, AiaButton, AiaIconButton } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { CloseOutlinedIcon } from '@/utils/icons';
import { textStyleCssVars } from '@/config/typography-tokens';

export type WorkspaceRemoveKind = 'source' | 'target' | 'derived';
export type WorkspaceRemoveMode = 'selected' | 'all';

type WorkspaceRemoveConfirmDialogProps = {
  open: boolean;
  kind: WorkspaceRemoveKind;
  mode: WorkspaceRemoveMode;
  count: number;
  onClose: () => void;
  onConfirm: () => void;
};

const KIND_LABELS = {
  source: { singular: 'source table', plural: 'source tables' },
  target: { singular: 'target table', plural: 'target tables' },
  derived: { singular: 'derived table', plural: 'derived tables' },
} as const;

function getCopy(kind: WorkspaceRemoveKind, mode: WorkspaceRemoveMode, count: number) {
  const labels = KIND_LABELS[kind];

  if (mode === 'all') {
    return {
      title: `Remove all ${labels.plural}?`,
      message: `Are you sure you want to remove all ${labels.plural} from the workspace? This action cannot be undone.`,
      confirmLabel: 'Remove all',
    };
  }

  const label = count === 1 ? labels.singular : labels.plural;
  return {
    title: `Remove ${count} ${label}?`,
    message: `Are you sure you want to remove ${count} ${label} from the workspace? This action cannot be undone.`,
    confirmLabel: 'Remove',
  };
}

export function WorkspaceRemoveConfirmDialog({
  open,
  kind,
  mode,
  count,
  onClose,
  onConfirm,
}: WorkspaceRemoveConfirmDialogProps) {
  if (!open) {
    return null;
  }

  const copy = getCopy(kind, mode, count);

  return (
    <AiaBox
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      onClick={onClose}
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 1400,
        px: 2,
        py: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(15, 23, 42, 0.42)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <AiaBox
        onClick={(event) => event.stopPropagation()}
        sx={{
          width: '100%',
          maxWidth: 480,
          borderRadius: '16px',
          border: '1px solid rgba(15, 23, 42, 0.08)',
          boxShadow: '0 30px 60px rgba(15, 23, 42, 0.18)',
          overflow: 'hidden',
          backgroundColor: '#FFFFFF',
        }}
      >
        <AiaBox
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 1.5,
            px: 2.5,
            py: 2,
            borderBottom: '1px solid #EEF2F7',
          }}
        >
          <AiaText
            sx={{
              ...textStyleCssVars('cardTitle'),
              textTransform: 'capitalize',
              letterSpacing: '-0.01em',
            }}
          >
            {copy.title}
          </AiaText>
          <AiaIconButton
            onClick={onClose}
            aria-label="Close"
            sx={{
              width: 32,
              height: 32,
              border: '1px solid #E2E8F0',
              color: '#64748B',
              bgcolor: '#FFFFFF',
              '&:hover': { bgcolor: '#F8FAFC' },
            }}
          >
            <CloseOutlinedIcon sx={{ fontSize: 18 }} />
          </AiaIconButton>
        </AiaBox>

        <AiaBox sx={{ px: 2.5, py: 2.25 }}>
          <AiaText sx={{ fontSize: 14, color: '#334155', lineHeight: 1.6 }}>
            {copy.message}
          </AiaText>
        </AiaBox>

        <AiaBox
          sx={{
            px: 2.5,
            py: 2,
            borderTop: '1px solid #EEF2F7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 1.25,
          }}
        >
          <AiaButton
            variant="outlined"
            onClick={onClose}
            sx={{
              minWidth: 96,
              height: 38,
              borderRadius: '10px',
              borderColor: '#dbe2ea',
              color: '#334155',
              fontSize: 14,
              fontWeight: 600,
              textTransform: 'none',
            }}
          >
            Cancel
          </AiaButton>
          <AiaButton
            variant="contained"
            color="primary"
            onClick={onConfirm}
            sx={{
              minWidth: 120,
              height: 38,
              borderRadius: '10px',
              fontSize: 14,
              fontWeight: 700,
              textTransform: 'none',
            }}
          >
            {copy.confirmLabel}
          </AiaButton>
        </AiaBox>
      </AiaBox>
    </AiaBox>
  );
}
