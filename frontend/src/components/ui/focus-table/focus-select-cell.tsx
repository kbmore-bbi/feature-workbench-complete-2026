import { TableCell } from '@mui/material';
import { FocusSelect } from '../focus-select';

export const FocusSelectCell = (props: any) => (
  <TableCell>
    <FocusSelect {...props} />
  </TableCell>
);