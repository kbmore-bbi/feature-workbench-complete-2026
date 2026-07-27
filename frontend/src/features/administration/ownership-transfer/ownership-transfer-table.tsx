'use client';

import { AiaButton } from '@/components/ui';
import {
  AiaDataTable,
  AiaDataTableTextCell,
  type AiaDataTableColumnDef,
} from '@/components/ui/aia-table';
import { EastRoundedIcon } from '@/utils/icons';
import { useMemo } from 'react';
import type { OwnershipTransferListItem, OwnershipTransferStatus } from '@/data/mock/administration';
import OwnershipTransferStatusBadge from './ownership-transfer-status-badge';

const STATUS_FILTER_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'Published', value: 'Published' },
  { label: 'Draft', value: 'Draft' },
  { label: 'In Review', value: 'In Review' },
];

type SortKey = 'mappingName' | 'owner' | 'project' | 'lastModified' | 'status';

type OwnershipTransferTableProps = {
  rows: OwnershipTransferListItem[];
  onTransfer: (item: OwnershipTransferListItem) => void;
};

export default function OwnershipTransferTable({ rows, onTransfer }: OwnershipTransferTableProps) {
  const columns = useMemo<Array<AiaDataTableColumnDef<OwnershipTransferListItem, SortKey>>>(
    () => [
      {
        id: 'mappingName',
        header: 'Mapping Name',
        minWidth: 220,
        sortable: true,
        sortKey: 'mappingName',
        filter: { type: 'text', getValue: (item) => item.mappingName },
        getSortValue: (item) => item.mappingName,
        renderCell: (item) => (
          <AiaDataTableTextCell wrap>{item.mappingName}</AiaDataTableTextCell>
        ),
      },
      {
        id: 'owner',
        header: 'Current Owner',
        minWidth: 180,
        sortable: true,
        sortKey: 'owner',
        filter: { type: 'text', getValue: (item) => item.owner.name },
        getSortValue: (item) => item.owner.name,
        renderCell: (item) => <AiaDataTableTextCell>{item.owner.name}</AiaDataTableTextCell>,
      },
      {
        id: 'project',
        header: 'Project',
        minWidth: 160,
        sortable: true,
        sortKey: 'project',
        filter: { type: 'text', getValue: (item) => item.projectName },
        getSortValue: (item) => item.projectName,
        renderCell: (item) => <AiaDataTableTextCell>{item.projectName}</AiaDataTableTextCell>,
      },
      {
        id: 'lastModified',
        header: 'Last Modified',
        minWidth: 140,
        sortable: true,
        sortKey: 'lastModified',
        filter: { type: 'text', getValue: (item) => item.lastModified },
        getSortValue: (item) => item.lastModified,
        renderCell: (item) => (
          <AiaDataTableTextCell nowrap>{item.lastModified}</AiaDataTableTextCell>
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
          getValue: (item) => item.status,
          match: (rowValue, filterValue) =>
            rowValue === (filterValue as OwnershipTransferStatus),
        },
        getSortValue: (item) => item.status,
        renderCell: (item) => <OwnershipTransferStatusBadge status={item.status} />,
      },
      {
        id: 'action',
        header: 'Action',
        minWidth: 120,
        align: 'center',
        filter: { type: 'none' },
        renderCell: (item) => (
          <AiaButton
            variant="outlined"
            size="small"
            customColor="var(--aia-button-color)"
            customBorderColor="var(--aia-button-color)"
            startIcon={<EastRoundedIcon sx={{ fontSize: 14 }} />}
            onClick={() => onTransfer(item)}
          >
            Transfer Ownership
          </AiaButton>
        ),
      },
    ],
    [onTransfer],
  );

  return (
    <AiaDataTable
      rows={rows}
      columns={columns}
      getRowId={(item) => item.id}
      defaultSort={{ key: 'mappingName', direction: 'asc' }}
      emptyMessage="No mappings match the current column filters."
    />
  );
}
