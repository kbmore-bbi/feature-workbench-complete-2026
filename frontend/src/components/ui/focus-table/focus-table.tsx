'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableContainer,
} from '@mui/material';

interface Column {
  key: string;
  label: string | React.ReactNode;
  align?: 'left' | 'center' | 'right';
}

interface FocusTableProps {
  columns: Column[];
  children: React.ReactNode;
}

const FocusTable = ({ columns, children }: FocusTableProps) => {
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            {columns.map(col => (
              <TableCell
                key={col.key}
                align={col.align ?? 'left'}
                sx={{ fontWeight: 600 }}
              >
                {col.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>{children}</TableBody>
      </Table>
    </TableContainer>
  );
};

export { FocusTable };