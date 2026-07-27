'use client';

import {
  AiaDataTable,
  AiaDataTableTextCell,
  type AiaDataTableColumnDef,
} from '@/components/ui/aia-table';
import { useMemo } from 'react';
import type { AuditLogAction, AuditLogListItem } from '@/data/mock/administration';
import AuditLogActionBadge from './audit-log-action-badge';

const ACTION_FILTER_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'All', value: '' },
  { label: 'User Login', value: 'User Login' },
  { label: 'User Created', value: 'User Created' },
  { label: 'User Updated', value: 'User Updated' },
  { label: 'User Locked', value: 'User Locked' },
  { label: 'User Unlocked', value: 'User Unlocked' },
  { label: 'Mapping Published', value: 'Mapping Published' },
  { label: 'Mapping Edited', value: 'Mapping Edited' },
  { label: 'Mapping Created', value: 'Mapping Created' },
  { label: 'Mapping Locked', value: 'Mapping Locked' },
  { label: 'Mapping Unlocked', value: 'Mapping Unlocked' },
  { label: 'Ownership Transferred', value: 'Ownership Transferred' },
  { label: 'Mapping Deleted', value: 'Mapping Deleted' },
];

type SortKey = 'timestamp' | 'user' | 'target' | 'details' | 'action';

type AuditLogTableProps = {
  rows: AuditLogListItem[];
};

export default function AuditLogTable({ rows }: AuditLogTableProps) {
  const columns = useMemo<Array<AiaDataTableColumnDef<AuditLogListItem, SortKey>>>(
    () => [
      {
        id: 'timestamp',
        header: 'Timestamp',
        minWidth: 160,
        sortable: true,
        sortKey: 'timestamp',
        filter: { type: 'text', getValue: (entry) => entry.timestamp },
        getSortValue: (entry) => entry.timestamp,
        renderCell: (entry) => (
          <AiaDataTableTextCell nowrap>{entry.timestamp}</AiaDataTableTextCell>
        ),
      },
      {
        id: 'user',
        header: 'User',
        minWidth: 180,
        sortable: true,
        sortKey: 'user',
        filter: { type: 'text', getValue: (entry) => entry.user.name },
        getSortValue: (entry) => entry.user.name,
        renderCell: (entry) => (
          <AiaDataTableTextCell wrap>{entry.user.name}</AiaDataTableTextCell>
        ),
      },
      {
        id: 'target',
        header: 'Target',
        minWidth: 200,
        sortable: true,
        sortKey: 'target',
        filter: { type: 'text', getValue: (entry) => entry.target },
        getSortValue: (entry) => entry.target,
        renderCell: (entry) => <AiaDataTableTextCell>{entry.target}</AiaDataTableTextCell>,
      },
      {
        id: 'details',
        header: 'Details',
        minWidth: 320,
        sortable: true,
        sortKey: 'details',
        filter: { type: 'text', getValue: (entry) => entry.details },
        getSortValue: (entry) => entry.details,
        renderCell: (entry) => <AiaDataTableTextCell>{entry.details}</AiaDataTableTextCell>,
      },
      {
        id: 'action',
        header: 'Action',
        minWidth: 180,
        sortable: true,
        sortKey: 'action',
        filter: {
          type: 'select',
          options: ACTION_FILTER_OPTIONS,
          getValue: (entry) => entry.action,
          match: (rowValue, filterValue) =>
            rowValue === (filterValue as AuditLogAction),
        },
        getSortValue: (entry) => entry.action,
        renderCell: (entry) => <AuditLogActionBadge action={entry.action} />,
      },
    ],
    [],
  );

  return (
    <AiaDataTable
      rows={rows}
      columns={columns}
      getRowId={(entry) => entry.id}
      defaultSort={{ key: 'timestamp', direction: 'desc' }}
      emptyMessage="No audit log entries match the current column filters."
    />
  );
}
