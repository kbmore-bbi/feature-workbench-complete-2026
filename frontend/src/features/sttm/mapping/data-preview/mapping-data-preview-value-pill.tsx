import { AiaBox } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import {
  DATA_PREVIEW_MAPPED_PILL_SX,
  DATA_PREVIEW_RULE_LABEL_SX,
  DATA_PREVIEW_SOURCE_PILL_SX,
  DATA_PREVIEW_TRANSFORMED_PILL_SX,
} from './mapping-data-preview-styles';

type MappingDataPreviewValuePillProps = {
  value: string | null;
  variant: 'source' | 'transformed' | 'mapped';
  ruleLabel?: string | null;
  emptyLabel?: string;
};

export function MappingDataPreviewValuePill({
  value,
  variant,
  ruleLabel,
  emptyLabel = '--',
}: MappingDataPreviewValuePillProps) {
  const displayValue = typeof value === 'string' ? value.trim() : null;

  if (!displayValue) {
    return (
      <AiaText sx={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600 }}>
        {emptyLabel}
      </AiaText>
    );
  }

  const pillSx =
    variant === 'source'
      ? DATA_PREVIEW_SOURCE_PILL_SX
      : variant === 'mapped'
        ? DATA_PREVIEW_MAPPED_PILL_SX
        : DATA_PREVIEW_TRANSFORMED_PILL_SX;

  return (
    <AiaBox sx={{ minWidth: 0 }}>
      <AiaBox component="span" sx={pillSx} title={displayValue}>
        {displayValue}
      </AiaBox>
      {variant === 'transformed' && ruleLabel ? (
        <AiaText sx={DATA_PREVIEW_RULE_LABEL_SX}>{String(ruleLabel)}</AiaText>
      ) : null}
    </AiaBox>
  );
}
