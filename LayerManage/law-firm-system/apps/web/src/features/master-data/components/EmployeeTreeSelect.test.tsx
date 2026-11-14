import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import EmployeeTreeSelect from './EmployeeTreeSelect';
import { masterDataApi } from '../api';
import type { EmployeeListItem, OrganizationNode } from '../types';

vi.mock('../api', () => ({
  masterDataApi: {
    organizations: { tree: vi.fn() },
    employees: { list: vi.fn() },
  },
}));

const tree = masterDataApi.organizations.tree as unknown as ReturnType<typeof vi.fn>;
const list = masterDataApi.employees.list as unknown as ReturnType<typeof vi.fn>;

const orgs: OrganizationNode[] = [
  { id: 'root', code: 'FIRM', name: '总所', type: 'FIRM', parentId: null, path: '/root', level: 0, sort: 1, status: 'ENABLED', version: 1, children: [
    { id: 'dept', code: 'DEPT', name: '医疗部', type: 'DEPARTMENT', parentId: 'root', path: '/root/dept', level: 1, sort: 1, status: 'ENABLED', version: 1, children: [] },
  ] },
];

const staff: EmployeeListItem[] = [
  { id: 'e1', employeeNo: '0333', name: '张三', employeeType: 'LAWYER', status: 'FORMAL', entryDate: '2026-01-01', activeProfessionalTeamIds: [], version: 3, primaryAssignment: { id: 'a1', employeeId: 'e1', organizationId: 'dept', positionId: 'p1', assignmentType: 'PRIMARY', startedAt: '2026-01-01', endedAt: null, version: 1 } },
  { id: 'e2', employeeNo: '0444', name: '李四', employeeType: 'ASSISTANT', status: 'LEAVED', entryDate: '2025-01-01', activeProfessionalTeamIds: [], version: 2, primaryAssignment: { id: 'a2', employeeId: 'e2', organizationId: 'dept', positionId: 'p2', assignmentType: 'PRIMARY', startedAt: '2025-01-01', endedAt: '2026-01-01', version: 1 } },
];

beforeEach(() => { tree.mockReset(); list.mockReset(); });

test('builds an organization-employee tree and reports the selected employee', async () => {
  tree.mockResolvedValue({ code: 200, message: 'success', data: orgs });
  list.mockResolvedValue({ code: 200, message: 'success', data: { list: staff, pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 } } });
  const onChange = vi.fn();
  render(<EmployeeTreeSelect onChange={onChange} />);
  fireEvent.mouseDown(screen.getByRole('combobox'));
  const option = await screen.findByText('0333 · 张三');
  expect(option).toBeTruthy();
  const leaved = screen.getByText('0444 · 李四（已离职）');
  expect(leaved).toBeTruthy();
  fireEvent.click(option);
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ id: 'e1', employeeNo: '0333', name: '张三', version: 3 }));
});
