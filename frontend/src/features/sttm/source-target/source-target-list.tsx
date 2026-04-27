'use client';
import SourceTargetItem from './source-target-item';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';

export default function SourceTargetList({ type }: any) {
  const { sources, targets, selectTarget, toggleSource   }: any = useSttmBuilderContext();
  const items = type === 'source' ? sources : targets;

  const selectHandler = (id:number | string) => {
    console.log(id)
    if(type === 'source') {
      toggleSource(id)
    } else {
      selectTarget(id)
    }
  }

  return (
    <div>
      {items && items.map((item: any) => (
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
