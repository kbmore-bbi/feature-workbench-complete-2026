import { Box, TableCell } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import { FocusSelect } from '@/components/ui/focus-select';
import { FocusButton } from '@/components/ui/focus-button';
import { focusTableCellSx } from '@/components/ui/focus-table';

type MappingRuleCellProps = {
  value: string;
  options: Array<{ label: string; value: string }>;
  onRuleChange: (value: string) => void;
  onPreProcess: () => void;
  configureValue?: string;
  highlighted?: boolean;
  width?: number | string;
  minWidth?: number | string;
};

const BASE_SELECT_SX: SxProps<Theme> = {
  '& .MuiOutlinedInput-root': {
    height: 36,
    minHeight: 36,
    fontSize: '0.8rem',
    borderRadius: '6px',
    bgcolor: '#fff',
  },
  '& .MuiSelect-select': {
    paddingTop: '8px !important',
    paddingBottom: '8px !important',
    fontSize: '0.8rem',
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: '#e5e7eb',
  },
};

const HIGHLIGHTED_SELECT_SX: SxProps<Theme> = {
  '& .MuiOutlinedInput-root': {
    bgcolor: '#fef3c7',
  },
  '& .MuiSelect-select': {
    color: '#92400e',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontWeight: 600,
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: '#f59e0b',
  },
};

export const MappingRuleCell = ({
  value,
  options,
  onRuleChange,
  onPreProcess,
  configureValue,
  highlighted = false,
  width,
  minWidth = 0,
}: MappingRuleCellProps) => {
  const selectOptions = configureValue
    ? [...options, { label: configureValue, value: configureValue }]
    : options;

  const selectSx: SxProps<Theme> = highlighted
    ? ([BASE_SELECT_SX, HIGHLIGHTED_SELECT_SX] as SxProps<Theme>)
    : BASE_SELECT_SX;

  return (
    <TableCell sx={focusTableCellSx({ width, minWidth }, { overflow: 'visible' })}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1,
          width: '100%',
          flexWrap: 'wrap',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <FocusSelect
            value={value}
            options={selectOptions}
            onChange={(next) => onRuleChange(Array.isArray(next) ? next[0] : next)}
            size="small"
            fullWidth
            sx={selectSx}
          />
        </Box>
        <FocusButton
          variant="outlined"
          size="small"
          rounded="md"
          startIcon={<AutoFixHighRoundedIcon sx={{ fontSize: 16 }} />}
          onClick={onPreProcess}
          sx={{
            height: 36,
            fontSize: '0.75rem',
            fontWeight: 600,
            color: '#92400e',
            borderColor: '#fbbf24',
            bgcolor: '#fffbeb',
            whiteSpace: 'nowrap',
            px: 1.25,
            flexShrink: 0,
            '&:hover': {
              bgcolor: '#fef3c7',
              borderColor: '#f59e0b',
            },
          }}
        >
          Pre-process
        </FocusButton>
      </Box>
    </TableCell>
  );
};
