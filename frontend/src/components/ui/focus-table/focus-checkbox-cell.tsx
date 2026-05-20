import { TableCell } from '@mui/material';
import { FocusCheckbox } from '../focus-checkbox';
import type { FocusTableCellProps } from './focus-table-cell.types';
import { focusTableCellSx } from './focus-table-cell.types';

type FocusCheckboxCellProps = FocusTableCellProps & {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  indeterminate?: boolean;
};

export const FocusCheckboxCell = ({
  checked,
  onChange,
  indeterminate,
  width,
  minWidth,
  sx,
}: FocusCheckboxCellProps) => (
  <TableCell
    padding="checkbox"
    sx={focusTableCellSx({ width: width ?? 44, minWidth, sx })}
  >
    <FocusCheckbox
      checked={checked}
      indeterminate={indeterminate}
      checkHandler={(nextChecked: boolean) => onChange?.(nextChecked)}
    />
  </TableCell>
);
