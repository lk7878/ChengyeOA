import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import CcRecipients from './CcRecipients';
import WorkflowDesigner from './WorkflowDesigner';
import { get, post, starter, validateSchema, WorkflowError, type FlowNode } from './api';
vi.mock('./api', async (original) => ({ ...(await original<object>()), get: vi.fn(), post: vi.fn() }));
const options = {
  users: [
    { id: 'a', name: '甲' },
    { id: 'b', name: '乙' },
  ],
  roles: [],
  hooks: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(get).mockResolvedValue([]);
});

test('CC editor preserves legacy recipients, adds independent groups and supports multiple members', async () => {
  let current: FlowNode;
  function Harness() {
    const [node, setNode] = useState<FlowNode>({
      id: 'cc',
      name: '抄送',
      type: 'CC',
      x: 0,
      y: 0,
      rule: { type: 'SELF' },
    });
    current = node;
    return (
      <CcRecipients
        node={node}
        options={options}
        fields={[]}
        onChange={(patch) => setNode({ ...node, ...patch })}
      />
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: '添加抄送对象' }));
  const select = screen.getByRole('combobox', { name: '抄送对象 2成员或角色' });
  fireEvent.mouseDown(select);
  fireEvent.click(await screen.findByText('甲'));
  fireEvent.click(screen.getByText('乙'));
  expect(current!.ccRules).toEqual([{ type: 'SELF' }, { type: 'USER', ids: ['a', 'b'] }]);
  expect(current!.rule).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: '删除抄送对象 1' }));
  expect(current!.ccRules).toEqual([{ type: 'USER', ids: ['a', 'b'] }]);
});

test('publish errors remain visible and locate the offending CC node without losing configuration', async () => {
  const schema = starter();
  schema.nodes[1] = {
    ...schema.nodes[1],
    type: 'CC',
    name: '通知财务',
    ccRules: [{ type: 'SELF' }, { type: 'USER', ids: [] }],
  };
  render(
    <WorkflowDesigner
      definition={{ name: '费用审批', schema, version: 0, revision: 1, enabled: false }}
      options={options}
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '校验并发布' })));
  expect(screen.getByText('保存失败 · 节点：通知财务 / 抄送对象 2')).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '定位并修改' }));
  expect(screen.getByRole('tab', { name: '3 · 流程设计' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('combobox', { name: '抄送对象 2成员或角色' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: '流程名称' })).toHaveValue('费用审批');
  vi.mocked(post).mockRejectedValueOnce(new Error('网络连接中断，请重试'));
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() =>
    expect(screen.getByText('保存失败 · 保存请求（权限、版本或网络）')).toBeInTheDocument(),
  );
  const panel = screen.getAllByRole('alert').find((el) => el.textContent?.includes('保存请求'))!;
  expect(within(panel).getByText('网络连接中断，请重试')).toBeInTheDocument();
  vi.mocked(post).mockRejectedValueOnce({
    response: {
      data: {
        message: '回写字段不存在、只读或未获写权限',
        location: { section: 'settings', label: '多维表格与自动化' },
      },
    },
  });
  fireEvent.click(screen.getByRole('button', { name: /保存草稿/ }));
  await waitFor(() => expect(screen.getByText('保存失败 · 多维表格与自动化')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: '定位并修改' }));
  expect(screen.getByRole('tab', { name: '4 · 更多设置' })).toHaveAttribute('aria-selected', 'true');
  vi.mocked(post).mockResolvedValueOnce({ id: 'd', revision: 2, version: 0 });
  fireEvent.click(screen.getByRole('button', { name: /保存草稿/ }));
  await waitFor(() => expect(screen.queryByText('保存失败 · 多维表格与自动化')).not.toBeInTheDocument());
});

test('schema diagnostics identify fields and branch links rather than reporting an anonymous error', () => {
  const s = starter();
  s.fields = [{ key: 'reason', label: '', type: 'text' }];
  try {
    validateSchema(s);
    throw new Error('expected validation failure');
  } catch (e) {
    expect(e).toBeInstanceOf(WorkflowError);
    expect((e as WorkflowError).location).toMatchObject({ section: 'form', field: 'reason' });
  }
  s.fields = [];
  s.nodes[1].rule = { type: 'SELF' };
  s.edges[0].condition = { field: 'missing', op: 'eq', value: 'x' };
  try {
    validateSchema(s);
    throw new Error('expected validation failure');
  } catch (e) {
    expect((e as WorkflowError).location).toMatchObject({ section: 'flow', edge: 'e1' });
  }
});
