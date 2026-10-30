import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import WorkflowDesigner from './WorkflowDesigner';
import VisualApprovals from './VisualApprovals';
import { useAuthStore } from '@/stores/authStore';
import { approvalPrintHtml } from './print-format';
import { insertFlowNode } from './flow-graph';
import { get, post, starter, validateSchema, type Instance } from './api';
vi.mock('./api', async (original) => ({ ...(await original<object>()), get: vi.fn(), post: vi.fn() }));
const options = { users: [{ id: 'person', name: '审批人' }], roles: [], hooks: [], ownRoles: [] };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(get).mockResolvedValue([]);
  vi.mocked(post).mockResolvedValue({ id: 'd', revision: 2, version: 1 });
});

test('four-step design saves audience, help text and settings and shows actual form controls', async () => {
  render(
    <WorkflowDesigner
      definition={{ id: 'd', name: '费用报销', schema: starter(), version: 1, revision: 1, enabled: true }}
      options={options}
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole('textbox', { name: '流程分组' }), { target: { value: '财务管理' } });
  fireEvent.change(screen.getByRole('textbox', { name: '申请说明' }), { target: { value: '请附发票' } });
  fireEvent.click(screen.getByRole('tab', { name: '2 · 表单设计' }));
  fireEvent.click(screen.getByRole('button', { name: '数字 / 金额' }));
  expect(screen.getAllByRole('spinbutton').some((x) => x.hasAttribute('disabled'))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /复\s*制/ }));
  fireEvent.click(screen.getByRole('tab', { name: '4 · 更多设置' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '发起人可撤回审批中的申请' }));
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(post).toHaveBeenCalled());
  expect(vi.mocked(post).mock.calls[0][1]).toMatchObject({
    schema: {
      category: '财务管理',
      description: '请附发票',
      settings: { allowWithdraw: false },
      fields: [{ type: 'number' }, { type: 'number' }],
    },
  });
});

test('inserting approval and branch nodes preserves existing links and produces a valid reachable graph after configuration', () => {
  let s = starter();
  s.fields = [{ key: 'amount', label: '金额', type: 'number' }];
  s = insertFlowNode(s, 'e1', 'CC');
  s = insertFlowNode(s, 'e2', 'BRANCH');
  s.nodes = s.nodes.map((n) =>
    ['APPROVAL', 'CC'].includes(n.type) ? { ...n, rule: { type: 'USER', ids: ['person'] } } : n,
  );
  expect(() => validateSchema(s)).not.toThrow();
  expect(s.nodes.filter((n) => n.type === 'BRANCH')).toHaveLength(1);
  expect(s.edges.some((e) => e.id === 'e1' && e.from === 'start')).toBe(true);
});

function original(): Instance {
  return {
    id: 'original',
    definitionId: 'd',
    title: '原申请',
    applicantId: 'person',
    status: 'APPROVED',
    currentNode: 'end',
    version: 2,
    visit: 2,
    definitionVersion: 1,
    content: { text: '<script>alert(1)</script>', secret: '不打印', details: [{ child: '明细内容' }] },
    snapshot: {
      ...starter(),
      fields: [
        { key: 'text', label: '事由', type: 'text' },
        { key: 'secret', label: '内部备注', type: 'text', printable: false },
        {
          key: 'details',
          label: '费用',
          type: 'detail',
          children: [{ key: 'child', label: '内容', type: 'text' }],
        },
      ],
    },
    editable: [],
    syncStatus: 'NONE',
    createdAt: '2026-10-30T00:00:00Z',
    tasks: [],
    logs: [],
    deliveries: [],
    canCorrect: true,
  };
}
test('print preview escapes all values, excludes nonprintable fields and renders detail rows', () => {
  const html = approvalPrintHtml(original(), options.users, '<img onerror=alert(1)>');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('不打印');
  expect(html).toContain('明细内容');
  expect(html).toContain('审批人');
});

test('completed application opens a prefilled correction and submits its original link for reapproval', async () => {
  const i = original();
  useAuthStore.setState({
    authorization: {
      userId: 'person',
      employeeId: null,
      isSystemSuperAdmin: false,
      isSystemAdmin: false,
      permissions: ['approval.read', 'approval.apply'],
      menus: [],
      fieldCapabilities: {},
      validUntil: null,
      evaluatedAt: new Date().toISOString(),
    },
    authorizationStatus: 'ready',
  });
  vi.mocked(get).mockImplementation(async (url) => {
    if (url === '/workflows/options') return options;
    if (url === '/workflows/definitions')
      return [{ id: 'd', name: '费用申请', version: 2, schema: i.snapshot }];
    if (url === '/workflows/instances/original') return i;
    return { rows: [], total: 0 };
  });
  vi.mocked(post).mockResolvedValue({
    ...i,
    id: 'correction',
    status: 'PENDING',
    correctionOf: 'original',
    canCorrect: false,
  });
  render(
    <MemoryRouter initialEntries={['/approvals/visual?instance=original']}>
      <VisualApprovals />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: '提交更正申请' }));
  expect(await screen.findByText('更正单将重新审批，通过后更新原业务记录')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '提交申请' }));
  await waitFor(() => expect(post).toHaveBeenCalled());
  expect(vi.mocked(post).mock.calls[0][1]).toMatchObject({
    definitionId: 'd',
    correctionOf: 'original',
    title: '更正：原申请',
  });
});
