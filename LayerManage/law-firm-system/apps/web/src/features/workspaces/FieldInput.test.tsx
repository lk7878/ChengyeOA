import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import FieldInput from './FieldInput';
import { post } from './api';
import type { Field } from './types';
vi.mock('./api', () => ({ post: vi.fn(), get: vi.fn(), errorMessage: () => '错误' }));
const field: Field = {
  id: 'lead',
  name: '线索ID',
  type: 'RELATION',
  required: false,
  writable: true,
  queryable: true,
  position: 3,
  archived: false,
  defaultValue: null,
  options: { targetSource: 'LEADS' },
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
test('business link editor loads selected labels and searches canonical records on the server', async () => {
  vi.mocked(post).mockResolvedValue({ options: [{ id: 'lead-1', label: 'L001 · 客户甲' }], hasMore: false });
  const onChange = vi.fn();
  render(
    <FieldInput
      field={field}
      value={['lead-1']}
      onChange={onChange}
      directory={{ employees: [], organizations: [], users: [], teams: [] }}
      tableId="conversion"
    />,
  );
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/tables/conversion/fields/lead/relation-options', {
      keyword: '',
      selectedIds: ['lead-1'],
    }),
  );
  expect(await screen.findByText('L001 · 客户甲')).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '客户乙' } });
  await waitFor(() =>
    expect(post).toHaveBeenLastCalledWith('/tables/conversion/fields/lead/relation-options', {
      keyword: '客户乙',
      selectedIds: ['lead-1'],
    }),
  );
});
test('recording upload selector accepts supported audio types', () => {
  const { container } = render(
    <FieldInput
      field={{ ...field, type: 'FILE', name: '录音、附件', options: {} }}
      value={[]}
      onChange={() => {}}
      directory={{ employees: [], organizations: [], users: [], teams: [] }}
      tableId="assessment"
    />,
  );
  const accept = container.querySelector('input[type=file]')?.getAttribute('accept');
  expect(accept).toContain('.mp3');
  expect(accept).toContain('.wav');
  expect(accept).toContain('.m4a');
});
