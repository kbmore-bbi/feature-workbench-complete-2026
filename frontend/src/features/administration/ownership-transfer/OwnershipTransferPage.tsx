'use client';

import { AiaBox, AiaPaper } from '@/components/ui';
import { useState } from 'react';
import { useAdministration } from '../context/administration-context';
import AdminPageHeader from '../shared/admin-page-header';
import {
  adminContentScrollSx,
  adminPageShellSx,
} from '../shared/administration-ui-styles';
import type { OwnershipTransferListItem } from './ownership-transfer-data';
import OwnershipTransferModal from './ownership-transfer-modal';
import OwnershipTransferTable from './ownership-transfer-table';

export default function OwnershipTransferPage() {
  const { ownershipItems, users, transferOwnership } = useAdministration();
  const [selectedItem, setSelectedItem] = useState<OwnershipTransferListItem | null>(null);

  return (
    <AiaBox sx={adminPageShellSx}>
      <AiaBox sx={adminContentScrollSx}>
        <AiaBox className="px-5 py-4">
          <AdminPageHeader
            title="Mapping Ownership Transfer"
            subtitle="Reassign mappings when team members leave or projects change owners."
          />

          <AiaPaper
            elevation={0}
            sx={{
              mt: 3,
              borderRadius: '12px',
              border: '1px solid #E8ECF4',
              overflow: 'hidden',
              bgcolor: '#FFFFFF',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 520,
              maxHeight: 'calc(100vh - 260px)',
            }}
          >
            <OwnershipTransferTable
              rows={ownershipItems}
              onTransfer={setSelectedItem}
            />
          </AiaPaper>
        </AiaBox>
      </AiaBox>

      <OwnershipTransferModal
        open={Boolean(selectedItem)}
        item={selectedItem}
        users={users}
        onClose={() => setSelectedItem(null)}
        onConfirm={(newOwnerId) => {
          if (!selectedItem) {
            return;
          }
          transferOwnership(selectedItem.id, newOwnerId);
          setSelectedItem(null);
        }}
      />
    </AiaBox>
  );
}
