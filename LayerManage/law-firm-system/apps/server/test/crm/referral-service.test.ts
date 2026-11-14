// SPEC-039 Task 1: 客户域转介绍服务契约测试（登记转介绍 / 客户转介绍列表）。
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { LeadService } from '../../app/application/crm/lead-service';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { CrmError, CUSTOMER_NOT_FOUND } from '../../app/domain/crm/lead-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const CRM_PERMISSIONS: PermissionCode[] = ['lead.create', 'lead.read'];

const prisma = createTestPrisma();

test.before(async () => {
  await prisma.$connect();
});

test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

function crmContext(userId: string, permissionCodes: PermissionCode[] = CRM_PERMISSIONS): AuthorizationContext {
  return {
    userId,
    employeeId: null,
    isSystemAdmin: false,
    isSystemSuperAdmin: false,
    grants: permissionCodes.map(permissionCode => ({
      sourceType: 'ROLE' as const,
      sourceId: `${userId}-grant-${permissionCode}`,
      sourceRoleId: 'test-role',
      permissionCode,
      resource: permissionCode.split('.')[0],
      scopeIds: ['ALL'],
      validUntil: null,
    })),
    fieldRules: [],
    permissionCodes,
    evaluatedAt: new Date(),
  };
}

async function seedCustomer(): Promise<string> {
  const customer = await prisma.customer.create({
    data: {
      customerNo: `CU-${randomUUID()}`,
      name: '转介绍客户',
      phone: '13800005555',
      phoneHash: 'seed',
      status: 'SIGNED',
      createdBy: 'seed',
    },
  });
  return customer.id;
}

async function serviceFor(permissionCodes: PermissionCode[] = CRM_PERMISSIONS): Promise<{ service: LeadService; userId: string }> {
  const user = await prisma.user.create({
    data: { username: `referral.actor.${randomUUID()}`, password: 'x' },
  });
  const actor: AuditActor = { actorUserId: user.id, requestId: `req-${randomUUID()}` };
  return { service: new LeadService(prisma, actor, crmContext(user.id, permissionCodes)), userId: user.id };
}

test('createReferralLead creates a REFERRAL lead bound to the referring customer with audit', async () => {
  const { service } = await serviceFor();
  const customerId = await seedCustomer();

  const result = await service.createReferralLead(customerId, {
    name: '转介绍线索甲',
    phone: '13900001111',
    wechat: 'wx_ref_a',
    intentionLevel: 4,
  });

  assert.equal(result.lead.sourceType, 'REFERRAL');
  assert.equal(result.lead.referralCustomerId, customerId);
  assert.equal(result.lead.status, 'NEW');
  assert.equal(result.lead.intentionLevel, 4);
  assert.ok(result.lead.leadNo.startsWith('L'), 'referral lead uses the L business number prefix');

  const stored = await prisma.lead.findUnique({ where: { id: result.lead.id } });
  assert.equal(stored?.sourceType, 'REFERRAL');
  assert.equal(stored?.referralCustomerId, customerId);

  // 客户不存在 → 404 CUSTOMER_NOT_FOUND。
  await assert.rejects(
    () => service.createReferralLead(randomUUID(), { name: 'x', phone: '13900002222' }),
    (error: unknown) => error instanceof CrmError && error.code === CUSTOMER_NOT_FOUND && error.httpStatus === 404,
  );

  // 无 lead.create → 403。
  await assert.rejects(
    async () => (await serviceFor(['lead.read'])).service.createReferralLead(customerId, { name: 'x', phone: '13900003333' }),
    { name: 'AuthorizationError' },
  );
});

test('listReferrals returns only the referring customer sourceType REFERRAL leads', async () => {
  const { service } = await serviceFor();
  const customerA = await seedCustomer();
  const customerB = await seedCustomer();

  await service.createReferralLead(customerA, { name: '转介甲', phone: '13900004444' });
  await service.createReferralLead(customerA, { name: '转介乙', phone: '13900005555' });
  // 客户 B 的转介绍不计入客户 A。
  await service.createReferralLead(customerB, { name: '转介丙', phone: '13900006666' });
  // 非 REFERRAL 来源（direct create）不计入。
  await service.createLead({ name: '普通线索', phone: '13900007777', sourceType: 'MANUAL', referralCustomerId: customerA });

  const referrals = await service.listReferrals(customerA, { page: 1, pageSize: 10 });
  assert.equal(referrals.total, 2, 'only REFERRAL-source leads for customerA');
  assert.ok(referrals.list.every(lead => lead.referralCustomerId === customerA));

  // 客户不存在 → 404。
  await assert.rejects(
    () => service.listReferrals(randomUUID(), {}),
    (error: unknown) => error instanceof CrmError && error.code === CUSTOMER_NOT_FOUND && error.httpStatus === 404,
  );

  // 无 lead.read → 403。
  await assert.rejects(
    async () => (await serviceFor(['lead.create'])).service.listReferrals(customerA, {}),
    { name: 'AuthorizationError' },
  );
});
