import { TableCell } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { FocusSelect } from '../focus-select';
import type { FocusTableCellProps } from './focus-table-cell.types';
import { focusTableCellSx } from './focus-table-cell.types';

type FocusSelectCellProps = FocusTableCellProps & {
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

export const FocusSelectCell = ({
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
}: FocusSelectCellProps) => (
  <TableCell
    align={align}
    padding={padding}
    sx={focusTableCellSx({ width, minWidth, sx }, { overflow: 'visible' })}
  >
    <FocusSelect
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
