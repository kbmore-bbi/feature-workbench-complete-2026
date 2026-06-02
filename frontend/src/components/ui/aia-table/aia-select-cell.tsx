import { TableCell } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { AiaSelect } from '../aia-select';
import type { AiaTableCellProps } from './aia-table-cell.types';
import { aiaTableCellSx } from './aia-table-cell.types';

type AiaSelectCellProps = AiaTableCellProps & {
  value?: string | string[];
  options?: Array<{ label: string; value: string }>;
  onChange?: (value: string | string[]) => void;
  placeholder?: string;
  multiple?: boolean;
  disabled?: boolean;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
  selectSx?: SxProps<Theme>;
};

export const AiaSelectCell = ({
  value,
  options,
  onChange,
  placeholder,
  multiple,
  disabled,
  size = 'small',
  fullWidth = true,
  align,
  width,
  minWidth,
  padding,
  sx,
  selectSx,
}: AiaSelectCellProps) => (
  <TableCell
    align={align}
    padding={padding}
    sx={aiaTableCellSx({ width, minWidth, sx }, { overflow: 'visible' })}
  >
    <AiaSelect
      value={value}
      options={options}
      onChange={onChange}
      placeholder={placeholder}
      multiple={multiple}
      disabled={disabled}
      size={size}
      fullWidth={fullWidth}
      sx={selectSx}
    />
  </TableCell>
);
