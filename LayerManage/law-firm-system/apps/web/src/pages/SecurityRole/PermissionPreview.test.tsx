import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import PermissionPreview from './PermissionPreview';
import PermissionOverview from './PermissionOverview';
import { get, post } from '@/features/workspaces/api';

vi.mock('@/features/workspaces/api', () => ({ get: vi.fn(), post: vi.fn(), errorMessage: (e: Error) => e.message }));
vi.mock('./CurrentPagePreview', () => ({ default: () => <div>当前业务页面预览</div> }));
const tables = [{ id: 't1', name: '案件管理表', base: { id: 'b1', name: '案件应用', workspace: { name: '律师部' } } }];
const subjects = [{ id: 'u1', target: 'MEMBER', label: '沈红梅（chengyeshm）' }, { id: 'r1', target: 'ROLE', label: '律师' }];
const row = { tableId: 't1', tableName: '案件管理表', subject: subjects[0], level: 1, limitedRows: true, limitedFields: false, limitedViews: false };
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(get).mockResolvedValue({ tables, subjects });
  vi.mocked(post).mockResolvedValue({ rows: [row], checked: 1, totalCandidates: 1, nextOffset: null });
});

test('all tables plus a member loads an effective overview and can open a single table preview', async () => {
  render(<MemoryRouter initialEntries={['/security/roles']}><PermissionPreview name="admin" /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '权限预览' }));
  await waitFor(() => expect(get).toHaveBeenCalledWith('/permission-overview/options'));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '预览对象' }));
  fireEvent.click(await screen.findByText('成员 · 沈红梅（chengyeshm）', { selector: '.ant-select-item-option-content' }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/permission-overview', { operation:'read', target: 'MEMBER', id: 'u1', offset: 0 }));
  expect(await screen.findByText('律师部 / 案件应用 / 案件管理表')).toBeInTheDocument();
  vi.mocked(post).mockResolvedValue({ fields: [], records: [], total: 0, canEdit: false, canDelete: false, canAdd: false, source: 'CUSTOM', actions: [] });
  fireEvent.click(screen.getByRole('button', { name: '预览表格' }));
  await waitFor(() => expect(post).toHaveBeenLastCalledWith('/tables/t1/permission-preview', expect.objectContaining({ target: 'MEMBER', id: 'u1', page: 1 })));
});

test('one table plus all members queries every member rather than a fake member id', async () => {
  render(<MemoryRouter initialEntries={['/workspaces?table=t1']}><PermissionPreview name="admin" /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '权限预览' }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '预览对象' }));
  fireEvent.click(await screen.findByText('全部成员', { selector: '.ant-select-item-option-content' }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/permission-overview', { operation:'read', tableId: 't1', target: 'ALL_MEMBERS', offset: 0 }));
  expect(await screen.findByRole('region', { name: '授权汇总' })).toBeInTheDocument();
});

test('overview continues bounded batches and marks partial failures instead of claiming completeness', async () => {
  vi.mocked(post).mockResolvedValueOnce({ rows: [row], checked: 40, totalCandidates: 100, nextOffset: 40 }).mockRejectedValueOnce(new Error('连接中断'));
  render(<PermissionOverview subject="ALL:ALL" tables={tables} onPreview={vi.fn()} />);
  expect(await screen.findByText('连接中断')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('查询未完成');
  expect(screen.getByRole('status')).toHaveTextContent('1 项授权');
  expect(post).toHaveBeenNthCalledWith(2, '/permission-overview', { operation:'read', target: 'ALL', offset: 40 });
});

test('changing subject discards late results from the previous request', async () => {
  let resolveOld!: (value: unknown) => void;
  vi.mocked(post).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  const view = render(<PermissionOverview key="old" subject="MEMBER:u1" tables={tables} onPreview={vi.fn()} />);
  vi.mocked(post).mockResolvedValue({ rows: [], checked: 1, totalCandidates: 1, nextOffset: null });
  view.rerender(<PermissionOverview key="new" subject="MEMBER:u2" tables={tables} onPreview={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('0 项授权'));
  await act(async () => { resolveOld({ rows: [row], checked: 1, totalCandidates: 1, nextOffset: null }); });
  expect(screen.queryByText('沈红梅（chengyeshm）')).not.toBeInTheDocument();
});
