
import { useSidebarSlot } from './sidebar-slot-context';

export function SidebarHost() {
  const { content } = useSidebarSlot();
  return <>{content}</>;
}
