/* eslint-disable react-refresh/only-export-components -- Preserve AntD static APIs on the shared modal component. */
import { Modal as AntModal } from 'antd';
import type { ModalProps } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import './DraggableModal.css';

function DragSurface({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  const move = (dx: number, dy: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    // Keep the complete title bar reachable, including the close button.
    const x = Math.max(8 - rect.left, Math.min(dx, window.innerWidth - 8 - rect.right));
    const y = Math.max(8 - rect.top, Math.min(dy, window.innerHeight - 64 - rect.top));
    setPosition(value => ({ x: value.x + x, y: value.y + y }));
  };
  useEffect(() => {
    const resize = () => move(0, 0);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  return <div ref={ref} className="oa-modal-drag-surface" style={position.x || position.y ? { transform: `translate(${position.x}px, ${position.y}px)` } : undefined}
    onPointerDown={event => {
      const target = event.target as HTMLElement;
      if (event.button !== 0 || !target.closest('.ant-modal-header') || target.closest('button,a,input,select,textarea')) return;
      drag.current = { x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    }}
    onPointerMove={event => {
      if (!drag.current) return;
      move(event.clientX - drag.current.x, event.clientY - drag.current.y);
      drag.current = { x: event.clientX, y: event.clientY };
    }}
    onPointerUp={() => { drag.current = null; }}
    onLostPointerCapture={() => { drag.current = null; }}
    onPointerCancel={() => { drag.current = null; }}
  >{children}</div>;
}

function DraggableModal(props: ModalProps) {
  // rc-dialog freezes hidden children, so an open/closed string key alone can
  // reuse the previous drag position when the modal opens again.
  const [session, setSession] = useState({ open: props.open, key: 0 });
  if (session.open !== props.open) setSession({ open: props.open, key: session.key + 1 });
  return <AntModal {...props} className={['oa-draggable-modal', props.className].filter(Boolean).join(' ')}
    modalRender={node => <DragSurface key={session.key}>{props.modalRender ? props.modalRender(node) : node}</DragSurface>} />;
}

// Preserve Ant Design's imperative confirmation APIs used by existing pages.
export default Object.assign(DraggableModal, {
  confirm: AntModal.confirm, info: AntModal.info, success: AntModal.success,
  error: AntModal.error, warning: AntModal.warning, warn: AntModal.warn,
  destroyAll: AntModal.destroyAll, useModal: AntModal.useModal, config: AntModal.config,
});
