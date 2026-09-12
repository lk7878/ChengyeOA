import { useEffect } from 'react';
import { Button } from 'antd';
import { useCaseWindow } from '@/features/intelligence/window-store';

export default function SmartCaseLauncher() {
  useEffect(() => { useCaseWindow.getState().show(); }, []);
  return <div><h2>智慧办案</h2><p>通过浮动工作台使用法律助手，可同时查看 OA 案件。最小化后，会话仍保持打开。</p><Button type="primary" onClick={() => useCaseWindow.getState().show()}>打开智慧办案工作台</Button></div>;
}
