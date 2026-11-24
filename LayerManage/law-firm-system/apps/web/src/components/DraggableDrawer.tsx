import { Drawer } from 'antd';
import type { DrawerProps } from 'antd';
import { useState } from 'react';
import { DragSurface } from './DraggableModal';

export default function DraggableDrawer(props: DrawerProps) {
  const [session, setSession] = useState({ open: props.open, key: 0 });
  if (session.open !== props.open) setSession({ open: props.open, key: session.key + 1 });
  return <Drawer {...props} drawerRender={node => <DragSurface key={session.key} fill>{props.drawerRender ? props.drawerRender(node) : node}</DragSurface>} />;
}
