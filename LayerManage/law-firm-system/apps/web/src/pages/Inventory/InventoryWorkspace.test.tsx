import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Link, MemoryRouter, useLocation } from 'react-router';
import InventoryWorkspace from './InventoryWorkspace';
import { get } from '@/features/workspaces/api';

vi.mock('@/features/workspaces/api', () => ({ get: vi.fn(), errorMessage: () => '当前账号无权访问或服务暂时不可用' }));
vi.mock('@/features/crm/BusinessWorkspacePage', () => ({ default: ({source}: {source: string}) => <div>目录：{source}</div> }));
vi.mock('./InventoryAnalyticsPage', () => ({ default: () => <div>统计页</div> }));
vi.mock('@/pages/Workspaces', () => ({ WorkspaceEditor: () => {
  const location = useLocation();
  return <div data-testid="editor">{location.pathname}{location.search}</div>;
} }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const routes = [
  ['customized-records', 'INVENTORY_REGISTER'], ['office-records', 'OFFICE_REGISTER'],
  ['inbound', 'OFFICE_INBOUND'], ['outbound', 'OFFICE_OUTBOUND'],
];
const row = (kind: string, id = kind) => ({ id, inventoryKind: kind, baseId: 'base-' + id, name: '已重命名的表 ' + id, baseName: '工作表', workspaceName: '分所物品管理' });
function mount(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><InventoryWorkspace /><Link to="/inventory/inbound">转入库菜单</Link><Link to="/inventory/outbound">转出库菜单</Link></MemoryRouter>);
}
test.each(routes)('%s opens the authorized typed worksheet on the original route', async (section, kind) => {
  vi.mocked(get).mockResolvedValue({ tables: [row(kind)], targets: [] });
  mount('/inventory/' + section);
  expect((await screen.findByTestId('editor')).textContent).toBe('/inventory/' + section + '?base=base-' + kind + '&table=' + kind);
  expect(get).toHaveBeenCalledWith('/collaboration/business-tables?source=INVENTORY_ITEMS&inventoryKind=' + kind);
  expect(screen.queryByText('目录：INVENTORY_MOVEMENTS')).toBeNull();
});
test('deep links reuse the shared editor without remapping IDs or dropping a view/record', async () => {
  const path = '/inventory/inbound?base=existing&table=renamed&view=personal&record=r';
  mount(path);
  expect((await screen.findByTestId('editor')).textContent).toBe(path);
  expect(get).not.toHaveBeenCalled();
});
test('multiple authorized worksheets prompt for selection rather than choosing another branch silently', async () => {
  vi.mocked(get).mockResolvedValue({ tables: [row('OFFICE_INBOUND', 'branch-a'), row('OFFICE_INBOUND', 'branch-b')] });
  mount('/inventory/inbound');
  const chosen = await screen.findByRole('link', { name: /已重命名的表 branch-b/ });
  expect(screen.queryByTestId('editor')).toBeNull();
  fireEvent.click(chosen);
  expect((await screen.findByTestId('editor')).textContent).toBe('/inventory/inbound?base=base-branch-b&table=branch-b');
});
test('missing or unauthorized sheets show an actionable empty state', async () => {
  vi.mocked(get).mockResolvedValue({ tables: [] });
  mount('/inventory/office-records');
  expect(await screen.findByText(/未找到可访问的对应工作表/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '重新加载' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '返回物品工作表' })).toHaveAttribute('href', '/inventory/items');
});
test('load failures stop the spinner and retry opens the worksheet', async () => {
  vi.mocked(get).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ tables: [row('OFFICE_OUTBOUND')] });
  mount('/inventory/outbound');
  expect(await screen.findByText('工作表加载失败')).toBeTruthy();
  expect(screen.queryByLabelText('正在打开工作表')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
  expect((await screen.findByTestId('editor')).textContent).toContain('table=OFFICE_OUTBOUND');
});
test('switching menus cancels stale destination results and can switch again after opening an editor', async () => {
  let resolveInbound!: (value: unknown) => void;
  vi.mocked(get).mockImplementation(url => url.endsWith('OFFICE_INBOUND')
    ? new Promise(resolve => { resolveInbound = resolve; })
    : Promise.resolve({ tables: [row('OFFICE_OUTBOUND')] }));
  mount('/inventory/inbound');
  await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('link', { name: '转出库菜单' }));
  expect((await screen.findByTestId('editor')).textContent).toContain('/inventory/outbound?');
  resolveInbound({ tables: [row('OFFICE_INBOUND')] });
  await waitFor(() => expect(screen.getByTestId('editor').textContent).toContain('table=OFFICE_OUTBOUND'));
  vi.mocked(get).mockResolvedValue({ tables: [row('OFFICE_INBOUND')] });
  fireEvent.click(screen.getByRole('link', { name: '转入库菜单' }));
  await waitFor(() => expect(screen.getByTestId('editor').textContent).toContain('table=OFFICE_INBOUND'));
});
