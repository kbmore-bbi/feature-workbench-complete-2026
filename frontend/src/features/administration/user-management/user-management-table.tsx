'use client';

import { AiaButton } from '@/components/ui';
import {
  AiaDataTable,
  AiaDataTableTextCell,
  type AiaDataTableColumnDef,
  type AiaDataTableSortDirection,
} from '@/components/ui/aia-table';
import { EditOutlinedIcon } from '@/utils/icons';
import { useMemo } from 'react';
import type { AdminUserListItem } from '@/data/mock/administration';
import AdminUserStatusBadge from './admin-user-status-badge';

const ROLE_FILTER_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'Admin', value: 'Admin' },
  { label: 'Publisher', value: 'Publisher' },
  { label: 'Editor', value: 'Editor' },
  { label: 'Viewer', value: 'Viewer' },
];

const STATUS_FILTER_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'Active', value: 'Active' },
  { label: 'Locked', value: 'Locked' },
];

type SortKey = 'user' | 'email' | 'role' | 'lastLogin' | 'mappings' | 'status';

function compareUsers(
  left: AdminUserListItem,
  right: AdminUserListItem,
  sortKey: SortKey,
  direction: AiaDataTableSortDirection,
): number {
  const factor = direction === 'asc' ? 1 : -1;

  if (left.isPrimaryAdmin !== right.isPrimaryAdmin) {
    return (Number(right.isPrimaryAdmin) - Number(left.isPrimaryAdmin)) * factor;
  }

  switch (sortKey) {
    case 'user':
      return left.name.localeCompare(right.name) * factor;
    case 'email':
      return left.email.localeCompare(right.email) * factor;
    case 'role':
      return left.role.localeCompare(right.role) * factor;
    case 'lastLogin':
      return left.lastLogin.localeCompare(right.lastLogin) * factor;
    case 'mappings':
      return (left.mappingsCount - right.mappingsCount) * factor;
    case 'status':
      return left.status.localeCompare(right.status) * factor;
    default:
      return 0;
  }
}

type UserManagementTableProps = {
  rows: AdminUserListItem[];
  onEditProfile: (user: AdminUserListItem) => void;
};

export default function UserManagementTable({ rows, onEditProfile }: UserManagementTableProps) {
  const columns = useMemo<Array<AiaDataTableColumnDef<AdminUserListItem, SortKey>>>(
    () => [
      {
        id: 'user',
        header: 'User',
        minWidth: 220,
        sortable: true,
        sortKey: 'user',
        filter: { type: 'text', getValue: (user) => user.name },
        getSortValue: (user) => user.name,
        renderCell: (user) => <AiaDataTableTextCell wrap>{user.name}</AiaDataTableTextCell>,
      },
      {
        id: 'email',
        header: 'Email',
        minWidth: 240,
        sortable: true,
        sortKey: 'email',
        filter: { type: 'text', getValue: (user) => user.email },
        getSortValue: (user) => user.email,
        renderCell: (user) => <AiaDataTableTextCell>{user.email}</AiaDataTableTextCell>,
      },
      {
        id: 'role',
        header: 'Role',
        minWidth: 120,
        sortable: true,
        sortKey: 'role',
        filter: {
          type: 'select',
          options: ROLE_FILTER_OPTIONS,
          getValue: (user) => user.role,
        },
        getSortValue: (user) => user.role,
        renderCell: (user) => <AiaDataTableTextCell>{user.role}</AiaDataTableTextCell>,
      },
      {
        id: 'lastLogin',
        header: 'Last Login',
        minWidth: 160,
        sortable: true,
        sortKey: 'lastLogin',
        filter: { type: 'text', getValue: (user) => user.lastLogin },
        getSortValue: (user) => user.lastLogin,
        renderCell: (user) => (
          <AiaDataTableTextCell nowrap>{user.lastLogin}</AiaDataTableTextCell>
        ),
      },
      {
        id: 'mappings',
        header: 'Mappings',
        minWidth: 100,
        sortable: true,
        sortKey: 'mappings',
        filter: { type: 'text', getValue: (user) => user.mappingsCount },
        getSortValue: (user) => user.mappingsCount,
        renderCell: (user) => (
          <AiaDataTableTextCell>{user.mappingsCount}</AiaDataTableTextCell>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        minWidth: 120,
        sortable: true,
        sortKey: 'status',
        filter: {
          type: 'select',
          options: STATUS_FILTER_OPTIONS,
          getValue: (user) => user.status,
        },
        getSortValue: (user) => user.status,
        renderCell: (user) => <AdminUserStatusBadge status={user.status} />,
      },
      {
        id: 'actions',
        header: 'Actions',
        minWidth: 140,
        align: 'center',
        filter: { type: 'none' },
        renderCell: (user) =>
          user.isPrimaryAdmin ? null : (
            <AiaButton
              variant="outlined"
              size="small"
              customColor="var(--aia-button-color)"
              customBorderColor="var(--aia-button-color)"
              startIcon={<EditOutlinedIcon sx={{ fontSize: 14 }} />}
              onClick={() => onEditProfile(user)}
            >
              Edit Profile
            </AiaButton>
          ),
      },
    ],
    [onEditProfile],
  );

  return (
    <AiaDataTable
      rows={rows}
      columns={columns}
      getRowId={(user) => user.id}
      defaultSort={{ key: 'user', direction: 'asc' }}
      compareRows={compareUsers}
      emptyMessage="No users match the current column filters."
    />
  );
}
