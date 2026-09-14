import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import CustomerListPage from '@/pages/customers/CustomerListPage';
import { clearCaseDraft } from '../case-draft';
import { useCustomerStore } from '@/stores/customer-store';
import { message } from 'antd';
import { beforeEach, expect, test, vi } from 'vitest';
import CasePage from '../index';
import { useAuthStore } from '@/stores/authStore';
import type { Case } from '@/types';
import type { PermissionCode } from '@/features/authorization/types';
import { ATTACHMENT_CATEGORIES, INTAKE_FIELDS } from '../intake-contract';

const caseApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
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
  clearCaseDraft();
  useCustomerStore.getState().reset();
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

test('customer creation displays a required phone and refuses an empty phone', async () => {
  grantPermissions(['customer.create']);
  render(<MemoryRouter><CustomerListPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: /新建客户/ }));
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '必填测试客户' } });
  expect(screen.getByLabelText('电话')).toHaveAttribute('aria-required', 'true');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /OK|确\s*定/ }));
  expect(await screen.findByText('请输入客户电话')).toBeInTheDocument();
  expect(customerApiMock.create).not.toHaveBeenCalled();
});

test('the case table includes every intake column, attachment category and system timestamp', async () => {
  caseApiMock.list.mockResolvedValue(pageOf([caseFixture({ customerName: '完整客户名称', lawyerName: '完整律师名称', intakeData: { contractNumber: '完整合同编号', riskAgencyRatio: '12.50' } })]));
  render(<MemoryRouter><CasePage /></MemoryRouter>);
  expect(await screen.findByText('完整客户名称')).toBeInTheDocument();
  const headings = screen.getAllByRole('columnheader');
  for (const label of [...INTAKE_FIELDS.map(field => field[1]), ...ATTACHMENT_CATEGORIES, '费用', '案情描述', '记录创建时间', '最近修改时间']) expect(headings.some(header => within(header).queryByText(label, { exact: true }))).toBe(true);
  expect(screen.getByText('12.50%')).toBeInTheDocument();
  expect(screen.getByText('完整合同编号')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /修\s*改|删\s*除/ })).not.toBeInTheDocument();
});

test('editing restores intake and files, saves clears with the version, and removes attachments only on save', async () => {
  grantPermissions(['case.update', 'case.file.read', 'case.file.manage']);
  const row = caseFixture({ lawyerId: 'emp-1', version: 7, fee: '9999999999999999.99', intakeData: { signedDate: '2026-09-14', fixedAgencyFee: '123.45' }, files: [{ id: 'contract-file', caseId: 'case-1', fileName: '原合同.pdf', category: '合同附件', fileType: 'application/pdf', fileSize: 8, uploadedBy: 'user-1', createdAt: '2026-09-14T00:00:00Z' }] });
  caseApiMock.list.mockResolvedValue(pageOf([row]));
  caseApiMock.detail.mockResolvedValue({ data: row });
  caseApiMock.update.mockResolvedValue({ data: { ...row, version: 8 } });
  render(<MemoryRouter><CasePage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: /修\s*改/ }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('修改案件')).toBeInTheDocument();
  expect(within(dialog).getByDisplayValue('2026-09-14')).toBeInTheDocument();
  expect(within(dialog).getByRole('spinbutton', { name: '费用' })).toHaveValue('9999999999999999.99');
  fireEvent.change(within(dialog).getByRole('textbox', { name: '案件标题' }), { target: { value: '修改后的标题' } });
  fireEvent.change(within(dialog).getByRole('spinbutton', { name: '固定代理费金额' }), { target: { value: '' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'delete' }));
  expect(caseApiMock.removeFile).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(caseApiMock.update).toHaveBeenCalledWith('case-1', expect.objectContaining({ version: 7, title: '修改后的标题', fee: '9999999999999999.99', intakeData: { signedDate: '2026-09-14' }, removeAttachmentIds: ['contract-file'] })));
  expect(caseApiMock.create).not.toHaveBeenCalled();
});

test('cancelling an edit does not persist it and confirmed deletion carries the selected version', async () => {
  grantPermissions(['case.update', 'case.delete']);
  const row = caseFixture({ lawyerId: 'emp-1', version: 4 });
  caseApiMock.list.mockResolvedValue(pageOf([row]));
  caseApiMock.detail.mockResolvedValue({ data: row });
  caseApiMock.remove.mockResolvedValue({ data: { id: row.id } });
  render(<MemoryRouter><CasePage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: /修\s*改/ }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('修改案件')).toBeInTheDocument();
  fireEvent.change(within(dialog).getByRole('textbox', { name: '案件标题' }), { target: { value: '取消的修改' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /取\s*消|Cancel/ }));
  expect(caseApiMock.update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /删\s*除/ }));
  const confirmation = await screen.findByText('删除案件 CA2026-0001？');
  expect(caseApiMock.remove).not.toHaveBeenCalled();
  fireEvent.click(within(confirmation.closest('.ant-popover') as HTMLElement).getByRole('button', { name: /删\s*除/ }));
  await waitFor(() => expect(caseApiMock.remove).toHaveBeenCalledWith('case-1', 4));
});

test('search passes the keyword and reset removes it from the next server query', async () => {
  caseApiMock.list.mockResolvedValue(pageOf([]));
  render(<MemoryRouter><CasePage /></MemoryRouter>);
  await waitFor(() => expect(caseApiMock.list).toHaveBeenCalled());
  fireEvent.change(screen.getByRole('textbox', { name: '案件关键词' }), { target: { value: ' HT-2026 ' } });
  fireEvent.click(screen.getByRole('button', { name: /搜\s*索/ }));
  await waitFor(() => expect(caseApiMock.list).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: 'HT-2026' })));
  fireEvent.click(screen.getByRole('button', { name: /重\s*置/ }));
  await waitFor(() => expect(caseApiMock.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 10 }));
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
  grantPermissions(['case.create', 'case.file.manage']);
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

  fireEvent.mouseDown(screen.getByRole('combobox', { name: '主办律师' }));
  fireEvent.click(await screen.findByText('李律师'));
  fireEvent.change(screen.getByRole('spinbutton', { name: '固定代理费金额' }), { target: { value: '1234.50' } });
  fireEvent.change(screen.getByRole('textbox', { name: '合同编号' }), { target: { value: 'HT-TEST-01' } });
  const uploadInput = screen.getByRole('dialog').querySelector('input[type="file"]')!;
  fireEvent.change(uploadInput, { target: { files: [new File(['contract'], '合同.pdf', { type: 'application/pdf' })] } });
  expect(await screen.findByText('合同.pdf')).toBeInTheDocument();

  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /确\s*定/ }));

  await waitFor(() => expect(caseApiMock.create).toHaveBeenCalledWith(
    expect.objectContaining({
      title: '合同纠纷案',
      customerId: 'customer-1',
      lawyerId: 'emp-1',
      caseType: '合同纠纷',
      priority: 'NORMAL',
      intakeData: expect.objectContaining({ fixedAgencyFee: '1234.5', contractNumber: 'HT-TEST-01' }),
      attachments: [{ category: '合同附件', fileName: '合同.pdf', fileType: 'application/pdf', base64: btoa('contract') }],
    }),
  ));
});

test('requires both customer and lead lawyer before creating a case', async () => {
  grantPermissions(['case.create']);
  caseApiMock.list.mockResolvedValue(pageOf([]));
  render(<MemoryRouter><CasePage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: /新建案件/ }));
  fireEvent.change(screen.getByRole('textbox', { name: '案件标题' }), { target: { value: '案件' } });
  fireEvent.change(screen.getByRole('textbox', { name: '案由' }), { target: { value: '合同纠纷' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /确\s*定/ }));
  expect(await screen.findByText('请选择客户')).toBeInTheDocument();
  expect(await screen.findByText('请选择主办律师', { selector: '.ant-form-item-explain-error' })).toBeInTheDocument();
  expect(caseApiMock.create).not.toHaveBeenCalled();
});

function FinanceLocation() { const location = useLocation(); return <p>财务页面{location.search}</p>; }
test('related finance navigates within the router with the encoded case number and preserves authentication', async () => {
  caseApiMock.list.mockResolvedValue(pageOf([caseFixture()]));
  useAuthStore.setState({ isAuthenticated: true });
  render(<MemoryRouter initialEntries={['/cases']}><Routes><Route path="/cases" element={<CasePage />} /><Route path="/finance" element={<FinanceLocation />} /></Routes></MemoryRouter>);
  fireEvent.click(await screen.findByRole('link', { name: '关联财务' }));
  expect(await screen.findByText('财务页面?caseNo=CA2026-0001')).toBeInTheDocument();
  expect(useAuthStore.getState().isAuthenticated).toBe(true);
});

test('new customer round trip saves to customer management and restores the unsaved case', async () => {
  grantPermissions(['case.create', 'customer.create', 'menu.customer']);
  caseApiMock.list.mockResolvedValue(pageOf([]));
  customerApiMock.create.mockResolvedValue({ data: { id: 'new-customer', name: '新增测试客户', customerNo: 'CU-NEW' } });
  render(<MemoryRouter initialEntries={['/cases']}><Routes><Route path="/cases" element={<CasePage />} /><Route path="/customers" element={<CustomerListPage />} /></Routes></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: /新建案件/ }));
  fireEvent.change(screen.getByRole('textbox', { name: '案件标题' }), { target: { value: '保留的案件草稿' } });
  fireEvent.change(screen.getByRole('combobox', { name: '客户' }), { target: { value: '新增测试客户' } });
  fireEvent.click(await screen.findByRole('button', { name: '新建客户：新增测试客户' }));
  expect(await screen.findByDisplayValue('新增测试客户')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('电话'), { target: { value: '13800000003' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /OK|确\s*定/ }));
  expect(await screen.findByDisplayValue('保留的案件草稿')).toBeInTheDocument();
  expect(customerApiMock.create).toHaveBeenCalledWith(expect.objectContaining({ name: '新增测试客户' }));
  expect(screen.getByText('新增测试客户')).toBeInTheDocument();
  expect(caseApiMock.create).not.toHaveBeenCalled();
});

test('cancelling customer creation returns to the case draft', async () => {
  grantPermissions(['case.create', 'customer.create', 'menu.customer']);
  caseApiMock.list.mockResolvedValue(pageOf([]));
  render(<MemoryRouter initialEntries={['/cases']}><Routes><Route path="/cases" element={<CasePage />} /><Route path="/customers" element={<CustomerListPage />} /></Routes></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: /新建案件/ }));
  fireEvent.change(screen.getByRole('textbox', { name: '案件标题' }), { target: { value: '取消后保留' } });
  fireEvent.change(screen.getByRole('combobox', { name: '客户' }), { target: { value: '待新建' } });
  fireEvent.click(await screen.findByRole('button', { name: '新建客户：待新建' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Cancel|取\s*消/ }));
  expect(await screen.findByDisplayValue('取消后保留')).toBeInTheDocument();
  expect(customerApiMock.create).not.toHaveBeenCalled();
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
