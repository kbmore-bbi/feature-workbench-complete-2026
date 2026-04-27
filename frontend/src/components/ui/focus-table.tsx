'use client';

import * as React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';

interface Column<T> {
  key: keyof T;
  label: string;
  align?: 'left' | 'center' | 'right';
  width?: number | string;
  render?: (row: T) => React.ReactNode;
}

interface FocusTableProps<T> {
  columns: Column<T>[];
  rows: T[];

  onRowClick?: (row: T) => void;

  size?: 'small' | 'medium';
  stickyHeader?: boolean;

  emptyText?: string;
}

function FocusTable<T>({
  columns,
  rows,
  onRowClick,
  size = 'small',
  stickyHeader = false,
  emptyText = 'No data',
}: FocusTableProps<T>) {
  return (
    <TableContainer component={Paper} elevation={0}>
      <Table size={size} stickyHeader={stickyHeader}>
        {/* ---------- HEADER ---------- */}
        <TableHead>
          <TableRow>
            {columns.map((col) => (
              <TableCell
                key={String(col.key)}
                align={col.align ?? 'left'}
                sx={{
                  fontWeight: 600,
                  backgroundColor: 'var(--mui-palette-background-header)',
                }}
              >
                {col.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>

        {/* ---------- BODY ---------- */}
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                align="center"
                sx={{ color: 'text.secondary', py: 3 }}
              >
                {emptyText}
              </TableCell>
            </TableRow>
          )}

          {rows.map((row, rowIndex) => (
            <TableRow
              key={rowIndex}
              hover={!!onRowClick}
              sx={{
                cursor: onRowClick ? 'pointer' : 'default',
              }}
              onClick={() => onRowClick?.(row)}
            >
              {columns.map((col) => (
                <TableCell
                  key={String(col.key)}
                  align={col.align ?? 'left'}
                >
                  {col.render
                    ? col.render(row)
                    : String(row[col.key] ?? '')}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export { FocusTable };