import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { FieldManagement } from './FieldManagement';
import { get, post } from './api';
vi.mock('./api', () => ({ get: vi.fn(), post: vi.fn(), errorMessage: (e: Error) => e.message }));
const field = { id: 'field', name: '备注', type: 'TEXT', position: 1, options: {}, stopped: true, system: false, core: false, reason: '' };
const props = { tableId: 'table', version: 2, canManage: true, onCreate: vi.fn(), onEdit: vi.fn(), onChanged: vi.fn() };
const report = { field, version: 2, blockers: [] as string[], token: 'preview-token', impact: { activeRecords: 3, recycledRecords: 2, extensionRecords: 0, revisions: 4, undoEntries: 1 } };
afterEach(() => { cleanup(); vi.resetAllMocks(); });
test('ordinary managers can restore but never see permanent deletion', async () => {
  vi.mocked(get).mockResolvedValue({ fields: [field], version: 2, superAdmin: false });
  render(<FieldManagement {...props} />);
  fireEvent.click(await screen.findByRole('tab', { name: '已停用（1）' }));
  expect(screen.getByRole('button', { name: '恢 复' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: '彻底删除' })).not.toBeInTheDocument();
});
test('superadmin must review counts and type the field name before a delete request', async () => {
  vi.mocked(get).mockImplementation(async url => url.includes('removal-preview') ? report : { fields: [field], version: 2, superAdmin: true });
  vi.mocked(post).mockResolvedValue({});
  render(<FieldManagement {...props} />);
  fireEvent.click(await screen.findByRole('tab', { name: '已停用（1）' }));
  fireEvent.click(screen.getByRole('button', { name: '彻底删除' }));
  const confirm = await screen.findByRole('button', { name: '确认彻底删除' });
  expect(confirm).toBeDisabled();
  expect(screen.getByText(/当前记录 3 条、回收站记录 2 条/)).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('输入字段名称确认删除'), { target: { value: '备注' } });
  expect(confirm).toBeEnabled(); fireEvent.click(confirm);
  await waitFor(() => expect(post).toHaveBeenCalledWith('/tables/table/fields/field/manage', { action: 'delete', version: 2, token: 'preview-token', confirmName: '备注' }));
});
test('dependency report prevents confirmation even with matching name', async () => {
  vi.mocked(get).mockImplementation(async url => url.includes('removal-preview') ? { ...report, blockers: ['视图「总表」的筛选'] } : { fields: [field], version: 2, superAdmin: true });
  render(<FieldManagement {...props} />);
  fireEvent.click(await screen.findByRole('tab', { name: '已停用（1）' }));
  fireEvent.click(screen.getByRole('button', { name: '彻底删除' }));
  await screen.findByText('视图「总表」的筛选');
  fireEvent.change(screen.getByLabelText('输入字段名称确认删除'), { target: { value: '备注' } });
  expect(screen.getByRole('button', { name: '确认彻底删除' })).toBeDisabled();
  expect(post).not.toHaveBeenCalled();
});
test('core field shows an explanation and allows superadmin display configuration only', async () => {
  vi.mocked(get).mockResolvedValue({ fields: [{ ...field, name: '主办律师', stopped: false, system: true, core: true, reason: '人员关联不能停用' }], version: 2, superAdmin: true });
  render(<FieldManagement {...props} />);
  await screen.findByText('主办律师');
  expect(screen.getByText('人员关联不能停用')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '停 用' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '展示配置' })).toBeEnabled();
});
