import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { masterDataApi } from '@/features/master-data/api';
import { userApi } from '@/api/user';
import { useAuthStore } from '@/stores/authStore';
import type { EmployeeDetail, OrganizationNode, Position } from '@/features/master-data/types';
import EmployeePage from './index';

vi.mock('@/features/master-data/api', () => ({ masterDataApi: {
  organizations: { options: vi.fn() }, positions: { list: vi.fn() },
  employees: { offboarding: vi.fn(), suspendAccount: vi.fn(), list: vi.fn(), detail: vi.fn(), create: vi.fn(), update: vi.fn(), formalize: vi.fn(), leave: vi.fn(), transferPrimary: vi.fn(), addAssignment: vi.fn(), endAssignment: vi.fn(), bindAccount: vi.fn(), unbindAccount: vi.fn(), remove: vi.fn() },
  professionalTeams: { list: vi.fn() },
} }));
vi.mock('@/api/user', () => ({ userApi: { list: vi.fn() } }));

const organization: OrganizationNode = { id: 'branch', code: 'BJ', name: '北京分所', type: 'BRANCH', parentId: 'root', path: '/root/branch', level: 1, sort: 0, status: 'ENABLED', version: 1, children: [] };
const position: Position = { id: 'lawyer', organizationId: 'branch', code: 'LAWYER', name: '律师', categoryCode: 'LAWYER', level: 1, responsibilities: null, status: 'ENABLED', version: 1, activeAssignmentCount: 1 };
const detail: EmployeeDetail = { id: 'emp-1', employeeNo: 'EMP-001', name: '张律师', employeeType: 'LAWYER', status: 'PROBATION', entryDate: '2026-07-01', activeProfessionalTeamIds: [], version: 2, primaryAssignment: { id: 'assignment-1', employeeId: 'emp-1', organizationId: 'branch', positionId: 'lawyer', assignmentType: 'PRIMARY', startedAt: '2026-07-01', endedAt: null, version: 1 }, phone: '13800000000', email: null, licenseNo: null, professionalDirections: ['CIVIL'], formalDate: null, leaveDate: null, assignments: [], professionalTeams: [], account: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(masterDataApi.employees.offboarding).mockResolvedValue({ code: 200, message: 'success', data: { account: null, counts: {}, resources: {}, suggestedRecipient: null, recipientHint: '请选择接收人', blockers: { cases: [], leads: [], subordinates: [], organizations: [], teams: [] } } });
  useAuthStore.setState({
    isAuthenticated: true,
    authorizationStatus: 'ready',
    authorization: {
      userId: 'user-1', employeeId: 'emp-1', isSystemSuperAdmin: false, isSystemAdmin: false,
      permissions: ['organization.read', 'position.read', 'professional_team.read', 'user.read', 'employee.high_sensitive.read'],
      menus: [], fieldCapabilities: {}, validUntil: null, evaluatedAt: '2026-07-19T00:00:00.000Z',
    },
  });
  vi.mocked(masterDataApi.organizations.options).mockResolvedValue({ code: 200, message: 'success', data: [organization] });
  vi.mocked(masterDataApi.positions.list).mockResolvedValue({ code: 200, message: 'success', data: [position] });
  vi.mocked(masterDataApi.professionalTeams.list).mockResolvedValue({ code: 200, message: 'success', data: { list: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } } });
  vi.mocked(masterDataApi.employees.list).mockResolvedValue({ code: 200, message: 'success', data: { list: [detail], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } } });
  vi.mocked(masterDataApi.employees.detail).mockResolvedValue({ code: 200, message: 'success', data: detail });
  vi.mocked(userApi.list).mockResolvedValue({ code: 200, message: 'success', data: { list: [{ id: 'user-1', username: 'zhang', status: 'ENABLED', createdAt: '2026-07-01' }], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } } });
});

test('filters the employee page and loads organization-driven positions when creating', async () => {
  const root: OrganizationNode = { ...organization, id: 'root', name: '重庆承业律师事务所', type: 'FIRM', parentId: null, children: [organization] };
  vi.mocked(masterDataApi.organizations.options).mockResolvedValue({ code: 200, message: 'success', data: [root] });
  render(<EmployeePage />);
  expect(await screen.findByText('张律师')).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('姓名或工号'), { target: { value: 'EMP-001' } });
  fireEvent.click(screen.getByRole('button', { name: /查\s*询/ }));
  await waitFor(() => expect(masterDataApi.employees.list).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: 'EMP-001', page: 1 })));
  fireEvent.click(screen.getByRole('button', { name: /新增员工/ }));
  fireEvent.mouseDown(screen.getByLabelText('主组织'));
  fireEvent.change(screen.getByLabelText('主组织'), { target: { value: '北京分所' } });
  fireEvent.click(await screen.findByText('重庆承业律师事务所/北京分所', { selector: '.ant-select-item-option-content' }));
  await waitFor(() => expect(masterDataApi.positions.list).toHaveBeenCalledWith({ organizationId: 'branch', status: 'ENABLED' }));
  expect(screen.getByLabelText('主岗位')).toBeEnabled();
});

test('opens employee details and exposes protected lifecycle commands', async () => {
  render(<EmployeePage />);
  fireEvent.click(await screen.findByRole('button', { name: '查看张律师' }));
  await waitFor(() => expect(masterDataApi.employees.detail).toHaveBeenCalledWith('emp-1'));
  expect((await screen.findAllByText('基础档案')).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: /转\s*正/ }));
  expect(screen.getByLabelText('转正日期')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: '办理离职' }));
  expect(screen.getByText('确认交接完成后才能提交离职')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'OK' }).some(button => button.hasAttribute('disabled'))).toBe(true);
});

test('unbinds the selected account using the current employee version', async () => {
  vi.mocked(masterDataApi.employees.detail).mockResolvedValue({ code: 200, message: 'success', data: { ...detail, account: { id: 'bound-user', username: 'bound', status: 'DISABLED' } } });
  render(<EmployeePage />);
  fireEvent.click(await screen.findByRole('button', { name: '查看张律师' }));
  fireEvent.click(await screen.findByRole('tab', { name: '账号绑定' }));
  fireEvent.click(await screen.findByRole('button', { name: '解除绑定' }));
  await waitFor(() => expect(masterDataApi.employees.unbindAccount).toHaveBeenCalledWith('emp-1', { employeeVersion: 2 }));
});

test('keeps scoped employees visible when auxiliary catalogs are forbidden', async () => {
  const forbidden = { response: { status: 403 } };
  vi.mocked(masterDataApi.organizations.options).mockRejectedValueOnce(forbidden);
  vi.mocked(masterDataApi.professionalTeams.list).mockRejectedValueOnce(forbidden);
  vi.mocked(masterDataApi.positions.list).mockRejectedValue(forbidden);
  vi.mocked(userApi.list).mockRejectedValueOnce(forbidden);

  render(<EmployeePage />);

  expect(await screen.findByText('张律师')).toBeInTheDocument();
  expect(screen.queryByText('您没有权限查看人员主数据')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '查看张律师' }));
  expect(await screen.findByText('张律师 · EMP-001')).toBeInTheDocument();
});

test('employee list and assignment detail show the full path to the actual primary organization', async () => {
  const team: OrganizationNode = { ...organization, id: 'team', name: '民商事组', type: 'GROUP', parentId: 'department', children: [] };
  const department: OrganizationNode = { ...organization, id: 'department', name: '律师部', type: 'DEPARTMENT', parentId: 'root', children: [team] };
  const root: OrganizationNode = { ...organization, id: 'root', name: '重庆承业律师事务所', type: 'FIRM', parentId: null, children: [department] };
  const assignment = { ...detail.primaryAssignment!, organizationId: 'department' };
  const employee = { ...detail, employeeType: 'SENIOR_LAWYER', primaryAssignment: assignment, assignments: [assignment] };
  vi.mocked(masterDataApi.organizations.options).mockResolvedValue({ code: 200, message: 'success', data: [root] });
  vi.mocked(masterDataApi.employees.list).mockResolvedValue({ code: 200, message: 'success', data: { list: [employee], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } } });
  vi.mocked(masterDataApi.employees.detail).mockResolvedValue({ code: 200, message: 'success', data: employee });
  render(<EmployeePage />);
  const path = '重庆承业律师事务所/律师部';
  expect(await screen.findByText(path)).toHaveAttribute('title', path);
  expect(screen.getByText('资深律师')).toBeInTheDocument();
  expect(screen.queryByText(`${path}/民商事组`)).not.toBeInTheDocument();
  expect(screen.queryByText('SENIOR_LAWYER')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '查看张律师' }));
  const drawer = await screen.findByRole('dialog');
  expect(within(drawer).getByText('资深律师')).toBeInTheDocument();
  fireEvent.click(within(drawer).getByRole('tab', { name: '任职关系' }));
  expect(within(drawer).getByText(path)).toBeInTheDocument();
});

test('Chinese type selection submits its original code when editing an employee', async () => {
  vi.mocked(masterDataApi.employees.update).mockResolvedValue({ code: 200, message: 'success', data: detail });
  render(<EmployeePage />);
  fireEvent.click(await screen.findByRole('button', { name: '查看张律师' }));
  fireEvent.click(await screen.findByRole('button', { name: '编辑档案' }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '人员类型' }));
  fireEvent.click(await screen.findByText('资深律师', { selector: '.ant-select-item-option-content' }));
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(masterDataApi.employees.update).toHaveBeenCalledWith('emp-1', expect.objectContaining({ employeeType: 'SENIOR_LAWYER', version: 2 })));
});

test('only a super-admin can confirm employee deletion and the interface explains account and history effects', async () => {
  useAuthStore.setState({ authorization: { ...useAuthStore.getState().authorization!, isSystemSuperAdmin: true } });
  vi.mocked(masterDataApi.employees.remove).mockResolvedValue({ code: 200, message: 'success', data: null });
  render(<EmployeePage />);
  fireEvent.click(await screen.findByRole('button', { name: '删除张律师' }));
  expect(masterDataApi.employees.remove).not.toHaveBeenCalled();
  expect(screen.getByText(/绑定账号会停用/)).toHaveTextContent('历史业务记录仍保留并关联原员工');
  vi.mocked(masterDataApi.employees.list).mockResolvedValue({ code: 200, message: 'success', data: { list: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } });
  await waitFor(() => expect(screen.getByRole('button', { name: '确认删除' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(masterDataApi.employees.remove).toHaveBeenCalledWith('emp-1', expect.objectContaining({ version: 2, confirmed: true })));
  await waitFor(() => expect(screen.queryByRole('button', { name: '查看张律师' })).not.toBeInTheDocument());
});

test('ordinary employee-management access does not expose employee deletion', async () => {
  render(<EmployeePage />);
  await screen.findByText('张律师');
  expect(screen.queryByRole('button', { name: '删除张律师' })).not.toBeInTheDocument();
});

test('handover checklist displays the exact blocking case and prevents deletion', async () => {
  useAuthStore.setState({ authorization: { ...useAuthStore.getState().authorization!, isSystemSuperAdmin: true } });
  vi.mocked(masterDataApi.employees.offboarding).mockResolvedValue({ code: 200, message: 'success', data: {
    account: null, counts: { cases: 1 }, resources: {}, suggestedRecipient: null, recipientHint: '请选择接收人',
    blockers: { cases: [{ id: 'case-1', caseNo: 'CA-001', title: '待移交案件', status: 'PENDING' }], leads: [], subordinates: [], organizations: [], teams: [] },
  } });
  render(<EmployeePage />);
  fireEvent.click(await screen.findByRole('button', { name: '删除张律师' }));
  expect(await screen.findByRole('link', { name: /CA-001.*待移交案件.*待处理/ })).toHaveAttribute('href', '/cases/case-1');
  expect(screen.getByRole('button', { name: '确认删除' })).toBeDisabled();
  expect(masterDataApi.employees.remove).not.toHaveBeenCalled();
});

test('offboarding pauses the account before allowing departure and defaults the material recipient to the department manager', async () => {
  useAuthStore.setState({ authorization: { ...useAuthStore.getState().authorization!, isSystemSuperAdmin: true } });
  const overview = { account: { id: 'departing-user', username: 'zhang', status: 'ENABLED' }, counts: {}, resources: { documents: 1 },
    suggestedRecipient: { userId: 'manager-user', employeeId: 'manager', name: '部门负责人', username: 'manager', organizationName: '北京分所' }, recipientHint: '已默认选择主职部门负责人，请确认接收人。',
    blockers: { cases: [], leads: [], subordinates: [], organizations: [], teams: [] },
  };
  vi.mocked(masterDataApi.employees.offboarding).mockResolvedValueOnce({ code: 200, message: 'success', data: overview })
    .mockResolvedValue({ code: 200, message: 'success', data: { ...overview, account: { ...overview.account, status: 'DISABLED' } } });
  vi.mocked(masterDataApi.employees.suspendAccount).mockResolvedValue({ code: 200, message: 'success', data: { ...detail, version: 3 } });
  render(<EmployeePage />);
  fireEvent.click(await screen.findByRole('button', { name: '删除张律师' }));
  await screen.findByText('已默认选择主职部门负责人，请确认接收人。');
  expect(screen.getByRole('button', { name: '登记离职完成' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '确认删除' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '暂停账号使用' }));
  await waitFor(() => expect(masterDataApi.employees.suspendAccount).toHaveBeenCalledWith('emp-1', { version: 2, confirmed: true }));
  await screen.findByText('账号：zhang（已暂停）');
  fireEvent.click(screen.getByRole('checkbox', { name: '我已核实离职手续及交接事项完成' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '登记离职完成' })).toBeEnabled());
  expect(masterDataApi.employees.remove).not.toHaveBeenCalled();
});

test('blocked deletion retains the employee and displays the Chinese handover reason', async () => {
  useAuthStore.setState({ authorization: { ...useAuthStore.getState().authorization!, isSystemSuperAdmin: true } });
  vi.mocked(masterDataApi.employees.remove).mockRejectedValue(new Error('EMPLOYEE_DELETE_IN_USE'));
  render(<EmployeePage />);
  fireEvent.click(await screen.findByRole('button', { name: '删除张律师' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '确认删除' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  expect(await screen.findByText(/该员工仍有未结案件/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '查看张律师' })).toBeInTheDocument();
});
