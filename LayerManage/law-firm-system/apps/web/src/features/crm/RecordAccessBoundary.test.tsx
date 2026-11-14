import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { expect, test, vi, beforeEach } from 'vitest';
import RecordAccessBoundary from './RecordAccessBoundary';
const read = vi.hoisted(() => vi.fn());
vi.mock('@/api/customer', () => ({ customerApi: { detail: read } }));
beforeEach(() => {
  vi.clearAllMocks();
  read.mockResolvedValue({ data: { id: 'original' } });
});
function open() {
  return render(
    <MemoryRouter initialEntries={['/customers/original']}>
      <Routes>
        <Route
          path="/customers/:id"
          element={
            <RecordAccessBoundary kind="customer">
              <input aria-label="草稿" defaultValue="初始值" />
            </RecordAccessBoundary>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}
test('successful row checks preserve drafts; denied scope unmounts them until explicit successful retry', async () => {
  open();
  fireEvent.change(screen.getByLabelText('草稿'), { target: { value: '未保存意见' } });
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(read).toHaveBeenCalledWith('original'));
  expect(screen.getByLabelText('草稿')).toHaveValue('未保存意见');
  read.mockRejectedValue(new Error('NOT_FOUND'));
  fireEvent(window, new Event('focus'));
  await screen.findByText('当前记录已不可用');
  expect(screen.queryByLabelText('草稿')).not.toBeInTheDocument();
  read.mockResolvedValue({ data: { id: 'original' } });
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  expect(screen.queryByLabelText('草稿')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重新加载记录' }));
  expect(await screen.findByLabelText('草稿')).toHaveValue('初始值');
});
