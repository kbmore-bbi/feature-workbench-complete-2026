import SourceTargetItem from './SourceTargetItem';
import { useDataContext } from '../../contexts/DataContext';

export default function SourceTargetList({ type }: any) {
  const { sources, targets, selectTarget, toggleSource   }: any = useDataContext();
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
      {items.map((item: any) => (
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
