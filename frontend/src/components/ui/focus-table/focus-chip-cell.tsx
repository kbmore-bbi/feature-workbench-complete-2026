import { TableCell } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { FocusChip } from '../focus-chip';
import type { FocusTableCellProps } from './focus-table-cell.types';
import { focusTableCellSx } from './focus-table-cell.types';

type FocusChipCellProps = FocusTableCellProps & {
  label?: string;
  color?: 'default' | 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';
  rounded?: boolean;
  size?: 'small' | 'medium';
  variant?: 'filled' | 'outlined';
  chipSx?: SxProps<Theme>;
};

export const FocusChipCell = ({
  label,
  color,
  rounded = true,
  size = 'small',
  variant = 'filled',
  chipSx,
  align,
  width,
  minWidth,
  padding,
  sx,
}: FocusChipCellProps) => (
  <TableCell align={align} padding={padding} sx={focusTableCellSx({ width, minWidth, sx })}>
    {label ? (
      <FocusChip
        label={label}
        size={size}
        color={color}
        rounded={rounded}
        variant={variant}
        sx={chipSx}
      />
    ) : null}
  </TableCell>
);
