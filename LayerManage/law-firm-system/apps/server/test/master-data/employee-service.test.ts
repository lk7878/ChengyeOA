import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { EmployeeService } from '../../app/application/master-data/employee-service';
import { hashPhone, normalizePhone } from '../../app/domain/crm/lead-policy';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { authorizationContext, hasCode } from './test-helpers';
import { createApiSession } from '../helpers/auth-session';

let prisma: PrismaClient;
let organizationId: string;
let positionId: string;
let service: EmployeeService;

const EMPLOYEE_PERMISSIONS = [
  'employee.read', 'employee.create', 'employee.update', 'employee.formalize', 'employee.leave',
] as const;

function employeeAuthorization(scopeIds = ['ALL'], employeeId: string | null = null) {
  return authorizationContext({
    userId: 'employee-actor',
    permissionCodes: [...EMPLOYEE_PERMISSIONS],
    resource: 'employee',
    scopeIds,
    employeeId,
    superAdmin: scopeIds.includes('ALL'),
  });
}

async function baseInput(employeeNo: string) {
  return {
    employeeNo, name: '  Alice Lawyer  ', phone: ' 13800000000 ', email: ' ALICE@EXAMPLE.COM ',
    idCard: `ID-${employeeNo}`, licenseNo: `LICENSE-${employeeNo}`, employeeType: 'LAWYER',
    professionalDirections: [' Civil '], entryDate: '2026-01-01',
    primaryOrganizationId: organizationId, primaryPositionId: positionId,
  };
}

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  organizationId = randomUUID();
  await prisma.organization.create({ data: {
    id: organizationId, code: 'ROOT', name: 'Root', type: 'FIRM', path: `/${organizationId}`,
  } });
  positionId = (await prisma.position.create({ data: {
    organizationId, code: 'LAWYER', name: 'Lawyer', categoryCode: 'LEGAL',
  } })).id;
  service = new EmployeeService(prisma, { actorUserId: 'employee-actor' }, employeeAuthorization());
});
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); });

test('handover overview names blockers, excludes deleted/converted leads and suggests the department manager', async () => {
  const employee = await service.create(await baseInput('OFFBOARD-1'));
  const manager = await service.create(await baseInput('MANAGER-1'));
  const managerUser = await prisma.user.create({ data: { username: 'manager', password: 'unused', employeeId: manager.id } });
  await prisma.organization.update({ where: { id: organizationId }, data: { managerEmployeeId: manager.id } });
  for (const [index, status] of ['NEW', 'CONVERTED', 'LOST', 'NEW'].entries()) await prisma.lead.create({ data: {
    leadNo: `OFF-${index}`, name: `线索${index}`, phone: '13800000001', phoneHash: `off-${index}`, assignedTo: employee.id, createdBy: 'employee-actor', status, deletedAt: index === 3 ? new Date() : null,
  } });
  const overview = await service.offboarding(employee.id);
  assert.deepEqual(overview.blockers.leads.map(lead => lead.leadNo), ['OFF-0']);
  assert.equal(overview.suggestedRecipient?.userId, managerUser.id);
  await assert.rejects(() => service.remove(employee.id, { version: 1, confirmed: true }), error => {
    assert.equal((error as { errors: { employeeHandoverBlockers: { leads: number } } }).errors.employeeHandoverBlockers.leads, 1);
    return hasCode('EMPLOYEE_DELETE_IN_USE')(error);
  });
  const ordinary = new EmployeeService(prisma, { actorUserId: 'employee-actor' }, { ...employeeAuthorization(), isSystemSuperAdmin: false });
  await assert.rejects(() => ordinary.offboarding(employee.id), hasCode('SUPER_ADMIN_REQUIRED'));
  await assert.rejects(() => ordinary.suspendAccount(employee.id, { version: 1, confirmed: true }), hasCode('SUPER_ADMIN_REQUIRED'));
});

test('pause preserves employment and materials, revokes sessions, and completed departure permits transfer and account deletion', async () => {
  const employee = await service.create(await baseInput('OFFBOARD-2'));
  const manager = await service.create(await baseInput('MANAGER-2'));
  const source = await prisma.user.create({ data: { username: 'departing', password: 'unused', employeeId: employee.id } });
  const recipient = await prisma.user.create({ data: { username: 'recipient', password: 'unused', employeeId: manager.id } });
  const session = await createApiSession(prisma, source.id);
  const workspace = await prisma.collabWorkspace.create({ data: { name: '未分享材料', organizationId, ownerId: source.id } });
  await assert.rejects(() => service.remove(employee.id, { version: 1, confirmed: true, deleteAccount: true, recipientUserId: recipient.id }), hasCode('EMPLOYEE_OFFBOARDING_INCOMPLETE'));
  const paused = await service.suspendAccount(employee.id, { version: 1, confirmed: true });
  assert.equal(paused.status, 'PROBATION'); assert.equal(paused.version, 2);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: source.id } })).status, 'DISABLED');
  assert.ok((await prisma.authSession.findUniqueOrThrow({ where: { id: session.sessionId } })).revokedAt);
  assert.equal(await prisma.employeeAssignment.count({ where: { employeeId: employee.id, endedAt: null } }), 1);
  assert.equal((await prisma.collabWorkspace.findUniqueOrThrow({ where: { id: workspace.id } })).ownerId, source.id);
  await assert.rejects(() => service.suspendAccount(employee.id, { version: 1, confirmed: true }), hasCode('VERSION_CONFLICT'));
  const departed = await service.leave(employee.id, { version: paused.version, handoverConfirmed: true, leaveDate: '2026-09-29' });
  await assert.rejects(() => service.remove(employee.id, { version: departed.version, confirmed: true, deleteAccount: true }), hasCode('EMPLOYEE_TRANSFER_REQUIRED'));
  await service.remove(employee.id, { version: departed.version, confirmed: true, deleteAccount: true, recipientUserId: recipient.id });
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: source.id } })).status, 'DELETED');
  assert.equal((await prisma.collabWorkspace.findUniqueOrThrow({ where: { id: workspace.id } })).ownerId, recipient.id);
  assert.ok((await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } })).deletedAt);
});

test('creates employee and primary assignment atomically with normalized identity', async () => {
  const created = await service.create(await baseInput(' emp-001 '));
  assert.equal(created.employeeNo, 'EMP-001');
  assert.equal(created.name, 'Alice Lawyer');
  assert.equal(created.email, 'alice@example.com');
  assert.equal(created.entryDate.toISOString().slice(0, 10), '2026-01-01');
  assert.deepEqual(created.professionalDirections, ['Civil']);
  assert.equal(created.formalDate, null);
  assert.deepEqual(created.activeProfessionalTeamIds, []);
  assert.equal(created.primaryAssignment?.organizationId, organizationId);
  assert.equal(await prisma.employeeAssignment.count({ where: { employeeId: created.id } }), 1);
});

test('departure releases the number while preserving old identity and permits only one concurrent replacement', async () => {
  const old = await service.create(await baseInput('REUSE-001'));
  await service.leave(old.id, { leaveDate: '2026-09-11', handoverConfirmed: true, version: 1 });
  const replacement = { ...await baseInput('REUSE-001'), idCard: null, licenseNo: null, name: 'New person' };
  const attempts = await Promise.allSettled([service.create(replacement), service.create(replacement)]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(attempts.some(result => result.status === 'rejected' && hasCode('EMPLOYEE_IDENTITY_CONFLICT')(result.reason)));
  const current = attempts.find(result => result.status === 'fulfilled')!;
  assert.notEqual(current.value.id, old.id);
  const history = await service.detail(old.id);
  assert.equal(history.employeeNo, 'REUSE-001');
  assert.equal(history.status, 'LEAVED');
  assert.equal(history.primaryAssignment, null);
  assert.equal(history.assignments[0].employeeId, old.id);
  assert.ok(history.assignments[0].endedAt);
});

test('deletion hides the profile, ends assignments, disables its account and preserves an audit and historical ID', async () => {
  const old = await service.create(await baseInput('DELETE-001'));
  const user = await prisma.user.create({ data: { username: 'delete.employee', password: 'unused', employeeId: old.id } });
  await service.remove(old.id, { version: 1, confirmed: true });
  const stored = await prisma.employee.findUniqueOrThrow({ where: { id: old.id } });
  assert.equal(stored.status, 'LEAVED'); assert.ok(stored.deletedAt);
  assert.equal(stored.employeeNo, old.employeeNo);
  assert.equal((await service.list({ page: 1, pageSize: 20 })).pagination.total, 0);
  await assert.rejects(() => service.detail(old.id), hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'));
  await assert.rejects(() => service.update(old.id, { name: 'Restore', version: stored.version }), hasCode('EMPLOYEE_NOT_FOUND'));
  assert.equal(await prisma.employeeAssignment.count({ where: { employeeId: old.id, endedAt: null } }), 0);
  assert.equal(await prisma.employeeAssignment.count({ where: { employeeId: old.id } }), 1);
  const account = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(account.status, 'DISABLED'); assert.equal(account.credentialVersion, user.credentialVersion + 1);
  const audit = await prisma.operationLog.findFirstOrThrow({ where: { targetId: old.id, action: 'DELETE' } });
  assert.ok(JSON.parse(audit.newValues!).deletedAt);
  assert.doesNotMatch(audit.newValues!, /13800000000|ID-DELETE/);
  const replacement = await service.create({ ...await baseInput(old.employeeNo), idCard: null, licenseNo: null });
  assert.notEqual(replacement.id, old.id);
});

test('employee deletion enforces super-admin, explicit confirmation, version and self protection', async () => {
  const employee = await service.create(await baseInput('DELETE-002'));
  const denied = new EmployeeService(prisma, { actorUserId: 'employee-actor' }, { ...employeeAuthorization(), isSystemSuperAdmin: false });
  await assert.rejects(() => denied.remove(employee.id, { version: 1, confirmed: true }), hasCode('SUPER_ADMIN_REQUIRED'));
  await assert.rejects(() => service.remove(employee.id, { version: 1, confirmed: false as true }), hasCode('VALIDATION_FAILED'));
  await assert.rejects(() => service.remove(employee.id, { version: 99, confirmed: true }), hasCode('VERSION_CONFLICT'));
  const self = new EmployeeService(prisma, { actorUserId: 'employee-actor' }, employeeAuthorization(['ALL'], employee.id));
  await assert.rejects(() => self.remove(employee.id, { version: 1, confirmed: true }), hasCode('EMPLOYEE_DELETE_SELF'));
  assert.equal((await service.detail(employee.id)).version, 1);
});

test('responsibility blockers abort deletion and keep the number reserved', async () => {
  const employee = await service.create(await baseInput('DELETE-003'));
  await prisma.organization.update({ where: { id: organizationId }, data: { managerEmployeeId: employee.id } });
  await assert.rejects(() => service.remove(employee.id, { version: 1, confirmed: true }), hasCode('EMPLOYEE_DELETE_IN_USE'));
  await assert.rejects(() => service.leave(employee.id, { version: 1, leaveDate: '2026-09-11', handoverConfirmed: true }), hasCode('MASTER_DATA_IN_USE'));
  await assert.rejects(async () => service.create({ ...await baseInput(employee.employeeNo), idCard: null, licenseNo: null }), hasCode('EMPLOYEE_IDENTITY_CONFLICT'));
  assert.equal((await service.detail(employee.id)).version, 1);
  assert.equal(await prisma.employeeAssignment.count({ where: { employeeId: employee.id, endedAt: null } }), 1);
});

test('deleting a departed profile cannot remove or change a new holder of its employee number', async () => {
  const old = await service.create(await baseInput('DELETE-004'));
  const departed = await service.leave(old.id, { version: 1, leaveDate: '2026-08-01', handoverConfirmed: true });
  const current = await service.create({ ...await baseInput(old.employeeNo), idCard: null, licenseNo: null });
  await service.remove(old.id, { version: departed.version, confirmed: true });
  assert.equal((await service.detail(current.id)).status, 'PROBATION');
  assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: old.id } })).leaveDate?.toISOString(), departed.leaveDate?.toISOString());
  assert.deepEqual((await service.list({ page: 1, pageSize: 20 })).list.map(item => item.id), [current.id]);
});

test('maps concurrent employee number and identity uniqueness to a safe conflict', async () => {
  const results = await Promise.allSettled([
    service.create(await baseInput('EMP-002')),
    service.create(await baseInput('EMP-002')),
  ]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  const rejected = results.find((item): item is PromiseRejectedResult => item.status === 'rejected');
  assert.ok(rejected);
  assert.equal(hasCode('EMPLOYEE_IDENTITY_CONFLICT')(rejected.reason), true);

  const duplicateIdentity = await baseInput('EMP-003');
  duplicateIdentity.idCard = 'ID-EMP-002';
  await assert.rejects(() => service.create(duplicateIdentity), hasCode('EMPLOYEE_IDENTITY_CONFLICT'));
});

test('updates with optimistic locking and formalizes only probation employees', async () => {
  const created = await service.create(await baseInput('EMP-004'));
  const updated = await service.update(created.id, { name: 'Updated Name', version: 1 });
  assert.equal(updated.version, 2);
  await assert.rejects(() => service.update(created.id, { name: 'Stale', version: 1 }), hasCode('VERSION_CONFLICT'));
  const formal = await service.formalize(created.id, { formalDate: '2026-02-01', version: 2 });
  assert.equal(formal.status, 'FORMAL');
  assert.equal(formal.formalDate?.toISOString().slice(0, 10), '2026-02-01');
  await assert.rejects(
    () => service.formalize(created.id, { formalDate: '2026-03-01', version: 3 }),
    hasCode('VALIDATION_FAILED'),
  );
});

test('requires handover, blocks active work and protects the initialized super-admin', async () => {
  const created = await service.create(await baseInput('EMP-005'));
  await assert.rejects(
    () => service.leave(created.id, { leaveDate: '2026-07-18', handoverConfirmed: false as true, version: 1 }),
    hasCode('VALIDATION_FAILED'),
  );
  await prisma.lead.create({ data: {
    leadNo: 'LEAD-EMP-005-HANDOVER',
    name: 'Active lead',
    phone: '13800000001',
    phoneHash: hashPhone(normalizePhone('13800000001')),
    assignedTo: created.id,
    createdBy: 'employee-actor',
  } });
  await assert.rejects(
    () => service.leave(created.id, { leaveDate: '2026-07-18', handoverConfirmed: true, version: 1 }),
    hasCode('MASTER_DATA_IN_USE'),
  );
  await prisma.lead.updateMany({ data: { status: 'LOST' } });

  const user = await prisma.user.create({ data: { username: 'protected.admin', password: 'unused', employeeId: created.id } });
  await prisma.systemInitialization.create({ data: {
    id: 'PRIMARY', rootOrganizationId: organizationId, superAdminUserId: user.id, completedAt: new Date(),
  } });
  await assert.rejects(
    () => service.leave(created.id, { leaveDate: '2026-07-18', handoverConfirmed: true, version: 1 }),
    hasCode('TRUST_ROOT_PROTECTED'),
  );
});

test('ends all relationships and disables an ordinary bound account on leave', async () => {
  const created = await service.create(await baseInput('EMP-006'));
  const user = await prisma.user.create({ data: { username: 'ordinary.user', password: 'unused', employeeId: created.id } });
  const leaved = await service.leave(created.id, { leaveDate: '2026-07-18', handoverConfirmed: true, version: 1 });
  assert.equal(leaved.status, 'LEAVED');
  assert.equal(await prisma.employeeAssignment.count({ where: { employeeId: created.id, endedAt: null } }), 0);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status, 'DISABLED');
});

test('blocks a manager with current reports and ends the leaver own reporting line', async () => {
  const manager = await service.create(await baseInput('EMP-007'));
  const subordinate = await service.create(await baseInput('EMP-008'));
  const line = await prisma.employeeReportingLine.create({
    data: {
      employeeId: subordinate.id,
      managerEmployeeId: manager.id,
      startedAt: new Date('2026-01-01'),
    },
  });

  await assert.rejects(
    () => service.leave(manager.id, { leaveDate: '2026-07-18', handoverConfirmed: true, version: manager.version }),
    hasCode('MASTER_DATA_IN_USE'),
  );
  await service.leave(subordinate.id, {
    leaveDate: '2026-07-18', handoverConfirmed: true, version: subordinate.version,
  });
  assert.ok((await prisma.employeeReportingLine.findUniqueOrThrow({ where: { id: line.id } })).endedAt);
  await assert.doesNotReject(
    () => service.leave(manager.id, { leaveDate: '2026-07-18', handoverConfirmed: true, version: manager.version }),
  );
});

test('applies employee scope unions to list, detail, and mutations without reviving history', async () => {
  const branchAId = randomUUID();
  const branchBId = randomUUID();
  await prisma.organization.createMany({ data: [
    { id: branchAId, code: 'BRANCH_A', name: 'Branch A', type: 'BRANCH', parentId: organizationId, path: `/${organizationId}/${branchAId}`, level: 1 },
    { id: branchBId, code: 'BRANCH_B', name: 'Branch B', type: 'BRANCH', parentId: organizationId, path: `/${organizationId}/${branchBId}`, level: 1 },
  ] });
  const branchAPosition = await prisma.position.create({ data: {
    organizationId: branchAId, code: 'BRANCH_A_LAWYER', name: 'Branch A lawyer', categoryCode: 'LEGAL',
  } });
  const branchBPosition = await prisma.position.create({ data: {
    organizationId: branchBId, code: 'BRANCH_B_LAWYER', name: 'Branch B lawyer', categoryCode: 'LEGAL',
  } });
  const activeSecondary = await service.create({ ...(await baseInput('EMP-SCOPE-A')), primaryOrganizationId: branchBId, primaryPositionId: branchBPosition.id });
  await prisma.employeeAssignment.create({ data: {
    employeeId: activeSecondary.id, organizationId: branchAId, positionId: branchAPosition.id,
    assignmentType: 'SECONDARY', startedAt: new Date('2026-01-01'),
  } });
  const historyOnly = await service.create({ ...(await baseInput('EMP-SCOPE-HISTORY')), primaryOrganizationId: branchBId, primaryPositionId: branchBPosition.id });
  await prisma.employeeAssignment.create({ data: {
    employeeId: historyOnly.id, organizationId: branchAId, positionId: branchAPosition.id,
    assignmentType: 'SECONDARY', startedAt: new Date('2025-01-01'), endedAt: new Date('2026-01-01'),
  } });
  const scope = await prisma.dataScope.create({ data: {
    name: 'Branch A employees', scopeType: 'BRANCH', organizationId: branchAId, includeDescendants: true,
  } });
  const scoped = new EmployeeService(
    prisma,
    { actorUserId: 'employee-actor' },
    employeeAuthorization([scope.id]),
  );

  assert.deepEqual((await scoped.list({ page: 1, pageSize: 20 })).list.map(item => item.id), [activeSecondary.id]);
  assert.equal((await scoped.detail(activeSecondary.id)).id, activeSecondary.id);
  await assert.rejects(() => scoped.detail(historyOnly.id), hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'));
  await assert.rejects(
    () => scoped.update(historyOnly.id, { name: 'Denied', version: 1 }),
    hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'),
  );
});

test('masks L3 fields by default and audits explicitly authorized raw reads', async () => {
  const created = await service.create(await baseInput('EMP-FIELD-READ'));
  const maskedService = new EmployeeService(
    prisma,
    { actorUserId: 'masked-reader' },
    authorizationContext({
      userId: 'masked-reader', permissionCodes: ['employee.read'], resource: 'employee',
      scopeIds: ['ALL'], superAdmin: false,
    }),
  );
  const masked = await maskedService.detail(created.id);
  assert.equal(masked.phone, '138****0000');
  assert.equal(masked.email, 'a***@example.com');
  assert.equal(masked.licenseNo, 'LIC***READ');
  assert.equal('idCard' in masked, false);

  const rawService = new EmployeeService(
    prisma,
    { actorUserId: 'raw-reader' },
    authorizationContext({
      userId: 'raw-reader', permissionCodes: ['employee.read'], resource: 'employee',
      scopeIds: ['ALL'], superAdmin: false,
      fieldRules: [{
        sourceRoleId: 'raw-reader-role', resource: 'employee', fieldCode: 'employee.phone',
        readLevel: 'READ', canWrite: false, canExport: false,
      }],
    }),
  );
  const raw = await rawService.detail(created.id);
  assert.equal(raw.phone, '13800000000');
  const audit = await prisma.operationLog.findFirstOrThrow({
    where: { userId: 'raw-reader', action: 'READ_L3_FIELDS' },
  });
  assert.match(audit.newValues ?? '', /employee\.phone/);
  assert.doesNotMatch(audit.newValues ?? '', /13800000000/);
});

test('requires canWrite for every supplied employee field before mutation', async () => {
  const created = await service.create(await baseInput('EMP-FIELD-WRITE'));
  const denied = new EmployeeService(
    prisma,
    { actorUserId: 'field-writer' },
    authorizationContext({
      userId: 'field-writer', permissionCodes: ['employee.read', 'employee.update'], resource: 'employee',
      scopeIds: ['ALL'], superAdmin: false,
    }),
  );
  await assert.rejects(
    () => denied.update(created.id, { phone: '13900000000', version: 1 }),
    hasCode('FIELD_PERMISSION_DENIED'),
  );
  assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: created.id } })).phone, '13800000000');

  const allowed = new EmployeeService(
    prisma,
    { actorUserId: 'field-writer' },
    authorizationContext({
      userId: 'field-writer', permissionCodes: ['employee.read', 'employee.update'], resource: 'employee',
      scopeIds: ['ALL'], superAdmin: false,
      fieldRules: [{
        sourceRoleId: 'field-writer-role', resource: 'employee', fieldCode: 'employee.phone',
        readLevel: 'MASKED', canWrite: true, canExport: false,
      }],
    }),
  );
  assert.equal((await allowed.update(created.id, { phone: '13900000000', version: 1 })).phone, '139****0000');
});

test('requires lifecycle field write capability in addition to formalize and leave actions', async () => {
  const formalizing = await service.create(await baseInput('EMP-FORMAL-FIELD'));
  const deniedFormalize = new EmployeeService(
    prisma,
    { actorUserId: 'lifecycle-writer' },
    authorizationContext({
      userId: 'lifecycle-writer', permissionCodes: ['employee.read', 'employee.formalize'],
      resource: 'employee', scopeIds: ['ALL'], superAdmin: false,
    }),
  );
  await assert.rejects(
    () => deniedFormalize.formalize(formalizing.id, { formalDate: '2026-02-01', version: 1 }),
    hasCode('FIELD_PERMISSION_DENIED'),
  );

  const allowedFormalize = new EmployeeService(
    prisma,
    { actorUserId: 'lifecycle-writer' },
    authorizationContext({
      userId: 'lifecycle-writer', permissionCodes: ['employee.read', 'employee.formalize'],
      resource: 'employee', scopeIds: ['ALL'], superAdmin: false,
      fieldRules: [{
        sourceRoleId: 'lifecycle-writer-role', resource: 'employee', fieldCode: 'employee.formalDate',
        readLevel: 'READ', canWrite: true, canExport: false,
      }],
    }),
  );
  assert.equal(
    (await allowedFormalize.formalize(formalizing.id, { formalDate: '2026-02-01', version: 1 })).status,
    'FORMAL',
  );

  const leaving = await service.create(await baseInput('EMP-LEAVE-FIELD'));
  const deniedLeave = new EmployeeService(
    prisma,
    { actorUserId: 'leave-writer' },
    authorizationContext({
      userId: 'leave-writer', permissionCodes: ['employee.read', 'employee.leave'],
      resource: 'employee', scopeIds: ['ALL'], superAdmin: false,
    }),
  );
  await assert.rejects(
    () => deniedLeave.leave(leaving.id, { leaveDate: '2026-07-18', handoverConfirmed: true, version: 1 }),
    hasCode('FIELD_PERMISSION_DENIED'),
  );
});
