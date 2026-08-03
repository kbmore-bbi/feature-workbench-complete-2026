'use client';

import { AiaBox, AiaCard } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { BODY_SX, SECONDARY_TEXT_SX, TYPOGRAPHY_TOKENS } from '@/config/typography-tokens';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import { WorkspaceEmptyMessage } from './workspace-empty-message';
import { workspaceCardSx } from '@/features/sttm/source-target/workspace-card-styles';
import type { DerivedSource } from '@/features/sttm/types/sttm.types';

function getDerivedSourceCounts(source: DerivedSource) {
  const sourceTableCount = source.tableIds?.length ?? source.baseSourceTables?.length ?? 0;
  const outputColumnCount =
    source.outputColumns?.length
    || source.previewColumns?.length
    || source.columns?.length
    || 0;
  const selectedColumnCount = source.selectedColumnsByTable
    ? Object.values(source.selectedColumnsByTable).reduce(
        (total, columns) => total + columns.length,
        0,
      )
    : (source.columns?.length ?? 0);

  return { sourceTableCount, selectedColumnCount, outputColumnCount };
}

type DerivedWorkspaceListProps = {
  orderedIds: string[];
  isSelected: (id: string) => boolean;
  onSelect: (id: string, event: React.MouseEvent, orderedIds: string[]) => void;
};

export default function DerivedWorkspaceList({
  orderedIds,
  isSelected,
  onSelect,
}: DerivedWorkspaceListProps) {
  const { derivedSources } = useSttmBuilderContext();

  const workspaceItems = derivedSources.filter((source) => source.isSelected);

  if (workspaceItems.length === 0) {
    return (
      <WorkspaceEmptyMessage>
        Drag derived sources from Derived Sources Selection into this area.
      </WorkspaceEmptyMessage>
    );
  }

  return (
    <AiaBox sx={{ width: '100%' }}>
      {workspaceItems.map((source) => {
        const { sourceTableCount, selectedColumnCount, outputColumnCount } =
          getDerivedSourceCounts(source);
        const selected = isSelected(source.id);

        return (
          <AiaCard
            key={source.id}
            variant="outlined"
            sx={workspaceCardSx(selected)}
            onClick={(event) => onSelect(source.id, event, orderedIds)}
          >
            <AiaBox
              sx={{
                flex: "1 1 auto",
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: "var(--sttm-card-title-caption-gap)",
              }}
            >
              <AiaText
                sx={{
                  ...BODY_SX,
                  color: TYPOGRAPHY_TOKENS.body.color,
                  whiteSpace: 'normal',
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word',
                }}
              >
                {source.sourceName}
              </AiaText>
              <AiaText
                sx={{
                  ...SECONDARY_TEXT_SX,
                  color: TYPOGRAPHY_TOKENS.secondaryText.color,
                }}
              >
                {sourceTableCount} source table{sourceTableCount === 1 ? '' : 's'} ·{' '}
                {outputColumnCount > 0
                  ? `${outputColumnCount} output column${outputColumnCount === 1 ? '' : 's'}`
                  : `${selectedColumnCount} selected columns`}
              </AiaText>
            </AiaBox>
          </AiaCard>
        );
      })}
    </AiaBox>
  );
}
