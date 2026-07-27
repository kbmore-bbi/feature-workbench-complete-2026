import { AiaBox, AiaTableCellPrimitive } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import type { SxProps, Theme } from '@mui/material/styles';
import { aiaTableCellSx } from '@/components/ui/aia-table';
import type { MappingState } from '@/features/sttm/types/sttm.types';
import { buildMappingDataPreview } from '../mapping-utils';
import { MAPPING_TABLE_BODY_TEXT_SX } from '../mapping-table-styles';
import { MappingDataPreviewValuePill } from './mapping-data-preview-value-pill';

type MappingDataPreviewCellProps = {
  mapping: MappingState;
  width?: number | string;
  minWidth?: number | string;
  sx?: SxProps<Theme>;
};

export function MappingDataPreviewCell({
  mapping,
  width = 168,
  minWidth,
  sx,
}: MappingDataPreviewCellProps) {
  const preview = buildMappingDataPreview(mapping);

  if (!preview.displayValue || mapping.status !== 'MAPPED') {
    return (
      <AiaTableCellPrimitive sx={aiaTableCellSx({ width, minWidth, sx })}>
        <AiaText sx={{ ...MAPPING_TABLE_BODY_TEXT_SX, color: '#94a3b8' }}>—</AiaText>
      </AiaTableCellPrimitive>
    );
  }

  return (
    <AiaTableCellPrimitive sx={aiaTableCellSx({ width, minWidth, sx })}>
      <AiaBox sx={{ minWidth: 0 }}>
        {preview.hasTransform ? (
          <MappingDataPreviewValuePill
            value={preview.transformedValue}
            variant="transformed"
            ruleLabel={preview.ruleLabel}
          />
        ) : (
          <MappingDataPreviewValuePill
            value={preview.displayValue}
            variant="mapped"
          />
        )}
      </AiaBox>
    </AiaTableCellPrimitive>
  );
}
