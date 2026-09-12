import { useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import { useAuthStore } from '@/stores/authStore';
import { useCaseWindow } from '@/features/intelligence/window-store';
import CaseWorkbench from './index';

const lifetime = vi.hoisted(() => ({ mount: vi.fn(), close: vi.fn() }));
vi.mock('@/pages/Intelligence', () => ({ default: function NativeRoot() {
  useEffect(() => { lifetime.mount(); return () => lifetime.close(); }, []);
  return <input aria-label="本次办案输入" />;
} }));
beforeEach(() => {
  vi.clearAllMocks(); useCaseWindow.getState().close();
  useAuthStore.setState({ isAuthenticated: true, userInfo: { id: 'workbench-lawyer', username: 'lawyer', name: '测试律师' }, authorization: {
    userId: 'workbench-lawyer', employeeId: null, isSystemSuperAdmin: false, isSystemAdmin: false, menus: ['menu.smart_case'], permissions: [], fieldCapabilities: {}, evaluatedAt: new Date().toISOString(), validUntil: null,
  } });
});
test('minimization and OA navigation retain a single root; close releases it', () => {
  render(<MemoryRouter><CaseWorkbench /><Link to="/cases">查看案件</Link><Routes><Route path="/" element={<p>首页</p>} /><Route path="/cases" element={<p>案件列表</p>} /></Routes></MemoryRouter>);
  act(() => useCaseWindow.getState().show());
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '待发送材料摘要' } });
  fireEvent.click(screen.getByRole('button', { name: '最小化智慧办案' }));
  fireEvent.click(screen.getByRole('link', { name: '查看案件' }));
  expect(screen.getByText('案件列表')).toBeInTheDocument();
  act(() => useCaseWindow.getState().show());
  expect(screen.getByRole('textbox')).toHaveValue('待发送材料摘要');
  expect(lifetime.mount).toHaveBeenCalledTimes(1); expect(lifetime.close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '关闭智慧办案' }));
  expect(lifetime.close).toHaveBeenCalledTimes(1);
});
test('permission withdrawal unmounts the private workspace and removes its window', () => {
  render(<MemoryRouter><CaseWorkbench /></MemoryRouter>);
  act(() => useCaseWindow.getState().show());
  act(() => useAuthStore.setState({ authorization: null }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(lifetime.close).toHaveBeenCalledTimes(1);
  expect(useCaseWindow.getState().open).toBe(false);
});
