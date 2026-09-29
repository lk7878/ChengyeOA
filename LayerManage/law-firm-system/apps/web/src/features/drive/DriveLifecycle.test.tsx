import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import DriveLifecycle from './DriveLifecycle';
import { post } from '../workspaces/api';
import type { Directory } from '../workspaces/types';

vi.mock('../workspaces/api', () => ({ post: vi.fn(), errorMessage: () => '失败', errorStatus: () => 500 }));

test('permanent deletion requires an impact preview followed by explicit confirmation', async () => {
  vi.mocked(post).mockResolvedValue({ previewToken: 'a'.repeat(64), affected: { folders: 1, bases: 2 }, workspace: { name: '云盘' }, fromPath: [{ name: '待删除' }] });
  const saved = vi.fn();
  render(<DriveLifecycle action="PURGE" item={{ id: 'folder', name: '待删除', parentId: null, path: [] }} folders={[]} directory={{ users: [], positions: [], organizations: [], teams: [] } as unknown as Directory} onClose={vi.fn()} onSaved={saved} />);
  expect(screen.getByText('彻底删除后无法恢复')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '确认彻底删除' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '预览权限影响' }));
  expect(await screen.findByLabelText('删除范围预览')).toHaveTextContent('2 个文档');
  fireEvent.click(screen.getByRole('button', { name: '确认彻底删除' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(post).toHaveBeenCalledWith('/drive/nodes/folder/lifecycle', { action: 'PURGE', previewToken: 'a'.repeat(64) }, expect.any(String));
});
