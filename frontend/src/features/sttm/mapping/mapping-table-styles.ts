import {
  aiaDataTableSx,
  AIA_DATA_TABLE_BODY_CELL_SX as MAPPING_TABLE_BODY_CELL_SX,
  AIA_DATA_TABLE_BODY_TEXT_SX as MAPPING_TABLE_BODY_TEXT_SX,
  AIA_DATA_TABLE_CONTAINER_SX as MAPPING_TABLE_CONTAINER_SX,
  AIA_DATA_TABLE_FILTER_CONTROL_HEIGHT as MAPPING_TABLE_FILTER_CONTROL_HEIGHT,
  AIA_DATA_TABLE_FILTER_CONTROL_ROOT_SX as MAPPING_TABLE_FILTER_CONTROL_ROOT_SX,
  AIA_DATA_TABLE_FILTER_INPUT_SX as MAPPING_TABLE_FILTER_INPUT_SX,
  AIA_DATA_TABLE_FILTER_SELECT_SX as MAPPING_TABLE_FILTER_SELECT_SX,
  AIA_DATA_TABLE_HEADER_CELL_SX as MAPPING_TABLE_HEADER_CELL_SX,
  AIA_DATA_TABLE_HEADER_ROW_HEIGHT as MAPPING_TABLE_HEADER_ROW_HEIGHT,
  AIA_DATA_TABLE_PAGINATION_SX as MAPPING_TABLE_PAGINATION_SX,
  AIA_DATA_TABLE_ROW_SX as MAPPING_TABLE_ROW_SX,
  AIA_DATA_TABLE_SCROLLBAR_SX as MAPPING_TABLE_SCROLLBAR_SX,
  AIA_DATA_TABLE_SEARCH_ROW_CELL_SX as MAPPING_TABLE_SEARCH_ROW_CELL_SX,
  AIA_DATA_TABLE_SEARCH_ROW_HEIGHT as MAPPING_TABLE_SEARCH_ROW_HEIGHT,
  AIA_DATA_TABLE_SECONDARY_INPUT_SX as MAPPING_TABLE_SECONDARY_INPUT_SX,
  AIA_DATA_TABLE_SECONDARY_INPUT_TYPOGRAPHY as MAPPING_TABLE_SECONDARY_INPUT_TYPOGRAPHY,
} from '@/components/ui/aia-table/aia-data-table-styles';

export {
  MAPPING_TABLE_BODY_CELL_SX,
  MAPPING_TABLE_BODY_TEXT_SX,
  MAPPING_TABLE_CONTAINER_SX,
  MAPPING_TABLE_FILTER_CONTROL_HEIGHT,
  MAPPING_TABLE_FILTER_CONTROL_ROOT_SX,
  MAPPING_TABLE_FILTER_INPUT_SX,
  MAPPING_TABLE_FILTER_SELECT_SX,
  MAPPING_TABLE_HEADER_CELL_SX,
  MAPPING_TABLE_HEADER_ROW_HEIGHT,
  MAPPING_TABLE_PAGINATION_SX,
  MAPPING_TABLE_ROW_SX,
  MAPPING_TABLE_SCROLLBAR_SX,
  MAPPING_TABLE_SEARCH_ROW_CELL_SX,
  MAPPING_TABLE_SEARCH_ROW_HEIGHT,
  MAPPING_TABLE_SECONDARY_INPUT_SX,
  MAPPING_TABLE_SECONDARY_INPUT_TYPOGRAPHY,
};

export function mappingTableSx(minWidth: number) {
  return aiaDataTableSx(minWidth);
}

export function scrollableMappingTableSx(minWidth: number) {
  return {
    ...mappingTableSx(minWidth),
    width: `max(100%, ${minWidth}px)`,
  };
}

export const MAPPING_TABLE_CHECKBOX_SX = {
  color: '#cbd5e1',
  '&.Mui-checked': {
    color: 'var(--color-primary)',
  },
  '&.MuiCheckbox-indeterminate': {
    color: 'var(--color-primary)',
  },
} as const;

export const MAPPING_SELECTION_BAR_SX = {
  px: 2,
  py: 1,
  bgcolor: 'var(--color-primary)',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 2,
  borderBottom: '1px solid color-mix(in srgb, var(--color-primary) 75%, #000000)',
} as const;

/** Fixed width for rule autocomplete — fits longest option without resizing on selection. */
export const MAPPING_PREPROCESS_RULE_SELECT_WIDTH = 240;

export const MAPPING_PREPROCESS_RULE_SELECT_WRAPPER_SX = {
  width: MAPPING_PREPROCESS_RULE_SELECT_WIDTH,
  minWidth: MAPPING_PREPROCESS_RULE_SELECT_WIDTH,
  maxWidth: MAPPING_PREPROCESS_RULE_SELECT_WIDTH,
  flexShrink: 0,
} as const;

export const MAPPING_PREPROCESS_RULE_ROW_SX = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 1,
  width: 'max-content',
  maxWidth: '100%',
} as const;

/** Aligns filter row search field with body rule select beside Pre-process button. */
export const MAPPING_PREPROCESS_RULE_BUTTON_SPACER_SX = {
  minWidth: 112,
  flexShrink: 0,
} as const;

const preprocessRuleInputFieldSx = {
  width: '100% !important',
  minWidth: '0 !important',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

export const MAPPING_PREPROCESS_RULE_SELECT_SX = {
  ...MAPPING_PREPROCESS_RULE_SELECT_WRAPPER_SX,
  '& .MuiOutlinedInput-root': {
    width: '100%',
    minWidth: '100%',
    height: 36,
    minHeight: 36,
  },
  '& .MuiInputBase-input, & .MuiAutocomplete-input': preprocessRuleInputFieldSx,
} as const;

export const MAPPING_PREPROCESS_RULE_FILTER_SX = {
  ...MAPPING_PREPROCESS_RULE_SELECT_WRAPPER_SX,
  '& .MuiOutlinedInput-root': {
    ...MAPPING_TABLE_FILTER_CONTROL_ROOT_SX,
    width: '100%',
    minWidth: '100%',
    height: 36,
    minHeight: 36,
    display: 'flex',
    alignItems: 'center',
    py: '0 !important',
    pr: '4px !important',
    borderRadius: '6px',
  },
  '& .MuiInputBase-input, & .MuiAutocomplete-input': {
    ...MAPPING_TABLE_SECONDARY_INPUT_TYPOGRAPHY,
    ...preprocessRuleInputFieldSx,
    py: '8px !important',
    pl: '12px !important',
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: '#e5e7eb',
  },
} as const;
