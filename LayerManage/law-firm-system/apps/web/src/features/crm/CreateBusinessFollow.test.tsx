import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import CreateBusinessFollow from './CreateBusinessFollow';
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../workspaces/api', () => ({ ...api, errorMessage: () => '请求失败，请重试' }));
beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ leads: [{ id: 'lead', name: 'CU001 · 测试客户' }] });
  api.post.mockReset();
});
test('follow creation selects an authorized lead and retries without losing data or duplicating the request', async () => {
  api.post.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ id: 'follow' });
  const created = vi.fn();
  render(
    <CreateBusinessFollow
      tableId="t"
      allowedFields={['nextPlan', 'nextTime']}
      onCreated={created}
      onCancel={() => {}}
    />,
  );
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/tables/t/follow-leads?keyword='));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '关联客户' }));
  fireEvent.click(await screen.findByText('CU001 · 测试客户'));
  fireEvent.change(screen.getByRole('textbox', { name: '跟进内容' }), { target: { value: '约定下周回访' } });
  fireEvent.click(screen.getByRole('button', { name: '保存跟进' }));
  await screen.findByText('请求失败，请重试');
  const first = api.post.mock.calls[0];
  expect(first[0]).toBe('/tables/t/business-records');
  expect(first[1]).toEqual({ leadId: 'lead', type: 'PHONE', content: '约定下周回访' });
  expect(screen.getByRole('textbox', { name: '跟进内容' })).toHaveValue('约定下周回访');
  fireEvent.click(screen.getByRole('button', { name: '保存跟进' }));
  await waitFor(() => expect(created).toHaveBeenCalledWith('follow'));
  expect(api.post.mock.calls[1][2]).toBe(first[2]);
});
