import { TableCell } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { FocusInput } from '../focus-input';
import type { FocusTableCellProps } from './focus-table-cell.types';
import { focusTableCellSx } from './focus-table-cell.types';

type FocusInputCellProps = FocusTableCellProps & {
  placeholder: string;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  inputSx?: SxProps<Theme>;
  multiline?: boolean;
  minRows?: number;
  maxRows?: number;
};

const DEFAULT_INPUT_SX: SxProps<Theme> = {
  '& .MuiOutlinedInput-root': {
    minHeight: 36,
    fontSize: '0.8rem',
    borderRadius: '6px',
    bgcolor: '#fff',
    paddingY: 0,
    alignItems: 'flex-start',
  },
  '& .MuiInputBase-input, & .MuiInputBase-inputMultiline': {
    paddingY: '8px !important',
    fontSize: '0.8rem',
    lineHeight: 1.45,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    overflow: 'hidden !important',
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: '#e5e7eb',
  },
};

export const FocusInputCell = ({
  placeholder,
  value = '',
  onChange,
  disabled = false,
  align,
  width,
  minWidth,
  padding,
  sx,
  inputSx,
  multiline = false,
  minRows,
  maxRows,
}: FocusInputCellProps) => (
  <TableCell
    align={align}
    padding={padding}
    sx={focusTableCellSx({ width, minWidth, sx }, { overflow: 'visible' })}
  >
    <FocusInput
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      size="small"
      fullWidth
      disabled={disabled}
      multiline={multiline}
      minRows={minRows}
      maxRows={maxRows}
      sx={[
        DEFAULT_INPUT_SX,
        ...(inputSx ? (Array.isArray(inputSx) ? inputSx : [inputSx]) : []),
      ]}
    />
  </TableCell>
);
