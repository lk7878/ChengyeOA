import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import Modal from '@/components/DraggableModal';
import RecordOperations from './RecordOperations';
import { get, post } from './api';

vi.mock('./api', () => ({ get: vi.fn(), post: vi.fn(), errorMessage: () => '记录已变化' }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
const props = {
  tableId: 't',
  schemaVersion: 3,
  selected: [],
  canDelete: true,
  disabled: false,
  revision: 0,
  onChanged: vi.fn(),
};
test('undo and redo use server operation IDs; recovery payloads never come from the browser', async () => {
  vi.mocked(get).mockResolvedValue([{ id: 'op', recordId: 'r', kind: 'UPDATE', undone: false }]);
  vi.mocked(post).mockResolvedValue({});
  const { rerender } = render(<RecordOperations {...props} />);
  await waitFor(() => expect(screen.getByRole('button', { name: /撤\s*销/ })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /撤\s*销/ }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/tables/t/record-operations/op', { direction: 'undo' }),
  );
  vi.mocked(get).mockResolvedValue([{ id: 'op', recordId: 'r', kind: 'UPDATE', undone: true }]);
  rerender(<RecordOperations {...props} revision={1} />);
  await waitFor(() => expect(screen.getByRole('button', { name: /重\s*做/ })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /重\s*做/ }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/tables/t/record-operations/op', { direction: 'redo' }),
  );
});
test('bulk delete requires confirmation and sends every selected version in one command', async () => {
  vi.mocked(get).mockResolvedValue([]);
  vi.mocked(post).mockResolvedValue({});
  const confirm = vi.spyOn(Modal, 'confirm').mockReturnValue({ destroy: vi.fn(), update: vi.fn() });
  const selected = ['a', 'b'].map((id) => ({
    id,
    tableId: 't',
    version: 4,
    values: {},
    createdAt: '',
    updatedAt: '',
    createdBy: 'u',
    ownerId: 'u',
  }));
  render(<RecordOperations {...props} selected={selected} />);
  fireEvent.click(screen.getByRole('button', { name: '批量删除 (2)' }));
  expect(post).not.toHaveBeenCalled();
  await act(async () => {
    await confirm.mock.calls[0][0].onOk?.();
  });
  expect(post).toHaveBeenCalledWith(
    '/tables/t/records/delete-batch',
    {
      schemaVersion: 3,
      records: [
        { id: 'a', version: 4 },
        { id: 'b', version: 4 },
      ],
    },
    expect.any(String),
  );
});
