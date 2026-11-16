import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { authApi } from '@/api/auth';
import { runtimeSession } from '../runtime-session';
import ChangePasswordDialog from './ChangePasswordDialog';
vi.mock('@/api/auth', () => ({ authApi: { changePassword: vi.fn() } }));
beforeEach(() => { vi.clearAllMocks(); runtimeSession.clear(); });
function Page() { const [open, setOpen] = useState(true); return <><input aria-label="未提交业务表单" defaultValue="保留业务草稿" /><ChangePasswordDialog open={open} onClose={() => setOpen(false)} /></>; }
test('checks confirmation before sending and keeps the business form while rotating credentials', async () => {
  vi.mocked(authApi.changePassword).mockResolvedValue({ code: 200, message: 'OK', data: { token: 'new-access', csrfToken: 'new-csrf', expiresIn: 900 } });
  render(<Page />);
  fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'old-personal-password' } });
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'new-personal-password' } });
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'mismatch' } });
  fireEvent.click(screen.getByRole('button', { name: '确认修改' }));
  await screen.findByText('两次输入的密码不一致'); expect(authApi.changePassword).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'new-personal-password' } });
  fireEvent.click(screen.getByRole('button', { name: '确认修改' }));
  await waitFor(() => expect(runtimeSession.getAccessToken()).toBe('new-access'));
  expect(screen.getByLabelText('未提交业务表单')).toHaveValue('保留业务草稿');
  expect(localStorage.length).toBe(0);
});
test('wrong current password stays in the dialog without changing the current session', async () => {
  runtimeSession.setAuthenticated({ token: 'existing', csrfToken: 'csrf', expiresIn: 900 });
  vi.mocked(authApi.changePassword).mockRejectedValue({ response: { status: 403, data: { message: 'CURRENT_PASSWORD_INVALID' } } });
  render(<Page />);
  for (const label of ['当前密码', '新密码', '确认新密码']) fireEvent.change(screen.getByLabelText(label), { target: { value: 'some-password' } });
  fireEvent.click(screen.getByRole('button', { name: '确认修改' }));
  await screen.findByText('当前密码不正确');
  expect(runtimeSession.getAccessToken()).toBe('existing');
  expect(screen.getByLabelText('未提交业务表单')).toHaveValue('保留业务草稿');
});
