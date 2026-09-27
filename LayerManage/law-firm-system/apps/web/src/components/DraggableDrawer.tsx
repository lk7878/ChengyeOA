import { Drawer } from 'antd';
import type { DrawerProps } from 'antd';
import { DragSurface } from './DraggableModal';

export default function DraggableDrawer(props: DrawerProps) {
  return <Drawer {...props} drawerRender={node => <DragSurface key={String(props.open)} fill>{props.drawerRender ? props.drawerRender(node) : node}</DragSurface>} />;
}
