'use client';

import SourceTargetItem from './source-target-item';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import { useMemo } from 'react';
import { WorkspaceEmptyMessage } from './workspace-empty-message';

type SourceTargetListProps = {
  type: 'source' | 'target';
  searchTerm?: string;
};

export default function SourceTargetList({ type, searchTerm = '' }: SourceTargetListProps) {
  const { sources, targets, selectTarget, toggleSource } = useSttmBuilderContext();
  const items = type === 'source' ? sources : targets;

  const filteredItems = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const workspaceItems = items.filter((item) => item.isSelected);
    const baseItems = !query
      ? workspaceItems
      : workspaceItems.filter((item) => {
          const haystack = [item.tableName, item.qualifiedName, item.tag]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          return haystack.includes(query);
        });

    if (type === 'target') {
      return baseItems;
    }

    return [...baseItems].sort((left, right) => {
      if (left.isSelected === right.isSelected) {
        return 0;
      }
      return left.isSelected ? -1 : 1;
    });
  }, [items, searchTerm, type]);

  const selectHandler = (id: string) => {
    if (type === 'source') {
      toggleSource(id);
    } else {
      selectTarget(id);
    }
  };

  if (filteredItems.length === 0) {
    return (
      <WorkspaceEmptyMessage>
        {type === "source"
          ? "Drag tables, schemas, or databases from Source Selection into this area."
          : "Drag one table from Target Selection into this area."}
      </WorkspaceEmptyMessage>
    );
  }

  return (
    <div>
      {filteredItems.map((item) => (
        <SourceTargetItem
          type={type}
          key={item.tableId}
          item={item}
          selectHandler={selectHandler}
        />
      ))}
    </div>
  );
}
