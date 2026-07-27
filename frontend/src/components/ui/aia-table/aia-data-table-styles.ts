import { BODY_SX, SECONDARY_TEXT_SX, TYPOGRAPHY_TOKENS, tokenLineHeight } from '@/config/typography-tokens';

export const AIA_DATA_TABLE_HEADER_ROW_HEIGHT = 44;
export const AIA_DATA_TABLE_FILTER_CONTROL_HEIGHT = 40;
export const AIA_DATA_TABLE_SEARCH_ROW_HEIGHT = 52;

const bodyInputTypography = {
  fontSize: `${TYPOGRAPHY_TOKENS.secondaryText.fontSize}px`,
  fontWeight: TYPOGRAPHY_TOKENS.secondaryText.fontWeight,
  lineHeight: tokenLineHeight(TYPOGRAPHY_TOKENS.secondaryText),
  color: TYPOGRAPHY_TOKENS.body.color,
};

export const AIA_DATA_TABLE_BODY_TEXT_SX = {
  ...SECONDARY_TEXT_SX,
  color: TYPOGRAPHY_TOKENS.body.color,
};

export const AIA_DATA_TABLE_SECONDARY_INPUT_SX = {
  '& .MuiOutlinedInput-root': bodyInputTypography,
  '& .MuiInputBase-input, & .MuiInputBase-inputMultiline, & .MuiAutocomplete-input': bodyInputTypography,
  '& .MuiSelect-select': bodyInputTypography,
} as const;

export const AIA_DATA_TABLE_SECONDARY_INPUT_TYPOGRAPHY = bodyInputTypography;

export const AIA_DATA_TABLE_HEADER_CELL_SX = {
  ...BODY_SX,
  color: TYPOGRAPHY_TOKENS.secondaryText.color,
  textAlign: 'left' as const,
  borderBottom: '1px solid #e5e7eb',
  bgcolor: '#fafafa',
  minHeight: AIA_DATA_TABLE_HEADER_ROW_HEIGHT,
  py: 1.25,
  px: 1.5,
  whiteSpace: 'nowrap' as const,
  verticalAlign: 'middle' as const,
};

export const AIA_DATA_TABLE_SEARCH_ROW_CELL_SX = {
  borderBottom: '1px solid #e5e7eb',
  bgcolor: '#fafafa',
  minHeight: AIA_DATA_TABLE_SEARCH_ROW_HEIGHT,
  py: 0.75,
  px: 1,
  verticalAlign: 'middle' as const,
};

const filterFieldTypography = {
  fontSize: `${TYPOGRAPHY_TOKENS.body.fontSize}px`,
  fontWeight: TYPOGRAPHY_TOKENS.body.fontWeight,
  lineHeight: tokenLineHeight(TYPOGRAPHY_TOKENS.body),
  color: TYPOGRAPHY_TOKENS.secondaryText.color,
};

const filterOutlinedRootSx = {
  height: `${AIA_DATA_TABLE_FILTER_CONTROL_HEIGHT}px`,
  minHeight: `${AIA_DATA_TABLE_FILTER_CONTROL_HEIGHT}px`,
  borderRadius: '8px',
  backgroundColor: '#ffffff',
  boxSizing: 'border-box' as const,
  display: 'flex',
  alignItems: 'center',
  transition: 'border-color 120ms ease, box-shadow 120ms ease',
  '& fieldset': {
    borderColor: '#e5e7eb',
  },
  '&:hover fieldset': {
    borderColor: '#e5e7eb',
  },
  '&.Mui-focused': {
    backgroundColor: '#ffffff',
    boxShadow: '0 0 0 2px rgba(0, 115, 160, 0.12)',
    '& fieldset': {
      borderColor: 'var(--color-primary-save, #0073a0)',
    },
  },
};

export const AIA_DATA_TABLE_FILTER_CONTROL_ROOT_SX = filterOutlinedRootSx;

export const AIA_DATA_TABLE_FILTER_INPUT_SX = {
  '& .MuiOutlinedInput-root': filterOutlinedRootSx,
  '& .MuiInputBase-input': {
    ...filterFieldTypography,
    py: '0 !important',
    px: '12px !important',
    height: `${AIA_DATA_TABLE_FILTER_CONTROL_HEIGHT}px`,
    boxSizing: 'border-box',
    '&::placeholder': {
      color: 'var(--color-muted, #9ca3af)',
      opacity: 1,
    },
  },
} as const;

export const AIA_DATA_TABLE_FILTER_SELECT_SX = {
  ...filterOutlinedRootSx,
  width: '100%',
  '& .MuiSelect-select': {
    ...filterFieldTypography,
    py: '0 !important',
    pl: '12px !important',
    pr: '32px !important',
    height: `${AIA_DATA_TABLE_FILTER_CONTROL_HEIGHT}px !important`,
    minHeight: `${AIA_DATA_TABLE_FILTER_CONTROL_HEIGHT}px !important`,
    display: 'flex',
    alignItems: 'center',
    boxSizing: 'border-box',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  '& .MuiSelect-icon': {
    right: 8,
    top: 'calc(50% - 12px)',
    fontSize: '1.5rem',
    color: 'var(--color-muted, #9ca3af)',
  },
} as const;

export const AIA_DATA_TABLE_BODY_CELL_SX = {
  ...SECONDARY_TEXT_SX,
  color: TYPOGRAPHY_TOKENS.body.color,
  borderBottom: '1px solid #edf2f7',
  verticalAlign: 'top' as const,
  textAlign: 'left' as const,
  py: 1.2,
};

export const AIA_DATA_TABLE_SCROLLBAR_SX = {
  scrollbarWidth: 'thin',
  scrollbarColor: '#cbd5e1 transparent',
  '&::-webkit-scrollbar': { width: 8, height: 8 },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: '#cbd5e1',
    borderRadius: 999,
  },
  '&::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
} as const;

export const AIA_DATA_TABLE_CONTAINER_SX = {
  flex: 1,
  minHeight: 0,
  width: '100%',
  border: 'none',
  borderRadius: 0,
  overflow: 'auto',
  ...AIA_DATA_TABLE_SCROLLBAR_SX,
} as const;

export function aiaDataTableSx(minWidth: number) {
  return {
    width: '100%',
    minWidth,
    tableLayout: 'fixed' as const,
    '& .MuiTableBody-root .MuiTableCell-root': AIA_DATA_TABLE_BODY_CELL_SX,
    '& .MuiTableBody-root .MuiTableRow-root:last-of-type .MuiTableCell-root': {
      borderBottom: '1px solid #edf2f7',
    },
  };
}

export const AIA_DATA_TABLE_PAGINATION_SX = {
  flexShrink: 0,
  borderTop: '1px solid #e5e7eb',
  bgcolor: '#fff',
  '.MuiTablePagination-toolbar': {
    minHeight: 44,
    px: 1.5,
  },
  '.MuiTablePagination-selectLabel, .MuiTablePagination-displayedRows': {
    ...SECONDARY_TEXT_SX,
    color: TYPOGRAPHY_TOKENS.body.color,
  },
} as const;

export const AIA_DATA_TABLE_ROW_SX = {
  bgcolor: '#fff',
  '&.MuiTableRow-root:hover': {
    bgcolor: '#fff',
  },
} as const;

export const AIA_DATA_TABLE_SCROLLABLE_HEADER_CELL_SX = {
  position: 'sticky' as const,
  top: 0,
  zIndex: 2,
  bgcolor: '#fafafa',
  backgroundColor: '#fafafa',
};

export const AIA_DATA_TABLE_SCROLLABLE_SEARCH_HEADER_CELL_SX = {
  position: 'sticky' as const,
  top: AIA_DATA_TABLE_HEADER_ROW_HEIGHT,
  zIndex: 2,
  bgcolor: '#fafafa',
  backgroundColor: '#fafafa',
};

export const AIA_DATA_TABLE_SCROLLABLE_BODY_CELL_SX = {
  position: 'relative' as const,
  zIndex: 1,
  bgcolor: '#fff',
  backgroundColor: '#fff',
};

export function aiaDataTableBodyCellSx(minWidth: number, align?: 'left' | 'center' | 'right') {
  const textAlign = align ?? 'left';

  return {
    ...AIA_DATA_TABLE_BODY_CELL_SX,
    ...AIA_DATA_TABLE_SCROLLABLE_BODY_CELL_SX,
    minWidth,
    width: minWidth,
    textAlign,
    '&&': {
      textAlign,
    },
  };
}
