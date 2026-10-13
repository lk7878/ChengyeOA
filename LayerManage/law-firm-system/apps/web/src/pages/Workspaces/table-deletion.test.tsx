import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
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
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
function Location() {
  return <output data-testid="location">{useLocation().search}</output>;
}

test.each(['CUSTOM', 'CASES'])(
  'delete %s table confirms consequences and clears stale navigation',
  async (source) => {
    const table = {
      id: 't',
      name: '待删除表',
      source,
      archived: source === 'CUSTOM',
      schemaVersion: 3,
      canManage: true,
      canDelete: true,
    };
    const fallback = { ...table, id: 'other', name: '其他表', archived: false };
    let deleted = false;
    const tables = () => [...(deleted ? [] : [table]), ...(source === 'CASES' ? [fallback] : [])];
    const access = { level: 4, canCreate: true, hidden: [], readonly: [] };
    vi.mocked(get).mockImplementation(async (url) => {
      if (url === '/workspaces') return { workspaces: [], canCreate: false } as never;
      if (url.startsWith('/collaboration/options'))
        return { users: [], employees: [], organizations: [], teams: [] } as never;
      if (url === '/bases/b/tables')
        return { base: { id: 'b', name: '管理工作区' }, access, tables: tables() } as never;
      if (url.startsWith('/tables/'))
        return {
          table: { ...(url === '/tables/t' ? table : fallback), baseId: 'b' },
          access,
          fields: [],
          views: [],
        } as never;
      throw new Error(url);
    });
    vi.mocked(post).mockResolvedValue({ records: [], total: 0 });
    vi.mocked(patch).mockImplementation(async () => {
      deleted = true;
      return { id: 't' } as never;
    });
    const confirm = vi.spyOn(Modal, 'confirm').mockReturnValue({ destroy: vi.fn(), update: vi.fn() });
    render(
      <MemoryRouter initialEntries={['/cases?base=b&table=t&view=v&driveReturn=1']}>
        <WorkspaceEditor businessMode />
        <Location />
      </MemoryRouter>,
    );
    fireEvent.mouseEnter(await screen.findByRole('button', { name: '管理待删除表' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除' }));
    expect(confirm).toHaveBeenCalledOnce();
    const config = confirm.mock.calls[0][0];
    expect(config.content).toContain(source === 'CUSTOM' ? '表内数据' : '原始业务记录会保留');
    expect(patch).not.toHaveBeenCalled();
    if (source === 'CUSTOM') {
      vi.mocked(patch).mockRejectedValueOnce(new Error('failed'));
      await act(async () => { await expect(config.onOk?.()).rejects.toThrow('failed'); });
      expect(screen.getByRole('button', { name: '管理待删除表' })).toBeInTheDocument();
      expect(screen.getByTestId('location').textContent).toContain('table=t');
    }
    await act(async () => {
      await config.onOk?.();
    });
    expect(patch).toHaveBeenCalledWith('/tables/t', { remove: true, version: 3 }, expect.any(String));
    if (source === 'CUSTOM') expect(vi.mocked(patch).mock.calls[0][2]).toBe(vi.mocked(patch).mock.calls[1][2]);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '管理待删除表' })).not.toBeInTheDocument(),
    );
    const location = screen.getByTestId('location').textContent;
    expect(location).not.toContain('view=');
    expect(location).toContain('driveReturn=1');
    if (source === 'CASES') expect(location).toContain('table=other');
    else expect(location).not.toContain('table=');
  },
);
