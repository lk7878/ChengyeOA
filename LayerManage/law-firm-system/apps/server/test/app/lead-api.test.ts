import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { createApiSession } from '../helpers/auth-session';
import { hashPhone } from '../../app/domain/crm/lead-policy';

// SPEC-009 Task 10: lead HTTP API 端到端测试（crm-factory + controller + router）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/app/lead-api.test.ts

process.env.EGG_TYPESCRIPT = 'true';

const app = mm.app();
let prisma: PrismaClient;

type ScopeFixture =
  | { kind: 'ALL' }
  | { kind: 'SELF' }
  | { kind: 'TEAM'; professionalTeamId: string }
  | { kind: 'BRANCH'; organizationId: string; includeDescendants?: boolean };

interface CrmSessionOptions {
  permissions: string[];
  scope?: ScopeFixture;
  employeeId?: string | null;
  l3Read?: Array<{ resource: 'lead' | 'customer'; fieldCode: string }>;
}

/**
 * 业务会话夹具：BUSINESS 角色 + RolePermission 直插（约束 4b 实现方式：测试夹具直接
 * 插 RolePermission/RoleDataScope/FieldPermission 行，生产 seed 归 Task 12）。
 * scope 对权限涉及的每个 resource 各建一行 RoleDataScope。
 */
async function createCrmSession(options: CrmSessionOptions): Promise<{ userId: string; token: string }> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      username: `crm.${suffix}`,
      password: 'not-used',
      employeeId: options.employeeId ?? null,
    },
  });
  const role = await prisma.role.create({
    data: {
      name: `CRM ${suffix}`,
      code: `CRM_${suffix.replaceAll('-', '').slice(0, 24).toUpperCase()}`,
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
        organizationId: scope.kind === 'BRANCH' ? scope.organizationId : null,
        professionalTeamId: scope.kind === 'TEAM' ? scope.professionalTeamId : null,
      },
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

async function seedLead(overrides: Partial<Prisma.LeadUncheckedCreateInput> = {}) {
  const id = randomUUID();
  return prisma.lead.create({
    data: {
      id,
      leadNo: `L-API-${id}`,
      name: '种子线索',
      phone: '13700009999',
      phoneHash: hashPhone('13700009999'),
      status: 'NEW',
      poolStatus: 'PUBLIC',
      createdBy: 'seed',
      ...overrides,
    },
  });
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
  const org = await createOrgFixture('EMP_ORG');
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

test('requires authentication for every lead endpoint', async () => {
  await app.httpRequest().get('/api/v1/leads').expect(401);
  await app.httpRequest().post('/api/v1/leads').send({ name: '张三', phone: '13800001234' }).expect(401);
  await app.httpRequest().get(`/api/v1/leads/${randomUUID()}`).expect(401);
  await app.httpRequest().get('/api/v1/leads/pool').expect(401);
  await app.httpRequest().post('/api/v1/leads/pool/claim').send({ leadId: randomUUID() }).expect(401);
});

test('rejects authenticated users without lead permissions', async () => {
  const ordinary = await createCrmSession({ permissions: [] });
  const denied = await app.httpRequest()
    .post('/api/v1/leads')
    .set(bearer(ordinary.token))
    .send({ name: '张三', phone: '13800001234' })
    .expect(403);
  assert.equal(denied.body.message, 'PERMISSION_DENIED');
  await app.httpRequest().get('/api/v1/leads').set(bearer(ordinary.token)).expect(403);
  await app.httpRequest().get('/api/v1/leads/pool').set(bearer(ordinary.token)).expect(403);

  // 只有 lead.read 没有 lead.create：读通、写拒。
  const reader = await createCrmSession({ permissions: ['lead.read'] });
  await app.httpRequest().get('/api/v1/leads').set(bearer(reader.token)).expect(200);
  await app.httpRequest()
    .post('/api/v1/leads')
    .set(bearer(reader.token))
    .send({ name: '张三', phone: '13800001234' })
    .expect(403);
});

test('creates leads with duplicate hints and masked L3 output by default', async () => {
  const session = await createCrmSession({ permissions: ['lead.create', 'lead.read'] });

  const first = await app.httpRequest()
    .post('/api/v1/leads')
    .set(bearer(session.token))
    .send({ name: '张三', phone: '13800001234', sourceType: 'MANUAL' })
    .expect(200);
  assert.equal(first.body.code, 200);
  assert.match(first.body.data.lead.leadNo, /^L\d{6}-[0-9A-Z]{6}$/);
  assert.equal(first.body.data.lead.status, 'NEW');
  assert.equal(first.body.data.lead.poolStatus, 'PUBLIC');
  assert.deepEqual(first.body.data.duplicates, []);
  // 无 L3 字段授权：phone 默认脱敏输出。
  assert.equal(first.body.data.lead.phone, '138****1234');

  const second = await app.httpRequest()
    .post('/api/v1/leads')
    .set(bearer(session.token))
    .send({ name: '李四', phone: '+86 138-0000-1234' })
    .expect(200);
  assert.notEqual(second.body.data.lead.id, first.body.data.lead.id);
  assert.ok(
    second.body.data.duplicates.some(
      (signal: { leadId: string; type: string }) => signal.leadId === first.body.data.lead.id && signal.type === 'PHONE',
    ),
    'expected a PHONE duplicate signal against the first lead',
  );
  // 去重提示与视图均不得泄露明文电话。
  assert.equal(JSON.stringify(second.body).includes('13800001234'), false);
});

test('scopes lead lists to the actor employee for SELF data scopes', async () => {
  const employeeA = await createEmployeeFixture();
  const employeeB = await createEmployeeFixture();
  const mine = await seedLead({ name: '我的线索', assignedTo: employeeA.id, poolStatus: 'PRIVATE', status: 'ASSIGNED' });
  await seedLead({ name: '他人线索', assignedTo: employeeB.id, poolStatus: 'PRIVATE', status: 'ASSIGNED' });
  await seedLead({ name: '公海线索' });
  const session = await createCrmSession({
    permissions: ['lead.read'],
    scope: { kind: 'SELF' },
    employeeId: employeeA.id,
  });

  const list = await app.httpRequest().get('/api/v1/leads').set(bearer(session.token)).expect(200);
  assert.deepEqual(list.body.data.list.map((item: { id: string }) => item.id), [mine.id]);
  assert.equal(list.body.data.total, 1);
});

test('scopes lead lists to the professional team for TEAM data scopes', async () => {
  const org = await createOrgFixture('TEAM_ORG');
  const teamX = await createTeamFixture(org.id, 'X');
  const teamY = await createTeamFixture(org.id, 'Y');
  const inTeam = await seedLead({ name: '本团队线索', professionalTeamId: teamX.id });
  await seedLead({ name: '外团队线索', professionalTeamId: teamY.id });
  await seedLead({ name: '无团队线索' });
  const session = await createCrmSession({
    permissions: ['lead.read'],
    scope: { kind: 'TEAM', professionalTeamId: teamX.id },
  });

  const list = await app.httpRequest().get('/api/v1/leads').set(bearer(session.token)).expect(200);
  assert.deepEqual(list.body.data.list.map((item: { id: string }) => item.id), [inTeam.id]);
});

test('scopes lead lists to the organization subtree for BRANCH data scopes', async () => {
  const branchA = await createOrgFixture('BRANCH_A');
  const childA = await createOrgFixture('CHILD_A', branchA);
  const branchB = await createOrgFixture('BRANCH_B');
  const inBranch = await seedLead({ name: '本所线索', branchId: branchA.id });
  const inChild = await seedLead({ name: '子组织线索', branchId: childA.id });
  // 未分配公海线索对本所范围可见（公海领取前提）。
  const poolInBranch = await seedLead({ name: '本所公海', branchId: branchA.id });
  await seedLead({ name: '外所线索', branchId: branchB.id });
  const session = await createCrmSession({
    permissions: ['lead.read'],
    scope: { kind: 'BRANCH', organizationId: branchA.id, includeDescendants: true },
  });

  const list = await app.httpRequest().get('/api/v1/leads').set(bearer(session.token)).expect(200);
  const ids = list.body.data.list.map((item: { id: string }) => item.id).sort();
  assert.deepEqual(ids, [inBranch.id, inChild.id, poolInBranch.id].sort());
});

test('lists every lead for ALL data scopes', async () => {
  const branch = await createOrgFixture('ALL_BRANCH');
  await seedLead({ name: '分所线索', branchId: branch.id });
  await seedLead({ name: '私海线索', poolStatus: 'PRIVATE' });
  await seedLead({ name: '回收池线索', poolStatus: 'RECYCLED' });
  const session = await createCrmSession({ permissions: ['lead.read'] });

  const list = await app.httpRequest().get('/api/v1/leads').set(bearer(session.token)).expect(200);
  assert.equal(list.body.data.total, 3);
  assert.equal(list.body.data.list.length, 3);
});

test('masks L3 fields without a grant and audits plaintext reads with one', async () => {
  const lead = await seedLead({ name: '脱敏目标', phone: '13800001111', wechat: 'wx-secret-001' });
  const masked = await createCrmSession({ permissions: ['lead.read'] });

  const maskedView = await app.httpRequest()
    .get(`/api/v1/leads/${lead.id}`)
    .set(bearer(masked.token))
    .expect(200);
  assert.equal(maskedView.body.data.phone, '138****1111');
  assert.equal(maskedView.body.data.wechat, '***');
  assert.equal(JSON.stringify(maskedView.body).includes('13800001111'), false);
  assert.equal(JSON.stringify(maskedView.body).includes('wx-secret-001'), false);

  const reader = await createCrmSession({
    permissions: ['lead.read'],
    l3Read: [
      { resource: 'lead', fieldCode: 'lead.phone' },
      { resource: 'lead', fieldCode: 'lead.wechat' },
    ],
  });
  const plaintext = await app.httpRequest()
    .get(`/api/v1/leads/${lead.id}`)
    .set(bearer(reader.token))
    .expect(200);
  assert.equal(plaintext.body.data.phone, '13800001111');
  assert.equal(plaintext.body.data.wechat, 'wx-secret-001');

  // 明文实际输出 → READ_L3_FIELDS 审计；脱敏输出不审计。
  const audit = await prisma.operationLog.findFirst({
    where: { userId: reader.userId, action: 'READ_L3_FIELDS', targetType: 'LEAD', targetId: lead.id },
  });
  assert.ok(audit, 'expected a READ_L3_FIELDS audit row for the plaintext read');
  assert.equal(JSON.stringify(audit.newValues).includes('13800001111'), false);
  assert.equal(JSON.stringify(audit.newValues).includes('wx-secret-001'), false);
  assert.equal(await prisma.operationLog.count({
    where: { userId: masked.userId, action: 'READ_L3_FIELDS' },
  }), 0);
});

test('rejects invalid status transitions with 409 and accepts legal ones', async () => {
  const session = await createCrmSession({ permissions: ['lead.create', 'lead.update', 'lead.read'] });
  const created = await app.httpRequest()
    .post('/api/v1/leads')
    .set(bearer(session.token))
    .send({ name: '状态机目标', phone: '13800005555' })
    .expect(200);
  const leadId = created.body.data.lead.id;

  // NEW → CONVERTED 不在流转表：409 稳定码。
  const invalid = await app.httpRequest()
    .patch(`/api/v1/leads/${leadId}`)
    .set(bearer(session.token))
    .send({ targetStatus: 'CONVERTED', reason: '试图跳级' })
    .expect(409);
  assert.equal(invalid.body.message, 'LEAD_STATE_TRANSITION_INVALID');

  // NEW → LOST 为合法流转（任意活状态可流失）。
  const lost = await app.httpRequest()
    .patch(`/api/v1/leads/${leadId}`)
    .set(bearer(session.token))
    .send({ targetStatus: 'LOST', reason: '客户明确拒绝' })
    .expect(200);
  assert.equal(lost.body.data.status, 'LOST');

  // LOST → NURTURE 箭头存在但 REACTIVATE_ENABLED=false：同样 409。
  const nurture = await app.httpRequest()
    .patch(`/api/v1/leads/${leadId}`)
    .set(bearer(session.token))
    .send({ targetStatus: 'NURTURE', reason: '尝试培育' })
    .expect(409);
  assert.equal(nurture.body.message, 'LEAD_STATE_TRANSITION_INVALID');
});

test('replays create with the same Idempotency-Key without duplicating', async () => {
  const session = await createCrmSession({ permissions: ['lead.create'] });
  const idempotencyKey = `idem-${randomUUID()}`;

  const first = await app.httpRequest()
    .post('/api/v1/leads')
    .set(bearer(session.token))
    .set('Idempotency-Key', idempotencyKey)
    .send({ name: '幂等目标', phone: '13800006666' })
    .expect(200);
  const replay = await app.httpRequest()
    .post('/api/v1/leads')
    .set(bearer(session.token))
    .set('Idempotency-Key', idempotencyKey)
    .send({ name: '幂等目标', phone: '13800006666' })
    .expect(200);

  assert.equal(replay.body.data.lead.id, first.body.data.lead.id);
  assert.equal(replay.body.data.lead.leadNo, first.body.data.lead.leadNo);
  assert.deepEqual(replay.body.data.duplicates, []);
  assert.equal(await prisma.lead.count(), 1);
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'lead.created' } }), 1);
});

test('rejects forged branch and team identifiers at entry with 400', async () => {
  const session = await createCrmSession({ permissions: ['lead.create', 'lead.read'] });

  const forgedBranch = await app.httpRequest()
    .post('/api/v1/leads')
    .set(bearer(session.token))
    .send({ name: '伪造分所', phone: '13800007777', branchId: randomUUID() })
    .expect(400);
  assert.equal(forgedBranch.body.message, 'VALIDATION_FAILED');

  const forgedTeam = await app.httpRequest()
    .post('/api/v1/leads')
    .set(bearer(session.token))
    .send({ name: '伪造团队', phone: '13800007778', professionalTeamId: randomUUID() })
    .expect(400);
  assert.equal(forgedTeam.body.message, 'VALIDATION_FAILED');
  assert.equal(await prisma.lead.count(), 0);

  // 合法 branch/team：透传进入事件信封（EventLog 真 FK 验证端到端连通）。
  const branch = await createOrgFixture('VALID_BRANCH');
  const team = await createTeamFixture(branch.id, 'VALID');
  const created = await app.httpRequest()
    .post('/api/v1/leads')
    .set(bearer(session.token))
    .send({
      name: '合法归属',
      phone: '13800007779',
      branchId: branch.id,
      professionalTeamId: team.id,
    })
    .expect(200);
  const event = await prisma.eventLog.findFirstOrThrow({
    where: { eventType: 'lead.created', objectId: created.body.data.lead.id },
  });
  assert.equal(event.branchId, branch.id);
  assert.equal(event.teamId, team.id);
});

test('rejects forged channel, campaign, and referral customer identifiers at entry with 400', async () => {
  // 终审条目 2：channelId/campaignId/referralCustomerId 同为真 relation（schema Lead
  // .channel/campaign/referralCustomer），伪造 FK 曾与 branch/team（4a）同族漏网——
  // 原样透传将 P2003 成 500。入口存在性校验后：伪造→400 不触服务层；合法值不受影响。
  const session = await createCrmSession({ permissions: ['lead.create', 'lead.read'] });

  const forgedChannel = await app.httpRequest()
    .post('/api/v1/leads')
    .set(bearer(session.token))
    .send({ name: '伪造渠道', phone: '13800008881', channelId: randomUUID() })
    .expect(400);
  assert.equal(forgedChannel.body.message, 'VALIDATION_FAILED');

  const forgedCampaign = await app.httpRequest()
    .post('/api/v1/leads')
    .set(bearer(session.token))
    .send({ name: '伪造活动', phone: '13800008882', campaignId: randomUUID() })
    .expect(400);
  assert.equal(forgedCampaign.body.message, 'VALIDATION_FAILED');

  const forgedReferral = await app.httpRequest()
    .post('/api/v1/leads')
    .set(bearer(session.token))
    .send({ name: '伪造推荐客户', phone: '13800008883', referralCustomerId: randomUUID() })
    .expect(400);
  assert.equal(forgedReferral.body.message, 'VALIDATION_FAILED');
  assert.equal(await prisma.lead.count(), 0);

  // 合法三字段：创建不受影响，引用原样落库并回显。
  const channel = await prisma.channel.create({
    data: {
      code: `CH_${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      name: 'Fixture Channel',
      type: 'SEARCH',
    },
  });
  const campaign = await prisma.campaign.create({
    data: {
      code: `CP_${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      name: 'Fixture Campaign',
      channelId: channel.id,
    },
  });
  const referrer = await prisma.customer.create({
    data: {
      customerNo: `CU-FIX-${randomUUID().replaceAll('-', '').slice(0, 10)}`,
      name: '推荐客户',
      phone: '13900009999',
      phoneHash: hashPhone('13900009999'),
      createdBy: 'fixture',
    },
  });
  const created = await app.httpRequest()
    .post('/api/v1/leads')
    .set(bearer(session.token))
    .send({
      name: '合法引用',
      phone: '13800008884',
      sourceType: 'REFERRAL',
      channelId: channel.id,
      campaignId: campaign.id,
      referralCustomerId: referrer.id,
    })
    .expect(200);
  assert.equal(created.body.data.lead.channelId, channel.id);
  assert.equal(created.body.data.lead.campaignId, campaign.id);
  assert.equal(created.body.data.lead.referralCustomerId, referrer.id);
});

test('claims pool leads only when the actor is bound to an employee', async () => {
  const lead = await seedLead({ name: '公海目标' });
  const unbound = await createCrmSession({ permissions: ['lead.pool.claim', 'lead.read'] });

  // 约束 4b 对照组：持有 lead.pool.claim 但账号未绑定员工 → 403 ACTOR_EMPLOYEE_UNBOUND。
  const denied = await app.httpRequest()
    .post('/api/v1/leads/pool/claim')
    .set(bearer(unbound.token))
    .send({ leadId: lead.id })
    .expect(403);
  assert.equal(denied.body.message, 'ACTOR_EMPLOYEE_UNBOUND');

  // 约束 4b：持有 lead.pool.claim 且绑定员工的会话，claim 返回非 403（200）。
  const employee = await createEmployeeFixture();
  const bound = await createCrmSession({
    permissions: ['lead.pool.claim', 'lead.read'],
    employeeId: employee.id,
  });
  const claimed = await app.httpRequest()
    .post('/api/v1/leads/pool/claim')
    .set(bearer(bound.token))
    .send({ leadId: lead.id })
    .expect(200);
  assert.equal(claimed.body.data.poolStatus, 'PRIVATE');
  assert.equal(claimed.body.data.assignedTo, employee.id);
  assert.equal(claimed.body.data.status, 'ASSIGNED');

  // 私海线索不可再领取：409 LEAD_NOT_IN_POOL。
  const again = await app.httpRequest()
    .post('/api/v1/leads/pool/claim')
    .set(bearer(bound.token))
    .send({ leadId: lead.id })
    .expect(409);
  assert.equal(again.body.message, 'LEAD_NOT_IN_POOL');
});

test('assigns and recycles leads through guarded endpoints', async () => {
  const target = await createEmployeeFixture();
  const lead = await seedLead({ name: '分配目标' });
  const session = await createCrmSession({ permissions: ['lead.assign', 'lead.recycle', 'lead.read'] });

  const assigned = await app.httpRequest()
    .post(`/api/v1/leads/${lead.id}/assign`)
    .set(bearer(session.token))
    .send({ toEmployeeId: target.id, reason: '分所轮转' })
    .expect(200);
  assert.equal(assigned.body.data.assignedTo, target.id);
  assert.equal(assigned.body.data.poolStatus, 'PRIVATE');
  assert.equal(assigned.body.data.status, 'ASSIGNED');

  // 目标员工不存在：400（Lead.assignedTo 真 FK 前置校验）。
  const forged = await app.httpRequest()
    .post(`/api/v1/leads/${lead.id}/assign`)
    .set(bearer(session.token))
    .send({ toEmployeeId: randomUUID() })
    .expect(400);
  assert.equal(forged.body.message, 'VALIDATION_FAILED');

  const recycled = await app.httpRequest()
    .post(`/api/v1/leads/${lead.id}/recycle`)
    .set(bearer(session.token))
    .send({ reason: '跟进不力回收' })
    .expect(200);
  assert.equal(recycled.body.data.poolStatus, 'RECYCLED');
  assert.equal(recycled.body.data.assignedTo, null);

  // 非私海不可手动回收：409。
  const invalid = await app.httpRequest()
    .post(`/api/v1/leads/${lead.id}/recycle`)
    .set(bearer(session.token))
    .send({ reason: '重复回收' })
    .expect(409);
  assert.equal(invalid.body.message, 'LEAD_STATE_TRANSITION_INVALID');

  // 无 lead.assign 权限：403。
  const reader = await createCrmSession({ permissions: ['lead.read'] });
  await app.httpRequest()
    .post(`/api/v1/leads/${lead.id}/assign`)
    .set(bearer(reader.token))
    .send({ toEmployeeId: target.id })
    .expect(403);
});

test('converts a lead once and rejects the second conversion with 409', async () => {
  const session = await createCrmSession({ permissions: ['lead.convert', 'customer.read'] });
  // 状态机仅允许 VISITED → CONVERTED：直接种子一条已到访线索，聚焦转化语义。
  const lead = await seedLead({ name: '转化目标', status: 'VISITED' });
  const leadId = lead.id;

  const converted = await app.httpRequest()
    .post(`/api/v1/leads/${leadId}/convert`)
    .set(bearer(session.token))
    .send({
      customer: { name: '转化客户', phone: '13900001111', customerType: 'INDIVIDUAL' },
      contact: { name: '联系人甲', phone: '13900002222', isPrimary: true },
    })
    .expect(200);
  // 转化路径 customerNo 前缀为 'C'（lead-service makeBusinessNo('C')；直建路径为 'CU'）。
  assert.match(converted.body.data.customerNo, /^C\d{6}-[0-9A-Z]{6}$/);
  assert.equal(converted.body.data.sourceLeadId, leadId);
  assert.equal(converted.body.data.status, 'POTENTIAL');

  const after = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  assert.equal(after.status, 'CONVERTED');

  const second = await app.httpRequest()
    .post(`/api/v1/leads/${leadId}/convert`)
    .set(bearer(session.token))
    .send({
      customer: { name: '转化客户', phone: '13900001111' },
      contact: { name: '联系人甲', phone: '13900002222' },
    })
    .expect(409);
  assert.equal(second.body.message, 'CUSTOMER_ALREADY_CONVERTED');
});

test('records and lists follows through nested routes', async () => {
  const session = await createCrmSession({ permissions: ['lead.create', 'lead.update', 'lead.read'] });
  const created = await app.httpRequest()
    .post('/api/v1/leads')
    .set(bearer(session.token))
    .send({ name: '跟进目标', phone: '13800009999' })
    .expect(200);
  const leadId = created.body.data.lead.id;

  const follow = await app.httpRequest()
    .post(`/api/v1/leads/${leadId}/follows`)
    .set(bearer(session.token))
    .send({ type: 'PHONE', content: '首次电话沟通', nextPlan: '约到店详谈', nextTime: '2026-08-01T02:00:00.000Z' })
    .expect(200);
  assert.equal(follow.body.data.type, 'PHONE');
  assert.equal(follow.body.data.content, '首次电话沟通');
  assert.equal(follow.body.data.leadId, leadId);

  const list = await app.httpRequest()
    .get(`/api/v1/leads/${leadId}/follows`)
    .set(bearer(session.token))
    .expect(200);
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.data[0].id, follow.body.data.id);

  // 非法跟进类型：400。
  await app.httpRequest()
    .post(`/api/v1/leads/${leadId}/follows`)
    .set(bearer(session.token))
    .send({ type: 'SMOKE_SIGNAL', content: '烽火传书' })
    .expect(400);
});

test('lists the public pool by default and the recycled pool on demand', async () => {
  const publicLead = await seedLead({ name: '公海线索' });
  await seedLead({ name: '私海线索', poolStatus: 'PRIVATE' });
  const recycledLead = await seedLead({ name: '回收池线索', poolStatus: 'RECYCLED' });
  const session = await createCrmSession({ permissions: ['lead.read'] });

  const publicPool = await app.httpRequest()
    .get('/api/v1/leads/pool')
    .set(bearer(session.token))
    .expect(200);
  assert.deepEqual(publicPool.body.data.list.map((item: { id: string }) => item.id), [publicLead.id]);

  const recycledPool = await app.httpRequest()
    .get('/api/v1/leads/pool?poolStatus=RECYCLED')
    .set(bearer(session.token))
    .expect(200);
  assert.deepEqual(recycledPool.body.data.list.map((item: { id: string }) => item.id), [recycledLead.id]);
});

test('does not route the overdue-recycle batch entry over HTTP', async () => {
  const session = await createCrmSession({ permissions: ['lead.recycle', 'lead.read', 'lead.create'] });
  // recycleOverdueLeads 是系统任务入口（lead-assignment-service 决策 7 守卫注记）：
  // 任何貌似合理的批量回收路径都不得可达。
  await app.httpRequest()
    .post('/api/v1/leads/recycle-overdue')
    .set(bearer(session.token))
    .send({})
    .expect(404);
  await app.httpRequest()
    .post('/api/v1/leads/pool/recycle-overdue')
    .set(bearer(session.token))
    .send({})
    .expect(404);
  await app.httpRequest()
    .post('/api/v1/tasks/lead-recycle')
    .set(bearer(session.token))
    .send({})
    .expect(404);
});

test('returns 404 for leads outside the caller scope without leaking existence', async () => {
  const branchA = await createOrgFixture('HIDE_A');
  const branchB = await createOrgFixture('HIDE_B');
  const hidden = await seedLead({ name: '外所线索', branchId: branchB.id });
  const session = await createCrmSession({
    permissions: ['lead.read', 'lead.update'],
    scope: { kind: 'BRANCH', organizationId: branchA.id },
  });

  const detail = await app.httpRequest()
    .get(`/api/v1/leads/${hidden.id}`)
    .set(bearer(session.token))
    .expect(404);
  assert.equal(detail.body.message, 'LEAD_NOT_FOUND');
  await app.httpRequest()
    .patch(`/api/v1/leads/${hidden.id}`)
    .set(bearer(session.token))
    .send({ targetStatus: 'LOST', reason: '越权尝试' })
    .expect(404);
});
