import { TableCell } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { AiaInput } from '../aia-input';
import type { AiaTableCellProps } from './aia-table-cell.types';
import { aiaTableCellSx } from './aia-table-cell.types';

type AiaInputCellProps = AiaTableCellProps & {
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

export const AiaInputCell = ({
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
}: AiaInputCellProps) => (
  <TableCell
    align={align}
    padding={padding}
    sx={aiaTableCellSx({ width, minWidth, sx }, { overflow: 'visible' })}
  >
    <AiaInput
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
