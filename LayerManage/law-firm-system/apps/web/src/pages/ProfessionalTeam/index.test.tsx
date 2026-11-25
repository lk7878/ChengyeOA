import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { masterDataApi } from '@/features/master-data/api';
import type { EmployeeListItem, OrganizationNode, ProfessionalTeamDetail } from '@/features/master-data/types';
import ProfessionalTeamPage from './index';
import { useAuthStore } from '@/stores/authStore';

vi.mock('@/features/master-data/api', () => ({ masterDataApi: {
  organizations: { options: vi.fn() }, employees: { list: vi.fn() },
  professionalTeams: { memberOptions: vi.fn(), organizationOptions: vi.fn(), list: vi.fn(), detail: vi.fn(), create: vi.fn(), update: vi.fn(), disable: vi.fn(), enable: vi.fn(), addMember: vi.fn(), endMember: vi.fn(), replaceLead: vi.fn() },
} }));

const org: OrganizationNode = { id: 'branch', code: 'BJ', name: '北京分所', type: 'BRANCH', parentId: 'root', path: '/root/branch', level: 1, sort: 0, status: 'ENABLED', version: 1, children: [] };
const employee: EmployeeListItem = { id: 'emp-1', employeeNo: 'EMP-001', name: '张律师', employeeType: 'LAWYER', status: 'FORMAL', entryDate: '2026-07-01', activeProfessionalTeamIds: [], version: 1, primaryAssignment: null };
const team: ProfessionalTeamDetail = { id: 'team-1', code: 'CRIMINAL', name: '刑事专业团队', categoryCode: 'CRIMINAL', homeOrganizationId: 'branch', description: null, status: 'ENABLED', version: 2, activeMemberCount: 1, members: [{ id: 'member-1', professionalTeamId: 'team-1', employeeId: 'emp-1', employeeName: '张律师', employeeNo: 'EMP-001', memberRole: 'LEAD', startedAt: '2026-07-01', endedAt: null, version: 1 }] };

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ hasPermission: () => true });
  vi.mocked(masterDataApi.professionalTeams.organizationOptions).mockResolvedValue({ code: 200, message: 'success', data: [org] });
  vi.mocked(masterDataApi.professionalTeams.memberOptions).mockResolvedValue({ code: 200, message: 'success', data: [employee] });
  vi.mocked(masterDataApi.organizations.options).mockResolvedValue({ code: 200, message: 'success', data: [org] });
  vi.mocked(masterDataApi.employees.list).mockResolvedValue({ code: 200, message: 'success', data: { list: [employee], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } } });
  vi.mocked(masterDataApi.professionalTeams.list).mockResolvedValue({ code: 200, message: 'success', data: { list: [team], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } } });
  vi.mocked(masterDataApi.professionalTeams.detail).mockResolvedValue({ code: 200, message: 'success', data: team });
});

test('supports an open category when creating a professional team', async () => {
  render(<ProfessionalTeamPage />);
  await screen.findByText('刑事专业团队');
  fireEvent.click(screen.getByRole('button', { name: /新增团队/ }));
  expect(await screen.findByLabelText('团队分类')).toHaveAttribute('placeholder', '例如：民商事、刑事辩护、劳动争议');
});

test('loads cross-office employees and keeps member history visible', async () => {
  render(<ProfessionalTeamPage />);
  fireEvent.click(await screen.findByRole('button', { name: '查看刑事专业团队' }));
  expect(await screen.findByText('张律师 · EMP-001')).toBeInTheDocument();
  expect(screen.getByText('负责人')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /添加成员/ }));
  await waitFor(() => expect(masterDataApi.professionalTeams.memberOptions).toHaveBeenCalledWith('team-1', undefined, false));
  expect(await screen.findByLabelText('员工')).toBeInTheDocument();
});


test('team leaders load teams without employee or organization administration access', async () => {
  useAuthStore.setState({ hasPermission: permission => ['professional_team.read', 'professional_team.member.manage'].includes(permission) });
  vi.mocked(masterDataApi.employees.list).mockRejectedValue(new Error('Forbidden'));
  vi.mocked(masterDataApi.organizations.options).mockRejectedValue(new Error('Forbidden'));
  render(<ProfessionalTeamPage />);
  fireEvent.click(await screen.findByRole('button', { name: '查看刑事专业团队' }));
  expect(await screen.findByText('张律师 · EMP-001')).toBeInTheDocument();
  expect(screen.queryByText('专业团队数据加载失败')).not.toBeInTheDocument();
  expect(masterDataApi.employees.list).not.toHaveBeenCalled();
  expect(masterDataApi.organizations.options).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /新增团队/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '更换负责人' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '添加成员' }));
  expect(await screen.findByLabelText('员工')).toBeInTheDocument();
  expect(masterDataApi.professionalTeams.memberOptions).toHaveBeenCalledWith('team-1', undefined, false);
});
