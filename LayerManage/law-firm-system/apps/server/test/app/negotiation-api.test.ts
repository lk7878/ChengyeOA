import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { createApiSession } from '../helpers/auth-session';
import { hashPhone } from '../../app/domain/crm/lead-policy';

// SPEC-010 Task 10: negotiation HTTP API 端到端测试（contract-factory + controller + router）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/app/negotiation-api.test.ts

process.env.EGG_TYPESCRIPT = 'true';

const app = mm.app();
let prisma: PrismaClient;

type ScopeFixture =
  | { kind: 'ALL' }
  | { kind: 'SELF' }
  | { kind: 'TEAM'; professionalTeamId: string }
  | { kind: 'BRANCH'; organizationId: string; includeDescendants?: boolean }
  | { kind: 'ORG'; organizationId: string };

interface ContractSessionOptions {
  permissions: string[];
  scope?: ScopeFixture;
  employeeId?: string | null;
}

/** 业务会话夹具（仿 lead-api T10 先例）：BUSINESS 角色 + RolePermission connect by code + 每 resource 一行数据范围。 */
async function createContractSession(options: ContractSessionOptions): Promise<{ userId: string; token: string }> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      username: `contract.negot.${suffix}`,
      password: 'not-used',
      employeeId: options.employeeId ?? null,
    },
  });
  const role = await prisma.role.create({
    data: {
      name: `CONTRACT NEGOT ${suffix}`,
      code: `CT_NEG_${suffix.replaceAll('-', '').slice(0, 20).toUpperCase()}`,
      type: 'BUSINESS',
      permissions: {
        create: options.permissions.map(code => ({ permission: { connect: { code } } })),
      },
    },
  });
  const scope = options.scope ?? { kind: 'ALL' };
  const resources = [...new Set(options.permissions.map(code => code.split('.')[0]))];
  for (const resource of resources) {
    const dataScope = await prisma.dataScope.create({
      data: {
        name: `Scope ${resource} ${suffix}`,
        scopeType: scope.kind,
        includeDescendants: scope.kind === 'BRANCH' ? scope.includeDescendants ?? true : false,
        organizationId: scope.kind === 'BRANCH' || scope.kind === 'ORG' ? scope.organizationId : null,
        professionalTeamId: scope.kind === 'TEAM' ? scope.professionalTeamId : null,
      },
    });
    await prisma.roleDataScope.create({
      data: { roleId: role.id, resource, dataScopeId: dataScope.id },
    });
  }
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const token = (await createApiSession(prisma, user.id)).token;
  return { userId: user.id, token };
}

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function createOrgFixture(code: string, parent?: { id: string; path: string }) {
  const id = randomUUID();
  return prisma.organization.create({
    data: {
      id,
      code: `${code}_${id.replaceAll('-', '').slice(0, 12)}`,
      name: code,
      type: 'BRANCH',
      parentId: parent?.id,
      path: parent ? `${parent.path}/${id}` : `/${id}`,
      level: parent ? parent.path.split('/').length - 1 : 0,
    },
  });
}

async function createTeamFixture(homeOrganizationId: string, code: string) {
  return prisma.professionalTeam.create({
    data: {
      code: `TEAM_${code}_${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      name: `Team ${code}`,
      categoryCode: 'CIVIL',
      homeOrganizationId,
    },
  });
}

async function createEmployeeFixture() {
  const org = await createOrgFixture('NEG_EMP_ORG');
  const position = await prisma.position.create({
    data: {
      organizationId: org.id,
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
          organizationId: org.id,
          positionId: position.id,
          assignmentType: 'PRIMARY',
          startedAt: new Date('2025-01-01'),
        },
      },
    },
  });
}

async function createCustomerFixture(createdBy: string) {
  return prisma.customer.create({
    data: {
      customerNo: `CU-NEG-${randomUUID()}`,
      name: '谈案客户',
      phone: '13900001111',
      phoneHash: hashPhone('13900001111'),
      status: 'INTENT',
      createdBy,
    },
  });
}

async function createLeadFixture(createdBy: string) {
  return prisma.lead.create({
    data: {
      leadNo: `L-NEG-${randomUUID()}`,
      name: '谈案来源线索',
      phone: '13700009999',
      phoneHash: hashPhone('13700009999'),
      status: 'VISITED',
      poolStatus: 'PRIVATE',
      createdBy,
    },
  });
}

async function createAppointmentFixture(leadId: string, createdBy: string) {
  return prisma.appointment.create({
    data: {
      appointmentNo: `AP-NEG-${randomUUID()}`,
      leadId,
      scheduledAt: new Date('2026-08-01T10:00:00Z'),
      channel: 'ONSITE',
      createdBy,
    },
  });
}

async function seedNegotiation(overrides: Partial<Prisma.NegotiationUncheckedCreateInput> & {
  customerId: string;
  negotiatorEmployeeId: string;
  createdBy: string;
}) {
  return prisma.negotiation.create({
    data: {
      negotiationNo: `NE-API-${randomUUID()}`,
      status: 'NEGOTIATING',
      ...overrides,
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

test('requires authentication for every negotiation endpoint', async () => {
  await app.httpRequest().get('/api/v1/negotiations').expect(401);
  await app.httpRequest().post('/api/v1/negotiations').send({ customerId: randomUUID() }).expect(401);
  await app.httpRequest().get(`/api/v1/negotiations/${randomUUID()}`).expect(401);
  await app.httpRequest().patch(`/api/v1/negotiations/${randomUUID()}`).send({ remark: 'x' }).expect(401);
  await app.httpRequest()
    .post(`/api/v1/negotiations/${randomUUID()}/close`)
    .send({ outcome: 'SIGNED' })
    .expect(401);
});

test('rejects authenticated users without negotiation permissions', async () => {
  const ordinary = await createContractSession({ permissions: [] });
  const denied = await app.httpRequest()
    .post('/api/v1/negotiations')
    .set(bearer(ordinary.token))
    .send({ customerId: randomUUID(), negotiatorEmployeeId: randomUUID() })
    .expect(403);
  assert.equal(denied.body.message, 'PERMISSION_DENIED');
  await app.httpRequest().get('/api/v1/negotiations').set(bearer(ordinary.token)).expect(403);
  await app.httpRequest()
    .post(`/api/v1/negotiations/${randomUUID()}/close`)
    .set(bearer(ordinary.token))
    .send({ outcome: 'SIGNED' })
    .expect(403);

  // 只有 negotiation.read：读通、写拒。
  const reader = await createContractSession({ permissions: ['negotiation.read'] });
  await app.httpRequest().get('/api/v1/negotiations').set(bearer(reader.token)).expect(200);
  await app.httpRequest()
    .post('/api/v1/negotiations')
    .set(bearer(reader.token))
    .send({ customerId: randomUUID(), negotiatorEmployeeId: randomUUID() })
    .expect(403);
});

test('creates, reads, updates, and closes negotiations through the API with audit rows', async () => {
  const session = await createContractSession({
    permissions: ['negotiation.create', 'negotiation.read', 'negotiation.update', 'customer.read'],
  });
  const customer = await createCustomerFixture(session.userId);
  const negotiator = await createEmployeeFixture();

  const created = await app.httpRequest()
    .post('/api/v1/negotiations')
    .set(bearer(session.token))
    .send({
      customerId: customer.id,
      negotiatorEmployeeId: negotiator.id,
      quotedAmount: '12800.50',
      customerConcerns: '担心周期过长',
    })
    .expect(200);
  assert.equal(created.body.code, 200);
  assert.match(created.body.data.negotiationNo, /^NE\d{6}-[0-9A-Z]{6}$/);
  assert.equal(created.body.data.status, 'NEGOTIATING');
  assert.equal(created.body.data.quotedAmount, '12800.50');
  assert.equal(created.body.data.version, 1);
  const negotiationId = created.body.data.id;

  const detail = await app.httpRequest()
    .get(`/api/v1/negotiations/${negotiationId}`)
    .set(bearer(session.token))
    .expect(200);
  assert.equal(detail.body.data.id, negotiationId);

  const list = await app.httpRequest()
    .get('/api/v1/negotiations')
    .set(bearer(session.token))
    .expect(200);
  assert.equal(list.body.data.total, 1);
  assert.equal(list.body.data.list[0].id, negotiationId);

  const updated = await app.httpRequest()
    .patch(`/api/v1/negotiations/${negotiationId}`)
    .set(bearer(session.token))
    .send({ quotedAmount: 15000, remark: '重点跟进' })
    .expect(200);
  assert.equal(updated.body.data.quotedAmount, '15000.00');
  assert.equal(updated.body.data.remark, '重点跟进');
  assert.equal(updated.body.data.version, 2);

  const closed = await app.httpRequest()
    .post(`/api/v1/negotiations/${negotiationId}/close`)
    .set(bearer(session.token))
    .send({ outcome: 'SIGNED' })
    .expect(200);
  assert.equal(closed.body.data.status, 'SIGNED');
  assert.ok(closed.body.data.signedAt, 'SIGNED close sets signedAt');

  // API 调用落 OperationLog（创建/更新/完结各一行，审计不含自由文本值）。
  const createAudit = await prisma.operationLog.findFirst({
    where: { userId: session.userId, action: 'NEGOTIATION_CREATE', targetType: 'NEGOTIATION', targetId: negotiationId },
  });
  assert.ok(createAudit, 'expected a NEGOTIATION_CREATE audit row from the API call');
  assert.equal(JSON.stringify(createAudit.newValues).includes('担心周期过长'), false);
  const closeAudit = await prisma.operationLog.findFirst({
    where: { userId: session.userId, action: 'NEGOTIATION_CLOSE', targetType: 'NEGOTIATION', targetId: negotiationId },
  });
  assert.ok(closeAudit, 'expected a NEGOTIATION_CLOSE audit row from the API call');
});

test('carries negotiation error codes through the API envelope', async () => {
  const session = await createContractSession({
    permissions: ['negotiation.create', 'negotiation.read', 'negotiation.update', 'customer.read'],
  });
  const customer = await createCustomerFixture(session.userId);
  const negotiator = await createEmployeeFixture();

  // 不存在：404 NEGOTIATION_NOT_FOUND。
  const missing = await app.httpRequest()
    .get(`/api/v1/negotiations/${randomUUID()}`)
    .set(bearer(session.token))
    .expect(404);
  assert.equal(missing.body.message, 'NEGOTIATION_NOT_FOUND');

  // 客户不存在：创建统一 404 不泄露。
  const noCustomer = await app.httpRequest()
    .post('/api/v1/negotiations')
    .set(bearer(session.token))
    .send({ customerId: randomUUID(), negotiatorEmployeeId: negotiator.id })
    .expect(404);
  assert.equal(noCustomer.body.message, 'NEGOTIATION_NOT_FOUND');

  // 伪造谈案人：VALIDATION_FAILED 400。
  const forgedEmployee = await app.httpRequest()
    .post('/api/v1/negotiations')
    .set(bearer(session.token))
    .send({ customerId: customer.id, negotiatorEmployeeId: randomUUID() })
    .expect(400);
  assert.equal(forgedEmployee.body.message, 'VALIDATION_FAILED');

  // 未知键：400。
  await app.httpRequest()
    .post('/api/v1/negotiations')
    .set(bearer(session.token))
    .send({ customerId: customer.id, negotiatorEmployeeId: negotiator.id, unexpected: true })
    .expect(400);

  // 完结后更新：409 CONTRACT_STATE_TRANSITION_INVALID。
  const created = await app.httpRequest()
    .post('/api/v1/negotiations')
    .set(bearer(session.token))
    .send({ customerId: customer.id, negotiatorEmployeeId: negotiator.id })
    .expect(200);
  await app.httpRequest()
    .post(`/api/v1/negotiations/${created.body.data.id}/close`)
    .set(bearer(session.token))
    .send({ outcome: 'UNSIGNED', unsignedReason: '价格未谈拢' })
    .expect(200);
  const updateClosed = await app.httpRequest()
    .patch(`/api/v1/negotiations/${created.body.data.id}`)
    .set(bearer(session.token))
    .send({ remark: '反悔改动' })
    .expect(409);
  assert.equal(updateClosed.body.message, 'CONTRACT_STATE_TRANSITION_INVALID');

  // UNSIGNED 缺原因：VALIDATION_FAILED 400。
  const created2 = await app.httpRequest()
    .post('/api/v1/negotiations')
    .set(bearer(session.token))
    .send({ customerId: customer.id, negotiatorEmployeeId: negotiator.id })
    .expect(200);
  const noReason = await app.httpRequest()
    .post(`/api/v1/negotiations/${created2.body.data.id}/close`)
    .set(bearer(session.token))
    .send({ outcome: 'UNSIGNED' })
    .expect(400);
  assert.equal(noReason.body.message, 'VALIDATION_FAILED');
});

test('validates appointmentId at creation (Task 6 Minor-2 ruling): forged 400, existing persisted', async () => {
  const session = await createContractSession({
    permissions: ['negotiation.create', 'negotiation.read', 'customer.read'],
  });
  const customer = await createCustomerFixture(session.userId);
  const negotiator = await createEmployeeFixture();

  // 伪造 appointmentId：VALIDATION_FAILED 400（服务层探针，不做归属链校验——closeout 已知项）。
  const forged = await app.httpRequest()
    .post('/api/v1/negotiations')
    .set(bearer(session.token))
    .send({ customerId: customer.id, negotiatorEmployeeId: negotiator.id, appointmentId: randomUUID() })
    .expect(400);
  assert.equal(forged.body.message, 'VALIDATION_FAILED');

  // 真实邀约：创建成功且 appointmentId 持久化。
  const lead = await createLeadFixture(session.userId);
  const appointment = await createAppointmentFixture(lead.id, session.userId);
  const created = await app.httpRequest()
    .post('/api/v1/negotiations')
    .set(bearer(session.token))
    .send({
      customerId: customer.id,
      negotiatorEmployeeId: negotiator.id,
      appointmentId: appointment.id,
    })
    .expect(200);
  assert.equal(created.body.data.appointmentId, appointment.id);
});

test('enforces SELF and TEAM data scopes on negotiation lists without leaking existence', async () => {
  const employeeA = await createEmployeeFixture();
  const employeeB = await createEmployeeFixture();
  const customer = await createCustomerFixture('seed');
  const branch = await createOrgFixture('NEG_SCOPE_BRANCH');
  const team = await createTeamFixture(branch.id, 'NEGSCOPE');
  const otherTeam = await createTeamFixture(branch.id, 'NEGOTHER');

  const asNegotiator = await seedNegotiation({
    customerId: customer.id, negotiatorEmployeeId: employeeA.id, createdBy: 'someone-else',
  });
  const outsiderOwned = await seedNegotiation({
    customerId: customer.id, negotiatorEmployeeId: employeeB.id, createdBy: 'someone-else',
  });
  const inTeam = await seedNegotiation({
    customerId: customer.id, negotiatorEmployeeId: employeeB.id, createdBy: 'someone-else',
    professionalTeamId: team.id,
  });
  await seedNegotiation({
    customerId: customer.id, negotiatorEmployeeId: employeeB.id, createdBy: 'someone-else',
    professionalTeamId: otherTeam.id,
  });

  // SELF：严格创建人；仅被指派为谈案人不会扩大本人的登记范围。
  const selfReader = await createContractSession({
    permissions: ['negotiation.read'],
    scope: { kind: 'SELF' },
    employeeId: employeeA.id,
  });
  const own = await seedNegotiation({ customerId: customer.id, negotiatorEmployeeId: employeeB.id, createdBy: selfReader.userId });
  await app.httpRequest().get(`/api/v1/negotiations/${asNegotiator.id}`).set(bearer(selfReader.token)).expect(404);
  const selfList = await app.httpRequest()
    .get('/api/v1/negotiations')
    .set(bearer(selfReader.token))
    .expect(200);
  assert.deepEqual(selfList.body.data.list.map((item: { id: string }) => item.id), [own.id]);
  const selfHidden = await app.httpRequest()
    .get(`/api/v1/negotiations/${outsiderOwned.id}`)
    .set(bearer(selfReader.token))
    .expect(404);
  assert.equal(selfHidden.body.message, 'NEGOTIATION_NOT_FOUND');

  // TEAM：锚 professionalTeamId。
  const teamReader = await createContractSession({
    permissions: ['negotiation.read'],
    scope: { kind: 'TEAM', professionalTeamId: team.id },
  });
  const teamList = await app.httpRequest()
    .get('/api/v1/negotiations')
    .set(bearer(teamReader.token))
    .expect(200);
  assert.deepEqual(teamList.body.data.list.map((item: { id: string }) => item.id), [inTeam.id]);
});

test('enforces BRANCH and ORG data scopes on negotiation lists', async () => {
  const employee = await createEmployeeFixture();
  const customer = await createCustomerFixture('seed');
  const branch = await createOrgFixture('NEG_BRANCH_MAIN');
  const branchChild = await createOrgFixture('NEG_BRANCH_CHILD', branch);
  const other = await createOrgFixture('NEG_BRANCH_OTHER');
  const org = await createOrgFixture('NEG_ORG_MAIN');
  const orgChild = await createOrgFixture('NEG_ORG_CHILD', org);

  const inBranch = await seedNegotiation({
    customerId: customer.id, negotiatorEmployeeId: employee.id, createdBy: 'seed', branchId: branch.id,
  });
  const inChild = await seedNegotiation({
    customerId: customer.id, negotiatorEmployeeId: employee.id, createdBy: 'seed', branchId: branchChild.id,
  });
  const outOfBranch = await seedNegotiation({
    customerId: customer.id, negotiatorEmployeeId: employee.id, createdBy: 'seed', branchId: other.id,
  });
  const inOrg = await seedNegotiation({
    customerId: customer.id, negotiatorEmployeeId: employee.id, createdBy: 'seed', branchId: org.id,
  });
  const inOrgChild = await seedNegotiation({
    customerId: customer.id, negotiatorEmployeeId: employee.id, createdBy: 'seed', branchId: orgChild.id,
  });

  // BRANCH：锚 branchId 含组织子树。
  const branchReader = await createContractSession({
    permissions: ['negotiation.read'],
    scope: { kind: 'BRANCH', organizationId: branch.id },
  });
  const branchList = await app.httpRequest()
    .get('/api/v1/negotiations')
    .set(bearer(branchReader.token))
    .expect(200);
  assert.deepEqual(
    branchList.body.data.list.map((item: { id: string }) => item.id).sort(),
    [inBranch.id, inChild.id].sort(),
  );
  await app.httpRequest()
    .get(`/api/v1/negotiations/${outOfBranch.id}`)
    .set(bearer(branchReader.token))
    .expect(404);

  // ORG：锚精确组织不含后代。
  const orgReader = await createContractSession({
    permissions: ['negotiation.read'],
    scope: { kind: 'ORG', organizationId: org.id },
  });
  const orgList = await app.httpRequest()
    .get('/api/v1/negotiations')
    .set(bearer(orgReader.token))
    .expect(200);
  assert.deepEqual(orgList.body.data.list.map((item: { id: string }) => item.id), [inOrg.id]);
  await app.httpRequest()
    .get(`/api/v1/negotiations/${inOrgChild.id}`)
    .set(bearer(orgReader.token))
    .expect(404);
});
