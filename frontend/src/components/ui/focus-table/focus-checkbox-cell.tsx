import { Checkbox, TableCell } from '@mui/material';
import { FocusCheckbox } from '../focus-checkbox';

export const FocusCheckboxCell = ({ checked }: { checked: boolean }) => (
  <TableCell padding="checkbox">
    <FocusCheckbox checked={checked} />
  </TableCell>
);