import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { masterDataApi } from '@/features/master-data/api';
import type { EmployeeListItem, OrganizationNode, ProfessionalTeamDetail } from '@/features/master-data/types';
import ProfessionalTeamPage from './index';

vi.mock('@/features/master-data/api', () => ({ masterDataApi: {
  organizations: { options: vi.fn() }, employees: { list: vi.fn() },
  professionalTeams: { list: vi.fn(), detail: vi.fn(), create: vi.fn(), update: vi.fn(), disable: vi.fn(), enable: vi.fn(), addMember: vi.fn(), endMember: vi.fn(), replaceLead: vi.fn() },
} }));

const org: OrganizationNode = { id: 'branch', code: 'BJ', name: '北京分所', type: 'BRANCH', parentId: 'root', path: '/root/branch', level: 1, sort: 0, status: 'ENABLED', version: 1, children: [] };
const employee: EmployeeListItem = { id: 'emp-1', employeeNo: 'EMP-001', name: '张律师', employeeType: 'LAWYER', status: 'FORMAL', entryDate: '2026-07-01', activeProfessionalTeamIds: [], version: 1, primaryAssignment: null };
const team: ProfessionalTeamDetail = { id: 'team-1', code: 'CRIMINAL', name: '刑事专业团队', categoryCode: 'CRIMINAL', homeOrganizationId: 'branch', description: null, status: 'ENABLED', version: 2, activeMemberCount: 1, members: [{ id: 'member-1', professionalTeamId: 'team-1', employeeId: 'emp-1', memberRole: 'LEAD', startedAt: '2026-07-01', endedAt: null, version: 1 }] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(masterDataApi.organizations.options).mockResolvedValue({ code: 200, message: 'success', data: [org] });
  vi.mocked(masterDataApi.employees.list).mockResolvedValue({ code: 200, message: 'success', data: { list: [employee], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } } });
  vi.mocked(masterDataApi.professionalTeams.list).mockResolvedValue({ code: 200, message: 'success', data: { list: [team], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } } });
  vi.mocked(masterDataApi.professionalTeams.detail).mockResolvedValue({ code: 200, message: 'success', data: team });
});

test('supports an open category when creating a professional team', async () => {
  render(<ProfessionalTeamPage />);
  await screen.findByText('刑事专业团队');
  fireEvent.click(screen.getByRole('button', { name: /新增团队/ }));
  expect(screen.getByLabelText('团队分类')).toHaveAttribute('placeholder', '例如：民商事、刑事辩护、劳动争议');
});

test('loads cross-office employees and keeps member history visible', async () => {
  render(<ProfessionalTeamPage />);
  fireEvent.click(await screen.findByRole('button', { name: '查看刑事专业团队' }));
  expect(await screen.findByText('张律师')).toBeInTheDocument();
  expect(screen.getByText('负责人')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /添加成员/ }));
  await waitFor(() => expect(masterDataApi.employees.list).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 100 })));
  expect(screen.getByLabelText('员工')).toBeInTheDocument();
});
