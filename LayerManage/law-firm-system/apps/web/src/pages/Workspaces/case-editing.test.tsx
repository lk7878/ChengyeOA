import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
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
  cleanup();
  vi.clearAllMocks();
});

test('case detail keeps edited core-field values and saves them to the table record endpoint', async () => {
  const table = {
    id: 't',
    baseId: 'b',
    name: '案件工作表',
    source: 'CASES',
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
});
