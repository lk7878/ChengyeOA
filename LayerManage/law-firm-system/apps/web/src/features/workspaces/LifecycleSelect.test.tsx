import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import LifecycleSelect from './LifecycleSelect';
import FieldInput from './FieldInput';
import { get } from './api';
import type { Field } from './types';
vi.mock('./api', () => ({ get: vi.fn(), post: vi.fn(), errorMessage: () => '关联记录不可访问' }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
test('upstream selector searches server scope and pages instead of truncating choices', async () => {
  vi.mocked(get).mockResolvedValue({ rows: [{ id: 'case1', label: 'HT-001 · 案件甲' }], hasMore: true });
  render(<LifecycleSelect tableId="t" value="case1" onChange={vi.fn()} />);
  await screen.findByText('HT-001 · 案件甲');
  expect(get).toHaveBeenCalledWith('/tables/t/lifecycle-choices?keyword=&page=1');
  fireEvent.click(screen.getByRole('button', { name: '加载更多关联项' }));
  await waitFor(() => expect(get).toHaveBeenCalledWith('/tables/t/lifecycle-choices?keyword=&page=2'));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '合同甲' } });
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith(
      '/tables/t/lifecycle-choices?keyword=' + encodeURIComponent('合同甲') + '&page=1',
    ),
  );
});
test('upstream permission failures stay visible; synchronized fields cannot be edited', async () => {
  vi.mocked(get).mockRejectedValue(new Error('denied'));
  const { unmount } = render(<LifecycleSelect tableId="t" value={null} onChange={vi.fn()} />);
  await screen.findByText('关联记录不可访问');
  unmount();
  const field: Field = {
    id: 'f',
    name: '合同金额（同步）',
    type: 'CURRENCY',
    required: false,
    writable: false,
    archived: false,
    position: 0,
    defaultValue: null,
    options: { lifecycleKey: 'contractAmount' },
  };
  render(
    <FieldInput
      field={field}
      value="1200.00"
      disabled
      onChange={vi.fn()}
      tableId="t"
      directory={{ organizations: [], employees: [], teams: [], users: [] }}
    />,
  );
  expect(screen.getByDisplayValue('1200.00')).toBeDisabled();
});
