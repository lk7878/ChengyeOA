import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import GridCell from './GridCell';
import { patch } from './api';
import type { Field, RecordRow } from './types';

vi.mock('./api', () => ({
  patch: vi.fn(),
  get: vi.fn(),
  errorMessage: () => '保存失败',
  errorStatus: () => 500,
}));
vi.mock('./FieldInput', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="单元格编辑" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const field: Field = {
  id: 'f',
  name: '标题',
  type: 'TEXT',
  writable: true,
  required: false,
  archived: false,
  position: 0,
  defaultValue: null,
  options: {},
};
const row: RecordRow = {
  id: 'r',
  tableId: 't',
  values: { f: '原值' },
  version: 2,
  createdAt: '',
  updatedAt: '',
  createdBy: 'u',
  ownerId: 'u',
};
const props = {
  row,
  field,
  tableId: 't',
  schemaVersion: 3,
  height: 40,
  directory: { organizations: [], employees: [], users: [], teams: [] },
  onDirty: vi.fn(),
  onSaved: vi.fn(),
  onConflict: vi.fn(),
};

test('contract status provides a workflow action instead of an unvalidated status write', () => {
  const action = vi.fn();
  render(
    <GridCell
      {...props}
      businessSource="CONTRACTS"
      field={{ ...field, writable: false, options: { businessKey: 'status' } }}
      onBusinessAction={action}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '标题：原值' }));
  expect(action).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: '标题：原值' })).toHaveAttribute(
    'title',
    expect.stringContaining('业务流程'),
  );
  expect(patch).not.toHaveBeenCalled();
});

test('a single click edits a cell and saves with record/schema versions', async () => {
  vi.mocked(patch).mockResolvedValue({ id: 'r', version: 3 });
  render(<GridCell {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '标题：原值' }));
  fireEvent.change(screen.getByLabelText('单元格编辑'), { target: { value: '新值' } });
  fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
  expect(patch).toHaveBeenCalledWith(
    '/tables/t/records/r',
    { values: { f: '新值' }, version: 2, schemaVersion: 3 },
    expect.any(String),
  );
});

test('readonly rows and fields cannot enter editing or submit writes', () => {
  const { rerender } = render(<GridCell {...props} field={{ ...field, writable: false }} />);
  fireEvent.click(screen.getByRole('button', { name: '标题：原值' }));
  expect(screen.queryByLabelText('单元格编辑')).toBeNull();
  rerender(<GridCell {...props} row={{ ...row, writable: false }} />);
  fireEvent.keyDown(screen.getByRole('button', { name: '标题：原值' }), { key: 'Enter' });
  expect(screen.queryByLabelText('单元格编辑')).toBeNull();
  expect(patch).not.toHaveBeenCalled();
});
test.each([
  'LEADS',
  'FOLLOWS',
  'CONTRACTS',
  'CUSTOMERS',
  'NEGOTIATIONS',
  'CHANNELS',
  'COSTS',
  'INVENTORY_ITEMS',
])('%s double-click editing can cancel or save a versioned field value', async (source) => {
  vi.mocked(patch).mockResolvedValue({ id: 'r', version: 3 });
  render(
    <GridCell {...props} field={{ ...field, options: { businessSource: source, businessKey: 'name' } }} />,
  );
  fireEvent.doubleClick(screen.getByRole('button', { name: '标题：原值' }));
  fireEvent.change(screen.getByLabelText('单元格编辑'), { target: { value: '取消的修改' } });
  fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
  expect(patch).not.toHaveBeenCalled();
  fireEvent.doubleClick(screen.getByRole('button', { name: '标题：原值' }));
  fireEvent.change(screen.getByLabelText('单元格编辑'), { target: { value: '保存的修改' } });
  fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
  await waitFor(() =>
    expect(patch).toHaveBeenCalledWith(
      '/tables/t/records/r',
      { values: { f: '保存的修改' }, version: 2, schemaVersion: 3 },
      expect.any(String),
    ),
  );
});
