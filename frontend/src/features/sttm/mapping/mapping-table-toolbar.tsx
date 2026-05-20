'use client';

import { Box, Chip, Typography } from '@mui/material';

type MappingTableToolbarProps = {
  rowCount: number;
  mappedCount: number;
  joinCount: number;
  sortBy?: string;
  onSortChange?: (value: string) => void;
};

export default function MappingTableToolbar({
  rowCount,
  mappedCount,
  joinCount,
}: MappingTableToolbarProps) {
  return (
    <Box
      sx={{
        px: 2,
        py: 1.25,
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        flexWrap: 'wrap',
        bgcolor: '#fff',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {joinCount > 0 && (
          <Chip
            size="small"
            label={`${joinCount} join${joinCount === 1 ? '' : 's'} active`}
            sx={{
              height: 26,
              fontSize: '0.72rem',
              fontWeight: 600,
              bgcolor: '#eff6ff',
              color: '#1d4ed8',
              border: '1px solid #bfdbfe',
            }}
          />
        )}
      </Box>

      <Typography sx={{ fontSize: '0.8rem', color: '#6b7280', fontWeight: 500 }}>
        {rowCount} rows • {mappedCount} mapped
      </Typography>
    </Box>
  );
}
