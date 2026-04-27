import { TableCell } from '@mui/material';
import { FocusChip } from '../focus-chip';

export const FocusChipCell = ({ label }: { label: string }) => (
  <TableCell>
    <FocusChip label={label} size="small" />
  </TableCell>
);