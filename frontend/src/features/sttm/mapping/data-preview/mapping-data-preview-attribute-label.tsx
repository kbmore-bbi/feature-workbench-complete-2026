import { AiaBox } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import { formatSqlType } from '../mapping-utils';
import { DATA_PREVIEW_ATTRIBUTE_TYPE_SX } from './mapping-data-preview-styles';

type MappingDataPreviewAttributeLabelProps = {
  name: string;
  dataType?: string | null;
};

export function MappingDataPreviewAttributeLabel({
  name,
  dataType,
}: MappingDataPreviewAttributeLabelProps) {
  return (
    <AiaBox sx={{ minWidth: 0 }}>
      <AiaText
        sx={{
          fontSize: '0.8rem',
          fontWeight: 400,
          color: '#111827',
          lineHeight: 1.35,
          overflowWrap: 'anywhere',
        }}
      >
        {name}
      </AiaText>
      <AiaText sx={DATA_PREVIEW_ATTRIBUTE_TYPE_SX}>
        {dataType ? formatSqlType(dataType).toLowerCase() : '—'}
      </AiaText>
    </AiaBox>
  );
}
