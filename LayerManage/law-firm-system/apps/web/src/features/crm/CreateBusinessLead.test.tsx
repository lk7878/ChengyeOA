import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import CreateBusinessLead from './CreateBusinessLead';
const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../workspaces/api', () => ({ post: api.post, errorMessage: () => '暂未收到确认，请重试' }));
beforeEach(() => {
  api.post.mockReset();
});
test('an uncertain create retains its draft and idempotency key; changed input uses a new attempt', async () => {
  api.post.mockRejectedValue(new Error('network'));
  const created = vi.fn();
  render(<CreateBusinessLead tableId="business" onCreated={created} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText('线索姓名'), { target: { value: '测试线索' } });
  fireEvent.change(screen.getByLabelText('线索联系电话'), { target: { value: '13900006661' } });
  fireEvent.click(screen.getByRole('button', { name: '创建线索' }));
  await screen.findByText('暂未收到确认，请重试');
  const firstKey = api.post.mock.calls[0][2];
  fireEvent.click(screen.getByRole('button', { name: '创建线索' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  expect(api.post.mock.calls[1][2]).toBe(firstKey);
  expect(screen.getByLabelText('线索姓名')).toHaveValue('测试线索');
  fireEvent.change(screen.getByLabelText('线索联系电话'), { target: { value: '13900006662' } });
  api.post.mockResolvedValueOnce({ id: 'canonical-lead', duplicates: 0 });
  fireEvent.click(screen.getByRole('button', { name: '创建线索' }));
  await waitFor(() => expect(created).toHaveBeenCalledWith('canonical-lead', 0));
  expect(api.post.mock.calls[2][2]).not.toBe(firstKey);
});
test('a response after leaving the creation dialog cannot navigate to the old record', async () => {
  let resolve!: (value: unknown) => void;
  api.post.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const created = vi.fn();
  const view = render(<CreateBusinessLead tableId="business" onCreated={created} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText('线索姓名'), { target: { value: '离开页面' } });
  fireEvent.change(screen.getByLabelText('线索联系电话'), { target: { value: '13900006663' } });
  fireEvent.click(screen.getByRole('button', { name: '创建线索' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
  view.unmount();
  resolve({ id: 'old-record', duplicates: 0 });
  await Promise.resolve();
  expect(created).not.toHaveBeenCalled();
});
