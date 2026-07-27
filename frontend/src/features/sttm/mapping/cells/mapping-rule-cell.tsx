import { AiaBox, AiaTableCellPrimitive } from '@/components/ui';

import type { SxProps, Theme } from '@mui/material/styles';
import { AutoFixHighRoundedIcon } from '@/utils/icons';

import { AiaAutocomplete } from '@/components/ui/aia-auto-complete';
import { AiaButton } from '@/components/ui/aia-button';
import { aiaTableCellSx } from '@/components/ui/aia-table';
import { TOUR_TARGETS } from '@/features/tour/constants/tour-targets';
import {
  MAPPING_TABLE_SECONDARY_INPUT_SX,
  MAPPING_TABLE_SECONDARY_INPUT_TYPOGRAPHY,
  MAPPING_PREPROCESS_RULE_ROW_SX,
  MAPPING_PREPROCESS_RULE_SELECT_SX,
  MAPPING_PREPROCESS_RULE_SELECT_WRAPPER_SX,
} from '../mapping-table-styles';

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
  ...MAPPING_TABLE_SECONDARY_INPUT_SX,
  '& .MuiOutlinedInput-root': {
    ...MAPPING_TABLE_SECONDARY_INPUT_TYPOGRAPHY,
    height: 36,
    minHeight: 36,
    borderRadius: '6px',
    bgcolor: '#fff',
    py: '0 !important',
  },
  '& .MuiInputBase-input, & .MuiAutocomplete-input': {
    ...MAPPING_TABLE_SECONDARY_INPUT_TYPOGRAPHY,
    paddingTop: '8px !important',
    paddingBottom: '8px !important',
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: '#e5e7eb',
  },
};

const HIGHLIGHTED_SELECT_SX: SxProps<Theme> = {
  '& .MuiOutlinedInput-root': {
    bgcolor: '#fef3c7',
  },
  '& .MuiInputBase-input, & .MuiAutocomplete-input': {
    color: '#92400e',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontWeight: 600,
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: '#f59e0b',
  },
};

const RULE_SELECT_SX: SxProps<Theme> = MAPPING_PREPROCESS_RULE_SELECT_SX;

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
    ? ([BASE_SELECT_SX, HIGHLIGHTED_SELECT_SX, RULE_SELECT_SX] as SxProps<Theme>)
    : ([BASE_SELECT_SX, RULE_SELECT_SX] as SxProps<Theme>);

  return (
    <AiaTableCellPrimitive sx={aiaTableCellSx({ width, minWidth, sx }, { overflow: 'visible' })}>
      <AiaBox sx={MAPPING_PREPROCESS_RULE_ROW_SX}>
        <AiaBox sx={MAPPING_PREPROCESS_RULE_SELECT_WRAPPER_SX}>
          <AiaAutocomplete
            hideLabel
            value={value}
            options={selectOptions}
            onChange={(next) => onRuleChange(Array.isArray(next) ? next[0] ?? '' : next)}
            placeholder={placeholder}
            size="small"
            fullWidth
            sx={selectSx}
          />
        </AiaBox>
        <AiaButton
          data-tour={TOUR_TARGETS.sttmPreprocessButton}
          variant="outlined"
          size="small"
          disabled={preProcessDisabled}
          startIcon={<AutoFixHighRoundedIcon sx={{ fontSize: 18 }} />}
          onClick={onPreProcess}
          sx={{ minWidth: 0, boxShadow: 'none', flexShrink: 0 }}
          customBorderColor="var(--aia-primary-bg-color)"
          customColor="var(--aia-primary-bg-color)"
        >
          Pre-process
        </AiaButton>
      </AiaBox>
    </AiaTableCellPrimitive>
  );
};
