import { TableCell } from '@mui/material';
import { FocusInput } from '../focus-input';

export const FocusInputCell = ({
  placeholder,
}: {
  placeholder: string;
}) => (
  <TableCell>
    <FocusInput value="" onChange={() => {}} placeholder={placeholder} />
  </TableCell>
);