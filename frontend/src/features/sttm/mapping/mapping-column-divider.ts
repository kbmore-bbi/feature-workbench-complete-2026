/** Visible column separator width in header/body cells. */
export const MAPPING_COLUMN_DIVIDER_WIDTH = 1;

/** Pointer hit area centered on the divider (equal space on both sides). */
export const MAPPING_COLUMN_RESIZE_HIT_WIDTH = 12;

export const mappingColumnDividerSx = {
  borderRight: `${MAPPING_COLUMN_DIVIDER_WIDTH}px solid #e5e7eb`,
  boxSizing: 'border-box' as const,
};
