import { TableCell } from '@mui/material';
import { FocusChip } from '../focus-chip';

export const FocusStatusCell = ({ status }: { status: 'MAPPED' | 'UNMAPPED' }) => (
  <TableCell align="right">
    <FocusChip
      label={status}
      color={status === 'MAPPED' ? 'success' : 'default'}
      size="small"
      rounded
    />
  </TableCell>
);