'use client';
import { AiaBox, AiaChip } from '@/components/ui';

import { AiaText } from '@/components/ui/aia-text';


type MappingTableToolbarProps = {
  rowCount: number;
  mappedCount: number;
  joinCount: number;
  sortBy?: string;
  onSortChange?: (value: string) => void;
};

export default function MappingTableToolbar({
  joinCount,
}: MappingTableToolbarProps) {
  return (
    <AiaBox
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
      <AiaBox sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {joinCount > 0 && (
          <AiaChip
            size="small"
            color="primary"
            label={`${joinCount} join${joinCount === 1 ? '' : 's'} active`}
          />
        )}
      </AiaBox>

      <AiaText sx={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 500 }}>
        Mapping table
      </AiaText>
    </AiaBox>
  );
}
