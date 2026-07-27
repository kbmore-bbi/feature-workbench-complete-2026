import type { ReactNode } from 'react';

export type AiaDataTableSortDirection = 'asc' | 'desc';

export type AiaDataTableFilterOption = {
  label: string;
  value: string;
};

export type AiaDataTableTextFilter<TRow> = {
  type: 'text';
  placeholder?: string;
  getValue: (row: TRow) => string | number;
};

export type AiaDataTableSelectFilter<TRow> = {
  type: 'select';
  options: AiaDataTableFilterOption[];
  getValue: (row: TRow) => string;
  match?: (rowValue: string, filterValue: string) => boolean;
};

export type AiaDataTableColumnFilter<TRow> =
  | AiaDataTableTextFilter<TRow>
  | AiaDataTableSelectFilter<TRow>
  | { type: 'none' };

export type AiaDataTableColumnDef<TRow, TSortKey extends string = string> = {
  id: string;
  header: string;
  minWidth: number;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  sortKey?: TSortKey;
  filter?: AiaDataTableColumnFilter<TRow>;
  getSortValue?: (row: TRow) => string | number;
  renderCell: (row: TRow) => ReactNode;
};

export type AiaDataTableProps<TRow, TSortKey extends string = string> = {
  rows: TRow[];
  columns: Array<AiaDataTableColumnDef<TRow, TSortKey>>;
  getRowId: (row: TRow) => string;
  defaultSort: { key: TSortKey; direction?: AiaDataTableSortDirection };
  compareRows?: (
    left: TRow,
    right: TRow,
    sortKey: TSortKey,
    direction: AiaDataTableSortDirection,
  ) => number;
  emptyMessage?: string;
  rowsPerPageOptions?: number[];
  defaultRowsPerPage?: number;
};
