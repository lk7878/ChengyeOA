import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { message } from 'antd';
import { beforeEach, expect, test, vi } from 'vitest';
import CasePage from '../index';
import { useAuthStore } from '@/stores/authStore';
import type { Case } from '@/types';
import type { PermissionCode } from '@/features/authorization/types';

const caseApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  createCommunication: vi.fn(),
  close: vi.fn(),
  listFiles: vi.fn(),
  uploadFile: vi.fn(),
  downloadFile: vi.fn(),
  removeFile: vi.fn(),
}));
vi.mock('@/api/business', async importOriginal => {
  const original = await importOriginal<typeof import('@/api/business')>();
  return { ...original, caseApi: caseApiMock };
});

const customerApiMock = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  update: vi.fn(),
  listContacts: vi.fn(),
  addContact: vi.fn(),
  updateContact: vi.fn(),
  removeContact: vi.fn(),
}));
vi.mock('@/api/customer', async importOriginal => {
  const original = await importOriginal<typeof import('@/api/customer')>();
  return { ...original, customerApi: customerApiMock };
});

const employeeApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
}));
vi.mock('@/api/organization', async importOriginal => {
  const original = await importOriginal<typeof import('@/api/organization')>();
  return { ...original, employeeApi: employeeApiMock };
});

function caseFixture(overrides: Partial<Case> = {}): Case {
  return {
    id: 'case-1',
    version: 1,
    caseNo: 'CA2026-0001',
    title: '张三离婚纠纷',
    customerId: 'customer-1',
    contractId: null,
    lawyerId: null,
    caseType: '离婚纠纷',
    status: 'PENDING',
    priority: 'NORMAL',
    fee: '12000.00',
    description: null,
    result: null,
    satisfaction: null,
    isReferrable: false,
    closedAt: null,
    createdAt: '2026-08-01T01:00:00.000Z',
    ...overrides,
  };
}

function pageOf(list: Case[], total = list.length) {
  return { code: 200, message: 'success', data: { list, page: 1, pageSize: 10, total } };
}

function caseWithTask(overrides: Partial<Case> = {}): Case {
  return caseFixture({
    tasks: [{
      id: 'task-1',
      caseId: 'case-1',
      name: '收集材料',
      nodeType: '材料收集',
      status: 'PENDING',
      dueDate: null,
      completedAt: null,
      remark: null,
      createdAt: '2026-08-01T01:00:00.000Z',
      updatedAt: '2026-08-01T01:00:00.000Z',
    }],
    ...overrides,
  });
}

function grantPermissions(permissions: PermissionCode[]) {
  useAuthStore.setState({
    authorization: {
      userId: 'user-1',
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
  vi.spyOn(message, 'success').mockImplementation(() => undefined as never);
  vi.spyOn(message, 'error').mockImplementation(() => undefined as never);
  useAuthStore.setState({ authorization: null, authorizationStatus: 'idle' });
  customerApiMock.list.mockResolvedValue({
    code: 200, message: 'success',
    data: { list: [{ id: 'customer-1', name: '张三', customerNo: 'CU-0001' }], page: 1, pageSize: 100, total: 1 },
  });
  employeeApiMock.list.mockResolvedValue({
    code: 200, message: 'success',
    data: { list: [{ id: 'emp-1', name: '李律师', employeeNo: 'EMP-0001' }], page: 1, pageSize: 100, total: 1 },
  });
  caseApiMock.detail.mockResolvedValue({
    code: 200, message: 'success', data: caseFixture(),
  });
});

test('renders the case list with server data and customer name mapping', async () => {
  caseApiMock.list.mockResolvedValue(pageOf([caseFixture()]));
  render(<MemoryRouter><CasePage /></MemoryRouter>);

  expect(await screen.findByText('CA2026-0001')).toBeInTheDocument();
  expect(screen.getByText('张三离婚纠纷')).toBeInTheDocument();
  expect(screen.getByText('张三')).toBeInTheDocument(); // customerId → 客户名映射
  expect(screen.getByText('待受理')).toBeInTheDocument(); // PENDING 状态标签
  expect(caseApiMock.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 10 }));
});

test('shows the empty state when the server returns no cases', async () => {
  caseApiMock.list.mockResolvedValue(pageOf([]));
  render(<MemoryRouter><CasePage /></MemoryRouter>);

  expect(await screen.findByText('暂无案件')).toBeInTheDocument();
});

test('hides create/close actions without case.create/case.close permissions', async () => {
  caseApiMock.list.mockResolvedValue(pageOf([caseFixture()]));
  render(<MemoryRouter><CasePage /></MemoryRouter>);

  expect(await screen.findByText('CA2026-0001')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /新建案件/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '结案' })).not.toBeInTheDocument();
});

test('shows create and close actions with the matching permissions', async () => {
  grantPermissions(['case.create', 'case.close']);
  caseApiMock.list.mockResolvedValue(pageOf([caseFixture()]));
  render(<MemoryRouter><CasePage /></MemoryRouter>);

  expect(await screen.findByText('CA2026-0001')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /新建案件/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /结\s*案/ })).toBeInTheDocument();
});

test('create modal submits the case create mutation with normalized payload', async () => {
  grantPermissions(['case.create']);
  caseApiMock.list.mockResolvedValue(pageOf([]));
  caseApiMock.create.mockResolvedValue({ code: 200, message: 'success', data: caseFixture() });
  render(<MemoryRouter><CasePage /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: /新建案件/ }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();

  fireEvent.change(screen.getByRole('textbox', { name: '案件标题' }), { target: { value: '合同纠纷案' } });
  fireEvent.change(screen.getByRole('textbox', { name: '案由' }), { target: { value: '合同纠纷' } });
  const customerSelect = screen.getByRole('combobox', { name: '客户' });
  fireEvent.mouseDown(customerSelect);
  fireEvent.click(await screen.findByText('张三'));

  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /确\s*定/ }));

  await waitFor(() => expect(caseApiMock.create).toHaveBeenCalledWith(
    expect.objectContaining({
      title: '合同纠纷案',
      customerId: 'customer-1',
      caseType: '合同纠纷',
      priority: 'NORMAL',
    }),
  ));
});

test('close flow submits the case close mutation with result and satisfaction', async () => {
  grantPermissions(['case.create', 'case.close']);
  caseApiMock.list.mockResolvedValue(pageOf([caseFixture()]));
  caseApiMock.close.mockResolvedValue({
    code: 200, message: 'success',
    data: caseFixture({ status: 'CLOSED', result: '调解成功', satisfaction: 5, closedAt: '2026-08-05T00:00:00.000Z' }),
  });
  render(<MemoryRouter><CasePage /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: /结\s*案/ }));
  const dialog = await screen.findByRole('dialog');

  fireEvent.change(within(dialog).getByPlaceholderText('如：胜诉/调解成功/撤诉'), { target: { value: '调解成功' } });
  fireEvent.change(within(dialog).getByRole('spinbutton', { name: '满意度' }), { target: { value: '5' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /结\s*案/ }));

  await waitFor(() => expect(caseApiMock.close).toHaveBeenCalledWith(
    'case-1',
    expect.objectContaining({ result: '调解成功', satisfaction: 5 }),
  ));
});

test('renders the case file list and shows the upload button with file permissions (SPEC-042)', async () => {
  grantPermissions(['case.file.read', 'case.file.manage']);
  caseApiMock.list.mockResolvedValue(pageOf([caseFixture()]));
  caseApiMock.detail.mockResolvedValue({ code: 200, message: 'success', data: caseFixture() });
  caseApiMock.listFiles.mockResolvedValue({
    code: 200, message: 'success',
    data: { list: [{ id: 'file-1', caseId: 'case-1', fileName: '证据.txt', fileType: 'text/plain', fileSize: 2048, uploadedBy: 'user-1', createdAt: '2026-08-05T01:00:00.000Z' }], page: 1, pageSize: 50, total: 1 },
  });
  render(<MemoryRouter><CasePage /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: /详情/ }));
  expect(await screen.findByText('证据.txt')).toBeInTheDocument();
  expect(caseApiMock.listFiles).toHaveBeenCalledWith('case-1', expect.objectContaining({ page: 1 }));
  expect(screen.getByRole('button', { name: /上传/ })).toBeInTheDocument();
});

test('creates a case task from the detail drawer', async () => {
  grantPermissions(['case.task.manage']);
  caseApiMock.list.mockResolvedValue(pageOf([caseFixture()]));
  caseApiMock.detail.mockResolvedValue({ code: 200, message: 'success', data: caseFixture() });
  caseApiMock.createTask.mockResolvedValue({
    code: 200, message: 'success',
    data: { id: 'task-new', caseId: 'case-1', name: '收集证据', nodeType: '立案准备', status: 'PENDING', dueDate: null, completedAt: null, remark: null },
  });
  render(<MemoryRouter><CasePage /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: /详情/ }));
  await screen.findByText('基本信息');
  fireEvent.click(screen.getByRole('button', { name: /新建任务/ }));

  await screen.findByRole('textbox', { name: '任务名称' });
  fireEvent.change(screen.getByRole('textbox', { name: '任务名称' }), { target: { value: '收集证据' } });
  const nodeSelect = screen.getByRole('combobox', { name: '节点类型' });
  fireEvent.mouseDown(nodeSelect);
  fireEvent.click((await screen.findAllByText('立案准备'))
    .find(el => el.closest('[role="option"]'))!);
  fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));

  await waitFor(() => expect(caseApiMock.createTask).toHaveBeenCalledWith(
    'case-1',
    expect.objectContaining({ name: '收集证据', nodeType: '立案准备' }),
  ));
});

test('flips a task state through the detail drawer', async () => {
  grantPermissions(['case.task.manage']);
  caseApiMock.list.mockResolvedValue(pageOf([caseFixture()]));
  caseApiMock.detail.mockResolvedValue({ code: 200, message: 'success', data: caseWithTask() });
  caseApiMock.updateTask.mockResolvedValue({
    code: 200, message: 'success',
    data: { id: 'task-1', caseId: 'case-1', name: '收集材料', nodeType: '材料收集', status: 'IN_PROGRESS', dueDate: null, completedAt: null, remark: null },
  });
  render(<MemoryRouter><CasePage /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: /详情/ }));
  await screen.findByText('收集材料');
  fireEvent.click(screen.getByRole('button', { name: '开始办理' }));

  await waitFor(() => expect(caseApiMock.updateTask).toHaveBeenCalledWith(
    'case-1', 'task-1', { status: 'IN_PROGRESS' },
  ));
});

test('creates a communication record from the detail drawer', async () => {
  grantPermissions(['case.communication.create']);
  caseApiMock.list.mockResolvedValue(pageOf([caseFixture()]));
  caseApiMock.detail.mockResolvedValue({ code: 200, message: 'success', data: caseFixture() });
  caseApiMock.createCommunication.mockResolvedValue({
    code: 200, message: 'success',
    data: { id: 'comm-new', caseId: 'case-1', type: 'PHONE', content: '已确认开庭时间', isKey: true, createdBy: 'user-1', createdAt: '2026-08-05T00:00:00.000Z' },
  });
  render(<MemoryRouter><CasePage /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: /详情/ }));
  await screen.findByText('基本信息');
  fireEvent.click(screen.getByRole('button', { name: /新增沟通/ }));

  await screen.findByRole('textbox', { name: '沟通内容' });
  fireEvent.change(screen.getByRole('textbox', { name: '沟通内容' }), { target: { value: '已确认开庭时间' } });
  fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));

  await waitFor(() => expect(caseApiMock.createCommunication).toHaveBeenCalledWith(
    'case-1',
    expect.objectContaining({ type: 'PHONE', content: '已确认开庭时间' }),
  ));
});
