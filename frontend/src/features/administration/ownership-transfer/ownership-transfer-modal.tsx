'use client';

import {
  AiaBox,
  AiaButton,
  AiaDialog,
  AiaDialogActions,
  AiaDialogContent,
  AiaDialogTitle,
  AiaStack,
} from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { AiaSelect, type AiaSelectOption } from '@/components/ui/aia-select';
import type { AdminUserListItem, OwnershipTransferListItem } from '@/data/mock/administration';
import { useEffect, useMemo, useState } from 'react';
import { adminBodyCellSx, adminBodyEmphasisSx } from '../shared/administration-ui-styles';

const fieldLabelSx = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: '#94A3B8',
  mb: 0.75,
} as const;

type OwnershipTransferModalProps = {
  open: boolean;
  item: OwnershipTransferListItem | null;
  users: AdminUserListItem[];
  onClose: () => void;
  onConfirm: (newOwnerId: string) => void;
};

export default function OwnershipTransferModal({
  open,
  item,
  users,
  onClose,
  onConfirm,
}: OwnershipTransferModalProps) {
  const [selectedOwnerId, setSelectedOwnerId] = useState('');

  useEffect(() => {
    if (!open || !item) {
      return;
    }
    setSelectedOwnerId('');
  }, [item, open]);

  const ownerOptions: AiaSelectOption[] = useMemo(
    () =>
      users
        .filter((user) => user.status === 'Active' && user.name !== item?.owner.name)
        .map((user) => ({
          value: user.id,
          label: `${user.name} (${user.role})`,
        })),
    [item?.owner.name, users],
  );

  const canConfirm = selectedOwnerId.length > 0;

  return (
    <AiaDialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <AiaDialogTitle sx={{ fontWeight: 700 }}>Transfer Mapping Ownership</AiaDialogTitle>
      <AiaDialogContent>
        {item ? (
          <AiaStack spacing={2} sx={{ pt: 1 }}>
            <AiaBox
              sx={{
                p: 1.5,
                borderRadius: '10px',
                border: '1px solid #E8ECF4',
                bgcolor: '#F8FAFC',
              }}
            >
              <AiaText sx={adminBodyEmphasisSx}>{item.mappingName}</AiaText>
              <AiaText sx={{ ...adminBodyCellSx, mt: 0.5 }}>
                Current owner: {item.owner.name} · Project: {item.projectName}
              </AiaText>
            </AiaBox>

            <AiaBox>
              <AiaText sx={fieldLabelSx}>NEW OWNER</AiaText>
              <AiaSelect
                fullWidth
                value={selectedOwnerId}
                placeholder="Select a user"
                options={ownerOptions}
                onChange={(value) => setSelectedOwnerId(Array.isArray(value) ? value[0] ?? '' : value)}
              />
            </AiaBox>
          </AiaStack>
        ) : null}
      </AiaDialogContent>
      <AiaDialogActions sx={{ px: 3, pb: 2.5 }}>
        <AiaButton variant="outlined" size="medium" onClick={onClose}>
          Cancel
        </AiaButton>
        <AiaButton
          variant="contained"
          color="primary"
          size="medium"
          disabled={!canConfirm}
          onClick={() => {
            if (!canConfirm) {
              return;
            }
            onConfirm(selectedOwnerId);
            onClose();
          }}
        >
          Transfer Ownership
        </AiaButton>
      </AiaDialogActions>
    </AiaDialog>
  );
}
