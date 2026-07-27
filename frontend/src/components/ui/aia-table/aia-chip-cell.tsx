import { TableCell } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { AiaChip } from '../aia-chip';
import type { AiaTableCellProps } from './aia-table-cell.types';
import { aiaTableCellSx } from './aia-table-cell.types';

type AiaChipCellProps = AiaTableCellProps & {
  label?: string;
  color?: 'default' | 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';
  rounded?: boolean;
  size?: 'small' | 'medium';
  chipSx?: SxProps<Theme>;
};

export const AiaChipCell = ({
  label,
  color = 'default',
  rounded = true,
  size = 'small',
  chipSx,
  align,
  width,
  minWidth,
  padding,
  sx,
}: AiaChipCellProps) => (
  <TableCell align={align} padding={padding} sx={aiaTableCellSx({ width, minWidth, sx })}>
    {label ? (
      <AiaChip
        label={label}
        size={size}
        color={color}
        rounded={rounded}
        sx={chipSx}
      />
    ) : null}
  </TableCell>
);
