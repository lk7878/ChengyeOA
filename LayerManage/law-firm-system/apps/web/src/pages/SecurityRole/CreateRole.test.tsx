import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import request from '@/api/request';
import CreateRole from './CreateRole';

vi.mock('@/api/request', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('./ApplicationPermissions', () => ({ ApplicationPermissions: () => null }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

test('keeps the wizard draft and shows a role conflict instead of a connection error, then allows retry', async () => {
  vi.mocked(request.get).mockResolvedValue({ data: { capabilities: ['基础办公'] } });
  vi.mocked(request.post).mockRejectedValueOnce({ response: { data: { message: 'AUTHORIZATION_IN_USE' } } });
  const onCreated = vi.fn();
  render(<CreateRole roles={[]} onCreated={onCreated} onClose={vi.fn()} canAuthorize={false} />);
  fireEvent.change(screen.getByLabelText('角色名称'), { target: { value: '律师' } });
  fireEvent.change(screen.getByLabelText('角色说明'), { target: { value: '总所律师' } });
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  fireEvent.click(screen.getByRole('button', { name: '核对并创建' }));
  expect(await screen.findByText('名称或编码已存在，或对象仍在使用中，请核对后重试。')).toBeInTheDocument();
  expect(screen.queryByText('请求未完成，请检查连接后重试。')).not.toBeInTheDocument();
  expect(screen.getByText('总所律师')).toBeInTheDocument();
  expect(onCreated).not.toHaveBeenCalled();
  expect(request.post).toHaveBeenCalledWith('/v1/roles', {
    name: '律师', description: '总所律师', basicOffice: true, copyRoleId: undefined, worksheets: [],
  }, { suppressGlobalError: true });
  vi.mocked(request.post).mockResolvedValueOnce({ data: { id: 'new-role', name: '律师' } });
  fireEvent.click(await screen.findByRole('button', { name: /核对并创建/ }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'new-role', name: '律师' }));
});
