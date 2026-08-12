'use client';

import { AiaBox, AiaButton, AiaPaper } from '@/components/ui';
import { AddRoundedIcon } from '@/utils/icons';
import { useState } from 'react';
import { useAdministration } from '../context/administration-context';
import AdminPageHeader from '../shared/admin-page-header';
import {
  adminContentScrollSx,
  adminPageShellSx,
} from '../shared/administration-ui-styles';
import type { AdminUserListItem } from './user-management-data';
import UserFormModal from './user-form-modal';
import UserManagementTable from './user-management-table';
import type { UserProfileInput } from '../shared/administration-utils';
import { TOUR_TARGETS } from '@/features/tour/constants/tour-targets';

export default function UserManagementPage() {
  const { users, createUser, updateUser } = useAdministration();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUserListItem | null>(null);

  const handleCreateUser = (input: UserProfileInput) => {
    createUser(input);
  };

  const handleUpdateUser = (input: UserProfileInput) => {
    if (!editingUser) {
      return;
    }
    updateUser(editingUser.id, input);
    setEditingUser(null);
  };

  return (
    <AiaBox sx={adminPageShellSx}>
      <AiaBox sx={adminContentScrollSx}>
        <AiaBox className="px-5 py-4">
          <AiaBox data-tour={TOUR_TARGETS.adminPageHeader}>
            <AdminPageHeader
              title="User Management"
              subtitle="Create users, update roles, and control account access"
              actions={
                <AiaButton
                  variant="contained"
                  color="primary"
                  size="medium"
                  data-tour={TOUR_TARGETS.adminAddUser}
                  startIcon={<AddRoundedIcon sx={{ fontSize: 18 }} />}
                  onClick={() => setIsCreateOpen(true)}
                >
                  Add User
                </AiaButton>
              }
            />
          </AiaBox>

          <AiaPaper
            elevation={0}
            data-tour={TOUR_TARGETS.adminUsersTable}
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
            <UserManagementTable rows={users} onEditProfile={setEditingUser} />
          </AiaPaper>
        </AiaBox>
      </AiaBox>

      <UserFormModal
        open={isCreateOpen}
        mode="create"
        onClose={() => setIsCreateOpen(false)}
        onSubmit={handleCreateUser}
      />

      <UserFormModal
        open={Boolean(editingUser)}
        mode="edit"
        initialValues={
          editingUser
            ? {
                name: editingUser.name,
                email: editingUser.email,
                role: editingUser.role,
                status: editingUser.status,
              }
            : undefined
        }
        lockEditable={!editingUser?.isPrimaryAdmin}
        onClose={() => setEditingUser(null)}
        onSubmit={handleUpdateUser}
      />
    </AiaBox>
  );
}
