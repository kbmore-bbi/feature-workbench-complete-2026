import { Box, TableCell } from '@mui/material';
import { AiaCheckbox } from '../aia-checkbox';
import type { AiaTableCellProps } from './aia-table-cell.types';
import { aiaTableCellSx } from './aia-table-cell.types';

type AiaCheckboxCellProps = AiaTableCellProps & {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  indeterminate?: boolean;
  checkboxSx?: import('@mui/material/styles').SxProps<import('@mui/material/styles').Theme>;
};

export const AiaCheckboxCell = ({
  checked,
  onChange,
  indeterminate,
  checkboxSx,
  width,
  minWidth,
  sx,
}: AiaCheckboxCellProps) => (
  <TableCell
    padding="none"
    sx={aiaTableCellSx({
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
      <AiaCheckbox
        checked={checked}
        indeterminate={indeterminate}
        checkHandler={(nextChecked: boolean) => onChange?.(nextChecked)}
        sx={checkboxSx}
      />
    </Box>
  </TableCell>
);
