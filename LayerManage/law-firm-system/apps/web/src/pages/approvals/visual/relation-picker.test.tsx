import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import RelationPicker from './RelationPicker';
import WorkflowDesigner from './WorkflowDesigner';
import { get, post, type FormField, starter } from './api';
import { relationSnapshot } from '../../../../../server/app/domain/workflow/relation-display';
vi.mock('./api', async original => ({ ...(await original<object>()), get: vi.fn(), post: vi.fn() }));
const fields = [
  { id: 'created', name: '创建时间', type: 'DATETIME' },
  { id: 'code', name: '合同编号', type: 'TEXT' },
  { id: 'customer', name: '客户姓名', type: 'TEXT' },
  { id: 'amount', name: '申请金额', type: 'NUMBER' },
];
const field: FormField = { key: 'contract', label: '关联合同', type: 'relation', tableId: 't', displayFieldIds: ['code', 'customer'], referenceFieldIds: ['amount'] };
const row = { id: 'record-internal-id', version: 3, values: { created: '1730000000', code: 'HT001', customer: '张三', amount: 2500 } };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(get).mockImplementation(async url => url.includes('/records/') ? { record: row } : { fields });
  vi.mocked(post).mockResolvedValue({ records: [row], total: 1 });
});
test('picker uses business labels and displays read-only referenced values for a selected record', async () => {
  render(<RelationPicker tableId="t" field={field} value={row.id} onChange={vi.fn()} />);
  expect(await screen.findByText('HT001 · 张三')).toBeInTheDocument();
  expect(await screen.findByText('2500')).toBeInTheDocument();
  expect(screen.queryByText('1730000000')).not.toBeInTheDocument();
  expect(screen.queryByText(row.id)).not.toBeInTheDocument();
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
});
test('persisted references render for read-only reviewers without requesting the source table', async () => {
  render(<RelationPicker tableId="t" field={field} value={row.id} disabled saved={relationSnapshot(field, fields, row)} onChange={vi.fn()} />);
  expect(screen.getByText('2500')).toBeInTheDocument();
  expect(screen.getByText('提交时引用内容 · 记录版本 v3')).toBeInTheDocument();
  expect(get).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});
test('clearing selection removes references and source errors have a retry action', async () => {
  const { rerender } = render(<RelationPicker tableId="t" field={field} value={row.id} onChange={vi.fn()} />);
  await screen.findByText('2500');
  rerender(<RelationPicker tableId="t" field={field} onChange={vi.fn()} />);
  await waitFor(() => expect(screen.queryByText('2500')).not.toBeInTheDocument());
  vi.mocked(get).mockRejectedValueOnce(new Error('访问失败'));
  rerender(<RelationPicker tableId="bad" field={{...field, tableId: 'bad'}} onChange={vi.fn()} />);
  const retry = await screen.findByRole('button', { name: /重\s*试/ });
  fireEvent.click(retry);
  await waitFor(() => expect(screen.queryByRole('button', { name: /重\s*试/ })).not.toBeInTheDocument());
});
test('legacy default labels prefer business fields over timestamp first columns', () => {
  expect(relationSnapshot({ ...field, displayFieldIds: undefined }, fields, row).label).toBe('HT001 · 张三');
});

test('designer saves ordered label and reference fields and clears them when switching tables', async () => {
  vi.mocked(get).mockImplementation(async url => url === '/workflows/tables' ? [{ id: 't', name: '合同表' }, { id: 't2', name: '其他表' }] : { fields });
  vi.mocked(post).mockResolvedValue({ id: 'd', revision: 2, version: 0 });
  const schema = starter();
  schema.fields = [field];
  render(<WorkflowDesigner definition={{ name: '合同审批', schema, version: 0, revision: 1, enabled: false }} options={{ users: [], roles: [], hooks: [] }} onSaved={vi.fn()} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('tab', { name: '2 · 表单设计' }));
  fireEvent.click(screen.getAllByText('关联合同')[0]);
  const display = await screen.findByRole('combobox', { name: '下拉显示字段' });
  await waitFor(() => expect(display).not.toBeDisabled());
  expect(screen.getByRole('combobox', { name: '只读引用字段' })).not.toBeDisabled();
  fireEvent.click(await screen.findByRole('button', { name: /保存草稿/ }));
  await waitFor(() => expect(post).toHaveBeenCalled());
  expect(vi.mocked(post).mock.calls[0][1]).toMatchObject({ schema: { fields: [{ displayFieldIds: ['code', 'customer'], referenceFieldIds: ['amount'] }] } });
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '关联数据表' }));
  fireEvent.click(await screen.findByText('其他表'));
  fireEvent.click(await screen.findByRole('button', { name: /保存草稿/ }));
  await waitFor(() => expect(vi.mocked(post).mock.calls).toHaveLength(2));
  expect(vi.mocked(post).mock.calls[1][1]).toMatchObject({ schema: { fields: [{ tableId: 't2', displayFieldIds: [], referenceFieldIds: [] }] } });
});
