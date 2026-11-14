import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button } from 'antd';
import { CloseOutlined, ExpandOutlined, MinusOutlined, ShrinkOutlined, RobotOutlined } from '@ant-design/icons';
import { useAuthStore } from '@/stores/authStore';
import { useCaseWindow } from '@/features/intelligence/window-store';
import IntelligencePage from '@/pages/Intelligence';
import './window.css';

type Box = { x: number; y: number; width: number; height: number };
function fit(box: Box): Box {
  const width = Math.min(Math.max(640, box.width), window.innerWidth - 16);
  const height = Math.min(Math.max(420, box.height), window.innerHeight - 16);
  return { width, height, x: Math.max(8, Math.min(box.x, window.innerWidth - width - 8)), y: Math.max(8, Math.min(box.y, window.innerHeight - height - 8)) };
}
function LiveWorkbench() {
  const { open, minimized, minimize, close } = useCaseWindow();
  const [maximized, setMaximized] = useState(false);
  const [box, setBox] = useState(() => fit({ x: 100, y: 72, width: 1240, height: 780 }));
  const [narrow, setNarrow] = useState(window.innerWidth < 720);
  const windowElement = useRef<HTMLElement>(null);
  const gesture = useRef<{ box: Box; x: number; y: number; resize: boolean } | null>(null);
  useEffect(() => { if (open && !minimized) windowElement.current?.focus({ preventScroll: true }); }, [open, minimized]);
  const returnFocus = () => document.querySelector<HTMLButtonElement>('[data-smart-case-launcher]')?.focus();
  useEffect(() => {
    const resize = () => { setNarrow(window.innerWidth < 720); setBox(previous => fit(previous)); };
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, []);
  const start = (event: PointerEvent<HTMLElement>, resize = false) => {
    if (maximized || narrow || (!resize && (event.target as HTMLElement).closest('button'))) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { box, x: event.clientX, y: event.clientY, resize };
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current; if (!current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    setBox(fit(current.resize ? { ...current.box, width: current.box.width + dx, height: current.box.height + dy } : { ...current.box, x: current.box.x + dx, y: current.box.y + dy }));
  };
  const end = () => { gesture.current = null; };
  const fullscreen = maximized || narrow;
  return <>
    {open && <section ref={windowElement} tabIndex={-1} className="case-workbench" role="dialog" aria-label="智慧办案浮动承业中心" aria-modal="false" style={{
      display: minimized ? 'none' : 'flex', left: fullscreen ? 8 : box.x, top: fullscreen ? 8 : box.y,
      width: fullscreen ? 'calc(100vw - 16px)' : box.width, height: fullscreen ? 'calc(100dvh - 16px)' : box.height,
    }}>
      <header className="case-workbench-titlebar" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onDoubleClick={event => { if (!(event.target as HTMLElement).closest('button')) setMaximized(value => !value); }}>
        <span><RobotOutlined /> 智慧办案 <small>服务器工作区</small></span>
        <div><Button type="text" aria-label="最小化智慧办案" title="最小化（保留会话）" icon={<MinusOutlined />} onClick={() => { minimize(); returnFocus(); }} />
          <Button type="text" aria-label={maximized ? '还原智慧办案窗口' : '最大化智慧办案'} title={maximized ? '还原' : '最大化'} icon={maximized ? <ShrinkOutlined /> : <ExpandOutlined />} disabled={narrow} onClick={() => setMaximized(value => !value)} />
          <Button type="text" aria-label="关闭智慧办案" title="关闭并停止当前连接" icon={<CloseOutlined />} onClick={() => { close(); returnFocus(); }} /></div>
      </header>
      <div className="case-workbench-body"><IntelligencePage feature="smart-case" embedded /></div>
      {!fullscreen && <div className="case-workbench-resize" role="separator" aria-label="调整智慧办案窗口大小" tabIndex={0}
        onPointerDown={event => start(event, true)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
        onKeyDown={event => { if (!event.key.startsWith('Arrow')) return; event.preventDefault(); setBox(previous => fit({ ...previous, width: previous.width + (event.key === 'ArrowRight' ? 20 : event.key === 'ArrowLeft' ? -20 : 0), height: previous.height + (event.key === 'ArrowDown' ? 20 : event.key === 'ArrowUp' ? -20 : 0) })); }} />}
    </section>}
  </>;
}

/** Mounted outside route elements so navigation/minimization keep one live native root. */
export default function CaseWorkbench() {
  const userId = useAuthStore(state => state.userInfo?.id);
  const allowed = useAuthStore(state => state.isAuthenticated && !!state.authorization?.menus.includes('menu.smart_case'));
  useEffect(() => { if (!allowed) useCaseWindow.getState().close(); }, [allowed]);
  return allowed && userId ? <LiveWorkbench key={userId} /> : null;
}
