// SPEC-013 Task 8: 审批中心页测试（非恒真）。沿 RefundListPage.test.tsx 形态：
// vi.mock approvalApi + useAuthStore 授权 + store reset；覆盖三 Tab 渲染/role 透传、
// 新建表单提交（按 formSchema 组装 content）、待办处理动作（taskId + action）、
// 权限按钮隐现（apply 门控新建/撤回、process 门控审批/驳回）、详情弹窗、错误 business message。
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { message } from 'antd';
import { beforeEach, expect, test, vi } from 'vitest';
import ApprovalCenterPage from '../ApprovalCenterPage';
import { useApprovalStore } from '@/stores/approval-store';
import { useAuthStore } from '@/stores/authStore';
import type { ApprovalDefinitionView, ApprovalInstanceView, ApprovalTaskView } from '@/api/approval';
import type { PermissionCode } from '@/features/authorization/types';

const approvalApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  definitions: vi.fn(),
  detail: vi.fn(),
  apply: vi.fn(),
  withdraw: vi.fn(),
  process: vi.fn(),
  // SPEC-019 Task 2：转交 API（approval.process）
  forwardTask: vi.fn(),
  // SPEC-020 Task 2：加签 API（approval.process）
  addSigners: vi.fn(),
  // SPEC-017 Task 3：定义管理 API（approval.manage）
  createDefinition: vi.fn(),
  listDefinitionsManage: vi.fn(),
  updateDefinition: vi.fn(),
  // SPEC-025 Task 3：导入导出 API（approval.manage）
  exportDefinitions: vi.fn(),
  importDefinitions: vi.fn(),
  // SPEC-028 Task 2：全组织视图 CSV 导出（approval.manage）
  exportApprovalsCsv: vi.fn(),
  // SPEC-030 Task 2：全组织审批统计（approval.manage）
  approvalStats: vi.fn(),
}));
vi.mock('@/api/approval', async importOriginal => {
  const original = await importOriginal<typeof import('@/api/approval')>();
  return { ...original, approvalApi: approvalApiMock };
});

const materialsMock = vi.hoisted(() => ({ list: vi.fn(), createType: vi.fn(), upload: vi.fn(), download: vi.fn(), remove: vi.fn(), clone: vi.fn(), material: vi.fn() }));
vi.mock('@/api/approval-materials', async importOriginal => ({ ...await importOriginal<typeof import('@/api/approval-materials')>(), approvalMaterialsApi: materialsMock }));

function taskFixture(overrides: Partial<ApprovalTaskView> = {}): ApprovalTaskView {
  return {
    id: 'task-1',
    instanceId: 'ap-1',
    nodeName: '审批',
    assigneeId: 'user-1',
    status: 'PENDING',
    remark: null,
    processedBy: null,
    processedAt: null,
    version: 1,
    createdAt: '2026-08-01T01:00:00.000Z',
    updatedAt: '2026-08-01T01:00:00.000Z',
    ...overrides,
  };
}

function instanceFixture(overrides: Partial<ApprovalInstanceView> = {}): ApprovalInstanceView {
  return {
    id: 'ap-1',
    definitionId: 'def-1',
    definitionVersion: 1,
    businessType: 'LEAVE',
    title: '请假申请-张三',
    content: {
      startDate: '2026-08-01T00:00:00.000Z',
      endDate: '2026-08-03T00:00:00.000Z',
      reason: '家中有事',
    },
    applicantId: 'user-1',
    status: 'PENDING',
    currentNode: 0,
    nodeSchema: null,
    decidedBy: null,
    decidedAt: null,
    version: 1,
    createdBy: 'user-1',
    createdAt: '2026-08-01T01:00:00.000Z',
    updatedAt: '2026-08-01T01:00:00.000Z',
    tasks: [taskFixture()],
    ...overrides,
  };
}

function definitionFixture(overrides: Partial<ApprovalDefinitionView> = {}): ApprovalDefinitionView {
  return {
    id: 'def-seal',
    code: 'SEAL',
    name: '用印申请',
    businessType: 'SEAL',
    formSchema: {
      fields: [
        { key: 'sealType', label: '用印类型', type: 'text', required: true },
        { key: 'docCount', label: '份数', type: 'number', required: true },
      ],
    },
    approverRule: { type: 'ROLE', roleCodes: ['SEAL_ADMIN'] },
    nodeSchema: null,
    version: 1,
    status: 'ACTIVE',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function pageOf(list: ApprovalInstanceView[], total = list.length) {
  return { code: 200, message: 'success', data: { list, page: 1, pageSize: 10, total } };
}

function grantPermissions(permissions: PermissionCode[], userId = 'user-1') {
  useAuthStore.setState({
    userInfo: { id: userId, username: 'user1', name: '用户一' },
    authorization: {
      userId,
      employeeId: null,
      isSystemSuperAdmin: false,
      isSystemAdmin: false,
      permissions,
      menus: [],
      fieldCapabilities: {},
      validUntil: null,
      evaluatedAt: new Date().toISOString(),
    },
    authorizationStatus: 'ready',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  materialsMock.list.mockResolvedValue({ code: 200, data: [] });
  vi.spyOn(message, 'success').mockImplementation(() => undefined as never);
  vi.spyOn(message, 'error').mockImplementation(() => undefined as never);
  useApprovalStore.getState().reset();
  useAuthStore.setState({ authorization: null, authorizationStatus: 'idle', userInfo: null });
});

test('renders the APPLIED tab with server data and passes role=APPLIED', async () => {
  grantPermissions(['approval.read']);
  approvalApiMock.list.mockResolvedValue(pageOf([instanceFixture()]));
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);

  expect(await screen.findByText('请假申请-张三')).toBeInTheDocument();
  expect(screen.getByText('请假申请')).toBeInTheDocument();
  expect(screen.getByText('审批中')).toBeInTheDocument();
  expect(approvalApiMock.list).toHaveBeenCalledWith(expect.objectContaining({ role: 'APPLIED', page: 1, pageSize: 10 }));
});

test('switching to the TODO tab fetches with role=TODO and shows the todo rows', async () => {
  grantPermissions(['approval.read', 'approval.process']);
  approvalApiMock.list.mockImplementation(async ({ role }: { role: string }) => {
    if (role === 'TODO') {
      return pageOf([instanceFixture({
        id: 'ap-2', title: '用印申请-公章', businessType: 'SEAL',
        tasks: [taskFixture({ id: 'task-9', assigneeId: 'user-1' })],
      })]);
    }
    return pageOf([]);
  });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');

  fireEvent.click(screen.getByRole('tab', { name: '我的待办' }));
  await waitFor(() => expect(approvalApiMock.list).toHaveBeenCalledWith(expect.objectContaining({ role: 'TODO' })));
  expect(await screen.findByText('用印申请-公章')).toBeInTheDocument();
});

test('approve button on a TODO row calls process with the task id', async () => {
  grantPermissions(['approval.read', 'approval.apply', 'approval.process']);
  approvalApiMock.list.mockImplementation(async ({ role }: { role: string }) => {
    if (role === 'TODO') {
      return pageOf([instanceFixture({
        id: 'ap-2', title: '用印申请-公章', businessType: 'SEAL',
        tasks: [taskFixture({ id: 'task-9', assigneeId: 'user-1' })],
      })]);
    }
    return pageOf([]);
  });
  approvalApiMock.process.mockResolvedValue({
    code: 200,
    message: 'success',
    data: instanceFixture({
      id: 'ap-2', title: '用印申请-公章', businessType: 'SEAL', status: 'APPROVED',
      tasks: [taskFixture({ id: 'task-9', assigneeId: 'user-1', status: 'APPROVED' })],
    }),
  });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');

  fireEvent.click(screen.getByRole('tab', { name: '我的待办' }));
  fireEvent.click(await screen.findByRole('button', { name: '审批通过' }));
  expect(await screen.findByText(/审批通过为高敏感操作/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '确认通过' }));

  await waitFor(() => expect(approvalApiMock.process).toHaveBeenCalledWith(
    'task-9',
    expect.objectContaining({ action: 'APPROVE' }),
  ));
  // 处理后回源刷新 TODO 列表。
  await waitFor(() => expect(approvalApiMock.list).toHaveBeenCalledWith(expect.objectContaining({ role: 'TODO' })));
});

test('hides approve/reject buttons on TODO rows without approval.process', async () => {
  grantPermissions(['approval.read']);
  approvalApiMock.list.mockImplementation(async ({ role }: { role: string }) => {
    if (role === 'TODO') {
      return pageOf([instanceFixture({
        id: 'ap-2', title: '用印申请-公章', businessType: 'SEAL',
        tasks: [taskFixture({ id: 'task-9', assigneeId: 'user-1' })],
      })]);
    }
    return pageOf([]);
  });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');

  fireEvent.click(screen.getByRole('tab', { name: '我的待办' }));
  await screen.findByText('用印申请-公章');

  expect(screen.queryByRole('button', { name: '审批通过' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '驳回' })).not.toBeInTheDocument();
  // 详情仅需 approval.read，仍可见。
  expect(screen.getByRole('button', { name: '详情' })).toBeInTheDocument();
});

test('hides the new-application button and does not fetch definitions without approval.apply', async () => {
  grantPermissions(['approval.read', 'approval.process']);
  approvalApiMock.list.mockResolvedValue(pageOf([]));
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');

  expect(screen.queryByRole('button', { name: /新建申请/ })).not.toBeInTheDocument();
  // read 用户 GET definitions 会 403 —— 前端不得发起（approval.apply 门控）。
  expect(approvalApiMock.definitions).not.toHaveBeenCalled();
});

test('creates an application from the SEAL definition form and submits content', async () => {
  grantPermissions(['approval.read', 'approval.apply']);
  approvalApiMock.list.mockResolvedValue(pageOf([]));
  approvalApiMock.definitions.mockResolvedValue({
    code: 200, message: 'success', data: [definitionFixture()],
  });
  approvalApiMock.apply.mockResolvedValue({
    code: 200, message: 'success', data: instanceFixture({ id: 'ap-new', title: '用印申请' }),
  });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');

  fireEvent.click(screen.getByRole('button', { name: /新建申请/ }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  await waitFor(() => expect(approvalApiMock.definitions).toHaveBeenCalledOnce());

  fireEvent.mouseDown(screen.getByRole('combobox', { name: '审批类型' }));
  fireEvent.click(await screen.findByText('用印申请'));

  // 选择定义后 title 默认类型名；表单按 formSchema 渲染（text + number 字段）。
  const sealTypeInput = await screen.findByRole('textbox', { name: '用印类型' });
  fireEvent.change(sealTypeInput, { target: { value: '公章' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: '份数' }), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));

  await waitFor(() => expect(approvalApiMock.apply).toHaveBeenCalledWith(
    expect.objectContaining({
      definitionCode: 'SEAL',
      title: '用印申请',
      content: { sealType: '公章', docCount: 3 },
    }),
  ));
  // 提交成功后回源刷新当前 Tab（APPLIED）。
  await waitFor(() => expect(approvalApiMock.list).toHaveBeenCalledTimes(2));
});

test('withdraws an APPLIED PENDING instance with approval.apply', async () => {
  grantPermissions(['approval.read', 'approval.apply']);
  approvalApiMock.list.mockResolvedValue(pageOf([instanceFixture({ status: 'PENDING' })]));
  approvalApiMock.withdraw.mockResolvedValue({
    code: 200, message: 'success', data: instanceFixture({ status: 'WITHDRAWN' }),
  });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('请假申请-张三');

  fireEvent.click(screen.getByRole('button', { name: '撤回' }));
  fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));

  await waitFor(() => expect(approvalApiMock.withdraw).toHaveBeenCalledWith(
    'ap-1',
    expect.objectContaining({ reason: '主动撤回' }),
  ));
  await waitFor(() => expect(approvalApiMock.list).toHaveBeenCalledWith(expect.objectContaining({ role: 'APPLIED' })));
});

test('shows the business message when the list request fails', async () => {
  grantPermissions(['approval.read']);
  approvalApiMock.list.mockRejectedValue({ response: { data: { message: 'APPROVAL_STATE_INVALID' } } });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);

  expect(await screen.findByText('审批列表加载失败')).toBeInTheDocument();
  expect(screen.getByText('APPROVAL_STATE_INVALID')).toBeInTheDocument();
});

test('opens the detail modal with instance content', async () => {
  grantPermissions(['approval.read']);
  approvalApiMock.list.mockResolvedValue(pageOf([instanceFixture()]));
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('请假申请-张三');

  fireEvent.click(screen.getByRole('button', { name: '详情' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  // 详情弹窗渲染 content 原始 Json（含 reason 值）。
  expect(screen.getByText(/家中有事/)).toBeInTheDocument();
});

test('detail modal groups tasks by nodeName and marks the currentNode group as 审批中', async () => {
  grantPermissions(['approval.read']);
  approvalApiMock.list.mockResolvedValue(pageOf([instanceFixture({
    id: 'ap-multi',
    title: '合同变更-大单',
    businessType: 'CONTRACT_CHANGE',
    status: 'PENDING',
    currentNode: 1,
    tasks: [
      taskFixture({ id: 'task-1', nodeName: '主管初审', assigneeId: 'user-2', status: 'APPROVED', processedAt: '2026-08-01T02:00:00.000Z' }),
      taskFixture({ id: 'task-2', nodeName: '合伙人终审', assigneeId: 'user-1', status: 'PENDING' }),
    ],
  })]));
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('合同变更-大单');

  fireEvent.click(screen.getByRole('button', { name: '详情' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();

  // 两节点链均渲染（节点进度链 + 分组头）。
  expect(screen.getAllByText('主管初审').length).toBeGreaterThan(0);
  expect(screen.getAllByText('合伙人终审').length).toBeGreaterThan(0);
  // 已完成节点（currentNode=0）标记 已完成；当前节点（currentNode=1 对应'合伙人终审'分组）标记 审批中。
  expect(within(screen.getByTestId('node-state-主管初审')).getByText('已完成')).toBeInTheDocument();
  expect(within(screen.getByTestId('node-state-合伙人终审')).getByText('审批中')).toBeInTheDocument();
  // 分组隔离：'合伙人终审'分组仅含本节点任务（审批人 user-1），不含节点[0] 的审批人 user-2。
  const currentGroup = screen.getByTestId('node-group-合伙人终审');
  expect(within(currentGroup).getByText('user-1')).toBeInTheDocument();
  expect(within(currentGroup).queryByText('user-2')).not.toBeInTheDocument();
});

test('TODO rows show the current node name (multi-node Tag and single-node muted text)', async () => {
  grantPermissions(['approval.read']);
  approvalApiMock.list.mockImplementation(async ({ role }: { role: string }) => {
    if (role === 'TODO') {
      return pageOf([
        instanceFixture({
          id: 'ap-multi', title: '合同变更-大单', businessType: 'CONTRACT_CHANGE', currentNode: 1,
          tasks: [
            taskFixture({ id: 'task-1', nodeName: '主管初审', assigneeId: 'user-2', status: 'APPROVED', processedAt: '2026-08-01T02:00:00.000Z' }),
            taskFixture({ id: 'task-2', nodeName: '合伙人终审', assigneeId: 'user-1', status: 'PENDING' }),
          ],
        }),
        instanceFixture({ id: 'ap-single', title: '请假申请-张三' }),
      ]);
    }
    return pageOf([]);
  });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');

  fireEvent.click(screen.getByRole('tab', { name: '我的待办' }));
  await screen.findByText('合同变更-大单');

  // 多节点实例：节点列显示当前节点名（合伙人终审）。
  expect(screen.getByText('合伙人终审')).toBeInTheDocument();
  // 单节点实例：节点列仍显示通用名 '审批'（弱化文本）。
  expect(screen.getByText('审批')).toBeInTheDocument();
});

test('detail modal clamps an out-of-range currentNode to the last group (SPEC-016 minor hardening)', async () => {
  grantPermissions(['approval.read']);
  approvalApiMock.list.mockResolvedValue(pageOf([instanceFixture({
    id: 'ap-clamp',
    title: '合同变更-越界',
    businessType: 'CONTRACT_CHANGE',
    status: 'PENDING',
    currentNode: 5, // 越界：两节点链仅 2 个分组，clamp 到末分组 index 1。
    tasks: [
      taskFixture({ id: 'task-1', nodeName: '主管初审', assigneeId: 'user-2', status: 'APPROVED', processedAt: '2026-08-01T02:00:00.000Z' }),
      taskFixture({ id: 'task-2', nodeName: '合伙人终审', assigneeId: 'user-1', status: 'PENDING' }),
    ],
  })]));
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('合同变更-越界');

  fireEvent.click(screen.getByRole('button', { name: '详情' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();

  // clamp 后 currentNode=min(5, 1)=1：末分组（合伙人终审）标记 审批中——不 clamp 时 index<5 全 已完成，断言失败。
  expect(within(screen.getByTestId('node-state-主管初审')).getByText('已完成')).toBeInTheDocument();
  expect(within(screen.getByTestId('node-state-合伙人终审')).getByText('审批中')).toBeInTheDocument();
});

// ==== SPEC-017 Task 3: 定义管理 Tab（approval.manage 门控）====

test('hides the 定义管理 tab without approval.manage', async () => {
  grantPermissions(['approval.read']);
  approvalApiMock.list.mockResolvedValue(pageOf([]));
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');

  expect(screen.queryByRole('tab', { name: '定义管理' })).not.toBeInTheDocument();
  // 无码用户不发 GET /definitions/manage（避免 403 噪音）。
  expect(approvalApiMock.listDefinitionsManage).not.toHaveBeenCalled();
});

test('shows the 定义管理 tab with approval.manage and renders the definition list', async () => {
  grantPermissions(['approval.read', 'approval.manage']);
  approvalApiMock.list.mockResolvedValue(pageOf([]));
  approvalApiMock.listDefinitionsManage.mockResolvedValue({
    code: 200,
    message: 'success',
    data: [definitionFixture({ code: 'EXPENSE_1', name: '专项报销', businessType: 'EXPENSE', status: 'ACTIVE' })],
  });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');

  expect(screen.getByRole('tab', { name: '定义管理' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: '定义管理' }));
  // 列表渲染：code/name/status Tag（ACTIVE→启用）。
  expect(await screen.findByText('EXPENSE_1')).toBeInTheDocument();
  expect(screen.getByText('专项报销')).toBeInTheDocument();
  expect(screen.getByText('启用')).toBeInTheDocument();
  // ACTIVE 行操作按钮为「禁用」。
  expect(screen.getByRole('button', { name: '禁用' })).toBeInTheDocument();
});

test('creates a new definition via the manage modal and refreshes the list', async () => {
  grantPermissions(['approval.read', 'approval.manage']);
  approvalApiMock.list.mockResolvedValue(pageOf([]));
  approvalApiMock.listDefinitionsManage.mockResolvedValue({ code: 200, message: 'success', data: [] });
  approvalApiMock.createDefinition.mockResolvedValue({
    code: 200,
    message: 'success',
    data: definitionFixture({ code: 'TRAVEL', name: '出差申请', businessType: 'EXPENSE' }),
  });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');

  fireEvent.click(screen.getByRole('tab', { name: '定义管理' }));
  await screen.findByText('暂无定义');
  fireEvent.click(screen.getByRole('button', { name: /新建定义/ }));
  const dialog = await screen.findByRole('dialog');

  fireEvent.change(within(dialog).getByRole('textbox', { name: '编码' }), { target: { value: 'TRAVEL' } });
  fireEvent.change(within(dialog).getByRole('textbox', { name: '名称' }), { target: { value: '出差申请' } });
  fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: '业务类型' }));
  fireEvent.click(await screen.findByText('费用报销'));
  fireEvent.change(within(dialog).getByRole('textbox', { name: /表单 Schema/ }), {
    target: { value: '{"fields":[{"key":"reason","label":"事由","type":"text","required":true}]}' },
  });
  fireEvent.change(within(dialog).getByRole('textbox', { name: /审批人取值/ }), { target: { value: 'HR' } });
  fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));

  await waitFor(() => expect(approvalApiMock.createDefinition).toHaveBeenCalledWith(expect.objectContaining({
    code: 'TRAVEL',
    name: '出差申请',
    businessType: 'EXPENSE',
    formSchema: { fields: [{ key: 'reason', label: '事由', type: 'text', required: true }] },
    approverRule: { type: 'ROLE', roleCodes: ['HR'] },
    nodeSchema: null,
  })));
  // 创建成功后关闭 Modal + 回源刷新管理列表（初始 1 次 + 刷新 1 次）。
  await waitFor(() => expect(approvalApiMock.listDefinitionsManage).toHaveBeenCalledTimes(2));
});

test('creates a SUPERVISOR (直属上级) definition without a value (SPEC-041)', async () => {
  grantPermissions(['approval.read', 'approval.manage']);
  approvalApiMock.list.mockResolvedValue(pageOf([]));
  approvalApiMock.listDefinitionsManage.mockResolvedValue({ code: 200, message: 'success', data: [] });
  approvalApiMock.createDefinition.mockResolvedValue({
    code: 200, message: 'success',
    data: definitionFixture({ code: 'LEAVE_SUP', name: '请假-上级', businessType: 'LEAVE' }),
  });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');

  fireEvent.click(screen.getByRole('tab', { name: '定义管理' }));
  await screen.findByText('暂无定义');
  fireEvent.click(screen.getByRole('button', { name: /新建定义/ }));
  const dialog = await screen.findByRole('dialog');

  fireEvent.change(within(dialog).getByRole('textbox', { name: '编码' }), { target: { value: 'LEAVE_SUP' } });
  fireEvent.change(within(dialog).getByRole('textbox', { name: '名称' }), { target: { value: '请假-上级' } });
  fireEvent.change(within(dialog).getByRole('textbox', { name: /表单 Schema/ }), {
    target: { value: '{"fields":[{"key":"amount","label":"金额","type":"number","required":true}]}' },
  });
  // 审批人类型选「直属上级」——无需取值 CSV。
  const ruleTypeSelect = within(dialog).getByRole('combobox', { name: '审批人类型' });
  fireEvent.mouseDown(ruleTypeSelect);
  fireEvent.click((await screen.findAllByText('直属上级')).at(-1)!);
  fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));

  await waitFor(() => expect(approvalApiMock.createDefinition).toHaveBeenCalledWith(expect.objectContaining({
    code: 'LEAVE_SUP',
    name: '请假-上级',
    businessType: 'LEAVE',
    approverRule: { type: 'SUPERVISOR' },
    nodeSchema: null,
  })));
});

test('keeps the modal open and shows the business message on code conflict', async () => {
  grantPermissions(['approval.read', 'approval.manage']);
  approvalApiMock.list.mockResolvedValue(pageOf([]));
  approvalApiMock.listDefinitionsManage.mockResolvedValue({ code: 200, message: 'success', data: [] });
  approvalApiMock.createDefinition.mockRejectedValue({
    response: { data: { message: 'APPROVAL_DEFINITION_CODE_CONFLICT' } },
  });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');

  fireEvent.click(screen.getByRole('tab', { name: '定义管理' }));
  await screen.findByText('暂无定义');
  fireEvent.click(screen.getByRole('button', { name: /新建定义/ }));
  const dialog = await screen.findByRole('dialog');

  fireEvent.change(within(dialog).getByRole('textbox', { name: '编码' }), { target: { value: 'SEAL' } });
  fireEvent.change(within(dialog).getByRole('textbox', { name: '名称' }), { target: { value: '重复编码' } });
  fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: '业务类型' }));
  fireEvent.click(await screen.findByText('用印申请'));
  fireEvent.change(within(dialog).getByRole('textbox', { name: /表单 Schema/ }), {
    target: { value: '{"fields":[{"key":"reason","label":"事由","type":"text","required":true}]}' },
  });
  fireEvent.change(within(dialog).getByRole('textbox', { name: /审批人取值/ }), { target: { value: 'HR' } });
  fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));

  await waitFor(() => expect(message.error).toHaveBeenCalledWith('APPROVAL_DEFINITION_CODE_CONFLICT'));
  // code 冲突后 Modal 保持打开（可改码重试）。
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('disables an ACTIVE definition via Popconfirm PATCH status and refreshes the list', async () => {
  grantPermissions(['approval.read', 'approval.manage']);
  approvalApiMock.list.mockResolvedValue(pageOf([]));
  approvalApiMock.listDefinitionsManage.mockResolvedValue({
    code: 200,
    message: 'success',
    data: [definitionFixture({ code: 'SEAL_1', name: '用印申请-专项', businessType: 'SEAL', status: 'ACTIVE' })],
  });
  approvalApiMock.updateDefinition.mockResolvedValue({
    code: 200,
    message: 'success',
    data: definitionFixture({ code: 'SEAL_1', name: '用印申请-专项', businessType: 'SEAL', status: 'DISABLED' }),
  });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');

  fireEvent.click(screen.getByRole('tab', { name: '定义管理' }));
  await screen.findByText('SEAL_1');
  fireEvent.click(screen.getByRole('button', { name: '禁用' }));
  fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));

  await waitFor(() => expect(approvalApiMock.updateDefinition).toHaveBeenCalledWith('SEAL_1', { status: 'DISABLED' }));
  // 禁用成功后回源刷新管理列表（初始 1 次 + 刷新 1 次）。
  await waitFor(() => expect(approvalApiMock.listDefinitionsManage).toHaveBeenCalledTimes(2));
});

// ==== SPEC-018 Task 2: 会签（nodeSchema mode:'ALL'）节点「会签」Tag ====

test('detail modal shows a 会签 Tag for ALL-mode nodes and none for ANY-mode nodes', async () => {
  grantPermissions(['approval.read']);
  approvalApiMock.list.mockResolvedValue(pageOf([instanceFixture({
    id: 'ap-countersign',
    title: '合同变更-双签',
    businessType: 'CONTRACT_CHANGE',
    status: 'PENDING',
    currentNode: 0,
    nodeSchema: [
      { name: '主管初审', approverRule: { type: 'ROLE', roleCodes: ['MANAGER'] }, mode: 'ALL' },
      { name: '合伙人终审', approverRule: { type: 'ROLE', roleCodes: ['PARTNER'] }, mode: 'ANY' },
    ] as unknown as Record<string, unknown>,
    tasks: [
      taskFixture({ id: 'task-1', nodeName: '主管初审', assigneeId: 'user-2', status: 'APPROVED', processedAt: '2026-08-01T02:00:00.000Z' }),
      taskFixture({ id: 'task-2', nodeName: '合伙人终审', assigneeId: 'user-1', status: 'PENDING' }),
    ],
  })]));
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('合同变更-双签');

  fireEvent.click(screen.getByRole('button', { name: '详情' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();

  // mode:'ALL' 节点（主管初审）旁渲染「会签」Tag；mode:'ANY' 节点（合伙人终审）旁无。
  expect(screen.getByTestId('node-countersign-主管初审')).toHaveTextContent('会签');
  expect(screen.queryByTestId('node-countersign-合伙人终审')).not.toBeInTheDocument();
});

test('detail modal shows no 会签 Tag when nodeSchema nodes omit mode (ANY default)', async () => {
  grantPermissions(['approval.read']);
  approvalApiMock.list.mockResolvedValue(pageOf([instanceFixture({
    id: 'ap-nomode',
    title: '合同变更-无模式',
    businessType: 'CONTRACT_CHANGE',
    status: 'PENDING',
    currentNode: 0,
    nodeSchema: [
      { name: '主管初审', approverRule: { type: 'ROLE', roleCodes: ['MANAGER'] } },
      { name: '合伙人终审', approverRule: { type: 'ROLE', roleCodes: ['PARTNER'] } },
    ] as unknown as Record<string, unknown>,
    tasks: [
      taskFixture({ id: 'task-1', nodeName: '主管初审', assigneeId: 'user-2', status: 'APPROVED', processedAt: '2026-08-01T02:00:00.000Z' }),
      taskFixture({ id: 'task-2', nodeName: '合伙人终审', assigneeId: 'user-1', status: 'PENDING' }),
    ],
  })]));
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('合同变更-无模式');

  fireEvent.click(screen.getByRole('button', { name: '详情' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();

  // 全链节点 mode 缺省（向后兼容 ANY）→ 无任何「会签」Tag。
  expect(screen.queryByTestId('node-countersign-主管初审')).not.toBeInTheDocument();
  expect(screen.queryByTestId('node-countersign-合伙人终审')).not.toBeInTheDocument();
  expect(screen.queryByText('会签')).not.toBeInTheDocument();
});

test('detail modal shows no 会签 Tag when nodeSchema is null (single node)', async () => {
  grantPermissions(['approval.read']);
  approvalApiMock.list.mockResolvedValue(pageOf([instanceFixture({ title: '请假申请-单节点', nodeSchema: null })]));
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('请假申请-单节点');

  fireEvent.click(screen.getByRole('button', { name: '详情' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();

  // nodeSchema null（单节点/顶层 approverRule）→ 无「会签」Tag。
  expect(screen.queryByText('会签')).not.toBeInTheDocument();
});

// ==== SPEC-019 Task 2: 审批转交（approval.process 门控）====

test('forwards a TODO task via the forward modal with the target userId and refreshes', async () => {
  grantPermissions(['approval.read', 'approval.process']);
  approvalApiMock.list.mockImplementation(async ({ role }: { role: string }) => {
    if (role === 'TODO') {
      return pageOf([instanceFixture({
        id: 'ap-2', title: '用印申请-公章', businessType: 'SEAL',
        tasks: [taskFixture({ id: 'task-9', assigneeId: 'user-1' })],
      })]);
    }
    return pageOf([]);
  });
  approvalApiMock.forwardTask.mockResolvedValue({
    code: 200,
    message: 'success',
    data: instanceFixture({
      id: 'ap-2', title: '用印申请-公章', businessType: 'SEAL',
      tasks: [taskFixture({ id: 'task-9', assigneeId: 'user-2' })],
    }),
  });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');

  fireEvent.click(screen.getByRole('tab', { name: '我的待办' }));
  fireEvent.click(await screen.findByRole('button', { name: '转交' }));
  // 环境内 AntD Modal 的 aria-labelledby 解析异常（重复 id=test-id），按内容定位转交弹窗。
  await screen.findByRole('textbox', { name: '目标审批人 ID' });
  const dialog = screen.getAllByRole('dialog').find(d => within(d).queryByRole('textbox', { name: '目标审批人 ID' }));
  if (!dialog) throw new Error('转交弹窗未渲染');
  fireEvent.change(within(dialog).getByRole('textbox', { name: '目标审批人 ID' }), { target: { value: 'user-2' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确认转交/ }));

  // 参数钉死：taskId + forwardToUserId（不传 remark/多余键）。
  await waitFor(() => expect(approvalApiMock.forwardTask).toHaveBeenCalledWith(
    'task-9',
    { forwardToUserId: 'user-2' },
  ));
  expect(message.success).toHaveBeenCalledWith('任务已转交');
  // 转交成功后回源刷新 TODO 列表（初始 APPLIED 1 次 + 切 Tab 1 次 + 转交刷新 1 次 → TODO 恰 2 次）。
  await waitFor(() => {
    const todoCalls = approvalApiMock.list.mock.calls.filter(([params]) => params.role === 'TODO');
    expect(todoCalls).toHaveLength(2);
  });
});

test('hides the forward button on TODO rows without approval.process', async () => {
  grantPermissions(['approval.read']);
  approvalApiMock.list.mockImplementation(async ({ role }: { role: string }) => {
    if (role === 'TODO') {
      return pageOf([instanceFixture({
        id: 'ap-2', title: '用印申请-公章', businessType: 'SEAL',
        tasks: [taskFixture({ id: 'task-9', assigneeId: 'user-1' })],
      })]);
    }
    return pageOf([]);
  });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');

  fireEvent.click(screen.getByRole('tab', { name: '我的待办' }));
  await screen.findByText('用印申请-公章');

  // 无 approval.process：审批/驳回/转交均隐藏；详情（仅 read）仍可见。
  expect(screen.queryByRole('button', { name: '审批通过' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '驳回' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '转交' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '详情' })).toBeInTheDocument();
});

test('detail modal shows the forward button only for own PENDING task and forwards it', async () => {
  grantPermissions(['approval.read', 'approval.process']);
  approvalApiMock.list.mockResolvedValue(pageOf([instanceFixture({
    id: 'ap-multi',
    title: '合同变更-大单',
    businessType: 'CONTRACT_CHANGE',
    status: 'PENDING',
    currentNode: 1,
    tasks: [
      taskFixture({ id: 'task-1', nodeName: '主管初审', assigneeId: 'user-2', status: 'APPROVED', processedAt: '2026-08-01T02:00:00.000Z' }),
      taskFixture({ id: 'task-2', nodeName: '合伙人终审', assigneeId: 'user-1', status: 'PENDING' }),
    ],
  })]));
  approvalApiMock.forwardTask.mockResolvedValue({
    code: 200,
    message: 'success',
    data: instanceFixture({ id: 'ap-multi', title: '合同变更-大单' }),
  });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('合同变更-大单');

  fireEvent.click(screen.getByRole('button', { name: '详情' }));
  await screen.findByRole('dialog');

  // 仅当前用户（user-1）的 PENDING 任务行有「转交」；已处理（user-2, APPROVED）行无。
  const currentGroup = screen.getByTestId('node-group-合伙人终审');
  expect(within(currentGroup).getByRole('button', { name: '转交' })).toBeInTheDocument();
  expect(within(screen.getByTestId('node-group-主管初审')).queryByRole('button', { name: '转交' })).not.toBeInTheDocument();

  fireEvent.click(within(currentGroup).getByRole('button', { name: '转交' }));
  // 环境内 AntD Modal 的 aria-labelledby 解析异常（重复 id=test-id），按内容定位转交弹窗。
  await screen.findByRole('textbox', { name: '目标审批人 ID' });
  const forwardDialog = screen.getAllByRole('dialog').find(d => within(d).queryByRole('textbox', { name: '目标审批人 ID' }));
  if (!forwardDialog) throw new Error('转交弹窗未渲染');
  fireEvent.change(within(forwardDialog).getByRole('textbox', { name: '目标审批人 ID' }), { target: { value: 'user-9' } });
  fireEvent.click(within(forwardDialog).getByRole('button', { name: /确认转交/ }));

  await waitFor(() => expect(approvalApiMock.forwardTask).toHaveBeenCalledWith(
    'task-2',
    { forwardToUserId: 'user-9' },
  ));
  expect(message.success).toHaveBeenCalledWith('任务已转交');
});

// ==== SPEC-020 Task 2: 审批加签（approval.process 门控）====

test('hides the 加签 button on TODO rows without approval.process', async () => {
  grantPermissions(['approval.read']);
  approvalApiMock.list.mockImplementation(async ({ role }: { role: string }) => {
    if (role === 'TODO') {
      return pageOf([instanceFixture({
        id: 'ap-2', title: '用印申请-公章', businessType: 'SEAL',
        tasks: [taskFixture({ id: 'task-9', assigneeId: 'user-1' })],
      })]);
    }
    return pageOf([]);
  });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');

  fireEvent.click(screen.getByRole('tab', { name: '我的待办' }));
  await screen.findByText('用印申请-公章');

  // 无 approval.process：加签（与审批/驳回/转交同区）隐藏；详情（仅 read）仍可见。
  expect(screen.queryByRole('button', { name: '加签' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '转交' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '详情' })).toBeInTheDocument();
});

test('adds signers to a TODO task via the modal with a split userId array and refreshes', async () => {
  grantPermissions(['approval.read', 'approval.process']);
  approvalApiMock.list.mockImplementation(async ({ role }: { role: string }) => {
    if (role === 'TODO') {
      return pageOf([instanceFixture({
        id: 'ap-2', title: '用印申请-公章', businessType: 'SEAL',
        tasks: [taskFixture({ id: 'task-9', assigneeId: 'user-1' })],
      })]);
    }
    return pageOf([]);
  });
  approvalApiMock.addSigners.mockResolvedValue({
    code: 200,
    message: 'success',
    data: instanceFixture({
      id: 'ap-2', title: '用印申请-公章', businessType: 'SEAL',
      tasks: [
        taskFixture({ id: 'task-9', assigneeId: 'user-1' }),
        taskFixture({ id: 'task-10', assigneeId: 'user-2' }),
      ],
    }),
  });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');

  fireEvent.click(screen.getByRole('tab', { name: '我的待办' }));
  fireEvent.click(await screen.findByRole('button', { name: '加签' }));
  // 环境内 AntD Modal 的 aria-labelledby 解析异常（重复 id=test-id），按内容定位加签弹窗。
  await screen.findByRole('textbox', { name: '加签目标审批人 ID（逗号分隔）' });
  const dialog = screen.getAllByRole('dialog').find(d => within(d).queryByRole('textbox', { name: '加签目标审批人 ID（逗号分隔）' }));
  if (!dialog) throw new Error('加签弹窗未渲染');
  fireEvent.change(within(dialog).getByRole('textbox', { name: '加签目标审批人 ID（逗号分隔）' }), { target: { value: 'user-2, user-3' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确认加签/ }));

  // 参数钉死：taskId + addSignerUserIds 数组（逗号分隔拆分去空白）。
  await waitFor(() => expect(approvalApiMock.addSigners).toHaveBeenCalledWith(
    'task-9',
    { addSignerUserIds: ['user-2', 'user-3'] },
  ));
  expect(message.success).toHaveBeenCalledWith('加签成功');
  // 加签成功后回源刷新 TODO 列表（初始 APPLIED 1 次 + 切 Tab 1 次 + 加签刷新 1 次 → TODO 恰 2 次）。
  await waitFor(() => {
    const todoCalls = approvalApiMock.list.mock.calls.filter(([params]) => params.role === 'TODO');
    expect(todoCalls).toHaveLength(2);
  });
});

test('detail modal shows the 加签 button only for own PENDING task rows', async () => {
  grantPermissions(['approval.read', 'approval.process']);
  approvalApiMock.list.mockResolvedValue(pageOf([instanceFixture({
    id: 'ap-multi',
    title: '合同变更-大单',
    businessType: 'CONTRACT_CHANGE',
    status: 'PENDING',
    currentNode: 1,
    tasks: [
      taskFixture({ id: 'task-1', nodeName: '主管初审', assigneeId: 'user-2', status: 'APPROVED', processedAt: '2026-08-01T02:00:00.000Z' }),
      taskFixture({ id: 'task-2', nodeName: '合伙人终审', assigneeId: 'user-1', status: 'PENDING' }),
    ],
  })]));
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('合同变更-大单');

  fireEvent.click(screen.getByRole('button', { name: '详情' }));
  await screen.findByRole('dialog');

  // 仅当前用户（user-1）的 PENDING 任务行有「加签」（与转交同列）；已处理（user-2, APPROVED）行无。
  const currentGroup = screen.getByTestId('node-group-合伙人终审');
  expect(within(currentGroup).getByRole('button', { name: '加签' })).toBeInTheDocument();
  expect(within(currentGroup).getByRole('button', { name: '转交' })).toBeInTheDocument();
  expect(within(screen.getByTestId('node-group-主管初审')).queryByRole('button', { name: '加签' })).not.toBeInTheDocument();
});

// ==== SPEC-023 Task 2: 全组织视图「全部审批」Tab（approval.manage 门控）====

test('hides the 全部审批 tab without approval.manage', async () => {
  grantPermissions(['approval.read']);
  approvalApiMock.list.mockResolvedValue(pageOf([]));
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');

  // 无 approval.manage：不渲染「全部审批」Tab（与定义管理 Tab 同门控先例）。
  expect(screen.queryByRole('tab', { name: '全部审批' })).not.toBeInTheDocument();
  // 无码用户也不发起 role=ALL 请求（避免 403 噪音）。
  const allCalls = approvalApiMock.list.mock.calls.filter(([params]) => params.role === 'ALL');
  expect(allCalls).toHaveLength(0);
});

test('shows the 全部审批 tab with approval.manage, renders org-wide rows, and opens detail from row data', async () => {
  // manage-only（无 approval.read）——D3 动态门控：role=ALL 仅查 approval.manage。
  grantPermissions(['approval.manage']);
  approvalApiMock.list.mockImplementation(async ({ role }: { role: string }) => {
    if (role === 'ALL') {
      return pageOf([
        instanceFixture({ id: 'ap-other-1', title: '请假申请-李四', applicantId: 'user-2', status: 'APPROVED' }),
        instanceFixture({ id: 'ap-other-2', title: '用印申请-王五', applicantId: 'user-3', status: 'PENDING' }),
      ]);
    }
    return pageOf([]);
  });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');

  // manage 用户可见「全部审批」Tab。
  expect(screen.getByRole('tab', { name: '全部审批' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: '全部审批' }));

  // 全组织列表渲染：非本人实例（applicantId user-2/user-3，当前用户 user-1）title 可见。
  expect(await screen.findByText('请假申请-李四')).toBeInTheDocument();
  expect(screen.getByText('用印申请-王五')).toBeInTheDocument();
  // role=ALL 透传（page 1）。
  await waitFor(() => expect(approvalApiMock.list).toHaveBeenCalledWith(
    expect.objectContaining({ role: 'ALL', page: 1, pageSize: 10 }),
  ));

  // M3 详情兜底：manage-only（无 read）用户详情弹窗以列表行数据渲染（列表行已含 content/tasks 全数据），
  // 不额外 getInstance（getInstance 对无 read 用户 403）——点开详情仅依赖行数据。
  fireEvent.click(screen.getAllByRole('button', { name: '详情' })[0]);
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText(/家中有事/)).toBeInTheDocument();
  expect(approvalApiMock.detail).not.toHaveBeenCalled();
});

// ==== SPEC-028 Task 2: 全组织视图筛选/搜索 + CSV 导出（approval.manage）====

test('ALL tab applies businessType and keyword filters to listInstances and resets them', async () => {
  grantPermissions(['approval.manage']);
  approvalApiMock.list.mockImplementation(async ({ role }: { role: string }) =>
    pageOf(role === 'ALL' ? [instanceFixture({ id: 'ap-f-1', title: '差旅报销七月' })] : []),
  );
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');
  fireEvent.click(screen.getByRole('tab', { name: '全部审批' }));

  // 筛选区渲染（testid）。businessType Select 用 mouseDown + 选项点击（AntD Select 交互）。
  await screen.findByTestId('filter-business-type');
  fireEvent.mouseDown(screen.getByTestId('filter-business-type'));
  fireEvent.click(await screen.findByTitle('EXPENSE'));
  fireEvent.change(screen.getByTestId('filter-keyword'), { target: { value: '报销' } });
  fireEvent.click(screen.getByTestId('filter-apply'));

  // 非恒真：查询 → list 带筛选参数（role=ALL + businessType + keyword）。
  await waitFor(() => expect(approvalApiMock.list).toHaveBeenCalledWith(
    expect.objectContaining({ role: 'ALL', businessType: 'EXPENSE', keyword: '报销' }),
  ));
  expect(await screen.findByText('差旅报销七月')).toBeInTheDocument();

  // 重置 → 清空筛选 + 重新拉全量（无筛选参数）。
  fireEvent.click(screen.getByTestId('filter-reset'));
  await waitFor(() => expect(approvalApiMock.list).toHaveBeenCalledWith(
    expect.objectContaining({ role: 'ALL' }),
  ));
  const lastCall = approvalApiMock.list.mock.calls.at(-1)![0] as { businessType?: string; keyword?: string };
  expect(lastCall.businessType).toBeUndefined();
  expect(lastCall.keyword).toBeUndefined();
});

test('ALL tab export CSV button downloads a CSV blob from the filtered export endpoint', async () => {
  grantPermissions(['approval.manage']);
  approvalApiMock.list.mockResolvedValue(pageOf([]));
  const csv = '\uFEFFinstanceId,businessType,title\r\nap-1,EXPENSE,差旅报销';
  approvalApiMock.exportApprovalsCsv.mockResolvedValue({ code: 200, message: 'success', data: csv });
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-csv');
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');
  fireEvent.click(screen.getByRole('tab', { name: '全部审批' }));
  await screen.findByTestId('export-csv');

  fireEvent.click(screen.getByTestId('export-csv'));

  // 非恒真：导出按钮 → exportApprovalsCsv（当前筛选）+ Blob 下载（type text/csv）。
  await waitFor(() => expect(approvalApiMock.exportApprovalsCsv).toHaveBeenCalledOnce());
  expect(createObjectURL).toHaveBeenCalledOnce();
  const blob = createObjectURL.mock.calls[0][0] as Blob;
  expect(blob.type).toBe('text/csv;charset=utf-8');
  // 原始字节以 UTF-8 BOM（EF BB BF）开头（Excel 兼容）——blob.text() 会用默认 TextDecoder 剥离前导 BOM，故用 arrayBuffer 验证。
  const bytes = new Uint8Array(await blob.arrayBuffer());
  expect(bytes[0]).toBe(0xEF);
  expect(bytes[1]).toBe(0xBB);
  expect(bytes[2]).toBe(0xBF);
  await expect(blob.text()).resolves.toBe('instanceId,businessType,title\r\nap-1,EXPENSE,差旅报销');
  expect(anchorClick).toHaveBeenCalledOnce();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-csv');
});

// ==== SPEC-025 Task 3: 审批定义导入导出（approval.manage 门控，定义管理 Tab）====

test('exports definitions to a JSON download when the export button is clicked', async () => {
  grantPermissions(['approval.read', 'approval.manage']);
  approvalApiMock.list.mockResolvedValue(pageOf([]));
  approvalApiMock.listDefinitionsManage.mockResolvedValue({
    code: 200,
    message: 'success',
    data: [definitionFixture({ code: 'SEAL', name: '用印申请' })],
  });
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-export');
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  approvalApiMock.exportDefinitions.mockResolvedValue({
    code: 200,
    message: 'success',
    data: { schemaVersion: 1, definitions: [definitionFixture({ code: 'SEAL', name: '用印申请' })] },
  });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');

  fireEvent.click(screen.getByRole('tab', { name: '定义管理' }));
  // AntD Button 双汉字自动插空格（"导 出"）——沿用既有 `/确\s*定/` 形态用正则匹配。
  fireEvent.click(await screen.findByRole('button', { name: /导\s*出/ }));

  // 非恒真：导出按钮 → exportDefinitions 调用 + 下载触发（Blob + URL.createObjectURL + a.click）。
  await waitFor(() => expect(approvalApiMock.exportDefinitions).toHaveBeenCalledOnce());
  expect(createObjectURL).toHaveBeenCalledOnce();
  const blob = createObjectURL.mock.calls[0][0] as Blob;
  expect(blob.type).toBe('application/json');
  // 下载内容为导出包络 JSON（含 schemaVersion + definitions code）——round-trip 原样上传。
  await expect(blob.text()).resolves.toContain('"schemaVersion": 1');
  await expect(blob.text()).resolves.toContain('"SEAL"');
  expect(anchorClick).toHaveBeenCalledOnce();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-export');
});

test('imports definitions from a SPEC-029 {schemaVersion, definitions} envelope and preserves the schema version', async () => {
  grantPermissions(['approval.read', 'approval.manage']);
  approvalApiMock.list.mockResolvedValue(pageOf([]));
  approvalApiMock.listDefinitionsManage.mockResolvedValue({ code: 200, message: 'success', data: [] });
  approvalApiMock.importDefinitions.mockResolvedValue({
    code: 200,
    message: 'success',
    data: { imported: 1, updated: 0 },
  });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');
  fireEvent.click(screen.getByRole('tab', { name: '定义管理' }));
  await screen.findByText('暂无定义');

  // SPEC-029 包络：{schemaVersion, definitions}（含视图字段）。
  const file = new File(
    [JSON.stringify({
      schemaVersion: 1,
      definitions: [{
        id: 'def-x',
        code: 'TRAVEL',
        name: '出差申请',
        businessType: 'EXPENSE',
        formSchema: { fields: [{ key: 'reason', label: '事由', type: 'text', required: true }] },
        approverRule: { type: 'ROLE', roleCodes: ['HR'] },
        nodeSchema: null,
        version: 1,
        status: 'ACTIVE',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      }],
    })],
    'approval-definitions.json',
    { type: 'application/json' },
  );
  fireEvent.change(screen.getByTestId('definition-import-input'), { target: { files: [file] } });

  // 非恒真：导入保留 schemaVersion + 剥离视图字段。
  await waitFor(() => expect(approvalApiMock.importDefinitions).toHaveBeenCalledWith({
    schemaVersion: 1,
    definitions: [{
      code: 'TRAVEL',
      name: '出差申请',
      businessType: 'EXPENSE',
      formSchema: { fields: [{ key: 'reason', label: '事由', type: 'text', required: true }] },
      approverRule: { type: 'ROLE', roleCodes: ['HR'] },
      nodeSchema: null,
      version: 1,
      status: 'ACTIVE',
    }],
  }));
  expect(message.success).toHaveBeenCalledWith(expect.stringContaining('新增 1 条'));
});

test('imports definitions from a JSON file and strips view fields before upload', async () => {
  grantPermissions(['approval.read', 'approval.manage']);
  approvalApiMock.list.mockResolvedValue(pageOf([]));
  approvalApiMock.listDefinitionsManage.mockResolvedValue({ code: 200, message: 'success', data: [] });
  approvalApiMock.importDefinitions.mockResolvedValue({
    code: 200,
    message: 'success',
    data: { imported: 1, updated: 1 },
  });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');

  fireEvent.click(screen.getByRole('tab', { name: '定义管理' }));
  await screen.findByText('暂无定义');

  // 导出下载形态的裸数组 fixture：含视图字段 id/createdAt/updatedAt（round-trip 原样上传）。
  const file = new File(
    [JSON.stringify([{
      id: 'def-x',
      code: 'TRAVEL',
      name: '出差申请',
      businessType: 'EXPENSE',
      formSchema: { fields: [{ key: 'reason', label: '事由', type: 'text', required: true }] },
      approverRule: { type: 'ROLE', roleCodes: ['HR'] },
      nodeSchema: null,
      version: 1,
      status: 'ACTIVE',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }])],
    'approval-definitions.json',
    { type: 'application/json' },
  );
  fireEvent.change(screen.getByTestId('definition-import-input'), { target: { files: [file] } });

  // 非恒真：导入参数剥离视图字段——只保留 import 白名单 8 键（无 id/createdAt/updatedAt）。
  await waitFor(() => expect(approvalApiMock.importDefinitions).toHaveBeenCalledWith({
    definitions: [{
      code: 'TRAVEL',
      name: '出差申请',
      businessType: 'EXPENSE',
      formSchema: { fields: [{ key: 'reason', label: '事由', type: 'text', required: true }] },
      approverRule: { type: 'ROLE', roleCodes: ['HR'] },
      nodeSchema: null,
      version: 1,
      status: 'ACTIVE',
    }],
  }));
  expect(message.success).toHaveBeenCalledWith(expect.stringContaining('新增 1 条'));
  // 导入成功后回源刷新管理列表（初始 1 次 + 刷新 1 次）。
  await waitFor(() => expect(approvalApiMock.listDefinitionsManage).toHaveBeenCalledTimes(2));
});

// ==== SPEC-030 Task 2: 全组织审批统计（ALL Tab，approval.manage）====

test('ALL tab fetches and renders the approval statistics cards', async () => {
  grantPermissions(['approval.manage']);
  approvalApiMock.list.mockResolvedValue(pageOf([]));
  approvalApiMock.approvalStats.mockResolvedValue({
    code: 200,
    message: 'success',
    data: {
      total: 5,
      pendingCount: 2,
      decidedCount: 3,
      byBusinessType: [{ businessType: 'EXPENSE', count: 3 }, { businessType: 'SEAL', count: 2 }],
      byStatus: [{ status: 'PENDING', count: 2 }, { status: 'APPROVED', count: 3 }],
      avgDecisionHours: 24.5,
    },
  });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  await screen.findByText('暂无审批记录');
  fireEvent.click(screen.getByRole('tab', { name: '全部审批' }));

  // 非恒真：切 ALL Tab → 拉取统计（role='ALL' 语义）+ 渲染统计卡片。
  await waitFor(() => expect(approvalApiMock.approvalStats).toHaveBeenCalledOnce());
  expect(await screen.findByTestId('stats-total')).toHaveTextContent('5');
  expect(screen.getByTestId('stats-pending')).toHaveTextContent('2');
  expect(screen.getByTestId('stats-decided')).toHaveTextContent('3');
  expect(screen.getByTestId('stats-avg-hours')).toHaveTextContent('24.5');
});


test('ordinary applicant can create a personal type from the selected template', async () => {
  grantPermissions(['approval.read', 'approval.apply']);
  approvalApiMock.list.mockResolvedValue(pageOf([]));
  const template = definitionFixture(); const custom = definitionFixture({ id: 'custom', code: 'CUSTOM_SALARY', name: '工资绩效发放', businessType: 'CUSTOM' });
  approvalApiMock.definitions.mockResolvedValue({ code: 200, data: [template] });
  materialsMock.createType.mockResolvedValue({ code: 200, data: custom });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: /新建申请/ }));
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: '审批类型' }));
  fireEvent.click(await screen.findByText('用印申请'));
  await waitFor(() => expect(screen.getByRole('textbox', { name: '标题' })).toHaveValue('用印申请'));
  fireEvent.click(screen.getByRole('button', { name: '自定义审批类型' }));
  fireEvent.change(screen.getByRole('textbox', { name: '自定义类型名称' }), { target: { value: '工资绩效发放' } });
  approvalApiMock.definitions.mockResolvedValue({ code: 200, data: [template, custom] });
  fireEvent.click(screen.getByRole('button', { name: '创建并使用' }));
  await waitFor(() => expect(materialsMock.createType).toHaveBeenCalledWith({ name: '工资绩效发放', templateCode: 'SEAL' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: '标题' })).toHaveValue('工资绩效发放'));
});

test('uploaded evidence is submitted by id and failure keeps application fields', async () => {
  grantPermissions(['approval.read', 'approval.apply']);
  approvalApiMock.list.mockResolvedValue(pageOf([]));
  approvalApiMock.definitions.mockResolvedValue({ code: 200, data: [definitionFixture({ formSchema: { fields: [] } })] });
  approvalApiMock.apply.mockRejectedValue({ response: { data: { message: 'APPROVAL_FILE_BIND_INVALID' } } });
  materialsMock.upload.mockResolvedValue({ code: 200, data: { id: 'file-1', fileName: '发票.pdf', mimeType: 'application/pdf', fileSize: 10 } });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: /新建申请/ }));
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: '审批类型' })); fireEvent.click(await screen.findByText('用印申请'));
  fireEvent.change(screen.getByLabelText('选择审批附件'), { target: { files: [new File(['%PDF-test'], '发票.pdf', { type: 'application/pdf' })] } });
  await screen.findByText('发票.pdf', { exact: false });
  fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(approvalApiMock.apply).toHaveBeenCalledWith(expect.objectContaining({ attachmentIds: ['file-1'] })));
  expect(screen.getByRole('textbox', { name: '标题' })).toHaveValue('用印申请');
});

test('submitted detail exposes preview/export but no attachment edit or removal', async () => {
  grantPermissions(['approval.read', 'approval.apply']);
  approvalApiMock.list.mockResolvedValue(pageOf([instanceFixture()]));
  materialsMock.list.mockResolvedValue({ code: 200, data: [{ id: 'f', fileName: '工资.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileSize: 100, instanceId: 'ap-1' }] });
  render(<MemoryRouter><ApprovalCenterPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '详情' }));
  await screen.findByText('工资.xlsx', { exact: false });
  expect(screen.getByRole('button', { name: /预\s*览/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '导出审批材料 Word' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /移\s*除/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '预览 / 编辑' })).not.toBeInTheDocument();
});
