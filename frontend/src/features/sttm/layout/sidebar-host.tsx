
import { useSidebarSlot } from './sidebar-slot-context';

export function SidebarHost() {
  const { contentComponent: Content } = useSidebarSlot();
  return Content ? <Content /> : null;
}
