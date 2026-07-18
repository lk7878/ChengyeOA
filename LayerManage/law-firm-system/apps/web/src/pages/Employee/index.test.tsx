import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { masterDataApi } from '@/features/master-data/api';
import { userApi } from '@/api/user';
import type { EmployeeDetail, OrganizationNode, Position } from '@/features/master-data/types';
import EmployeePage from './index';

vi.mock('@/features/master-data/api', () => ({ masterDataApi: {
  organizations: { tree: vi.fn() }, positions: { list: vi.fn() },
  employees: { list: vi.fn(), detail: vi.fn(), create: vi.fn(), update: vi.fn(), formalize: vi.fn(), leave: vi.fn(), transferPrimary: vi.fn(), addAssignment: vi.fn(), endAssignment: vi.fn(), bindAccount: vi.fn(), unbindAccount: vi.fn() },
  professionalTeams: { list: vi.fn() },
} }));
vi.mock('@/api/user', () => ({ userApi: { list: vi.fn() } }));

const organization: OrganizationNode = { id: 'branch', code: 'BJ', name: '北京分所', type: 'BRANCH', parentId: 'root', path: '/root/branch', level: 1, sort: 0, status: 'ENABLED', version: 1, children: [] };
const position: Position = { id: 'lawyer', organizationId: 'branch', code: 'LAWYER', name: '律师', categoryCode: 'LAWYER', level: 1, responsibilities: null, status: 'ENABLED', version: 1, activeAssignmentCount: 1 };
const detail: EmployeeDetail = { id: 'emp-1', employeeNo: 'EMP-001', name: '张律师', employeeType: 'LAWYER', status: 'PROBATION', entryDate: '2026-07-01', activeProfessionalTeamIds: [], version: 2, primaryAssignment: { id: 'assignment-1', employeeId: 'emp-1', organizationId: 'branch', positionId: 'lawyer', assignmentType: 'PRIMARY', startedAt: '2026-07-01', endedAt: null, version: 1 }, phone: '13800000000', email: null, idCard: null, licenseNo: null, professionalDirections: ['CIVIL'], formalDate: null, leaveDate: null, assignments: [], professionalTeams: [], account: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(masterDataApi.organizations.tree).mockResolvedValue({ code: 200, message: 'success', data: [organization] });
  vi.mocked(masterDataApi.positions.list).mockResolvedValue({ code: 200, message: 'success', data: [position] });
  vi.mocked(masterDataApi.professionalTeams.list).mockResolvedValue({ code: 200, message: 'success', data: { list: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } } });
  vi.mocked(masterDataApi.employees.list).mockResolvedValue({ code: 200, message: 'success', data: { list: [detail], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } } });
  vi.mocked(masterDataApi.employees.detail).mockResolvedValue({ code: 200, message: 'success', data: detail });
  vi.mocked(userApi.list).mockResolvedValue({ code: 200, message: 'success', data: { list: [{ id: 'user-1', username: 'zhang', status: 'ENABLED', createdAt: '2026-07-01' }], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } } });
});

test('filters the employee page and loads organization-driven positions when creating', async () => {
  render(<EmployeePage />);
  expect(await screen.findByText('张律师')).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('姓名或工号'), { target: { value: 'EMP-001' } });
  fireEvent.click(screen.getByRole('button', { name: /查\s*询/ }));
  await waitFor(() => expect(masterDataApi.employees.list).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: 'EMP-001', page: 1 })));
  fireEvent.click(screen.getByRole('button', { name: /新增员工/ }));
  fireEvent.mouseDown(screen.getByLabelText('主组织'));
  fireEvent.click((await screen.findAllByText('北京分所')).at(-1)!);
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
