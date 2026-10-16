import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import Modal from '@/components/DraggableModal';
import { WorkspaceEditor } from './index';
import { get, patch, post } from '@/features/workspaces/api';

vi.mock('@/features/workspaces/api', () => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  errorMessage: () => '失败',
  errorStatus: () => 500,
  streamEvents: () => new Promise(() => {}),
}));
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  vi.clearAllMocks();
});

test.each(['NEGOTIATIONS', 'CUSTOMERS', 'CASES', 'CONTRACTS', 'CUSTOM'])(
  'reselecting the current %s table reloads the editor',
  async (source) => {
    const table = { id: 't', baseId: 'b', name: '业务记录表', source, schemaVersion: 1, archived: false };
    const access = { level: 1, canCreate: false, hidden: [], readonly: [] };
    const detail = {
      table,
      access,
      fields: [],
      views: [{ id: 'v', name: '总表', type: 'GRID', shared: true, isDefault: true, version: 1, config: {} }],
    };
    vi.mocked(get).mockImplementation(async (url) => {
      if (url === '/workspaces') return { workspaces: [], canCreate: false } as never;
      if (url.startsWith('/collaboration/options'))
        return { users: [], employees: [], organizations: [], teams: [] } as never;
      if (url === '/bases/b/tables')
        return { base: { id: 'b', name: '工作区' }, access, tables: [table] } as never;
      if (url === '/tables/t') return detail as never;
      throw new Error(url);
    });
    vi.mocked(post).mockResolvedValue({ records: [], total: 0, groups: [] });
    render(
      <MemoryRouter initialEntries={['/workspaces?base=b&table=t']}>
        <WorkspaceEditor businessMode />
      </MemoryRouter>,
    );
    await screen.findByRole('tab', { name: '总表' });
    const previous = vi.mocked(get).mock.calls.filter(([url]) => url === '/tables/t').length;
    fireEvent.click(screen.getByRole('button', { name: '业务记录表' }));
    await waitFor(() =>
      expect(vi.mocked(get).mock.calls.filter(([url]) => url === '/tables/t').length).toBeGreaterThan(
        previous,
      ),
    );
    expect(await screen.findByRole('tab', { name: '总表' })).toBeInTheDocument();
    expect(screen.queryByText('选择或新建数据表')).not.toBeInTheDocument();
  },
);

test.each(['CASES', 'CONTRACTS', 'FOLLOWS'])('%s detail keeps edited core-field values and saves them to the table record endpoint', async (source) => {
  const table = {
    id: 't',
    baseId: 'b',
    name: '案件工作表',
    source,
    schemaVersion: 1,
    position: 0,
    archived: false,
  };
  const row = {
    id: 'r',
    tableId: 't',
    values: { title: '原案件名称' },
    version: 4,
    writable: true,
    createdBy: 'u',
    ownerId: 'u',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const access = {
    level: 2,
    canCreate: false,
    canManageAccess: false,
    selfOnly: false,
    hidden: [],
    readonly: [],
    workspaceId: 'w',
  };
  const detail = {
    table,
    access,
    canDeleteRecords: true,
    fields: [
      {
        id: 'title',
        name: '案件名称',
        type: 'TEXT',
        writable: true,
        required: false,
        options: { businessKey: 'title' },
        position: 0,
        archived: false,
        defaultValue: null,
      },
    ],
    views: [
      {
        id: 'v',
        name: '总表',
        type: 'GRID',
        shared: true,
        isDefault: true,
        ownerId: 'u',
        version: 1,
        position: 0,
        config: {},
      },
    ],
    userId: 'u',
    employeeId: null,
  };
  vi.mocked(get).mockImplementation(async (url) => {
    if (url === '/workspaces') return { workspaces: [], canCreate: false } as never;
    if (url.startsWith('/collaboration/options'))
      return { users: [], employees: [], organizations: [], teams: [] } as never;
    if (url === '/bases/b/tables')
      return {
        base: { id: 'b', workspaceId: 'w', name: '案件管理', version: 1 },
        access,
        tables: [table],
        orderToken: 'token',
      } as never;
    if (url === '/tables/t') return detail as never;
    if (url === '/tables/t/records/r') return { record: row, revisions: [], comments: [] } as never;
    throw new Error(url);
  });
  vi.mocked(post).mockImplementation(async (url) =>
    url.endsWith('/query')
      ? ({ records: [row], total: 1, page: 1, pageSize: 50, groups: [], schemaVersion: 1 } as never)
      : ({} as never),
  );
  vi.mocked(patch).mockResolvedValue({ id: 'r', version: 5 });
  render(
    <MemoryRouter initialEntries={['/cases?base=b&table=t&record=r']}>
      <WorkspaceEditor businessMode />
    </MemoryRouter>,
  );
  const input = await screen.findByRole('textbox', { name: '案件名称' });
  await waitFor(() => expect(get).toHaveBeenCalledWith('/tables/t/records/r'));
  fireEvent.change(input, { target: { value: '修改后的案件名称' } });
  expect(input).toHaveValue('修改后的案件名称');
  fireEvent.click(screen.getByRole('button', { name: /^保\s*存$/ }));
  await waitFor(() =>
    expect(patch).toHaveBeenCalledWith(
      '/tables/t/records/r',
      { values: { title: '修改后的案件名称' }, version: 4, schemaVersion: 1 },
      expect.any(String),
    ),
  );
  const confirm = vi.spyOn(Modal, 'confirm').mockReturnValue({ destroy: vi.fn(), update: vi.fn() });
  fireEvent.click(await screen.findByRole('button', { name: /^删\s*除$/ }));
  expect(confirm).toHaveBeenCalledOnce();
  const config = confirm.mock.calls[0][0];
  expect(config.content).toContain(source === 'CONTRACTS' ? '正式合同记录' : source === 'FOLLOWS' ? '正式跟进记录' : '正式案件');
  expect(patch).toHaveBeenCalledTimes(1);
  await act(async () => { await config.onOk?.(); });
  await waitFor(() => expect(patch).toHaveBeenCalledWith(
    '/tables/t/records/r', { archived: true, version: 4, schemaVersion: 1 }, expect.any(String),
  ));

});
