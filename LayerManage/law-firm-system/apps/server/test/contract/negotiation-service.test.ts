import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { NegotiationService } from '../../app/application/contract/negotiation-service';
import { CreateNegotiationInput } from '../../app/application/contract/contract-types';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import {
  CONTRACT_ERROR_CODES,
  ContractError,
} from '../../app/domain/contract/contract-errors';
import { hashPhone } from '../../app/domain/crm/lead-policy';
import { MasterDataError } from '../../app/domain/master-data/master-data-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

// SPEC-010 Task 6: negotiation-service 契约测试（CRM-07 谈案创建/列表/详情/更新门禁/完结/数据范围/事件同事务）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/contract/negotiation-service.test.ts

let prisma: PrismaClient;

const NEGOTIATION_PERMISSIONS: PermissionCode[] = [
  'negotiation.read',
  'negotiation.create',
  'negotiation.update',
  'customer.read',
];

test.before(() => {
  prisma = createTestPrisma();
});

test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

function hasCode(code: string): (error: unknown) => boolean {
  return error => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

interface ContextOverrides {
  employeeId?: string | null;
  permissionCodes?: PermissionCode[];
  scopeIds?: string[];
}

function contractContext(userId: string, overrides: ContextOverrides = {}): AuthorizationContext {
  const permissionCodes = overrides.permissionCodes ?? NEGOTIATION_PERMISSIONS;
  const scopeIds = overrides.scopeIds ?? ['ALL'];
  return {
    userId,
    employeeId: overrides.employeeId ?? null,
    isSystemAdmin: false,
    isSystemSuperAdmin: false,
    grants: permissionCodes.map(permissionCode => ({
      sourceType: 'ROLE' as const,
      sourceId: `${userId}-grant-${permissionCode}`,
      sourceRoleId: 'test-role',
      permissionCode,
      resource: permissionCode.split('.')[0],
      scopeIds,
      validUntil: null,
    })),
    fieldRules: [],
    permissionCodes,
    evaluatedAt: new Date(),
  };
}

async function createActor(): Promise<{ userId: string; actor: AuditActor }> {
  const user = await prisma.user.create({
    data: { username: `negotiation.actor.${randomUUID()}`, password: 'x' },
  });
  return {
    userId: user.id,
    actor: { actorUserId: user.id, requestId: `req-${randomUUID()}` },
  };
}

function serviceFor(userId: string, actor: AuditActor, overrides: ContextOverrides = {}): NegotiationService {
  return new NegotiationService(prisma, actor, contractContext(userId, overrides));
}

async function createOrganizationFixture(code: string, parent?: { id: string; path: string }) {
  const id = randomUUID();
  return prisma.organization.create({
    data: {
      id,
      code: `${code}_${id}`,
      name: code,
      type: 'BRANCH',
      parentId: parent?.id,
      path: parent ? `${parent.path}/${id}` : `/${id}`,
      level: parent ? parent.path.split('/').length - 1 : 0,
    },
  });
}

async function createEmployeeInOrg(organizationId: string, code: string) {
  const position = await prisma.position.create({
    data: {
      organizationId,
      code: `POS_${randomUUID()}`,
      name: `${code} position`,
      categoryCode: 'STAFF',
    },
  });
  return prisma.employee.create({
    data: {
      employeeNo: `EMP_${randomUUID()}`,
      name: code,
      phone: `1${randomUUID().replaceAll('-', '').slice(0, 10)}`,
      type: 'SALES',
      status: 'FORMAL',
      entryDate: new Date('2025-01-01'),
      assignments: {
        create: {
          organizationId,
          positionId: position.id,
          assignmentType: 'PRIMARY',
          startedAt: new Date('2025-01-01'),
        },
      },
    },
  });
}

async function createEmployeeFixture(code: string) {
  const orgId = randomUUID();
  await prisma.organization.create({
    data: { id: orgId, code: `ORG_${orgId}`, name: code, type: 'BRANCH', path: `/${orgId}` },
  });
  return createEmployeeInOrg(orgId, code);
}

async function createCustomerFixture(createdBy: string) {
  return prisma.customer.create({
    data: {
      customerNo: `CU-SEED-${randomUUID()}`,
      name: '谈案客户',
      phone: '13900001111',
      phoneHash: hashPhone('13900001111'),
      status: 'INTENT',
      createdBy,
    },
  });
}

async function createNegotiationFixture(overrides: {
  customerId: string;
  negotiatorEmployeeId: string;
  createdBy: string;
  status?: string;
  branchId?: string | null;
  professionalTeamId?: string | null;
}) {
  return prisma.negotiation.create({
    data: {
      negotiationNo: `NE-SEED-${randomUUID()}`,
      customerId: overrides.customerId,
      negotiatorEmployeeId: overrides.negotiatorEmployeeId,
      createdBy: overrides.createdBy,
      status: overrides.status ?? 'NEGOTIATING',
      branchId: overrides.branchId ?? null,
      professionalTeamId: overrides.professionalTeamId ?? null,
    },
  });
}

function negotiationInput(
  customerId: string,
  negotiatorEmployeeId: string,
  overrides: Partial<CreateNegotiationInput> = {},
): CreateNegotiationInput {
  return { customerId, negotiatorEmployeeId, ...overrides };
}

test('createNegotiation persists the negotiation and writes negotiation.created in one transaction', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  const service = serviceFor(userId, actor);

  const view = await service.createNegotiation(negotiationInput(customer.id, negotiator.id, {
    quotedAmount: '12800.50',
    customerConcerns: '担心周期过长',
    competitorInfo: '对比了隔壁律所',
    remark: '重点关注',
  }));

  assert.ok(view.id);
  assert.match(view.negotiationNo, /^NE\d{6}-[0-9A-Z]{6}$/);
  assert.equal(view.status, 'NEGOTIATING');
  assert.equal(view.customerId, customer.id);
  assert.equal(view.negotiatorEmployeeId, negotiator.id);
  assert.equal(view.quotedAmount, '12800.50');
  assert.equal(view.customerConcerns, '担心周期过长');
  assert.equal(view.competitorInfo, '对比了隔壁律所');
  assert.equal(view.remark, '重点关注');
  assert.equal(view.branchId, null);
  assert.equal(view.professionalTeamId, null);
  assert.equal(view.version, 1);
  assert.equal(view.signedAt, null);
  assert.equal(view.unsignedReason, null);

  const stored = await prisma.negotiation.findUniqueOrThrow({ where: { id: view.id } });
  assert.equal(stored.createdBy, userId);
  assert.equal(stored.quotedAmount?.toFixed(2), '12800.50');

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'NEGOTIATION', objectId: view.id },
  });
  assert.equal(event.eventType, 'negotiation.created');
  assert.equal(event.eventVersion, 1);
  assert.equal(event.sourceModule, 'CONTRACT');
  assert.equal(event.operatorUserId, userId);
  assert.deepEqual(event.payload, {
    negotiationId: view.id,
    customerId: customer.id,
    negotiatorEmployeeId: negotiator.id,
    status: 'NEGOTIATING',
  });

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'NEGOTIATION', targetId: view.id, action: 'NEGOTIATION_CREATE' },
  });
  assert.equal(operationLog.userId, userId);
});

test('createNegotiation accepts a numeric quotedAmount and projects it unmasked', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  const service = serviceFor(userId, actor);

  const view = await service.createNegotiation(negotiationInput(customer.id, negotiator.id, {
    quotedAmount: 9600,
  }));

  assert.equal(view.quotedAmount, '9600.00');
});

test('createNegotiation rejects an invalid or negative quotedAmount with VALIDATION_FAILED 400', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  const service = serviceFor(userId, actor);

  await assert.rejects(
    () => service.createNegotiation(negotiationInput(customer.id, negotiator.id, { quotedAmount: 'not-a-number' })),
    error => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );
  await assert.rejects(
    () => service.createNegotiation(negotiationInput(customer.id, negotiator.id, { quotedAmount: '-5' })),
    error => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );
  assert.equal(await prisma.negotiation.count(), 0);
});

test('createNegotiation resolves branchId/professionalTeamId from the referenced lead when not explicit', async () => {
  const { userId, actor } = await createActor();
  const branch = await createOrganizationFixture('BRANCH_MAIN');
  const team = await prisma.professionalTeam.create({
    data: {
      code: `TEAM_${randomUUID()}`,
      name: '刑辩团队',
      categoryCode: 'OTHER',
      homeOrganizationId: branch.id,
    },
  });
  const customer = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  const lead = await prisma.lead.create({
    data: {
      leadNo: `L-SEED-${randomUUID()}`,
      name: '来源线索',
      phone: '13700009999',
      phoneHash: hashPhone('13700009999'),
      status: 'VISITED',
      poolStatus: 'PRIVATE',
      branchId: branch.id,
      professionalTeamId: team.id,
      createdBy: userId,
    },
  });
  const service = serviceFor(userId, actor);

  const inherited = await service.createNegotiation(negotiationInput(customer.id, negotiator.id, {
    leadId: lead.id,
  }));
  assert.equal(inherited.leadId, lead.id);
  assert.equal(inherited.branchId, branch.id);
  assert.equal(inherited.professionalTeamId, team.id);

  const otherBranch = await createOrganizationFixture('BRANCH_OTHER');
  const explicit = await service.createNegotiation(negotiationInput(customer.id, negotiator.id, {
    leadId: lead.id,
    branchId: otherBranch.id,
  }));
  assert.equal(explicit.branchId, otherBranch.id, 'explicit branchId wins over lead inheritance');
  assert.equal(explicit.professionalTeamId, team.id, 'team still inherited when not explicit');

  const inheritedEvent = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'NEGOTIATION', objectId: inherited.id },
  });
  assert.equal(inheritedEvent.branchId, branch.id);
  assert.equal(inheritedEvent.teamId, team.id);
});

test('createNegotiation rejects a missing lead reference with VALIDATION_FAILED 400', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  const service = serviceFor(userId, actor);

  await assert.rejects(
    () => service.createNegotiation(negotiationInput(customer.id, negotiator.id, { leadId: randomUUID() })),
    error => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );
  assert.equal(await prisma.negotiation.count(), 0);
});

// SPEC-010 Task 10（Task 6 Minor② 到期裁决落地）：appointmentId 探针——存在性校验
// （Appointment 无 deletedAt 列，schema 实证；不做归属链校验，记 closeout 已知项），
// 伪造 → VALIDATION_FAILED 400，与 leadId 探针先例对称。
test('createNegotiation rejects a forged appointmentId with VALIDATION_FAILED 400 and writes nothing', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  const service = serviceFor(userId, actor);

  await assert.rejects(
    () => service.createNegotiation(negotiationInput(customer.id, negotiator.id, { appointmentId: randomUUID() })),
    error => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );
  assert.equal(await prisma.negotiation.count(), 0);
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'negotiation.created' } }), 0);
});

test('createNegotiation accepts an existing appointment and persists appointmentId', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  const lead = await prisma.lead.create({
    data: {
      leadNo: `L-SEED-${randomUUID()}`,
      name: '邀约来源线索',
      phone: '13700009999',
      phoneHash: hashPhone('13700009999'),
      status: 'VISITED',
      poolStatus: 'PRIVATE',
      createdBy: userId,
    },
  });
  const appointment = await prisma.appointment.create({
    data: {
      appointmentNo: `AP-SEED-${randomUUID()}`,
      leadId: lead.id,
      scheduledAt: new Date('2026-08-01T10:00:00Z'),
      channel: 'ONSITE',
      createdBy: userId,
    },
  });
  const service = serviceFor(userId, actor);

  const view = await service.createNegotiation(negotiationInput(customer.id, negotiator.id, {
    appointmentId: appointment.id,
  }));
  assert.equal(view.appointmentId, appointment.id);
  const stored = await prisma.negotiation.findUniqueOrThrow({ where: { id: view.id } });
  assert.equal(stored.appointmentId, appointment.id);
});

test('createNegotiation rejects a forged negotiatorEmployeeId with VALIDATION_FAILED 400 and writes nothing', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);

  await assert.rejects(
    () => service.createNegotiation(negotiationInput(customer.id, randomUUID())),
    error => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );
  assert.equal(await prisma.negotiation.count(), 0);
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'negotiation.created' } }), 0);
});

test('createNegotiation returns NEGOTIATION_NOT_FOUND 404 for a missing customer', async () => {
  const { userId, actor } = await createActor();
  const negotiator = await createEmployeeFixture('谈案律师');
  const service = serviceFor(userId, actor);

  await assert.rejects(
    () => service.createNegotiation(negotiationInput(randomUUID(), negotiator.id)),
    error => error instanceof ContractError
      && error.code === CONTRACT_ERROR_CODES.NEGOTIATION_NOT_FOUND
      && error.httpStatus === 404,
  );
  assert.equal(await prisma.negotiation.count(), 0);
});

test('createNegotiation hides a customer outside the operator customer.read scope as 404', async () => {
  const { userId, actor } = await createActor();
  const employeeA = await createEmployeeFixture('客服A');
  const customer = await createCustomerFixture('someone-else');
  const negotiator = await createEmployeeFixture('谈案律师');
  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  const scoped = serviceFor(userId, actor, {
    employeeId: employeeA.id,
    scopeIds: [selfScope.id],
  });

  await assert.rejects(
    () => scoped.createNegotiation(negotiationInput(customer.id, negotiator.id)),
    error => error instanceof ContractError
      && error.code === CONTRACT_ERROR_CODES.NEGOTIATION_NOT_FOUND
      && error.httpStatus === 404,
  );
  assert.equal(await prisma.negotiation.count(), 0);
});

test('createNegotiation requires the negotiation.create action permission', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  const service = serviceFor(userId, actor, { permissionCodes: ['negotiation.read'] });

  await assert.rejects(
    () => service.createNegotiation(negotiationInput(customer.id, negotiator.id)),
    hasCode('PERMISSION_DENIED'),
  );
  assert.equal(await prisma.negotiation.count(), 0);
});

test('listNegotiations paginates and filters by status and customerId', async () => {
  const { userId, actor } = await createActor();
  const customerA = await createCustomerFixture(userId);
  const customerB = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  const service = serviceFor(userId, actor);

  const first = await service.createNegotiation(negotiationInput(customerA.id, negotiator.id));
  const second = await service.createNegotiation(negotiationInput(customerA.id, negotiator.id));
  await service.createNegotiation(negotiationInput(customerB.id, negotiator.id));

  const page1 = await service.listNegotiations({ page: 1, pageSize: 2 });
  assert.equal(page1.total, 3);
  assert.equal(page1.page, 1);
  assert.equal(page1.pageSize, 2);
  assert.equal(page1.list.length, 2);

  const page2 = await service.listNegotiations({ page: 2, pageSize: 2 });
  assert.equal(page2.list.length, 1);
  const allIds = [...page1.list, ...page2.list].map(item => item.id);
  assert.equal(new Set(allIds).size, 3);

  const byCustomer = await service.listNegotiations({ customerId: customerA.id });
  assert.equal(byCustomer.total, 2);
  assert.deepEqual(
    byCustomer.list.map(item => item.id).sort(),
    [first.id, second.id].sort(),
  );

  const byStatus = await service.listNegotiations({ status: 'SIGNED' });
  assert.equal(byStatus.total, 0);
});

test('getNegotiation returns the detail and hides missing ids as NEGOTIATION_NOT_FOUND 404', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  const service = serviceFor(userId, actor);
  const created = await service.createNegotiation(negotiationInput(customer.id, negotiator.id));

  const fetched = await service.getNegotiation(created.id);
  assert.equal(fetched.id, created.id);
  assert.equal(fetched.negotiationNo, created.negotiationNo);

  await assert.rejects(
    () => service.getNegotiation(randomUUID()),
    error => error instanceof ContractError
      && error.code === CONTRACT_ERROR_CODES.NEGOTIATION_NOT_FOUND
      && error.httpStatus === 404,
  );
});

test('updateNegotiation changes fields only while NEGOTIATING and bumps version', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  const service = serviceFor(userId, actor);
  const created = await service.createNegotiation(negotiationInput(customer.id, negotiator.id, {
    customerConcerns: '初始顾虑',
  }));

  const updated = await service.updateNegotiation(created.id, {
    quotedAmount: '15000',
    customerConcerns: '更新后的顾虑',
    competitorInfo: '新增竞品信息',
  });
  assert.equal(updated.quotedAmount, '15000.00');
  assert.equal(updated.customerConcerns, '更新后的顾虑');
  assert.equal(updated.competitorInfo, '新增竞品信息');
  assert.equal(updated.version, 2);
  assert.equal(updated.updatedBy, userId);

  const stored = await prisma.negotiation.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.version, 2);

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'NEGOTIATION', targetId: created.id, action: 'NEGOTIATION_UPDATE' },
  });
  assert.ok(operationLog.newValues?.includes('quotedAmount'));
  assert.ok(!operationLog.newValues?.includes('更新后的顾虑'), 'audit must not log free-text values');
});

test('updateNegotiation validates a changed negotiatorEmployeeId exists', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  const service = serviceFor(userId, actor);
  const created = await service.createNegotiation(negotiationInput(customer.id, negotiator.id));

  await assert.rejects(
    () => service.updateNegotiation(created.id, { negotiatorEmployeeId: randomUUID() }),
    error => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );

  const replacement = await createEmployeeFixture('接手律师');
  const updated = await service.updateNegotiation(created.id, { negotiatorEmployeeId: replacement.id });
  assert.equal(updated.negotiatorEmployeeId, replacement.id);
});

test('updateNegotiation rejects closed negotiations with CONTRACT_STATE_TRANSITION_INVALID 409', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  const service = serviceFor(userId, actor);
  const created = await service.createNegotiation(negotiationInput(customer.id, negotiator.id));
  await service.closeNegotiation(created.id, { outcome: 'SIGNED' });

  await assert.rejects(
    () => service.updateNegotiation(created.id, { remark: '改动' }),
    error => error instanceof ContractError
      && error.code === CONTRACT_ERROR_CODES.CONTRACT_STATE_TRANSITION_INVALID
      && error.httpStatus === 409,
  );
});

test('closeNegotiation SIGNED sets signedAt and writes negotiation.closed with the pinned payload keys', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  const service = serviceFor(userId, actor);
  const created = await service.createNegotiation(negotiationInput(customer.id, negotiator.id));

  const closed = await service.closeNegotiation(created.id, { outcome: 'SIGNED' });
  assert.equal(closed.status, 'SIGNED');
  assert.ok(closed.signedAt instanceof Date);
  assert.equal(closed.unsignedReason, null);
  assert.equal(closed.version, 2);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'NEGOTIATION', objectId: created.id, eventType: 'negotiation.closed' },
  });
  assert.equal(event.eventVersion, 1);
  assert.equal(event.sourceModule, 'CONTRACT');
  assert.equal(event.operatorUserId, userId);
  assert.deepEqual(event.payload, { negotiationId: created.id, status: 'SIGNED' });
});

test('closeNegotiation UNSIGNED requires a reason and stores it without leaking it into the event payload', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  const service = serviceFor(userId, actor);
  const created = await service.createNegotiation(negotiationInput(customer.id, negotiator.id));

  await assert.rejects(
    () => service.closeNegotiation(created.id, { outcome: 'UNSIGNED' }),
    error => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );
  const stillOpen = await prisma.negotiation.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stillOpen.status, 'NEGOTIATING');

  const closed = await service.closeNegotiation(created.id, {
    outcome: 'UNSIGNED',
    unsignedReason: '价格未谈拢',
  });
  assert.equal(closed.status, 'UNSIGNED');
  assert.equal(closed.unsignedReason, '价格未谈拢');
  assert.equal(closed.signedAt, null);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'NEGOTIATION', objectId: created.id, eventType: 'negotiation.closed' },
  });
  assert.deepEqual(event.payload, { negotiationId: created.id, status: 'UNSIGNED' });
});

test('closeNegotiation rejects a contradictory unsignedReason on SIGNED with VALIDATION_FAILED 400', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  const service = serviceFor(userId, actor);
  const created = await service.createNegotiation(negotiationInput(customer.id, negotiator.id));

  await assert.rejects(
    () => service.closeNegotiation(created.id, { outcome: 'SIGNED', unsignedReason: '矛盾原因' }),
    error => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );
});

test('closeNegotiation on a terminal negotiation throws CONTRACT_STATE_TRANSITION_INVALID 409', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  const service = serviceFor(userId, actor);
  const created = await service.createNegotiation(negotiationInput(customer.id, negotiator.id));
  await service.closeNegotiation(created.id, { outcome: 'SIGNED' });

  await assert.rejects(
    () => service.closeNegotiation(created.id, { outcome: 'UNSIGNED', unsignedReason: '反悔' }),
    error => error instanceof ContractError
      && error.code === CONTRACT_ERROR_CODES.CONTRACT_STATE_TRANSITION_INVALID
      && error.httpStatus === 409,
  );
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'negotiation.closed', objectId: created.id } }),
    1,
    'no duplicate close event',
  );
});

test('concurrent closeNegotiation on the same version has exactly one winner; loser gets VERSION_CONFLICT 409', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  const service = serviceFor(userId, actor);
  const created = await service.createNegotiation(negotiationInput(customer.id, negotiator.id));

  // 确定性竞速（仿 lead-assignment-service.test.ts:684 Promise.all 竞速先例）：第三方事务持
  // FOR UPDATE 行锁 1s，两个 close 事务的 findFirst 均先于任何提交完成（同读 NEGOTIATING v1
  // 并通过状态门禁），其 updateMany 被行锁阻塞；锁释放后一者提交 version 1→2，另一者（READ
  // COMMITTED 下重评 where）命中 version=2 → count=0 → 钉死 VERSION_CONFLICT 分支
  // （无锁时败者交错落 CONTRACT_STATE_TRANSITION_INVALID/VERSION_CONFLICT 之二，非确定性）。
  const lockHolder = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM negotiation WHERE id = ${created.id} FOR UPDATE`;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }, { timeout: 15000 });
  // 让锁先落定再发起竞速。
  await new Promise(resolve => setTimeout(resolve, 100));

  const results = await Promise.allSettled([
    service.closeNegotiation(created.id, { outcome: 'SIGNED' }),
    service.closeNegotiation(created.id, { outcome: 'UNSIGNED', unsignedReason: '竞速落败' }),
  ]);
  await lockHolder;

  const fulfilled = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one close may win');
  assert.equal(rejected.length, 1, 'the losing close must fail, never silently overwrite');
  const loser = rejected[0].reason;
  assert.ok(
    loser instanceof MasterDataError && loser.code === 'VERSION_CONFLICT' && loser.status === 409,
    `loser must get VERSION_CONFLICT 409, got ${String(loser)}`,
  );

  const winner = fulfilled[0].value;
  const stored = await prisma.negotiation.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.status, winner.status, 'winner outcome committed');
  assert.ok(stored.status === 'SIGNED' || stored.status === 'UNSIGNED');
  assert.equal(stored.version, 2, 'exactly one close may commit');
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'negotiation.closed', objectId: created.id } }),
    1,
    'no duplicate close event from the racing loser',
  );
  assert.equal(
    await prisma.operationLog.count({
      where: { targetType: 'NEGOTIATION', targetId: created.id, action: 'NEGOTIATION_CLOSE' },
    }),
    1,
    'only the winner writes the close audit',
  );
});

test('list and get enforce the SELF scope on negotiatorEmployeeId or createdBy without leaking existence', async () => {
  const { userId, actor } = await createActor();
  const employeeA = await createEmployeeFixture('谈案A');
  const employeeB = await createEmployeeFixture('谈案B');
  const customer = await createCustomerFixture(userId);
  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  const asNegotiator = await createNegotiationFixture({
    customerId: customer.id,
    negotiatorEmployeeId: employeeA.id,
    createdBy: 'someone-else',
  });
  const asCreator = await createNegotiationFixture({
    customerId: customer.id,
    negotiatorEmployeeId: employeeB.id,
    createdBy: userId,
  });
  const outOfScope = await createNegotiationFixture({
    customerId: customer.id,
    negotiatorEmployeeId: employeeB.id,
    createdBy: 'someone-else',
  });

  const scoped = serviceFor(userId, actor, {
    employeeId: employeeA.id,
    scopeIds: [selfScope.id],
  });

  const page = await scoped.listNegotiations({});
  assert.deepEqual(
    page.list.map(item => item.id).sort(),
    [asNegotiator.id, asCreator.id].sort(),
  );
  assert.equal(page.total, 2);

  const fetched = await scoped.getNegotiation(asNegotiator.id);
  assert.equal(fetched.id, asNegotiator.id);
  await assert.rejects(
    () => scoped.getNegotiation(outOfScope.id),
    hasCode(CONTRACT_ERROR_CODES.NEGOTIATION_NOT_FOUND),
  );
});

test('TEAM scope anchors on Negotiation.professionalTeamId', async () => {
  const { userId, actor } = await createActor();
  const branch = await createOrganizationFixture('BRANCH_MAIN');
  const team = await prisma.professionalTeam.create({
    data: {
      code: `TEAM_${randomUUID()}`,
      name: '刑辩团队',
      categoryCode: 'OTHER',
      homeOrganizationId: branch.id,
    },
  });
  const otherTeam = await prisma.professionalTeam.create({
    data: {
      code: `TEAM_${randomUUID()}`,
      name: '民商团队',
      categoryCode: 'OTHER',
      homeOrganizationId: branch.id,
    },
  });
  const teamScope = await prisma.dataScope.create({
    data: { name: `team-${randomUUID()}`, scopeType: 'TEAM', professionalTeamId: team.id },
  });
  const customer = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  const inTeam = await createNegotiationFixture({
    customerId: customer.id,
    negotiatorEmployeeId: negotiator.id,
    createdBy: 'someone-else',
    professionalTeamId: team.id,
  });
  const inOtherTeam = await createNegotiationFixture({
    customerId: customer.id,
    negotiatorEmployeeId: negotiator.id,
    createdBy: 'someone-else',
    professionalTeamId: otherTeam.id,
  });

  const scoped = serviceFor(userId, actor, { scopeIds: [teamScope.id] });
  const page = await scoped.listNegotiations({});
  assert.deepEqual(page.list.map(item => item.id), [inTeam.id]);
  assert.equal(page.total, 1);
  await assert.rejects(
    () => scoped.getNegotiation(inOtherTeam.id),
    hasCode(CONTRACT_ERROR_CODES.NEGOTIATION_NOT_FOUND),
  );
});

test('BRANCH scope anchors on Negotiation.branchId including the organization subtree', async () => {
  const { userId, actor } = await createActor();
  const branch = await createOrganizationFixture('BRANCH_MAIN');
  const branchChild = await createOrganizationFixture('BRANCH_CHILD', branch);
  const other = await createOrganizationFixture('BRANCH_OTHER');
  const clerk = await createEmployeeInOrg(branch.id, '分所员工');
  const branchScope = await prisma.dataScope.create({
    data: { name: `branch-${randomUUID()}`, scopeType: 'BRANCH', organizationId: branch.id },
  });
  const customer = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  const inBranch = await createNegotiationFixture({
    customerId: customer.id,
    negotiatorEmployeeId: negotiator.id,
    createdBy: 'someone-else',
    branchId: branch.id,
  });
  const inChild = await createNegotiationFixture({
    customerId: customer.id,
    negotiatorEmployeeId: negotiator.id,
    createdBy: 'someone-else',
    branchId: branchChild.id,
  });
  const outOfBranch = await createNegotiationFixture({
    customerId: customer.id,
    negotiatorEmployeeId: negotiator.id,
    createdBy: 'someone-else',
    branchId: other.id,
  });

  const scoped = serviceFor(userId, actor, { employeeId: clerk.id, scopeIds: [branchScope.id] });
  const page = await scoped.listNegotiations({});
  assert.deepEqual(
    page.list.map(item => item.id).sort(),
    [inBranch.id, inChild.id].sort(),
  );
  assert.equal(page.total, 2);
  await assert.rejects(
    () => scoped.getNegotiation(outOfBranch.id),
    hasCode(CONTRACT_ERROR_CODES.NEGOTIATION_NOT_FOUND),
  );
});

test('ORG scope anchors on the exact organization without descendants', async () => {
  const { userId, actor } = await createActor();
  const org = await createOrganizationFixture('ORG_MAIN');
  const orgChild = await createOrganizationFixture('ORG_CHILD', org);
  const clerk = await createEmployeeInOrg(org.id, '机构员工');
  const orgScope = await prisma.dataScope.create({
    data: { name: `org-${randomUUID()}`, scopeType: 'ORG', organizationId: org.id },
  });
  const customer = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  const inOrg = await createNegotiationFixture({
    customerId: customer.id,
    negotiatorEmployeeId: negotiator.id,
    createdBy: 'someone-else',
    branchId: org.id,
  });
  const inChild = await createNegotiationFixture({
    customerId: customer.id,
    negotiatorEmployeeId: negotiator.id,
    createdBy: 'someone-else',
    branchId: orgChild.id,
  });

  const scoped = serviceFor(userId, actor, { employeeId: clerk.id, scopeIds: [orgScope.id] });
  const page = await scoped.listNegotiations({});
  assert.deepEqual(page.list.map(item => item.id), [inOrg.id]);
  assert.equal(page.total, 1);
  await assert.rejects(
    () => scoped.getNegotiation(inChild.id),
    hasCode(CONTRACT_ERROR_CODES.NEGOTIATION_NOT_FOUND),
  );
});

test('a context without any matching scope target fails closed', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  await createNegotiationFixture({
    customerId: customer.id,
    negotiatorEmployeeId: negotiator.id,
    createdBy: 'someone-else',
    branchId: (await createOrganizationFixture('BRANCH_MAIN')).id,
  });
  const unrelatedScope = await prisma.dataScope.create({
    data: {
      name: `team-${randomUUID()}`,
      scopeType: 'TEAM',
      professionalTeamId: (await prisma.professionalTeam.create({
        data: {
          code: `TEAM_${randomUUID()}`,
          name: '空团队',
          categoryCode: 'OTHER',
          homeOrganizationId: (await createOrganizationFixture('BRANCH_TEAM')).id,
        },
      })).id,
    },
  });

  const scoped = serviceFor(userId, actor, { scopeIds: [unrelatedScope.id] });
  const page = await scoped.listNegotiations({});
  assert.equal(page.total, 0);
  assert.deepEqual(page.list, []);
});
