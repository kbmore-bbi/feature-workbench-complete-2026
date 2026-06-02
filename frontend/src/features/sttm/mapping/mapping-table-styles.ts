export const MAPPING_TABLE_HEADER_CELL_SX = {
  color: '#4b5563',
  fontWeight: 700,
  fontSize: '0.68rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase' as const,
  textAlign: 'left' as const,
  borderBottom: '1px solid #e5e7eb',
  bgcolor: '#fafafa',
  py: 0.65,
  whiteSpace: 'nowrap' as const,
};

export const MAPPING_TABLE_BODY_CELL_SX = {
  borderBottom: '1px solid #edf2f7',
  verticalAlign: 'top' as const,
  textAlign: 'left' as const,
  py: 1.2,
};

export const MAPPING_TABLE_SCROLLBAR_SX = {
  scrollbarWidth: 'thin',
  scrollbarColor: '#cbd5e1 transparent',
  '&::-webkit-scrollbar': { width: 8, height: 8 },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: '#cbd5e1',
    borderRadius: 999,
  },
  '&::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
} as const;

export const MAPPING_TABLE_CONTAINER_SX = {
  flex: 1,
  minHeight: 0,
  width: '100%',
  border: 'none',
  borderRadius: 0,
  overflow: 'auto',
  ...MAPPING_TABLE_SCROLLBAR_SX,
} as const;

export function mappingTableSx(minWidth: number) {
  return {
    width: '100%',
    minWidth,
    tableLayout: 'fixed' as const,
    '& .MuiTableBody-root .MuiTableCell-root': MAPPING_TABLE_BODY_CELL_SX,
    '& .MuiTableBody-root .MuiTableRow-root:last-of-type .MuiTableCell-root': {
      borderBottom: '1px solid #edf2f7',
    },
  };
}

export function scrollableMappingTableSx(minWidth: number) {
  return {
    ...mappingTableSx(minWidth),
    width: `max(100%, ${minWidth}px)`,
  };
}

export const MAPPING_TABLE_PAGINATION_SX = {
  flexShrink: 0,
  borderTop: '1px solid #e5e7eb',
  bgcolor: '#fff',
  '.MuiTablePagination-toolbar': {
    minHeight: 44,
    px: 1.5,
  },
  '.MuiTablePagination-selectLabel, .MuiTablePagination-displayedRows': {
    fontSize: '0.78rem',
    color: '#64748b',
  },
} as const;

export const MAPPING_TABLE_ROW_SX = {
  bgcolor: '#fff',
  '&.MuiTableRow-root:hover': {
    bgcolor: '#fff',
  },
} as const;
