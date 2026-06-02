'use client';

import SourceTargetItem from './source-target-item';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import { useMemo } from 'react';

type SourceTargetListProps = {
  type: 'source' | 'target';
  searchTerm?: string;
};

export default function SourceTargetList({ type, searchTerm = '' }: SourceTargetListProps) {
  const { sources, targets, selectTarget, toggleSource } = useSttmBuilderContext();
  const items = type === 'source' ? sources : targets;

  const filteredItems = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) {
      return items;
    }

    return items.filter((item) => {
      const haystack = [item.tableName, item.qualifiedName, item.tag]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [items, searchTerm]);

  const selectHandler = (id: string) => {
    if (type === 'source') {
      toggleSource(id);
    } else {
      selectTarget(id);
    }
  };

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
