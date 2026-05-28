import { Box, TableCell } from '@mui/material';
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
    padding="none"
    sx={focusTableCellSx({
      width: width ?? 64,
      minWidth,
      sx: [
        {
          px: 0,
          textAlign: 'center',
          verticalAlign: 'middle',
        },
        ...(sx ? (Array.isArray(sx) ? sx : [sx]) : []),
      ],
    })}
  >
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
      }}
    >
      <FocusCheckbox
        checked={checked}
        indeterminate={indeterminate}
        checkHandler={(nextChecked: boolean) => onChange?.(nextChecked)}
      />
    </Box>
  </TableCell>
);
