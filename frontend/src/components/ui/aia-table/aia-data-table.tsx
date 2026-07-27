'use client';

import type { ReactNode } from 'react';
import {
  AiaBox,
  AiaInput,
  AiaPaper,
  AiaSelect,
  AiaTableBody,
  AiaTableCellPrimitive,
  AiaTableContainer,
  AiaTableHead,
  AiaTablePagination,
  AiaTablePrimitive,
  AiaTableRowPrimitive,
} from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import {
  KeyboardArrowDownRoundedIcon,
  KeyboardArrowUpRoundedIcon,
} from '@/utils/icons';
import { useEffect, useMemo, useState } from 'react';
import {
  AIA_DATA_TABLE_BODY_TEXT_SX,
  AIA_DATA_TABLE_CONTAINER_SX,
  AIA_DATA_TABLE_FILTER_INPUT_SX,
  AIA_DATA_TABLE_FILTER_SELECT_SX,
  AIA_DATA_TABLE_HEADER_CELL_SX,
  AIA_DATA_TABLE_PAGINATION_SX,
  AIA_DATA_TABLE_ROW_SX,
  AIA_DATA_TABLE_SCROLLABLE_HEADER_CELL_SX,
  AIA_DATA_TABLE_SCROLLABLE_SEARCH_HEADER_CELL_SX,
  AIA_DATA_TABLE_SEARCH_ROW_CELL_SX,
  aiaDataTableBodyCellSx,
  aiaDataTableSx,
} from './aia-data-table-styles';
import type {
  AiaDataTableColumnDef,
  AiaDataTableProps,
  AiaDataTableSortDirection,
} from './aia-data-table.types';

const DEFAULT_ROWS_PER_PAGE = 25;
const DEFAULT_ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

function ColumnFilterInput({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <AiaInput
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      size="small"
      fullWidth
      inputProps={{ 'aria-label': placeholder }}
      sx={AIA_DATA_TABLE_FILTER_INPUT_SX}
    />
  );
}

function ColumnFilterSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <AiaSelect
      value={value}
      options={options}
      size="small"
      fullWidth
      onChange={(next) => onChange(Array.isArray(next) ? next[0] ?? '' : next)}
      sx={AIA_DATA_TABLE_FILTER_SELECT_SX}
    />
  );
}

function SortableHeader({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: AiaDataTableSortDirection;
  onClick: () => void;
}) {
  return (
    <AiaBox
      component="button"
      type="button"
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.25,
        border: 'none',
        background: 'transparent',
        p: 0,
        m: 0,
        cursor: 'pointer',
        color: 'inherit',
        font: 'inherit',
        textTransform: 'inherit',
      }}
    >
      {label}
      {active ? (
        direction === 'asc' ? (
          <KeyboardArrowUpRoundedIcon sx={{ fontSize: 16 }} />
        ) : (
          <KeyboardArrowDownRoundedIcon sx={{ fontSize: 16 }} />
        )
      ) : null}
    </AiaBox>
  );
}

type ColumnLayout = Pick<AiaDataTableColumnDef<unknown>, 'minWidth' | 'align'>;

function headerCellSx(column: ColumnLayout) {
  return {
    ...AIA_DATA_TABLE_HEADER_CELL_SX,
    ...AIA_DATA_TABLE_SCROLLABLE_HEADER_CELL_SX,
    minWidth: column.minWidth,
    width: column.minWidth,
    ...(column.align ? { textAlign: column.align } : {}),
  };
}

function searchRowCellSx(column: ColumnLayout) {
  return {
    ...AIA_DATA_TABLE_SEARCH_ROW_CELL_SX,
    ...AIA_DATA_TABLE_SCROLLABLE_SEARCH_HEADER_CELL_SX,
    minWidth: column.minWidth,
    width: column.minWidth,
    ...(column.align ? { textAlign: column.align } : {}),
  };
}

function defaultCompareRows<TRow, TSortKey extends string>(
  left: TRow,
  right: TRow,
  sortKey: TSortKey,
  direction: AiaDataTableSortDirection,
  columns: Array<AiaDataTableColumnDef<TRow, TSortKey>>,
): number {
  const factor = direction === 'asc' ? 1 : -1;
  const column = columns.find((entry) => entry.sortKey === sortKey);
  if (!column?.getSortValue) {
    return 0;
  }

  const leftValue = column.getSortValue(left);
  const rightValue = column.getSortValue(right);

  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
    return (leftValue - rightValue) * factor;
  }

  return String(leftValue).localeCompare(String(rightValue)) * factor;
}

function rowMatchesFilters<TRow>(
  row: TRow,
  columns: Array<AiaDataTableColumnDef<TRow>>,
  columnFilters: Record<string, string>,
): boolean {
  return columns.every((column) => {
    const filterValue = columnFilters[column.id] ?? '';
    if (!filterValue || !column.filter || column.filter.type === 'none') {
      return true;
    }

    if (column.filter.type === 'text') {
      const rowValue = column.filter.getValue(row);
      return String(rowValue ?? '')
        .toLowerCase()
        .includes(filterValue.trim().toLowerCase());
    }

    const rowValue = column.filter.getValue(row);
    const match =
      column.filter.match ??
      ((currentRowValue: string, currentFilterValue: string) =>
        currentRowValue === currentFilterValue);
    return match(rowValue, filterValue);
  });
}

export type AiaDataTableTextCellProps = {
  children: ReactNode;
  nowrap?: boolean;
  wrap?: boolean;
};

export function AiaDataTableTextCell({
  children,
  nowrap = false,
  wrap = false,
}: AiaDataTableTextCellProps) {
  return (
    <AiaText
      sx={{
        ...AIA_DATA_TABLE_BODY_TEXT_SX,
        ...(wrap
          ? {
              lineHeight: 1.45,
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
              minWidth: 0,
            }
          : {}),
        ...(nowrap ? { whiteSpace: 'nowrap' } : {}),
      }}
    >
      {children}
    </AiaText>
  );
}

function renderAlignedCellContent<TRow>(
  column: AiaDataTableColumnDef<TRow>,
  row: TRow,
) {
  const content = column.renderCell(row);

  if (column.align === 'center' || column.align === 'right') {
    return (
      <AiaBox
        sx={{
          display: 'flex',
          width: '100%',
          justifyContent: column.align === 'center' ? 'center' : 'flex-end',
        }}
      >
        {content}
      </AiaBox>
    );
  }

  return content;
}

export function AiaDataTable<TRow, TSortKey extends string = string>({
  rows,
  columns,
  getRowId,
  defaultSort,
  compareRows,
  emptyMessage = 'No rows match the current column filters.',
  rowsPerPageOptions = DEFAULT_ROWS_PER_PAGE_OPTIONS,
  defaultRowsPerPage = DEFAULT_ROWS_PER_PAGE,
}: AiaDataTableProps<TRow, TSortKey>) {
  const initialFilters = useMemo(
    () =>
      columns.reduce<Record<string, string>>((accumulator, column) => {
        accumulator[column.id] = '';
        return accumulator;
      }, {}),
    [columns],
  );

  const [columnFilters, setColumnFilters] = useState(initialFilters);
  const [sortKey, setSortKey] = useState<TSortKey>(defaultSort.key);
  const [sortDirection, setSortDirection] = useState<AiaDataTableSortDirection>(
    defaultSort.direction ?? 'asc',
  );
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(defaultRowsPerPage);

  const tableMinWidth = columns.reduce((total, column) => total + column.minWidth, 0);

  const updateColumnFilter = (columnId: string, value: string) => {
    setColumnFilters((current) => ({ ...current, [columnId]: value }));
  };

  const handleSort = (key: TSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection('asc');
  };

  const filteredRows = useMemo(
    () => rows.filter((row) => rowMatchesFilters(row, columns, columnFilters)),
    [columnFilters, columns, rows],
  );

  const sortedRows = useMemo(() => {
    const compare =
      compareRows ??
      ((left: TRow, right: TRow, currentSortKey: TSortKey, direction: AiaDataTableSortDirection) =>
        defaultCompareRows(left, right, currentSortKey, direction, columns));

    return [...filteredRows].sort((left, right) => compare(left, right, sortKey, sortDirection));
  }, [columns, compareRows, filteredRows, sortDirection, sortKey]);

  const paginatedRows = useMemo(() => {
    const start = page * rowsPerPage;
    return sortedRows.slice(start, start + rowsPerPage);
  }, [page, rowsPerPage, sortedRows]);

  useEffect(() => {
    setPage(0);
  }, [columnFilters, rowsPerPage, sortDirection, sortKey]);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(sortedRows.length / rowsPerPage) - 1);
    if (page > maxPage) {
      setPage(maxPage);
    }
  }, [page, rowsPerPage, sortedRows.length]);

  return (
    <AiaBox sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <AiaTableContainer component={AiaPaper} elevation={0} sx={AIA_DATA_TABLE_CONTAINER_SX}>
        <AiaTablePrimitive stickyHeader size="small" sx={aiaDataTableSx(tableMinWidth)}>
          <colgroup>
            {columns.map((column) => (
              <col key={column.id} style={{ width: column.minWidth }} />
            ))}
          </colgroup>
          <AiaTableHead>
            <AiaTableRowPrimitive>
              {columns.map((column) => (
                <AiaTableCellPrimitive
                  key={`${column.id}-header`}
                  align={column.align}
                  sx={headerCellSx(column)}
                >
                  {column.sortable && column.sortKey ? (
                    <SortableHeader
                      label={column.header}
                      active={sortKey === column.sortKey}
                      direction={sortDirection}
                      onClick={() => handleSort(column.sortKey as TSortKey)}
                    />
                  ) : (
                    column.header
                  )}
                </AiaTableCellPrimitive>
              ))}
            </AiaTableRowPrimitive>

            <AiaTableRowPrimitive>
              {columns.map((column) => (
                <AiaTableCellPrimitive
                  key={`${column.id}-filter`}
                  align={column.align}
                  sx={searchRowCellSx(column)}
                >
                  {column.filter?.type === 'text' ? (
                    <ColumnFilterInput
                      value={columnFilters[column.id] ?? ''}
                      placeholder={column.filter.placeholder ?? 'Search...'}
                      onChange={(value) => updateColumnFilter(column.id, value)}
                    />
                  ) : null}
                  {column.filter?.type === 'select' ? (
                    <ColumnFilterSelect
                      value={columnFilters[column.id] ?? ''}
                      options={column.filter.options}
                      onChange={(value) => updateColumnFilter(column.id, value)}
                    />
                  ) : null}
                </AiaTableCellPrimitive>
              ))}
            </AiaTableRowPrimitive>
          </AiaTableHead>

          <AiaTableBody>
            {paginatedRows.map((row) => (
              <AiaTableRowPrimitive key={getRowId(row)} hover sx={AIA_DATA_TABLE_ROW_SX}>
                {columns.map((column) => (
                  <AiaTableCellPrimitive
                    key={`${getRowId(row)}-${column.id}`}
                    align={column.align}
                    sx={aiaDataTableBodyCellSx(column.minWidth, column.align)}
                  >
                    {renderAlignedCellContent(column, row)}
                  </AiaTableCellPrimitive>
                ))}
              </AiaTableRowPrimitive>
            ))}

            {!paginatedRows.length ? (
              <AiaTableRowPrimitive>
                <AiaTableCellPrimitive colSpan={columns.length} sx={{ py: 4, textAlign: 'center' }}>
                  <AiaText sx={{ ...AIA_DATA_TABLE_BODY_TEXT_SX, color: '#64748b' }}>
                    {emptyMessage}
                  </AiaText>
                </AiaTableCellPrimitive>
              </AiaTableRowPrimitive>
            ) : null}
          </AiaTableBody>
        </AiaTablePrimitive>
      </AiaTableContainer>

      <AiaTablePagination
        component="div"
        count={sortedRows.length}
        page={page}
        onPageChange={(_, nextPage) => setPage(nextPage)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(event) => {
          setRowsPerPage(Number.parseInt(event.target.value, 10));
          setPage(0);
        }}
        rowsPerPageOptions={rowsPerPageOptions}
        sx={AIA_DATA_TABLE_PAGINATION_SX}
      />
    </AiaBox>
  );
}
