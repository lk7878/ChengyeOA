import { useEffect } from 'react';
import { Button } from 'antd';
import { openCaseAssistant } from '@/features/intelligence/desktop';

export default function SmartCaseLauncher() {
  useEffect(() => { void openCaseAssistant(); }, []);
  return <div><h2>智慧办案</h2><p>{window.chengyeDesktop ? '通过本机 Harness 选择工作目录并办案，可同时查看 OA 案件。' : '通过浮动承业中心使用法律助手，可同时查看 OA 案件。最小化后，会话仍保持打开。'}</p><Button type="primary" onClick={() => { void openCaseAssistant(); }}>打开智慧办案承业中心</Button></div>;
}
