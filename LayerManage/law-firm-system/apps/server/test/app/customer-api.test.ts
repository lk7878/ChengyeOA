import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { createApiSession } from '../helpers/auth-session';

// SPEC-009 Task 10: customer HTTP API 端到端测试（客户主数据 + 联系人）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/app/customer-api.test.ts

process.env.EGG_TYPESCRIPT = 'true';

const app = mm.app();
let prisma: PrismaClient;

interface CrmSessionOptions {
  permissions: string[];
  scopeType?: 'ALL' | 'SELF';
  employeeId?: string | null;
  l3Read?: Array<{ resource: 'customer'; fieldCode: string }>;
}

/** 业务会话夹具：BUSINESS 角色 + RolePermission 直插 + 每 resource 一行数据范围。 */
async function createCrmSession(options: CrmSessionOptions): Promise<{ userId: string; token: string }> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      username: `crm.cust.${suffix}`,
      password: 'not-used',
      employeeId: options.employeeId ?? null,
    },
  });
  const role = await prisma.role.create({
    data: {
      name: `CRM CUST ${suffix}`,
      code: `CRM_CUST_${suffix.replaceAll('-', '').slice(0, 20).toUpperCase()}`,
      type: 'BUSINESS',
      permissions: {
        create: options.permissions.map(code => ({ permission: { connect: { code } } })),
      },
    },
  });
  const resources = [...new Set(options.permissions.map(code => code.split('.')[0]))];
  for (const resource of resources) {
    const dataScope = await prisma.dataScope.create({
      data: { name: `Scope ${resource} ${suffix}`, scopeType: options.scopeType ?? 'ALL' },
    });
    await prisma.roleDataScope.create({
      data: { roleId: role.id, resource, dataScopeId: dataScope.id },
    });
  }
  for (const rule of options.l3Read ?? []) {
    await prisma.fieldPermission.create({
      data: {
        roleId: role.id,
        resource: rule.resource,
        fieldCode: rule.fieldCode,
        readLevel: 'READ',
        canWrite: true,
      },
    });
  }
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const token = (await createApiSession(prisma, user.id)).token;
  return { userId: user.id, token };
}

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function createEmployeeFixture() {
  const orgId = randomUUID();
  await prisma.organization.create({
    data: {
      id: orgId,
      code: `CUST_ORG_${orgId.replaceAll('-', '').slice(0, 12)}`,
      name: 'Customer Fixture Org',
      type: 'BRANCH',
      path: `/${orgId}`,
    },
  });
  const position = await prisma.position.create({
    data: {
      organizationId: orgId,
      code: `POS_${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      name: 'Fixture Position',
      categoryCode: 'STAFF',
    },
  });
  return prisma.employee.create({
    data: {
      employeeNo: `EMP_${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      name: 'Fixture Employee',
      phone: `1${randomUUID().replaceAll('-', '').slice(0, 10)}`,
      type: 'SALES',
      status: 'FORMAL',
      entryDate: new Date('2025-01-01'),
      assignments: {
        create: {
          organizationId: orgId,
          positionId: position.id,
          assignmentType: 'PRIMARY',
          startedAt: new Date('2025-01-01'),
        },
      },
    },
  });
}

test.before(async () => {
  prisma = createTestPrisma();
  await app.ready();
});

test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
  await app.close();
  await mm.restore();
});

test('requires authentication for customer endpoints', async () => {
  await app.httpRequest().get('/api/v1/customers').expect(401);
  await app.httpRequest().post('/api/v1/customers').send({ name: '张三', phone: '13800001234' }).expect(401);
  await app.httpRequest().get(`/api/v1/customers/${randomUUID()}`).expect(401);
  await app.httpRequest().patch(`/api/v1/customers/${randomUUID()}`).send({ name: '改名' }).expect(401);
  await app.httpRequest()
    .post(`/api/v1/customers/${randomUUID()}/contacts`)
    .send({ name: '联系人', phone: '13800001234' })
    .expect(401);
  await app.httpRequest().get(`/api/v1/customers/${randomUUID()}/contacts`).expect(401);
});

test('rejects authenticated users without customer permissions', async () => {
  const ordinary = await createCrmSession({ permissions: [] });
  const denied = await app.httpRequest()
    .post('/api/v1/customers')
    .set(bearer(ordinary.token))
    .send({ name: '张三', phone: '13800001234' })
    .expect(403);
  assert.equal(denied.body.message, 'PERMISSION_DENIED');
  await app.httpRequest().get('/api/v1/customers').set(bearer(ordinary.token)).expect(403);
  await app.httpRequest()
    .get(`/api/v1/customers/${randomUUID()}/contacts`)
    .set(bearer(ordinary.token))
    .expect(403);
});

test('creates, reads, lists, and updates customers with masked L3 output by default', async () => {
  const session = await createCrmSession({
    permissions: ['customer.create', 'customer.read', 'customer.update'],
  });

  const created = await app.httpRequest()
    .post('/api/v1/customers')
    .set(bearer(session.token))
    .send({ name: '李四', phone: '13900002222', wechat: 'wx-cust-001', customerType: 'INDIVIDUAL' })
    .expect(200);
  assert.equal(created.body.code, 200);
  assert.match(created.body.data.customerNo, /^CU\d{6}-[0-9A-Z]{6}$/);
  assert.equal(created.body.data.status, 'POTENTIAL');
  assert.equal(created.body.data.sourceLeadId, null);
  // 无 L3 字段授权：默认脱敏。
  assert.equal(created.body.data.phone, '139****2222');
  assert.equal(created.body.data.wechat, '***');
  assert.equal(JSON.stringify(created.body).includes('13900002222'), false);
  const customerId = created.body.data.id;

  const detail = await app.httpRequest()
    .get(`/api/v1/customers/${customerId}`)
    .set(bearer(session.token))
    .expect(200);
  assert.equal(detail.body.data.id, customerId);
  assert.equal(detail.body.data.phone, '139****2222');

  const list = await app.httpRequest()
    .get('/api/v1/customers')
    .set(bearer(session.token))
    .expect(200);
  assert.equal(list.body.data.total, 1);
  assert.equal(list.body.data.list[0].id, customerId);

  const updated = await app.httpRequest()
    .patch(`/api/v1/customers/${customerId}`)
    .set(bearer(session.token))
    .send({ name: '李四改名', remark: '重点客户', status: 'INTENT' })
    .expect(200);
  assert.equal(updated.body.data.name, '李四改名');
  assert.equal(updated.body.data.remark, '重点客户');
  assert.equal(updated.body.data.status, 'INTENT');
  assert.equal(updated.body.data.version, 2);

  // 非法枚举与未知键：400。
  await app.httpRequest()
    .patch(`/api/v1/customers/${customerId}`)
    .set(bearer(session.token))
    .send({ status: 'NOT_A_STATUS' })
    .expect(400);
  await app.httpRequest()
    .patch(`/api/v1/customers/${customerId}`)
    .set(bearer(session.token))
    .send({ unexpected: true })
    .expect(400);
});

test('audits plaintext L3 reads for users with a customer field grant', async () => {
  const reader = await createCrmSession({
    permissions: ['customer.create', 'customer.read'],
    l3Read: [
      { resource: 'customer', fieldCode: 'customer.phone' },
      { resource: 'customer', fieldCode: 'customer.wechat' },
    ],
  });
  const created = await app.httpRequest()
    .post('/api/v1/customers')
    .set(bearer(reader.token))
    .send({ name: '明文客户', phone: '13900003333', wechat: 'wx-plain-001' })
    .expect(200);
  const customerId = created.body.data.id;

  const detail = await app.httpRequest()
    .get(`/api/v1/customers/${customerId}`)
    .set(bearer(reader.token))
    .expect(200);
  assert.equal(detail.body.data.phone, '13900003333');
  assert.equal(detail.body.data.wechat, 'wx-plain-001');

  const audit = await prisma.operationLog.findFirst({
    where: { userId: reader.userId, action: 'READ_L3_FIELDS', targetType: 'CUSTOMER', targetId: customerId },
  });
  assert.ok(audit, 'expected a READ_L3_FIELDS audit row for the plaintext customer read');
  assert.equal(JSON.stringify(audit.newValues).includes('13900003333'), false);
  assert.equal(JSON.stringify(audit.newValues).includes('wx-plain-001'), false);
});

test('manages contacts and carries the duplicate-phone conflict as 409', async () => {
  const session = await createCrmSession({
    permissions: ['customer.create', 'customer.read', 'customer.update'],
  });
  const created = await app.httpRequest()
    .post('/api/v1/customers')
    .set(bearer(session.token))
    .send({ name: '联系人宿主', phone: '13900004444' })
    .expect(200);
  const customerId = created.body.data.id;

  const primary = await app.httpRequest()
    .post(`/api/v1/customers/${customerId}/contacts`)
    .set(bearer(session.token))
    .send({ name: '王五', phone: '13711112222', relation: '本人', isPrimary: true })
    .expect(200);
  assert.equal(primary.body.data.isPrimary, true);
  assert.equal(primary.body.data.customerId, customerId);

  // 同一客户下电话重复：实例携带 409（而非 400/500），稳定码 VALIDATION_FAILED。
  const duplicate = await app.httpRequest()
    .post(`/api/v1/customers/${customerId}/contacts`)
    .set(bearer(session.token))
    .send({ name: '王五重复', phone: '13711112222' })
    .expect(409);
  assert.equal(duplicate.body.message, 'VALIDATION_FAILED');

  const second = await app.httpRequest()
    .post(`/api/v1/customers/${customerId}/contacts`)
    .set(bearer(session.token))
    .send({ name: '赵六', phone: '13711113333', isPrimary: true })
    .expect(200);
  // isPrimary 切换：旧主联系人标记被同事务清除。
  const firstAfterSwitch = await prisma.contact.findUniqueOrThrow({ where: { id: primary.body.data.id } });
  assert.equal(firstAfterSwitch.isPrimary, false);
  assert.equal(second.body.data.isPrimary, true);

  const patched = await app.httpRequest()
    .patch(`/api/v1/customers/${customerId}/contacts/${second.body.data.id}`)
    .set(bearer(session.token))
    .send({ relation: '配偶', wechat: 'wx-contact-002' })
    .expect(200);
  assert.equal(patched.body.data.relation, '配偶');

  // 更新为已存在的电话：同样 409。
  const updateConflict = await app.httpRequest()
    .patch(`/api/v1/customers/${customerId}/contacts/${second.body.data.id}`)
    .set(bearer(session.token))
    .send({ phone: '13711112222' })
    .expect(409);
  assert.equal(updateConflict.body.message, 'VALIDATION_FAILED');

  await app.httpRequest()
    .delete(`/api/v1/customers/${customerId}/contacts/${second.body.data.id}`)
    .set(bearer(session.token))
    .expect(200);
  const removed = await prisma.contact.findUniqueOrThrow({ where: { id: second.body.data.id } });
  assert.ok(removed.deletedAt, 'expected the contact to be soft-deleted');

  // 不存在的联系人：404（不泄露存在性）。
  await app.httpRequest()
    .delete(`/api/v1/customers/${customerId}/contacts/${randomUUID()}`)
    .set(bearer(session.token))
    .expect(404);

  // GET contacts（用户裁决 C1 增量）：返回未软删联系人，默认脱敏。
  const contacts = await app.httpRequest()
    .get(`/api/v1/customers/${customerId}/contacts`)
    .set(bearer(session.token))
    .expect(200);
  assert.equal(contacts.body.data.length, 1);
  assert.equal(contacts.body.data[0].id, primary.body.data.id);
  assert.equal(contacts.body.data[0].name, '王五');
  assert.equal(contacts.body.data[0].phone, '137****2222');
  assert.equal(JSON.stringify(contacts.body).includes('13711112222'), false);
});

test('hides customers outside the caller scope with 404 and validates transport input', async () => {
  const owner = await createCrmSession({ permissions: ['customer.create', 'customer.read'] });
  const created = await app.httpRequest()
    .post('/api/v1/customers')
    .set(bearer(owner.token))
    .send({ name: '属主客户', phone: '13900005555' })
    .expect(200);
  const customerId = created.body.data.id;

  // SELF 范围锚定 createdBy：他人创建的客户不可见。
  const employee = await createEmployeeFixture();
  const outsider = await createCrmSession({
    permissions: ['customer.read', 'customer.update'],
    scopeType: 'SELF',
    employeeId: employee.id,
  });
  const hidden = await app.httpRequest()
    .get(`/api/v1/customers/${customerId}`)
    .set(bearer(outsider.token))
    .expect(404);
  assert.equal(hidden.body.message, 'LEAD_NOT_FOUND');
  await app.httpRequest()
    .patch(`/api/v1/customers/${customerId}`)
    .set(bearer(outsider.token))
    .send({ name: '越权改名' })
    .expect(404);

  // 传输层校验：缺 phone / 未知键 / 非法电话。
  await app.httpRequest()
    .post('/api/v1/customers')
    .set(bearer(owner.token))
    .send({ name: '缺电话' })
    .expect(400);
  await app.httpRequest()
    .post('/api/v1/customers')
    .set(bearer(owner.token))
    .send({ name: '非法电话', phone: 'abc-not-phone' })
    .expect(400);
});

test('lists contacts with scope enforcement and plaintext L3 auditing', async () => {
  const owner = await createCrmSession({ permissions: ['customer.create', 'customer.update'] });
  const created = await app.httpRequest()
    .post('/api/v1/customers')
    .set(bearer(owner.token))
    .send({ name: '联系人可见性宿主', phone: '13900007777' })
    .expect(200);
  const customerId = created.body.data.id;
  await app.httpRequest()
    .post(`/api/v1/customers/${customerId}/contacts`)
    .set(bearer(owner.token))
    .send({ name: '可见联系人', phone: '13722221111', wechat: 'wx-visible-01' })
    .expect(200);

  // SELF 范围锚定 createdBy：他人客户联系人列表 404（不泄露存在性）。
  const employee = await createEmployeeFixture();
  const outsider = await createCrmSession({
    permissions: ['customer.read'],
    scopeType: 'SELF',
    employeeId: employee.id,
  });
  const hidden = await app.httpRequest()
    .get(`/api/v1/customers/${customerId}/contacts`)
    .set(bearer(outsider.token))
    .expect(404);
  assert.equal(hidden.body.message, 'LEAD_NOT_FOUND');

  // 持有人但无客户读权限：403（requirePermission 先于服务层）。
  const noRead = await createCrmSession({ permissions: ['customer.update'] });
  await app.httpRequest()
    .get(`/api/v1/customers/${customerId}/contacts`)
    .set(bearer(noRead.token))
    .expect(403);

  // L3 字段授权读者：明文输出 + READ_L3_FIELDS 审计（审计不落地明文）。
  const reader = await createCrmSession({
    permissions: ['customer.read'],
    l3Read: [
      { resource: 'customer', fieldCode: 'customer.phone' },
      { resource: 'customer', fieldCode: 'customer.wechat' },
    ],
  });
  const plain = await app.httpRequest()
    .get(`/api/v1/customers/${customerId}/contacts`)
    .set(bearer(reader.token))
    .expect(200);
  assert.equal(plain.body.data.length, 1);
  assert.equal(plain.body.data[0].phone, '13722221111');
  assert.equal(plain.body.data[0].wechat, 'wx-visible-01');
  const audit = await prisma.operationLog.findFirst({
    where: { userId: reader.userId, action: 'READ_L3_FIELDS', targetType: 'CUSTOMER', targetId: customerId },
  });
  assert.ok(audit, 'expected a READ_L3_FIELDS audit row for the plaintext contacts read');
  assert.equal(JSON.stringify(audit.newValues).includes('13722221111'), false);
  assert.equal(JSON.stringify(audit.newValues).includes('wx-visible-01'), false);
});

test('does not expose prototype routes removed by the rebuild', async () => {
  const session = await createCrmSession({
    permissions: ['customer.create', 'customer.read', 'customer.update'],
  });
  const created = await app.httpRequest()
    .post('/api/v1/customers')
    .set(bearer(session.token))
    .send({ name: '路由锁定', phone: '13900006666' })
    .expect(200);
  const customerId = created.body.data.id;

  // 原型路由（PUT/DELETE/跨模块只读子资源）已整体移除。
  await app.httpRequest()
    .put(`/api/v1/customers/${customerId}`)
    .set(bearer(session.token))
    .send({ name: 'PUT 不应存在' })
    .expect(404);
  await app.httpRequest()
    .delete(`/api/v1/customers/${customerId}`)
    .set(bearer(session.token))
    .expect(404);
  await app.httpRequest()
    .get(`/api/v1/customers/${customerId}/contracts`)
    .set(bearer(session.token))
    .expect(404);
  await app.httpRequest()
    .get(`/api/v1/customers/${customerId}/cases`)
    .set(bearer(session.token))
    .expect(404);
  await app.httpRequest()
    .get(`/api/v1/customers/${customerId}/payments`)
    .set(bearer(session.token))
    .expect(404);
});
