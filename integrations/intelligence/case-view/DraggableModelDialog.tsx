import React, { useEffect, useRef } from 'react';
import { Modal, IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';

/** Drag only this smart-case settings dialog; keep the upstream mask and Escape behavior. */
export function DraggableModelDialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const header = useRef<HTMLDivElement>(null);
  const offset = useRef({ x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number }>();
  const move = (x: number, y: number) => {
    const panel = header.current?.closest<HTMLElement>('[role="dialog"]');
    const layer = panel?.parentElement;
    if (!panel || !layer) return;
    const area = layer.getBoundingClientRect();
    const left = Math.max(0, area.left) + 8, top = Math.max(0, area.top) + 8;
    const right = Math.min(window.innerWidth, area.right) - 8, bottom = Math.min(window.innerHeight, area.bottom) - 8;
    panel.style.maxHeight = `${Math.max(80, Math.min(560, (bottom - top) * 0.75, bottom - top - 64))}px`;
    const rect = panel.getBoundingClientRect();
    const baseLeft = rect.left - offset.current.x, baseTop = rect.top - offset.current.y;
    offset.current = {
      x: Math.min(Math.max(x, left - baseLeft), Math.max(left, right - rect.width) - baseLeft),
      y: Math.min(Math.max(y, top - baseTop), Math.max(top, bottom - rect.height) - baseTop),
    };
    panel.style.transform = `translate(${offset.current.x}px, ${offset.current.y}px)`;
  };
  useEffect(() => {
    if (!open) return;
    offset.current = { x: 0, y: 0 }; drag.current = undefined;
    const fit = () => move(offset.current.x, offset.current.y);
    fit(); window.addEventListener('resize', fit);
    const observer = new ResizeObserver(fit);
    const layer = header.current?.closest('[role="dialog"]')?.parentElement;
    if (layer) observer.observe(layer);
    return () => { window.removeEventListener('resize', fit); observer.disconnect(); drag.current = undefined; };
  }, [open]);
  return <Modal open={open} onClose={onClose} title="AI模型配置" headless className="native-model-dialog">
    <div ref={header} className="native-model-dialog-header" tabIndex={0} role="group" aria-label="移动AI模型配置窗口" title="按住鼠标左键拖动；也可使用方向键移动，Home居中"
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary || (event.target as HTMLElement).closest('button')) return;
        event.preventDefault();
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: offset.current.x, top: offset.current.y };
        event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.dataset.dragging = 'true';
      }}
      onPointerMove={event => { const start = drag.current; if (start?.id === event.pointerId) move(start.left + event.clientX - start.x, start.top + event.clientY - start.y); }}
      onPointerUp={event => { if (drag.current?.id === event.pointerId) { drag.current = undefined; event.currentTarget.releasePointerCapture(event.pointerId); delete event.currentTarget.dataset.dragging; } }}
      onPointerCancel={event => { drag.current = undefined; delete event.currentTarget.dataset.dragging; }}
      onLostPointerCapture={event => { drag.current = undefined; delete event.currentTarget.dataset.dragging; }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        const directions: Record<string, [number, number]> = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
        if (event.key === 'Home') { event.preventDefault(); move(0, 0); }
        else if (directions[event.key]) { event.preventDefault(); const [x, y] = directions[event.key]; move(offset.current.x + x, offset.current.y + y); }
      }}>
      <h2>AI模型配置</h2>
      <button type="button" aria-label="关闭" onClick={onClose}><IconCloseOutline16 size={14} /></button>
    </div>
    <div className="native-model-dialog-body">{children}</div>
  </Modal>;
}
