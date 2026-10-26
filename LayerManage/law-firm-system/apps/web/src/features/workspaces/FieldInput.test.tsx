import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import FieldInput from './FieldInput';
import { post } from './api';
import type { Field } from './types';
import { displayValue } from './display-value';
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
test('administrative expense dates and money use the same formats in the table and editor', () => {
  const directory = { employees: [], organizations: [], users: [], teams: [] };
  const change = vi.fn();
  const total = { ...field, type: 'FORMULA', name: '费用金额', writable: false, options: { numberFormat: 'CNY' as const } };
  expect(displayValue(total, '3703.68', directory)).toBe('3,703.68');
  const { rerender } = render(<FieldInput field={total} value="3703.68" onChange={change} directory={directory} tableId="expense" />);
  expect(screen.getByRole('textbox')).toBeDisabled();
  expect(screen.getByRole('textbox')).toHaveValue('3,703.68');
  rerender(<FieldInput field={{ ...field, type: 'CURRENCY', name: '单价', options: { numberFormat: 'CNY' } }} value="1234.56" onChange={change} directory={directory} tableId="expense" />);
  expect(screen.getByRole('spinbutton')).toHaveValue('1,234.56');
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2,345.67' } });
  fireEvent.blur(screen.getByRole('spinbutton'));
  expect(change).toHaveBeenCalledWith('2345.67');
  const date = { ...field, type: 'DATETIME', name: '采购日期', options: { dateOnly: true } };
  expect(displayValue(date, '2026-10-25T16:00:00.000Z', directory)).toBe('2026/10/26');
  rerender(<FieldInput field={date} value="2026-10-25T16:00:00.000Z" onChange={change} directory={directory} tableId="expense" />);
  expect(screen.getByLabelText('采购日期')).toHaveValue('2026-10-26');
  fireEvent.change(screen.getByLabelText('采购日期'), { target: { value: '2026-10-27' } });
  expect(change).toHaveBeenCalledWith('2026-10-26T16:00:00.000Z');
});
test('office inventory formula fields stay read-only while multiline notes and quantities remain editable', () => {
  const directory = { employees: [], organizations: [], users: [], teams: [] };
  const change = vi.fn();
  const { rerender } = render(<FieldInput field={{ ...field, type: 'FORMULA', name: '库存数量', writable: false, options: { inventoryKey: '库存数量' } }} value={12.5} onChange={change} directory={directory} tableId="stock" />);
  expect(screen.getByRole('textbox')).toBeDisabled();
  expect(screen.getByRole('textbox')).toHaveValue('12.5');
  rerender(<FieldInput field={{ ...field, type: 'LONG_TEXT', name: '备注', options: { inventoryKey: '备注' } }} value="" onChange={change} directory={directory} tableId="stock" />);
  fireEvent.change(screen.getByLabelText('备注'), { target: { value: '第一行\n第二行' } });
  expect(change).toHaveBeenCalledWith('第一行\n第二行');
  rerender(<FieldInput field={{ ...field, type: 'NUMBER', name: '盘存时数量', options: { inventoryKey: '盘存时数量' } }} value={0} onChange={change} directory={directory} tableId="take" />);
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '25.5' } });
  expect(change).toHaveBeenCalledWith(25.5);
});
test('office movement and receipt dates display YYYY/MM/DD in Beijing time', () => {
  for (const name of ['日期', '领取日期']) {
    const f = { ...field, type: 'DATETIME', name, options: { inventoryKey: name } };
    expect(displayValue(f, '2026-10-25T16:30:00Z', { employees: [], organizations: [], users: [], teams: [] })).toBe('2026/10/26');
  }
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
