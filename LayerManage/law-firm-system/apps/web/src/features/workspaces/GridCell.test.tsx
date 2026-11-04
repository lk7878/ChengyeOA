import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import GridCell from './GridCell';
import { ConfigProvider } from 'antd';
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

test('changing font and row height preserves the active cell draft and original write versions', async () => {
  vi.mocked(patch).mockResolvedValue({ id: 'r', version: 3 });
  const { rerender } = render(<ConfigProvider theme={{ token: { fontSize: 14 } }}><GridCell {...props}/></ConfigProvider>);
  fireEvent.click(screen.getByRole('button', { name: '标题：原值' }));
  fireEvent.change(screen.getByLabelText('单元格编辑'), { target: { value: '外观切换前填写的内容' } });
  rerender(<ConfigProvider theme={{ token: { fontSize: 18, controlHeight: 40 } }}><GridCell {...props} height={72}/></ConfigProvider>);
  expect(screen.getByLabelText('单元格编辑')).toHaveValue('外观切换前填写的内容');
  expect(patch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(patch).toHaveBeenCalledWith('/tables/t/records/r',
    { values: { f: '外观切换前填写的内容' }, version: 2, schemaVersion: 3 }, expect.any(String)));
});

test('prospect contact is masked in the grid and edits preserve the actual value', async () => {
  vi.mocked(patch).mockResolvedValue({ id: 'r', version: 3 });
  render(<GridCell {...props} field={{ ...field, name: '联系方式', options: { maskDisplay: true } }}
    row={{ ...row, values: { f: '13812345678' } }} />);
  fireEvent.doubleClick(screen.getByRole('button', { name: '联系方式：138****5678' }));
  expect(screen.getByLabelText('单元格编辑')).toHaveValue('13812345678');
  fireEvent.change(screen.getByLabelText('单元格编辑'), { target: { value: '13912345678' } });
  fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
  expect(patch).toHaveBeenCalledWith('/tables/t/records/r',
    { values: { f: '13912345678' }, version: 2, schemaVersion: 3 }, expect.any(String));
});
test('administrative status is highlighted while remaining editable',()=>{
  render(<GridCell {...props} field={{...field,type:'SINGLE_SELECT',options:{choices:[{id:'办理中',name:'办理中',color:'blue'}]}}} row={{...row,values:{f:'办理中'}}}/>);
  expect(screen.getByText('办理中')).toHaveClass('ant-tag-blue');
  fireEvent.doubleClick(screen.getByRole('button',{name:'标题：办理中'}));
  expect(screen.getByLabelText('单元格编辑')).toHaveValue('办理中');
});

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

test('linked record fields cannot enter inline editing while unlinked records remain editable', () => {
  const view=render(<GridCell {...props} row={{...row, readonlyFields:['f']}} />);
  fireEvent.doubleClick(screen.getByText('原值'));
  expect(screen.queryByLabelText('单元格编辑')).not.toBeInTheDocument();
  view.rerender(<GridCell {...props} row={{...row, readonlyFields:[]}} />);
  fireEvent.doubleClick(screen.getByText('原值'));
  expect(screen.getByLabelText('单元格编辑')).toBeInTheDocument();
});
