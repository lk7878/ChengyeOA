import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import ModuleRecordList from './ModuleRecordList';
import CreateModuleBase from './CreateModuleBase';
import { moduleRecords } from './module-records';
import { businessSources } from './business-sources';
import request from '@/api/request';
import { useAuthStore } from '@/stores/authStore';
import { get, post } from '@/features/workspaces/api';

vi.mock('@/api/request', () => ({ default: { get: vi.fn(), delete: vi.fn() } }));
vi.mock('@/features/workspaces/api', () => ({
  get: vi.fn(async () => ({ workspaces: [{ id: 'w', name: '律所工作区' }] })),
  post: vi.fn(),
  errorMessage: () => '有关联业务，无法删除',
}));
beforeEach(() => {
  useAuthStore.setState({ hasPermission: () => true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
test.each(Object.keys(moduleRecords) as (keyof typeof moduleRecords)[])(
  '%s lists saved domain records without requiring a workspace connection',
  async (source) => {
    const config = moduleRecords[source];
    const key = config.columns[0][0];
    const row = { id: 'record', leadId: 'lead', [key]: '已保存记录', version: 3 };
    vi.mocked(request.get).mockResolvedValue({ data: { list: [row], pagination: { total: 1 } } });
    render(
      <MemoryRouter>
        <ModuleRecordList source={source} />
      </MemoryRouter>,
    );
    await screen.findByText('已保存记录');
    expect(request.get).toHaveBeenCalledWith(
      config.endpoint,
      expect.objectContaining({
        params: expect.objectContaining({ page: 1, pageSize: 20, ...config.params }),
      }),
    );
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      source === 'FOLLOWS' ? '/leads/lead' : businessSources[source].path + '/' + row.id,
    );
  },
);
test('reader has no delete button; authorized deletion uses version and keeps the error in the confirmation', async () => {
  vi.mocked(request.get).mockResolvedValue({
    data: { list: [{ id: 'c', customerNo: 'CU1', name: '客户甲', version: 7 }], total: 1 },
  });
  useAuthStore.setState({ hasPermission: () => false });
  const view = render(
    <MemoryRouter>
      <ModuleRecordList source="CUSTOMERS" />
    </MemoryRouter>,
  );
  await screen.findByText('客户甲');
  expect(screen.queryByRole('button', { name: /删\s*除/ })).toBeNull();
  view.unmount();
  useAuthStore.setState({ hasPermission: () => true });
  vi.mocked(request.delete).mockRejectedValue(new Error('in use'));
  render(
    <MemoryRouter>
      <ModuleRecordList source="CUSTOMERS" />
    </MemoryRouter>,
  );
  await screen.findByText('客户甲');
  fireEvent.click(screen.getByRole('button', { name: /删\s*除/ }));
  const modal = await screen.findByRole('dialog');
  fireEvent.click(within(modal).getByRole('button', { name: '确认删除' }));
  await within(modal).findByText('有关联业务，无法删除');
  expect(request.delete).toHaveBeenCalledWith('/v1/customers/c', { data: { version: 7 } });
  expect(screen.getByText('客户甲')).toBeTruthy();
});
test('financial domain queries translate route context into the API filters', async () => {
  vi.mocked(request.get).mockResolvedValue({ data: { list: [], total: 0 } });
  render(
    <MemoryRouter initialEntries={['/payments?contract=contract1&case=case1']}>
      <ModuleRecordList source="PAYMENTS" />
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(request.get).toHaveBeenCalledWith('/v1/payments', {
      params: { page: 1, pageSize: 20, contractId: 'contract1' },
    }),
  );
});
test('new module workbooks request a canonical business connection by default', async () => {
  vi.mocked(post).mockResolvedValue({ id: 'base', tableId: 'table' });
  const onCreated = vi.fn();
  render(<CreateModuleBase source="CUSTOMERS" onCreated={onCreated} />);
  fireEvent.click(screen.getByRole('button', { name: '新建多维表格' }));
  await screen.findByText('律所工作区');
  expect(get).toHaveBeenCalledWith('/workspaces?source=CUSTOMERS');
  const modal = await screen.findByRole('dialog');
  fireEvent.click(within(modal).getByRole('button', { name: '创建工作表' }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/workspaces/w/drive/bases',
      { name: '客户管理', moduleSource: 'CUSTOMERS', connectBusiness: true },
      expect.any(String),
    ),
  );
  expect(onCreated).toHaveBeenCalledWith('base', 'table');
});
