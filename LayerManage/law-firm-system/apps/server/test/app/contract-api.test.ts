import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { createApiSession } from '../helpers/auth-session';
import { hashPhone } from '../../app/domain/crm/lead-policy';

// SPEC-010 Task 10: contract HTTP API 端到端测试（创建四来源/提交-审批-签署-生效全链/动作路由/404 锁）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/app/contract-api.test.ts

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
      username: `contract.ct.${suffix}`,
      password: 'not-used',
      employeeId: options.employeeId ?? null,
    },
  });
  const role = await prisma.role.create({
    data: {
      name: `CONTRACT CT ${suffix}`,
      code: `CT_CT_${suffix.replaceAll('-', '').slice(0, 20).toUpperCase()}`,
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

const FULL_CONTRACT_PERMISSIONS = [
  'contract.create', 'contract.read', 'contract.submit', 'contract.approve',
  'contract.sign', 'contract.effect', 'contract.terminate', 'contract.void',
  'customer.read', 'payment.read',
];

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

async function createCustomerFixture(createdBy: string) {
  return prisma.customer.create({
    data: {
      customerNo: `CU-CT-${randomUUID()}`,
      name: '合同客户',
      phone: '13900001111',
      phoneHash: hashPhone('13900001111'),
      status: 'INTENT',
      createdBy,
    },
  });
}

async function seedContract(overrides: Partial<Prisma.ContractUncheckedCreateInput> & {
  customerId: string;
  createdBy: string;
}) {
  return prisma.contract.create({
    data: {
      contractNo: `CT-API-${randomUUID()}`,
      contractType: 'FIRST_SIGN',
      title: '种子合同',
      sourceType: 'CUSTOMER',
      status: 'DRAFT',
      ...overrides,
    },
  });
}

/** 经 API 把 RISK_NOTICE 推到 SIGNED（requiresApproval=false：submit 直落 PENDING_SIGN）。 */
async function signRiskNotice(token: string, customerId: string): Promise<string> {
  const created = await app.httpRequest()
    .post('/api/v1/contracts')
    .set(bearer(token))
    .send({ contractType: 'RISK_NOTICE', title: '风险告知书', customerId })
    .expect(200);
  const id = created.body.data.id as string;
  await app.httpRequest().post(`/api/v1/contracts/${id}/submit`).set(bearer(token)).send({}).expect(200);
  const signed = await app.httpRequest()
    .post(`/api/v1/contracts/${id}/sign`)
    .set(bearer(token))
    .send({})
    .expect(200);
  assert.equal(signed.body.data.status, 'SIGNED');
  return id;
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

test('requires authentication for every contract endpoint', async () => {
  await app.httpRequest().get('/api/v1/contracts').expect(401);
  await app.httpRequest().post('/api/v1/contracts').send({ title: 'x' }).expect(401);
  await app.httpRequest().get(`/api/v1/contracts/${randomUUID()}`).expect(401);
  await app.httpRequest().post(`/api/v1/contracts/${randomUUID()}/submit`).send({}).expect(401);
  await app.httpRequest().post(`/api/v1/contracts/${randomUUID()}/approve`).send({}).expect(401);
  await app.httpRequest().post(`/api/v1/contracts/${randomUUID()}/reject`).send({ comment: 'x' }).expect(401);
  await app.httpRequest().post(`/api/v1/contracts/${randomUUID()}/sign`).send({}).expect(401);
  await app.httpRequest().post(`/api/v1/contracts/${randomUUID()}/effect`).send({}).expect(401);
  await app.httpRequest().post(`/api/v1/contracts/${randomUUID()}/terminate`).send({ reason: 'x' }).expect(401);
  await app.httpRequest().post(`/api/v1/contracts/${randomUUID()}/void`).send({ reason: 'x' }).expect(401);
  await app.httpRequest().get(`/api/v1/contracts/${randomUUID()}/plans`).expect(401);
});

test('rejects authenticated users without contract permissions', async () => {
  const ordinary = await createContractSession({ permissions: [] });
  const denied = await app.httpRequest()
    .post('/api/v1/contracts')
    .set(bearer(ordinary.token))
    .send({ contractType: 'FIRST_SIGN', title: '合同', customerId: randomUUID() })
    .expect(403);
  assert.equal(denied.body.message, 'PERMISSION_DENIED');
  await app.httpRequest().get('/api/v1/contracts').set(bearer(ordinary.token)).expect(403);
  await app.httpRequest()
    .post(`/api/v1/contracts/${randomUUID()}/effect`)
    .set(bearer(ordinary.token))
    .send({})
    .expect(403);

  // 只有 contract.read：读通、写与动作拒。
  const reader = await createContractSession({ permissions: ['contract.read'] });
  await app.httpRequest().get('/api/v1/contracts').set(bearer(reader.token)).expect(200);
  await app.httpRequest()
    .post(`/api/v1/contracts/${randomUUID()}/submit`)
    .set(bearer(reader.token))
    .send({})
    .expect(403);
});

test('creates contracts from all four source types', async () => {
  const session = await createContractSession({ permissions: ['contract.create', 'contract.read', 'customer.read'] });
  const customer = await createCustomerFixture(session.userId);

  // CUSTOMER（缺省 sourceType）。
  const fromCustomer = await app.httpRequest()
    .post('/api/v1/contracts')
    .set(bearer(session.token))
    .send({ contractType: 'FIRST_SIGN', title: '客户直建合同', customerId: customer.id, amount: '12000' })
    .expect(200);
  assert.equal(fromCustomer.body.data.sourceType, 'CUSTOMER');
  assert.equal(fromCustomer.body.data.status, 'DRAFT');
  assert.equal(fromCustomer.body.data.amount, '12000.00');
  assert.match(fromCustomer.body.data.contractNo, /^FS-[A-Z0-9]+-[A-Z0-9]+-\d{4}-\d{4}$/);

  // NEGOTIATION（negotiationId 必填且客户归属一致——先直插一条谈案）。
  const negotiator = await prisma.employee.create({
    data: {
      employeeNo: `EMP_${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      name: '谈案人',
      phone: `1${randomUUID().replaceAll('-', '').slice(0, 10)}`,
      type: 'SALES',
      status: 'FORMAL',
      entryDate: new Date('2025-01-01'),
    },
  });
  const negotiation = await prisma.negotiation.create({
    data: {
      negotiationNo: `NE-CT-${randomUUID()}`,
      customerId: customer.id,
      negotiatorEmployeeId: negotiator.id,
      createdBy: session.userId,
    },
  });
  const fromNegotiation = await app.httpRequest()
    .post('/api/v1/contracts')
    .set(bearer(session.token))
    .send({
      contractType: 'FORMAL',
      title: '谈案来源合同',
      customerId: customer.id,
      sourceType: 'NEGOTIATION',
      negotiationId: negotiation.id,
    })
    .expect(200);
  assert.equal(fromNegotiation.body.data.sourceType, 'NEGOTIATION');
  assert.equal(fromNegotiation.body.data.negotiationId, negotiation.id);

  // ANALYSIS / CASE（sourceId 溯源引用）。
  const fromAnalysis = await app.httpRequest()
    .post('/api/v1/contracts')
    .set(bearer(session.token))
    .send({
      contractType: 'FIRST_SIGN',
      title: '分析委托来源合同',
      customerId: customer.id,
      sourceType: 'ANALYSIS',
      sourceId: randomUUID(),
    })
    .expect(200);
  assert.equal(fromAnalysis.body.data.sourceType, 'ANALYSIS');
  const fromCase = await app.httpRequest()
    .post('/api/v1/contracts')
    .set(bearer(session.token))
    .send({
      contractType: 'FORMAL',
      title: '案件来源合同',
      customerId: customer.id,
      sourceType: 'CASE',
      sourceId: randomUUID(),
    })
    .expect(200);
  assert.equal(fromCase.body.data.sourceType, 'CASE');

  // SUPPLEMENT 依附父合同。
  const supplement = await app.httpRequest()
    .post('/api/v1/contracts')
    .set(bearer(session.token))
    .send({
      contractType: 'SUPPLEMENT',
      title: '补充协议',
      customerId: customer.id,
      parentContractId: fromCustomer.body.data.id,
    })
    .expect(200);
  assert.equal(supplement.body.data.parentContractId, fromCustomer.body.data.id);

  const list = await app.httpRequest()
    .get('/api/v1/contracts')
    .set(bearer(session.token))
    .expect(200);
  assert.equal(list.body.data.total, 5);
});

test('drives the full submit-approve-sign-effect chain with plans, case creation, audit, and effect idempotency', async () => {
  const session = await createContractSession({ permissions: FULL_CONTRACT_PERMISSIONS });
  const customer = await createCustomerFixture(session.userId);
  await signRiskNotice(session.token, customer.id);

  const created = await app.httpRequest()
    .post('/api/v1/contracts')
    .set(bearer(session.token))
    .send({
      contractType: 'FORMAL',
      title: '正式委托合同',
      customerId: customer.id,
      amount: '12000',
      paymentTerms: JSON.stringify({
        plans: [
          { period: 1, dueDate: '2026-09-01', amount: '5000.00' },
          { period: 2, dueDate: '2026-10-01', amount: '7000.00' },
        ],
      }),
    })
    .expect(200);
  const contractId = created.body.data.id as string;

  const submitted = await app.httpRequest()
    .post(`/api/v1/contracts/${contractId}/submit`)
    .set(bearer(session.token))
    .send({})
    .expect(200);
  assert.equal(submitted.body.data.status, 'PENDING_APPROVAL');
  assert.equal(submitted.body.data.submittedBy, session.userId);

  const approved = await app.httpRequest()
    .post(`/api/v1/contracts/${contractId}/approve`)
    .set(bearer(session.token))
    .send({ comment: '同意' })
    .expect(200);
  assert.equal(approved.body.data.status, 'PENDING_SIGN');
  assert.equal(approved.body.data.approvedBy, session.userId);

  const signed = await app.httpRequest()
    .post(`/api/v1/contracts/${contractId}/sign`)
    .set(bearer(session.token))
    .send({ signDate: '2026-08-01T08:00:00Z' })
    .expect(200);
  assert.equal(signed.body.data.status, 'SIGNED');

  const effected = await app.httpRequest()
    .post(`/api/v1/contracts/${contractId}/effect`)
    .set(bearer(session.token))
    .send({ effectiveDate: '2026-08-02T00:00:00Z' })
    .expect(200);
  assert.equal(effected.body.data.status, 'EFFECTIVE');

  // 生效事务矩阵：应收计划两条 + FORMAL 案件最小建档。
  const plans = await app.httpRequest()
    .get(`/api/v1/contracts/${contractId}/plans`)
    .set(bearer(session.token))
    .expect(200);
  assert.equal(plans.body.data.length, 2);
  assert.equal(plans.body.data[0].period, 1);
  assert.equal(plans.body.data[0].amount, '5000.00');
  assert.equal(plans.body.data[1].amount, '7000.00');
  const createdCase = await prisma.case.findFirst({ where: { contractId } });
  assert.ok(createdCase, 'FORMAL effect must create a case in the same transaction');

  // API 调用落 OperationLog（创建/生效各一行，无自由文本）。
  const createAudit = await prisma.operationLog.findFirst({
    where: { userId: session.userId, action: 'CONTRACT_CREATE', targetType: 'CONTRACT', targetId: contractId },
  });
  assert.ok(createAudit, 'expected a CONTRACT_CREATE audit row from the API call');
  assert.equal(JSON.stringify(createAudit.newValues).includes('正式委托合同'), false);
  const effectAudit = await prisma.operationLog.findFirst({
    where: { userId: session.userId, action: 'CONTRACT_EFFECT', targetType: 'CONTRACT', targetId: contractId },
  });
  assert.ok(effectAudit, 'expected a CONTRACT_EFFECT audit row from the API call');

  // 幂等：effect 重放经 API 不翻倍（状态机天然幂等——返回现状，零副作用零事件零审计）。
  const replay = await app.httpRequest()
    .post(`/api/v1/contracts/${contractId}/effect`)
    .set(bearer(session.token))
    .send({})
    .expect(200);
  assert.equal(replay.body.data.status, 'EFFECTIVE');
  assert.equal(await prisma.paymentPlan.count({ where: { contractId } }), 2);
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'contract.effective', objectId: contractId } }),
    1,
  );
  assert.equal(
    await prisma.operationLog.count({
      where: { action: 'CONTRACT_EFFECT', targetType: 'CONTRACT', targetId: contractId },
    }),
    1,
  );

  // 终止。
  const terminated = await app.httpRequest()
    .post(`/api/v1/contracts/${contractId}/terminate`)
    .set(bearer(session.token))
    .send({ reason: '双方协商解除' })
    .expect(200);
  assert.equal(terminated.body.data.status, 'TERMINATED');
  assert.ok(terminated.body.data.terminatedAt);
});

test('supports reject-resubmit and void transitions', async () => {
  const session = await createContractSession({ permissions: FULL_CONTRACT_PERMISSIONS });
  const customer = await createCustomerFixture(session.userId);

  const created = await app.httpRequest()
    .post('/api/v1/contracts')
    .set(bearer(session.token))
    .send({ contractType: 'FIRST_SIGN', title: '驳回重提合同', customerId: customer.id })
    .expect(200);
  const contractId = created.body.data.id as string;
  await app.httpRequest().post(`/api/v1/contracts/${contractId}/submit`).set(bearer(session.token)).send({}).expect(200);

  // 驳回缺 comment：VALIDATION_FAILED 400。
  const noComment = await app.httpRequest()
    .post(`/api/v1/contracts/${contractId}/reject`)
    .set(bearer(session.token))
    .send({})
    .expect(400);
  assert.equal(noComment.body.message, 'VALIDATION_FAILED');

  const rejected = await app.httpRequest()
    .post(`/api/v1/contracts/${contractId}/reject`)
    .set(bearer(session.token))
    .send({ comment: '条款需修订' })
    .expect(200);
  assert.equal(rejected.body.data.status, 'DRAFT');

  // DRAFT 可重新提交（状态机天然允许）。
  const resubmitted = await app.httpRequest()
    .post(`/api/v1/contracts/${contractId}/submit`)
    .set(bearer(session.token))
    .send({})
    .expect(200);
  assert.equal(resubmitted.body.data.status, 'PENDING_APPROVAL');

  // 作废（PENDING_APPROVAL 可作废）。
  const voided = await app.httpRequest()
    .post(`/api/v1/contracts/${contractId}/void`)
    .set(bearer(session.token))
    .send({ reason: '客户撤单' })
    .expect(200);
  assert.equal(voided.body.data.status, 'VOID');
  assert.ok(voided.body.data.voidedAt);
});

test('carries contract error codes through the API envelope', async () => {
  const session = await createContractSession({ permissions: FULL_CONTRACT_PERMISSIONS });
  const customer = await createCustomerFixture(session.userId);

  // 不存在：404 CONTRACT_NOT_FOUND。
  const missing = await app.httpRequest()
    .get(`/api/v1/contracts/${randomUUID()}`)
    .set(bearer(session.token))
    .expect(404);
  assert.equal(missing.body.message, 'CONTRACT_NOT_FOUND');

  // 非法流转：DRAFT approve → 409 CONTRACT_STATE_TRANSITION_INVALID。
  const draft = await app.httpRequest()
    .post('/api/v1/contracts')
    .set(bearer(session.token))
    .send({ contractType: 'FIRST_SIGN', title: '状态机合同', customerId: customer.id })
    .expect(200);
  const invalid = await app.httpRequest()
    .post(`/api/v1/contracts/${draft.body.data.id}/approve`)
    .set(bearer(session.token))
    .send({})
    .expect(409);
  assert.equal(invalid.body.message, 'CONTRACT_STATE_TRANSITION_INVALID');

  // RISK_NOTICE 前置缺失：FORMAL 签署后生效 → 409 RISK_NOTICE_MISSING。
  const formal = await app.httpRequest()
    .post('/api/v1/contracts')
    .set(bearer(session.token))
    .send({ contractType: 'FORMAL', title: '无风险告知正式合同', customerId: customer.id, amount: '8000' })
    .expect(200);
  const formalId = formal.body.data.id as string;
  await app.httpRequest().post(`/api/v1/contracts/${formalId}/submit`).set(bearer(session.token)).send({}).expect(200);
  await app.httpRequest().post(`/api/v1/contracts/${formalId}/approve`).set(bearer(session.token)).send({}).expect(200);
  await app.httpRequest().post(`/api/v1/contracts/${formalId}/sign`).set(bearer(session.token)).send({}).expect(200);
  const noRiskNotice = await app.httpRequest()
    .post(`/api/v1/contracts/${formalId}/effect`)
    .set(bearer(session.token))
    .send({})
    .expect(409);
  assert.equal(noRiskNotice.body.message, 'RISK_NOTICE_MISSING');

  // RECEIVABLE_PLAN_MISMATCH 双闸（终审修复轮 F-1）：
  // ① create 闸——计划合计 ≠ 合同金额 create 即 400 零写入（stuck-SIGNED 根除）；
  // ② effect 闸——create 闸之前的遗产畸形行（直改存量）effect 仍 400 整事务回滚。
  await signRiskNotice(session.token, customer.id);
  const createGate = await app.httpRequest()
    .post('/api/v1/contracts')
    .set(bearer(session.token))
    .send({
      contractType: 'FORMAL',
      title: '计划错配合同',
      customerId: customer.id,
      amount: '10000',
      paymentTerms: JSON.stringify({ plans: [{ period: 1, dueDate: '2026-09-01', amount: '6000.00' }] }),
    })
    .expect(400);
  assert.equal(createGate.body.message, 'RECEIVABLE_PLAN_MISMATCH');

  const legacy = await app.httpRequest()
    .post('/api/v1/contracts')
    .set(bearer(session.token))
    .send({
      contractType: 'FORMAL',
      title: '遗产错配合同',
      customerId: customer.id,
      amount: '10000',
    })
    .expect(200);
  const legacyId = legacy.body.data.id as string;
  await app.httpRequest().post(`/api/v1/contracts/${legacyId}/submit`).set(bearer(session.token)).send({}).expect(200);
  await app.httpRequest().post(`/api/v1/contracts/${legacyId}/approve`).set(bearer(session.token)).send({}).expect(200);
  await app.httpRequest().post(`/api/v1/contracts/${legacyId}/sign`).set(bearer(session.token)).send({}).expect(200);
  await prisma.contract.update({
    where: { id: legacyId },
    data: { paymentTerms: JSON.stringify({ plans: [{ period: 1, dueDate: '2026-09-01', amount: '6000.00' }] }) },
  });
  const planMismatch = await app.httpRequest()
    .post(`/api/v1/contracts/${legacyId}/effect`)
    .set(bearer(session.token))
    .send({})
    .expect(400);
  assert.equal(planMismatch.body.message, 'RECEIVABLE_PLAN_MISMATCH');

  // 伪造 branchId：服务层探针 VALIDATION_FAILED 400，不得以 P2003 冒泡 500。
  const forgedBranch = await app.httpRequest()
    .post('/api/v1/contracts')
    .set(bearer(session.token))
    .send({ contractType: 'FIRST_SIGN', title: '伪造锚合同', customerId: customer.id, branchId: randomUUID() })
    .expect(400);
  assert.equal(forgedBranch.body.message, 'VALIDATION_FAILED');

  // NEGOTIATION 来源缺 negotiationId / SUPPLEMENT 缺 parentContractId：400。
  await app.httpRequest()
    .post('/api/v1/contracts')
    .set(bearer(session.token))
    .send({ contractType: 'FIRST_SIGN', title: '缺谈案', customerId: customer.id, sourceType: 'NEGOTIATION' })
    .expect(400);
  await app.httpRequest()
    .post('/api/v1/contracts')
    .set(bearer(session.token))
    .send({ contractType: 'SUPPLEMENT', title: '缺父合同', customerId: customer.id })
    .expect(400);
});

test('enforces all four data scope kinds on contract lists without leaking existence', async () => {
  const customer = await createCustomerFixture('seed');
  const branch = await createOrgFixture('CT_BRANCH_MAIN');
  const branchChild = await createOrgFixture('CT_BRANCH_CHILD', branch);
  const other = await createOrgFixture('CT_BRANCH_OTHER');
  const team = await createTeamFixture(branch.id, 'CTSCOPE');
  const otherTeam = await createTeamFixture(branch.id, 'CTOTHER');
  const org = await createOrgFixture('CT_ORG_MAIN');
  const orgChild = await createOrgFixture('CT_ORG_CHILD', org);

  const employee = await prisma.employee.create({
    data: {
      employeeNo: `EMP_${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      name: '范围员工',
      phone: `1${randomUUID().replaceAll('-', '').slice(0, 10)}`,
      type: 'SALES',
      status: 'FORMAL',
      entryDate: new Date('2025-01-01'),
    },
  });
  // SELF：Contract 无员工列，锚 createdBy=读取者本人 userId（employeeId 仅作锚启闭——
  // null 时 createdBy 锚不贡献、fail-closed，Task 6 Minor④ degenerate 先例）。
  const selfReader = await createContractSession({
    permissions: ['contract.read'],
    scope: { kind: 'SELF' },
    employeeId: employee.id,
  });
  const asCreator = await seedContract({ customerId: customer.id, createdBy: selfReader.userId });
  const inTeam = await seedContract({ customerId: customer.id, createdBy: 'seed', professionalTeamId: team.id });
  await seedContract({ customerId: customer.id, createdBy: 'seed', professionalTeamId: otherTeam.id });
  const inBranch = await seedContract({ customerId: customer.id, createdBy: 'seed', branchId: branch.id });
  const inChild = await seedContract({ customerId: customer.id, createdBy: 'seed', branchId: branchChild.id });
  const outOfBranch = await seedContract({ customerId: customer.id, createdBy: 'seed', branchId: other.id });
  const inOrg = await seedContract({ customerId: customer.id, createdBy: 'seed', branchId: org.id });
  const inOrgChild = await seedContract({ customerId: customer.id, createdBy: 'seed', branchId: orgChild.id });

  const selfList = await app.httpRequest()
    .get('/api/v1/contracts')
    .set(bearer(selfReader.token))
    .expect(200);
  assert.deepEqual(selfList.body.data.list.map((item: { id: string }) => item.id), [asCreator.id]);

  // TEAM：锚 professionalTeamId。
  const teamReader = await createContractSession({
    permissions: ['contract.read'],
    scope: { kind: 'TEAM', professionalTeamId: team.id },
  });
  const teamList = await app.httpRequest()
    .get('/api/v1/contracts')
    .set(bearer(teamReader.token))
    .expect(200);
  assert.deepEqual(teamList.body.data.list.map((item: { id: string }) => item.id), [inTeam.id]);

  // BRANCH：锚 branchId 含子树。
  const branchReader = await createContractSession({
    permissions: ['contract.read'],
    scope: { kind: 'BRANCH', organizationId: branch.id },
  });
  const branchList = await app.httpRequest()
    .get('/api/v1/contracts')
    .set(bearer(branchReader.token))
    .expect(200);
  assert.deepEqual(
    branchList.body.data.list.map((item: { id: string }) => item.id).sort(),
    [inBranch.id, inChild.id].sort(),
  );
  const branchHidden = await app.httpRequest()
    .get(`/api/v1/contracts/${outOfBranch.id}`)
    .set(bearer(branchReader.token))
    .expect(404);
  assert.equal(branchHidden.body.message, 'CONTRACT_NOT_FOUND');

  // ORG：锚精确组织不含后代。
  const orgReader = await createContractSession({
    permissions: ['contract.read'],
    scope: { kind: 'ORG', organizationId: org.id },
  });
  const orgList = await app.httpRequest()
    .get('/api/v1/contracts')
    .set(bearer(orgReader.token))
    .expect(200);
  assert.deepEqual(orgList.body.data.list.map((item: { id: string }) => item.id), [inOrg.id]);
  await app.httpRequest()
    .get(`/api/v1/contracts/${inOrgChild.id}`)
    .set(bearer(orgReader.token))
    .expect(404);
});

test('does not expose prototype contract routes removed by the rebuild (404 locks)', async () => {
  const session = await createContractSession({ permissions: FULL_CONTRACT_PERMISSIONS });
  const customer = await createCustomerFixture(session.userId);
  const created = await app.httpRequest()
    .post('/api/v1/contracts')
    .set(bearer(session.token))
    .send({ contractType: 'FIRST_SIGN', title: '锁路由合同', customerId: customer.id })
    .expect(200);
  const contractId = created.body.data.id as string;

  // 原型物理删除端点已整体移除（创建后仅经动作路由流转，无 update/delete 路由——设计如此）。
  await app.httpRequest()
    .put(`/api/v1/contracts/${contractId}`)
    .set(bearer(session.token))
    .send({ title: 'PUT 不应存在' })
    .expect(404);
  await app.httpRequest()
    .delete(`/api/v1/contracts/${contractId}`)
    .set(bearer(session.token))
    .expect(404);

  // 原型台账路径被新 /:id 捕获 → service CONTRACT_NOT_FOUND 404（殊途同归）。
  const ledger = await app.httpRequest()
    .get('/api/v1/contracts/ledger')
    .set(bearer(session.token))
    .expect(404);
  assert.equal(ledger.body.message, 'CONTRACT_NOT_FOUND');
});
