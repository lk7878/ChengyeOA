import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';

import {
  AddContactInput,
  CreateCustomerInput,
  CustomerService,
} from '../../app/application/crm/customer-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { CrmError, LEAD_NOT_FOUND } from '../../app/domain/crm/lead-errors';
import { hashPhone, normalizePhone } from '../../app/domain/crm/lead-policy';
import { MasterDataError } from '../../app/domain/master-data/master-data-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

// SPEC-009 Task 8: customer-service 契约测试（客户主数据 + 联系人）。
// 绑定决策（2026-07-29 dispatch coordinator decisions）：
//  10. customer.read/create/update；customer.merge 不实现。
//  11. Customer 无组织列：范围锚定 SELF→createdBy=actor.userId（与 lead-service 写 createdBy 同一身份串）、
//      TEAM→sourceLead.professionalTeamId、BRANCH/ORG→sourceLead.branchId 子树；sourceLeadId=null 仅命中
//      SELF 谓词与 ALL；OR 并集 fail-closed；不可见 → LEAD_NOT_FOUND(404)（无 CUSTOMER_NOT_FOUND 码）。
//  12. createCustomer：normalizePhone+hashPhone 双写；customerNo=makeBusinessNo('CU')；status 默认
//      POTENTIAL（提供则校验 CUSTOMER_STATUS）；sourceLeadId 恒 null（转化路径独占）；直建不去重拦截。
//  13. updateCustomer：version 乐观锁；仅更新提供字段；phone 变更重算 phone+phoneHash。
//  14. get/list：范围 + customer-projection 脱敏（customer.read 锚定 customer.phone/customer.wechat）+
//      明文输出时 auditRawL3Access（purpose customer.read）；列表 targetId 'LIST' 哨兵。
//  15. 联系人：addContact/updateContact/removeContact=customer.update，listContacts=customer.read；
//      @@unique([customerId, phoneHash]) P2002→VALIDATION_FAILED(409)；isPrimary=true 同事务清其他；
//      removeContact 软删；listContacts 排除软删按 createdAt ASC；电话按 customer.read 字段能力脱敏。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/crm/customer-service.test.ts

let prisma: PrismaClient;

const CUSTOMER_PERMISSIONS: PermissionCode[] = [
  'customer.read',
  'customer.create',
  'customer.update',
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
  fieldRules?: AuthorizationContext['fieldRules'];
}

function crmContext(userId: string, overrides: ContextOverrides = {}): AuthorizationContext {
  const permissionCodes = overrides.permissionCodes ?? CUSTOMER_PERMISSIONS;
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
    fieldRules: overrides.fieldRules ?? [],
    permissionCodes,
    evaluatedAt: new Date(),
  };
}

async function createActor(): Promise<{ userId: string; actor: AuditActor }> {
  const user = await prisma.user.create({
    data: { username: `customer.actor.${randomUUID()}`, password: 'x' },
  });
  return {
    userId: user.id,
    actor: { actorUserId: user.id, requestId: `req-${randomUUID()}` },
  };
}

function serviceFor(userId: string, actor: AuditActor, overrides: ContextOverrides = {}): CustomerService {
  return new CustomerService(prisma, actor, crmContext(userId, overrides));
}

function customerInput(overrides: Partial<CreateCustomerInput> = {}): CreateCustomerInput {
  return {
    name: '王五',
    phone: '13800001234',
    ...overrides,
  };
}

function contactInput(overrides: Partial<AddContactInput> = {}): AddContactInput {
  return {
    name: '联系人',
    phone: '13511112222',
    ...overrides,
  };
}

async function seedCustomer(data: Partial<Prisma.CustomerUncheckedCreateInput> = {}) {
  const id = randomUUID();
  return prisma.customer.create({
    data: {
      id,
      customerNo: `C-SEED-${id}`,
      name: '种子客户',
      phone: '13700008888',
      phoneHash: hashPhone('13700008888'),
      status: 'POTENTIAL',
      createdBy: 'seed',
      ...data,
    },
  });
}

async function seedLead(data: Partial<Prisma.LeadUncheckedCreateInput> = {}) {
  const id = randomUUID();
  return prisma.lead.create({
    data: {
      id,
      leadNo: `L-SEED-${id}`,
      name: '种子线索',
      phone: '13700009999',
      phoneHash: hashPhone('13700009999'),
      status: 'NEW',
      poolStatus: 'PUBLIC',
      createdBy: 'seed',
      ...data,
    },
  });
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

test('createCustomer persists with dual phone storage and writes customer.created', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);

  const view = await service.createCustomer(customerInput({
    wechat: 'wx-cust-001',
    email: 'cust@example.com',
    address: '北京市朝阳区',
    customerType: 'INDIVIDUAL',
    tags: '["vip"]',
    remark: '直客建档',
  }));

  assert.ok(view.id);
  // customerNo（决策 12）：CU + yyMMdd + '-' + 6 位随机字母数字。
  assert.match(view.customerNo, /^CU\d{6}-[0-9A-Z]{6}$/);
  assert.equal(view.status, 'POTENTIAL');
  assert.equal(view.sourceLeadId, null);
  // 无 L3 READ 字段规则：视图脱敏。
  assert.equal(view.phone, '138****1234');
  assert.equal(view.wechat, '***');

  const stored = await prisma.customer.findUniqueOrThrow({ where: { id: view.id } });
  assert.equal(stored.phone, '13800001234');
  assert.equal(stored.phoneHash, hashPhone(normalizePhone('13800001234')));
  assert.equal(stored.createdBy, userId);
  assert.equal(stored.sourceLeadId, null);
  assert.equal(stored.version, 1);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { eventType: 'customer.created', objectType: 'CUSTOMER', objectId: view.id },
  });
  assert.equal(event.eventVersion, 1);
  assert.equal(event.sourceModule, 'CRM');
  assert.equal(event.operatorUserId, userId);
  assert.deepEqual(event.payload, {
    customerId: view.id,
    sourceLeadId: null,
    status: 'POTENTIAL',
  });
});

test('createCustomer honors provided status, rejects invalid input and requires customer.create', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);

  const intent = await service.createCustomer(customerInput({ status: 'INTENT', phone: '13800005555' }));
  assert.equal(intent.status, 'INTENT');
  const event = await prisma.eventLog.findFirstOrThrow({
    where: { eventType: 'customer.created', objectId: intent.id },
  });
  assert.deepEqual(event.payload, { customerId: intent.id, sourceLeadId: null, status: 'INTENT' });

  await assert.rejects(
    () => service.createCustomer(customerInput({ status: 'BOGUS' as never, phone: '13800006666' })),
    error => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );
  // sourceLeadId 不可经直建设置（决策 12：转化路径独占）→ 精确键校验拒绝。
  await assert.rejects(
    () => service.createCustomer({ ...customerInput(), sourceLeadId: randomUUID() } as never),
    hasCode('VALIDATION_FAILED'),
  );
  await assert.rejects(
    () => serviceFor(userId, actor, { permissionCodes: ['customer.read'] })
      .createCustomer(customerInput({ phone: '13800007777' })),
    hasCode('PERMISSION_DENIED'),
  );
  assert.equal(await prisma.customer.count({ where: { status: 'BOGUS' } }), 0);
});

test('createCustomer writes OperationLog audit without phone, wechat or remark plaintext', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const view = await service.createCustomer(customerInput({
    wechat: 'wx-secret-002',
    remark: '内部敏感备注',
  }));

  const audit = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'CUSTOMER', targetId: view.id, action: 'CUSTOMER_CREATE' },
  });
  assert.equal(audit.userId, userId);
  assert.equal((audit.newValues ?? '').includes('13800001234'), false);
  assert.equal((audit.newValues ?? '').includes('wx-secret-002'), false);
  assert.equal((audit.newValues ?? '').includes('内部敏感备注'), false);
});

test('updateCustomer applies partial updates, re-normalizes phone and bumps version', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const created = await service.createCustomer(customerInput());

  const updated = await service.updateCustomer(created.id, {
    phone: '+86 139-0000-2222',
    address: '上海市静安区',
    status: 'SIGNED',
  });

  assert.equal(updated.version, 2);
  assert.equal(updated.address, '上海市静安区');
  assert.equal(updated.status, 'SIGNED');
  assert.equal(updated.name, '王五', 'name was not provided and must be kept');

  const stored = await prisma.customer.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.phone, '13900002222');
  assert.equal(stored.phoneHash, hashPhone(normalizePhone('13900002222')));
  assert.equal(stored.updatedBy, userId);

  await assert.rejects(
    () => service.updateCustomer(created.id, { status: 'BOGUS' as never }),
    hasCode('VALIDATION_FAILED'),
  );
  await assert.rejects(
    () => service.updateCustomer(randomUUID(), { address: '不存在' }),
    error => error instanceof CrmError && error.code === LEAD_NOT_FOUND && error.httpStatus === 404,
  );
  await assert.rejects(
    () => serviceFor(userId, actor, { permissionCodes: ['customer.read'] })
      .updateCustomer(created.id, { address: '越权' }),
    hasCode('PERMISSION_DENIED'),
  );
});

test('getCustomer masks L3 fields by default and audits raw reads with purpose customer.read', async () => {
  const { userId, actor } = await createActor();
  const created = await serviceFor(userId, actor).createCustomer(
    customerInput({ wechat: 'wx-cust-003' }),
  );

  const masked = await serviceFor(userId, actor).getCustomer(created.id);
  assert.equal(masked.phone, '138****1234');
  assert.equal(masked.wechat, '***');
  assert.equal(await prisma.operationLog.count({ where: { action: 'READ_L3_FIELDS' } }), 0);

  const reader = serviceFor(userId, actor, {
    fieldRules: [{
      sourceRoleId: 'test-role',
      resource: 'customer',
      fieldCode: 'customer.phone',
      readLevel: 'READ',
      canWrite: true,
      canExport: false,
    }],
  });
  const readable = await reader.getCustomer(created.id);
  assert.equal(readable.phone, '13800001234');
  assert.equal(readable.wechat, '***', 'wechat stays masked without its own READ rule');

  const audit = await prisma.operationLog.findFirstOrThrow({
    where: { action: 'READ_L3_FIELDS', targetType: 'CUSTOMER', targetId: created.id },
  });
  assert.equal(audit.userId, userId);
  assert.match(audit.newValues ?? '', /customer\.phone/);
  assert.match(audit.newValues ?? '', /customer\.read/);
  assert.doesNotMatch(audit.newValues ?? '', /13800001234/);
});

test('listCustomers paginates, filters by status and masks phone with LIST audit sentinel', async () => {
  const { userId, actor } = await createActor();
  await seedCustomer({ name: '潜在客户一', status: 'POTENTIAL' });
  await seedCustomer({ name: '意向客户一', status: 'INTENT', phone: '13600001111', phoneHash: hashPhone('13600001111') });
  await seedCustomer({ name: '签约客户一', status: 'SIGNED', phone: '13600002222', phoneHash: hashPhone('13600002222') });

  const service = serviceFor(userId, actor);
  const page1 = await service.listCustomers({ page: 1, pageSize: 2 });
  assert.equal(page1.total, 3);
  assert.equal(page1.list.length, 2);
  assert.equal(page1.page, 1);

  const intentOnly = await service.listCustomers({ status: 'INTENT' });
  assert.equal(intentOnly.total, 1);
  assert.equal(intentOnly.list[0].name, '意向客户一');
  assert.equal(intentOnly.list[0].phone, '136****1111');

  const reader = serviceFor(userId, actor, {
    fieldRules: [{
      sourceRoleId: 'test-role',
      resource: 'customer',
      fieldCode: 'customer.phone',
      readLevel: 'READ',
      canWrite: true,
      canExport: false,
    }],
  });
  const raw = await reader.listCustomers({});
  assert.equal(raw.total, 3);
  const audit = await prisma.operationLog.findFirstOrThrow({
    where: { action: 'READ_L3_FIELDS', targetType: 'CUSTOMER', targetId: 'LIST' },
  });
  assert.match(audit.newValues ?? '', /customer\.phone/);
});

test('SELF scope anchors on createdBy: own customers visible, others hidden', async () => {
  const owner = await createActor();
  const outsider = await createActor();
  const org = await createOrganizationFixture('BRANCH_MAIN');
  const clerk = await createEmployeeInOrg(org.id, '客服');
  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });

  const mine = await serviceFor(owner.userId, owner.actor).createCustomer(customerInput());
  const others = await serviceFor(outsider.userId, outsider.actor)
    .createCustomer(customerInput({ name: '他人客户', phone: '13877776666' }));

  const scoped = serviceFor(owner.userId, owner.actor, {
    employeeId: clerk.id,
    scopeIds: [selfScope.id],
  });
  const page = await scoped.listCustomers({});
  assert.deepEqual(page.list.map(item => item.id), [mine.id]);
  assert.equal(page.total, 1);
  const fetched = await scoped.getCustomer(mine.id);
  assert.equal(fetched.id, mine.id);
  await assert.rejects(() => scoped.getCustomer(others.id), hasCode(LEAD_NOT_FOUND));
  await assert.rejects(
    () => scoped.updateCustomer(others.id, { address: '越权改写' }),
    hasCode(LEAD_NOT_FOUND),
  );
});

test('BRANCH scope anchors on sourceLead.branchId; null-sourceLead customers are invisible', async () => {
  const { userId, actor } = await createActor();
  const branch = await createOrganizationFixture('BRANCH_MAIN');
  const branchChild = await createOrganizationFixture('BRANCH_CHILD', branch);
  const other = await createOrganizationFixture('BRANCH_OTHER');
  const clerk = await createEmployeeInOrg(branch.id, '分所客服');
  const branchScope = await prisma.dataScope.create({
    data: { name: `branch-${randomUUID()}`, scopeType: 'BRANCH', organizationId: branch.id },
  });

  const inBranchLead = await seedLead({ branchId: branch.id });
  const inChildLead = await seedLead({ branchId: branchChild.id, name: '子机构线索' });
  const outLead = await seedLead({ branchId: other.id, name: '外所线索' });
  const custIn = await seedCustomer({ name: '分所客户', sourceLeadId: inBranchLead.id });
  const custChild = await seedCustomer({
    name: '子机构客户',
    sourceLeadId: inChildLead.id,
    phone: '13611110000',
    phoneHash: hashPhone('13611110000'),
  });
  const custOut = await seedCustomer({
    name: '外所客户',
    sourceLeadId: outLead.id,
    phone: '13622220000',
    phoneHash: hashPhone('13622220000'),
  });
  const custDirect = await seedCustomer({
    name: '直建客户',
    phone: '13633330000',
    phoneHash: hashPhone('13633330000'),
  });

  const scoped = serviceFor(userId, actor, { employeeId: clerk.id, scopeIds: [branchScope.id] });
  const page = await scoped.listCustomers({});
  assert.deepEqual(page.list.map(item => item.id).sort(), [custIn.id, custChild.id].sort());
  assert.equal(page.total, 2);
  await assert.rejects(() => scoped.getCustomer(custOut.id), hasCode(LEAD_NOT_FOUND));
  await assert.rejects(() => scoped.getCustomer(custDirect.id), hasCode(LEAD_NOT_FOUND));
});

test('addContact stores the phone hash, enforces per-customer uniqueness and primary exclusivity', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const customer = await service.createCustomer(customerInput());
  const other = await service.createCustomer(customerInput({ name: '另一客户', phone: '13899990000' }));

  const first = await service.addContact(
    customer.id,
    contactInput({ name: '张三本人', relation: '本人', isPrimary: true }),
  );
  assert.equal(first.isPrimary, true);
  const storedFirst = await prisma.contact.findUniqueOrThrow({ where: { id: first.id } });
  assert.equal(storedFirst.phone, '13511112222');
  assert.equal(storedFirst.phoneHash, hashPhone(normalizePhone('13511112222')));
  assert.equal(storedFirst.createdBy, userId);

  // 同客户同电话（含格式化变体）→ P2002 映射 VALIDATION_FAILED(409)。
  await assert.rejects(
    () => service.addContact(customer.id, contactInput({ name: '重复电话', phone: '+86 135-1111-2222' })),
    error => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 409,
  );

  // 跨客户同电话允许（唯一约束是 [customerId, phoneHash]）。
  const onOther = await service.addContact(other.id, contactInput({ name: '同号另一客户' }));
  assert.ok(onOther.id);

  // 第二个 isPrimary=true 同事务清除第一个。
  const second = await service.addContact(
    customer.id,
    contactInput({ name: '配偶', phone: '13533334444', relation: '配偶', isPrimary: true }),
  );
  assert.equal(second.isPrimary, true);
  assert.equal((await prisma.contact.findUniqueOrThrow({ where: { id: first.id } })).isPrimary, false);
  assert.equal((await prisma.contact.findUniqueOrThrow({ where: { id: second.id } })).isPrimary, true);

  await assert.rejects(
    () => serviceFor(userId, actor, { permissionCodes: ['customer.read'] })
      .addContact(customer.id, contactInput({ phone: '13555556666' })),
    hasCode('PERMISSION_DENIED'),
  );
});

test('updateContact re-normalizes phone, re-applies primary exclusivity and maps P2002 to 409', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const customer = await service.createCustomer(customerInput());
  const first = await service.addContact(customer.id, contactInput({ isPrimary: true }));
  const second = await service.addContact(
    customer.id,
    contactInput({ name: '第二联系人', phone: '13533334444' }),
  );

  const updated = await service.updateContact(customer.id, second.id, {
    phone: '+86 135-7777-8888',
    isPrimary: true,
  });
  assert.equal(updated.isPrimary, true);
  const storedSecond = await prisma.contact.findUniqueOrThrow({ where: { id: second.id } });
  assert.equal(storedSecond.phone, '13577778888');
  assert.equal(storedSecond.phoneHash, hashPhone(normalizePhone('13577778888')));
  assert.equal((await prisma.contact.findUniqueOrThrow({ where: { id: first.id } })).isPrimary, false);

  // 改成与第一联系人同电话 → 唯一冲突 409。
  await assert.rejects(
    () => service.updateContact(customer.id, second.id, { phone: '13511112222' }),
    error => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 409,
  );

  await assert.rejects(
    () => service.updateContact(customer.id, randomUUID(), { relation: '不存在' }),
    hasCode(LEAD_NOT_FOUND),
  );
  // 跨客户串改：contact 属于 other 客户时必须 404。
  const other = await service.createCustomer(customerInput({ name: '另一客户', phone: '13899990001' }));
  await assert.rejects(
    () => service.updateContact(other.id, first.id, { relation: '串改' }),
    hasCode(LEAD_NOT_FOUND),
  );
});

test('removeContact soft-deletes and listContacts excludes deleted rows in createdAt order', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const customer = await service.createCustomer(customerInput());
  const first = await service.addContact(customer.id, contactInput({ name: '联系人一' }));
  const second = await service.addContact(
    customer.id,
    contactInput({ name: '联系人二', phone: '13533334444' }),
  );
  const third = await service.addContact(
    customer.id,
    contactInput({ name: '联系人三', phone: '13555556666' }),
  );

  await service.removeContact(customer.id, second.id);

  const remaining = await service.listContacts(customer.id);
  assert.deepEqual(remaining.map(item => item.id), [first.id, third.id]);
  const removed = await prisma.contact.findUniqueOrThrow({ where: { id: second.id } });
  assert.ok(removed.deletedAt instanceof Date);

  await assert.rejects(() => service.removeContact(customer.id, second.id), hasCode(LEAD_NOT_FOUND));
});

test('contact views mask phone by customer.read field capability and audit raw disclosure', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const customer = await service.createCustomer(customerInput());
  await service.addContact(customer.id, contactInput({ wechat: 'wx-contact-001' }));

  const masked = await service.listContacts(customer.id);
  assert.equal(masked[0].phone, '135****2222');
  assert.equal(masked[0].wechat, '***');
  assert.equal(await prisma.operationLog.count({ where: { action: 'READ_L3_FIELDS' } }), 0);

  const reader = serviceFor(userId, actor, {
    fieldRules: [{
      sourceRoleId: 'test-role',
      resource: 'customer',
      fieldCode: 'customer.phone',
      readLevel: 'READ',
      canWrite: true,
      canExport: false,
    }],
  });
  const raw = await reader.listContacts(customer.id);
  assert.equal(raw[0].phone, '13511112222');
  assert.equal(raw[0].wechat, '***');
  const audit = await prisma.operationLog.findFirstOrThrow({
    where: { action: 'READ_L3_FIELDS', targetType: 'CUSTOMER', targetId: customer.id },
  });
  assert.match(audit.newValues ?? '', /customer\.phone/);
  assert.doesNotMatch(audit.newValues ?? '', /13511112222/);
});

test('contact operations hide out-of-scope customers without leaking existence', async () => {
  const { userId, actor } = await createActor();
  const branch = await createOrganizationFixture('BRANCH_MAIN');
  const other = await createOrganizationFixture('BRANCH_OTHER');
  const clerk = await createEmployeeInOrg(branch.id, '分所客服');
  const branchScope = await prisma.dataScope.create({
    data: { name: `branch-${randomUUID()}`, scopeType: 'BRANCH', organizationId: branch.id },
  });
  const outLead = await seedLead({ branchId: other.id });
  const custOut = await seedCustomer({ sourceLeadId: outLead.id });
  const seededContact = await prisma.contact.create({
    data: {
      customerId: custOut.id,
      name: '外所联系人',
      phone: '13599990000',
      phoneHash: hashPhone('13599990000'),
      createdBy: 'seed',
    },
  });

  const scoped = serviceFor(userId, actor, { employeeId: clerk.id, scopeIds: [branchScope.id] });
  await assert.rejects(() => scoped.listContacts(custOut.id), hasCode(LEAD_NOT_FOUND));
  await assert.rejects(() => scoped.addContact(custOut.id, contactInput()), hasCode(LEAD_NOT_FOUND));
  await assert.rejects(
    () => scoped.updateContact(custOut.id, seededContact.id, { relation: '越权' }),
    hasCode(LEAD_NOT_FOUND),
  );
  await assert.rejects(() => scoped.removeContact(custOut.id, seededContact.id), hasCode(LEAD_NOT_FOUND));
  await assert.rejects(
    () => serviceFor(userId, actor, { permissionCodes: ['customer.create'] })
      .listContacts(custOut.id),
    hasCode('PERMISSION_DENIED'),
  );
});

// ==================== SPEC-031 客户经营分析（复购 + 转介绍）====================

async function seedContract(customerId: string, overrides: Partial<Prisma.ContractUncheckedCreateInput> = {}) {
  const id = randomUUID();
  return prisma.contract.create({
    data: {
      id,
      contractNo: `CT-SEED-${id}`,
      contractType: 'FORMAL',
      title: '合同',
      customerId,
      sourceType: 'CUSTOMER',
      status: 'EFFECTIVE',
      createdBy: 'seed',
      ...overrides,
    },
  });
}

test('getCustomer aggregates repurchase and referral metrics into the view (SPEC-031)', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const customer = await seedCustomer();
  // 三份合同（首单 + 复购 2）——其中一份已软删应排除。
  await seedContract(customer.id, { createdAt: new Date('2026-01-01T00:00:00.000Z') });
  await seedContract(customer.id, { createdAt: new Date('2026-06-01T00:00:00.000Z') });
  await seedContract(customer.id, { createdAt: new Date('2026-03-01T00:00:00.000Z'), deletedAt: new Date() });
  // 两条线索引荐（referralCustomerId=本客户）。
  await seedLead({ referralCustomerId: customer.id });
  await seedLead({ referralCustomerId: customer.id });

  const view = await service.getCustomer(customer.id);
  assert.equal(view.contractCount, 2, 'soft-deleted contract is excluded');
  assert.equal(view.repurchaseCount, 1, 'one first order + one repurchase');
  assert.equal(view.referralCount, 2, 'two leads referred by this customer');
  assert.equal(view.firstContractAt?.toISOString(), new Date('2026-01-01T00:00:00.000Z').toISOString());
  assert.equal(view.latestContractAt?.toISOString(), new Date('2026-06-01T00:00:00.000Z').toISOString());
});

test('getCustomer returns zero metrics for a customer with no contracts or referrals (SPEC-031)', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const customer = await seedCustomer();

  const view = await service.getCustomer(customer.id);
  assert.equal(view.contractCount, 0);
  assert.equal(view.repurchaseCount, 0);
  assert.equal(view.referralCount, 0);
  assert.equal(view.firstContractAt, null);
  assert.equal(view.latestContractAt, null);
});

test('listCustomers batch-aggregates metrics across the page (SPEC-031)', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const repeatCustomer = await seedCustomer({ name: '复购客户' });
  const newCustomer = await seedCustomer({ name: '新客' });
  await seedContract(repeatCustomer.id, {});
  await seedContract(repeatCustomer.id, {});
  await seedLead({ referralCustomerId: repeatCustomer.id });

  const page = await service.listCustomers({ page: 1, pageSize: 10, keyword: '客' });
  const repeat = page.list.find(item => item.id === repeatCustomer.id);
  const fresh = page.list.find(item => item.id === newCustomer.id);
  assert.ok(repeat, 'repeat customer is in the page');
  assert.equal(repeat.contractCount, 2);
  assert.equal(repeat.repurchaseCount, 1);
  assert.equal(repeat.referralCount, 1);
  assert.ok(fresh, 'new customer is in the page');
  assert.equal(fresh.contractCount, 0, 'batch aggregation leaves unrelated customers at zero');
  assert.equal(fresh.referralCount, 0);
});
