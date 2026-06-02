import { Box, TableCell } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { AutoFixHighRoundedIcon } from '@/utils/icons';

import { AiaSelect } from '@/components/ui/aia-select';
import { AiaButton } from '@/components/ui/aia-button';
import { aiaTableCellSx } from '@/components/ui/aia-table';

type MappingRuleCellProps = {
  value: string;
  options: Array<{ label: string; value: string }>;
  onRuleChange: (value: string) => void;
  onPreProcess: () => void;
  configureValue?: string;
  placeholder?: string;
  highlighted?: boolean;
  preProcessDisabled?: boolean;
  width?: number | string;
  minWidth?: number | string;
  sx?: SxProps<Theme>;
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
  placeholder = 'Select rule...',
  highlighted = false,
  preProcessDisabled = false,
  width,
  minWidth = 0,
  sx,
}: MappingRuleCellProps) => {
  const selectOptions = configureValue
    ? [...options, { label: configureValue, value: configureValue }]
    : options;

  const selectSx: SxProps<Theme> = highlighted
    ? ([BASE_SELECT_SX, HIGHLIGHTED_SELECT_SX] as SxProps<Theme>)
    : BASE_SELECT_SX;

  return (
    <TableCell sx={aiaTableCellSx({ width, minWidth, sx }, { overflow: 'hidden' })}>
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
          <AiaSelect
            value={value}
            options={selectOptions}
            onChange={(next) => onRuleChange(Array.isArray(next) ? next[0] : next)}
            placeholder={placeholder}
            size="small"
            fullWidth
            sx={selectSx}
          />
        </Box>
        <AiaButton
          variant="contained"
          size="small"
          rounded="md"
          disabled={preProcessDisabled}
          startIcon={<AutoFixHighRoundedIcon sx={{ fontSize: 16 }} />}
          onClick={onPreProcess}
          customColor="#ffffff"
          customBackgroundColor="#0f172a"
          customHoverBackgroundColor="#1e293b"
          customBorderColor="#0f172a"
          sx={{
            height: 36,
            fontSize: '0.75rem',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            px: 1.25,
            flexShrink: 0,
            boxShadow: 'none',
            '&:hover': {
              boxShadow: 'none',
            },
            '&.Mui-disabled': {
              opacity: 1,
              backgroundColor: '#f1f5f9',
              border: '1px solid #f1f5f9',
              color: '#94a3b8',
            },
          }}
        >
          Pre-process
        </AiaButton>
      </Box>
    </TableCell>
  );
};
