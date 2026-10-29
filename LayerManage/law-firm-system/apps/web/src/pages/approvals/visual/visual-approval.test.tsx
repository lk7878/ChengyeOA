import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { useState } from 'react';
import WorkflowDesigner from './WorkflowDesigner';
import WorkflowForm from './WorkflowForm';
import { get, post, starter, type Values, type FormField } from './api';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  get: vi.fn(),
  post: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(get).mockResolvedValue([]);
  vi.mocked(post).mockResolvedValue({ id: 'd', revision: 2, version: 0 });
});
const options = { users: [{ id: 'reviewer', name: '审批人' }], roles: [], hooks: [] };

test('component library adds and reorders fields; saved drafts preserve schema and optimistic revision', async () => {
  render(
    <WorkflowDesigner
      definition={{
        id: 'd',
        name: '表单设计回归',
        schema: starter(),
        version: 0,
        revision: 1,
        enabled: false,
      }}
      options={options}
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '单行文本' }));
  fireEvent.click(screen.getByRole('button', { name: '数字 / 金额' }));
  const up = screen.getAllByRole('button', { name: '上移字段' });
  fireEvent.click(up[1]);
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(post).toHaveBeenCalled());
  const payload = vi.mocked(post).mock.calls[0][1] as {
    schema: { fields: FormField[] };
    revision: number;
    publish: boolean;
  };
  expect(payload.schema.fields.map((f) => f.type)).toEqual(['number', 'text']);
  expect(payload.revision).toBe(1);
  expect(payload.publish).toBe(false);
});
test('invalid graph cannot publish and entered fields remain available to repair', async () => {
  const schema = starter();
  schema.edges = [];
  render(
    <WorkflowDesigner
      definition={{ name: '未连接的流程', schema, version: 0, revision: 1, enabled: false }}
      options={options}
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '校验并发布' }));
  expect(await screen.findByText(/普通节点须有一条连线/)).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: '流程名称' })).toHaveValue('未连接的流程');
});
test('form supports conditional visibility, readonly numeric input, detail additions and computed totals', async () => {
  const fields: FormField[] = [
    { key: 'type', label: '类型', type: 'text' },
    {
      key: 'reason',
      label: '说明',
      type: 'textarea',
      visibleWhen: { field: 'type', op: 'eq', value: '特殊' },
    },
    { key: 'locked', label: '只读值', type: 'number' },
    {
      key: 'lines',
      label: '费用明细',
      type: 'detail',
      children: [{ key: 'amount', label: '金额', type: 'number' }],
    },
    { key: 'total', label: '合计', type: 'formula', formula: { op: 'sum', fields: ['lines.amount'] } },
  ];
  function Harness() {
    const [values, setValues] = useState<Values>({ type: '普通', locked: 8, lines: [{ amount: 10 }] });
    return (
      <WorkflowForm
        fields={fields}
        values={values}
        onChange={setValues}
        editable={['type', 'reason', 'lines']}
        users={[]}
      />
    );
  }
  render(<Harness />);
  expect(screen.queryByText('说明')).not.toBeInTheDocument();
  fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '特殊' } });
  expect(screen.getByText('说明')).toBeInTheDocument();
  expect(screen.getAllByRole('spinbutton')[0]).toBeDisabled();
  expect(screen.getAllByDisplayValue('10')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '增加明细行' }));
  expect(screen.getAllByRole('button', { name: '删除此行' })).toHaveLength(2);
  await act(async () => fireEvent.change(screen.getAllByRole('spinbutton')[2], { target: { value: '5' } }));
  expect(screen.getByDisplayValue('15')).toBeDisabled();
  fireEvent.click(screen.getAllByRole('button', { name: '删除此行' })[1]);
  expect(screen.getAllByRole('button', { name: '删除此行' })).toHaveLength(1);
});
