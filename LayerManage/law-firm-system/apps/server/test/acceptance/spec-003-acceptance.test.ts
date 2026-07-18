import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { EmployeeService } from '../../app/application/master-data/employee-service';
import { OrganizationService } from '../../app/application/master-data/organization-service';
import { assertTestDatabaseUrl, clearTestApplicationData } from '../helpers/test-database';

let queryCount = 0;
const prisma = new PrismaClient({
  datasources: { db: { url: assertTestDatabaseUrl().toString() } },
  log: [{ emit: 'event', level: 'query' }],
});
prisma.$on('query', () => { queryCount += 1; });

test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  queryCount = 0;
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

test('loads a 500-node multi-office hierarchy with one bounded query', async () => {
  const organizations: Prisma.OrganizationCreateManyInput[] = [
    { id: 'root', code: 'ROOT', name: 'Root Firm', type: 'FIRM', path: '/root', level: 0 },
    { id: 'branch-a', code: 'BRANCH_A', name: 'Branch A', type: 'BRANCH', parentId: 'root', path: '/root/branch-a', level: 1 },
    { id: 'branch-b', code: 'BRANCH_B', name: 'Branch B', type: 'BRANCH', parentId: 'root', path: '/root/branch-b', level: 1 },
    { id: 'research', code: 'RESEARCH', name: 'Research', type: 'HQ_CENTER', parentId: 'root', path: '/root/research', level: 1 },
    { id: 'training', code: 'TRAINING', name: 'Training', type: 'HQ_CENTER', parentId: 'root', path: '/root/training', level: 1 },
    { id: 'brand', code: 'BRAND', name: 'Brand', type: 'HQ_CENTER', parentId: 'root', path: '/root/brand', level: 1 },
  ];
  for (let index = 0; index < 494; index += 1) {
    const id = `group-${String(index).padStart(3, '0')}`;
    const parentId = index === 0 ? 'research' : `group-${String(index - 1).padStart(3, '0')}`;
    const parentPath = organizations.find(item => item.id === parentId)?.path ?? '';
    const parentLevel = organizations.find(item => item.id === parentId)?.level ?? 0;
    organizations.push({ id, code: `GROUP_${String(index).padStart(3, '0')}`, name: `Group ${index}`, type: 'GROUP', parentId, path: `${parentPath}/${id}`, level: parentLevel + 1 });
  }
  await prisma.organization.createMany({ data: organizations });

  queryCount = 0;
  const startedAt = performance.now();
  const tree = await new OrganizationService(prisma, { actorUserId: 'acceptance' }).tree();
  const elapsedMs = performance.now() - startedAt;
  assert.equal(queryCount, 1);
  assert.equal(countNodes(tree), 500);
  assert.ok(elapsedMs < 2000, `Organization tree took ${elapsedMs.toFixed(1)}ms`);
  console.log(`SPEC-003 organization tree: ${elapsedMs.toFixed(1)}ms, ${queryCount} query`);
});

test('keeps employee pagination deterministic with assignments, teams, and account binding', async () => {
  await prisma.organization.createMany({ data: [
    { id: 'root', code: 'ROOT', name: 'Root Firm', type: 'FIRM', path: '/root', level: 0 },
    { id: 'branch-a', code: 'BRANCH_A', name: 'Branch A', type: 'BRANCH', parentId: 'root', path: '/root/branch-a', level: 1 },
    { id: 'branch-b', code: 'BRANCH_B', name: 'Branch B', type: 'BRANCH', parentId: 'root', path: '/root/branch-b', level: 1 },
  ] });
  await prisma.position.createMany({ data: [
    { id: 'position-a', organizationId: 'branch-a', code: 'LAWYER_A', name: 'Lawyer', categoryCode: 'LEGAL' },
    { id: 'position-b', organizationId: 'branch-b', code: 'LAWYER_B', name: 'Lawyer', categoryCode: 'LEGAL' },
  ] });
  const createdAt = new Date('2026-07-18T00:00:00.000Z');
  const employees = Array.from({ length: 30 }, (_, index) => ({
    id: `employee-${String(index).padStart(2, '0')}`,
    employeeNo: `EMP-${String(index).padStart(3, '0')}`,
    name: `Employee ${index}`,
    phone: `1380000${String(index).padStart(4, '0')}`,
    type: 'LAWYER', status: 'FORMAL', entryDate: createdAt, createdAt, updatedAt: createdAt,
  }));
  await prisma.employee.createMany({ data: employees });
  await prisma.employeeAssignment.createMany({ data: employees.map((employee, index) => ({
    id: `assignment-${index}`, employeeId: employee.id,
    organizationId: index === 0 ? 'branch-b' : 'branch-a', positionId: index === 0 ? 'position-b' : 'position-a',
    assignmentType: 'PRIMARY', startedAt: createdAt, createdAt, updatedAt: createdAt,
  })) });
  await prisma.employeeAssignment.create({ data: { id: 'history-0', employeeId: 'employee-00', organizationId: 'branch-a', positionId: 'position-a', assignmentType: 'PRIMARY', startedAt: new Date('2025-01-01'), endedAt: createdAt } });
  await prisma.user.create({ data: { id: 'bound-user', username: 'bound.user', password: 'non-production-fixture', employeeId: 'employee-00' } });
  await prisma.professionalTeam.create({ data: { id: 'cross-office-team', code: 'CROSS_OFFICE', name: 'Cross-office Team', categoryCode: 'OTHER', homeOrganizationId: 'root' } });
  await prisma.professionalTeamMember.createMany({ data: [
    { id: 'lead', professionalTeamId: 'cross-office-team', employeeId: 'employee-00', memberRole: 'LEAD', startedAt: createdAt },
    { id: 'lawyer', professionalTeamId: 'cross-office-team', employeeId: 'employee-01', memberRole: 'LAWYER', startedAt: createdAt },
  ] });

  const service = new EmployeeService(prisma, { actorUserId: 'acceptance' });
  queryCount = 0;
  const startedAt = performance.now();
  const first = await service.list({ page: 1, pageSize: 10 });
  const firstQueries = queryCount;
  const second = await service.list({ page: 2, pageSize: 10 });
  const elapsedMs = performance.now() - startedAt;
  const expectedFirst = employees.slice(0, 10).map(item => item.employeeNo);
  const expectedSecond = employees.slice(10, 20).map(item => item.employeeNo);
  assert.deepEqual(first.list.map(item => item.employeeNo), expectedFirst);
  assert.deepEqual(second.list.map(item => item.employeeNo), expectedSecond);
  assert.equal(first.list[0].primaryAssignment?.organizationId, 'branch-b');
  assert.deepEqual(first.list[0].activeProfessionalTeamIds, ['cross-office-team']);
  assert.equal(firstQueries, 5, `First employee page used ${firstQueries} queries`);
  assert.equal(queryCount - firstQueries, 5, `Second employee page used ${queryCount - firstQueries} queries`);
  assert.ok(elapsedMs < 2000, `Two employee pages took ${elapsedMs.toFixed(1)}ms`);
  console.log(`SPEC-003 employee pagination: ${elapsedMs.toFixed(1)}ms, ${queryCount} queries for two pages`);
});

function countNodes(nodes: Array<{ children: Array<{ children: unknown[] }> }>): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children as Array<{ children: Array<{ children: unknown[] }> }>), 0);
}
