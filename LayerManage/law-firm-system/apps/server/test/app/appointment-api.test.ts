import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { createApiSession } from '../helpers/auth-session';
import { hashPhone } from '../../app/domain/crm/lead-policy';

// SPEC-009 Task 10: appointment HTTP API 端到端测试。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/app/appointment-api.test.ts

process.env.EGG_TYPESCRIPT = 'true';

const app = mm.app();
let prisma: PrismaClient;

interface CrmSessionOptions {
  permissions: string[];
  employeeId?: string | null;
}

/** 业务会话夹具：BUSINESS 角色 + RolePermission 直插 + 每 resource 一行 ALL 数据范围。 */
async function createCrmSession(options: CrmSessionOptions): Promise<{ userId: string; token: string }> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      username: `crm.appt.${suffix}`,
      password: 'not-used',
      employeeId: options.employeeId ?? null,
    },
  });
  const role = await prisma.role.create({
    data: {
      name: `CRM APPT ${suffix}`,
      code: `CRM_APPT_${suffix.replaceAll('-', '').slice(0, 20).toUpperCase()}`,
      type: 'BUSINESS',
      permissions: {
        create: options.permissions.map(code => ({ permission: { connect: { code } } })),
      },
    },
  });
  const resources = [...new Set(options.permissions.map(code => code.split('.')[0]))];
  for (const resource of resources) {
    const dataScope = await prisma.dataScope.create({
      data: { name: `Scope ${resource} ${suffix}`, scopeType: 'ALL' },
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

async function seedLead(overrides: Partial<Prisma.LeadUncheckedCreateInput> = {}) {
  const id = randomUUID();
  return prisma.lead.create({
    data: {
      id,
      leadNo: `L-APPT-${id}`,
      name: '邀约目标线索',
      phone: '13700009999',
      phoneHash: hashPhone('13700009999'),
      status: 'NEW',
      poolStatus: 'PUBLIC',
      createdBy: 'seed',
      ...overrides,
    },
  });
}

const SLOT_A = '2026-08-10T02:00:00.000Z';
const SLOT_B = '2026-08-11T02:00:00.000Z';
const SLOT_C = '2026-08-12T02:00:00.000Z';

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

test('requires authentication for appointment endpoints', async () => {
  await app.httpRequest()
    .post('/api/v1/appointments')
    .send({ leadId: randomUUID(), scheduledAt: SLOT_A, channel: 'ONSITE' })
    .expect(401);
  await app.httpRequest().get(`/api/v1/appointments/${randomUUID()}`).expect(401);
  await app.httpRequest().post(`/api/v1/appointments/${randomUUID()}/visit`).send({}).expect(401);
  await app.httpRequest().get(`/api/v1/leads/${randomUUID()}/appointments`).expect(401);
});

test('rejects authenticated users without appointment permissions', async () => {
  const ordinary = await createCrmSession({ permissions: [] });
  const denied = await app.httpRequest()
    .post('/api/v1/appointments')
    .set(bearer(ordinary.token))
    .send({ leadId: randomUUID(), scheduledAt: SLOT_A, channel: 'ONSITE' })
    .expect(403);
  assert.equal(denied.body.message, 'PERMISSION_DENIED');
  await app.httpRequest()
    .get(`/api/v1/appointments/${randomUUID()}`)
    .set(bearer(ordinary.token))
    .expect(403);
});

test('creates an appointment and promotes the lead when the state machine allows', async () => {
  const session = await createCrmSession({ permissions: ['appointment.create', 'appointment.read'] });
  const lead = await seedLead({ status: 'SCREENED' });

  const created = await app.httpRequest()
    .post('/api/v1/appointments')
    .set(bearer(session.token))
    .send({ leadId: lead.id, scheduledAt: SLOT_A, channel: 'ONSITE', remark: '到店谈案' })
    .expect(200);
  assert.equal(created.body.code, 200);
  assert.match(created.body.data.appointmentNo, /^AP\d{6}-[0-9A-Z]{6}$/);
  assert.equal(created.body.data.status, 'PENDING');
  assert.equal(created.body.data.leadId, lead.id);
  assert.equal(created.body.data.scheduledAt, SLOT_A);

  // SCREENED → INVITED 为合法流转：同事务推进并落事件。
  const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(after.status, 'INVITED');
  assert.ok(await prisma.eventLog.findFirst({
    where: { eventType: 'lead.status_changed', objectId: lead.id },
  }));
  assert.ok(await prisma.eventLog.findFirst({
    where: { eventType: 'appointment.created', objectId: created.body.data.id },
  }));

  const detail = await app.httpRequest()
    .get(`/api/v1/appointments/${created.body.data.id}`)
    .set(bearer(session.token))
    .expect(200);
  assert.equal(detail.body.data.id, created.body.data.id);

  const nested = await app.httpRequest()
    .get(`/api/v1/leads/${lead.id}/appointments`)
    .set(bearer(session.token))
    .expect(200);
  assert.deepEqual(nested.body.data.map((item: { id: string }) => item.id), [created.body.data.id]);
});

test('rejects invalid transport shapes with 400', async () => {
  const session = await createCrmSession({ permissions: ['appointment.create'] });
  const lead = await seedLead();

  await app.httpRequest()
    .post('/api/v1/appointments')
    .set(bearer(session.token))
    .send({ leadId: lead.id, scheduledAt: 'not-a-date', channel: 'ONSITE' })
    .expect(400);
  await app.httpRequest()
    .post('/api/v1/appointments')
    .set(bearer(session.token))
    .send({ leadId: lead.id, scheduledAt: SLOT_A, channel: 'PIGEON' })
    .expect(400);
  const unknownKey = await app.httpRequest()
    .post('/api/v1/appointments')
    .set(bearer(session.token))
    .send({ leadId: lead.id, scheduledAt: SLOT_A, channel: 'ONSITE', unexpected: true })
    .expect(400);
  assert.equal(unknownKey.body.message, 'VALIDATION_FAILED');
  assert.equal(await prisma.appointment.count(), 0);
});

test('replays the same slot for the same creator and rejects others with 409', async () => {
  const creatorA = await createCrmSession({ permissions: ['appointment.create'] });
  const creatorB = await createCrmSession({ permissions: ['appointment.create'] });
  const lead = await seedLead();

  const first = await app.httpRequest()
    .post('/api/v1/appointments')
    .set(bearer(creatorA.token))
    .send({ leadId: lead.id, scheduledAt: SLOT_A, channel: 'ONLINE' })
    .expect(200);

  // 同创建人 + 同 leadId + 同槽位：幂等回放，不写新行/事件。
  const replay = await app.httpRequest()
    .post('/api/v1/appointments')
    .set(bearer(creatorA.token))
    .send({ leadId: lead.id, scheduledAt: SLOT_A, channel: 'ONLINE' })
    .expect(200);
  assert.equal(replay.body.data.id, first.body.data.id);
  assert.equal(await prisma.appointment.count(), 1);
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'appointment.created' } }), 1);

  // 他人同槽位：APPOINTMENT_CONFLICT 409。
  const conflict = await app.httpRequest()
    .post('/api/v1/appointments')
    .set(bearer(creatorB.token))
    .send({ leadId: lead.id, scheduledAt: SLOT_A, channel: 'ONSITE' })
    .expect(409);
  assert.equal(conflict.body.message, 'APPOINTMENT_CONFLICT');
});

test('confirms a visit once and rejects a second transition with 409', async () => {
  const session = await createCrmSession({ permissions: ['appointment.create', 'appointment.visit', 'appointment.read'] });
  const lead = await seedLead({ status: 'INVITED' });
  const created = await app.httpRequest()
    .post('/api/v1/appointments')
    .set(bearer(session.token))
    .send({ leadId: lead.id, scheduledAt: SLOT_A, channel: 'ONSITE' })
    .expect(200);
  const appointmentId = created.body.data.id;

  const visited = await app.httpRequest()
    .post(`/api/v1/appointments/${appointmentId}/visit`)
    .set(bearer(session.token))
    .send({})
    .expect(200);
  assert.equal(visited.body.data.status, 'VISITED');

  // INVITED → VISITED 合法：lead 同事务推进。
  const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(after.status, 'VISITED');
  assert.ok(await prisma.eventLog.findFirst({
    where: { eventType: 'appointment.visited', objectId: appointmentId },
  }));

  const again = await app.httpRequest()
    .post(`/api/v1/appointments/${appointmentId}/visit`)
    .set(bearer(session.token))
    .send({})
    .expect(409);
  assert.equal(again.body.message, 'LEAD_STATE_TRANSITION_INVALID');

  // 无 appointment.visit 权限：403。
  const noVisit = await createCrmSession({ permissions: ['appointment.read'] });
  await app.httpRequest()
    .post(`/api/v1/appointments/${appointmentId}/visit`)
    .set(bearer(noVisit.token))
    .send({})
    .expect(403);
});

test('reschedules an appointment into a new pending row and guards conflicts', async () => {
  const session = await createCrmSession({ permissions: ['appointment.create', 'appointment.read'] });
  const lead = await seedLead();
  const created = await app.httpRequest()
    .post('/api/v1/appointments')
    .set(bearer(session.token))
    .send({ leadId: lead.id, scheduledAt: SLOT_A, channel: 'ONSITE', remark: '原时段' })
    .expect(200);
  const oldId = created.body.data.id;

  // 先占住 SLOT_B（另一活动邀约），验证改期冲突守卫。
  const blocker = await app.httpRequest()
    .post('/api/v1/appointments')
    .set(bearer(session.token))
    .send({ leadId: lead.id, scheduledAt: SLOT_B, channel: 'ONLINE' })
    .expect(200);
  const conflict = await app.httpRequest()
    .post(`/api/v1/appointments/${oldId}/reschedule`)
    .set(bearer(session.token))
    .send({ scheduledAt: SLOT_B })
    .expect(409);
  assert.equal(conflict.body.message, 'APPOINTMENT_CONFLICT');

  const rescheduled = await app.httpRequest()
    .post(`/api/v1/appointments/${oldId}/reschedule`)
    .set(bearer(session.token))
    .send({ scheduledAt: SLOT_C })
    .expect(200);
  assert.equal(rescheduled.body.data.status, 'PENDING');
  assert.equal(rescheduled.body.data.rescheduledFromId, oldId);
  assert.equal(rescheduled.body.data.scheduledAt, SLOT_C);
  // 沿用旧行 channel/remark。
  assert.equal(rescheduled.body.data.channel, 'ONSITE');
  assert.equal(rescheduled.body.data.remark, '原时段');

  const archived = await prisma.appointment.findUniqueOrThrow({ where: { id: oldId } });
  assert.equal(archived.status, 'RESCHEDULED');
  assert.ok(blocker.body.data.id);

  // 终态行不可再改期：409。
  const terminal = await app.httpRequest()
    .post(`/api/v1/appointments/${oldId}/reschedule`)
    .set(bearer(session.token))
    .send({ scheduledAt: SLOT_A })
    .expect(409);
  assert.equal(terminal.body.message, 'LEAD_STATE_TRANSITION_INVALID');
});

test('rejects appointments for terminal leads with 409 and hides out-of-scope rows with 404', async () => {
  const session = await createCrmSession({ permissions: ['appointment.create', 'appointment.read'] });
  const converted = await seedLead({ status: 'CONVERTED' });
  const forbidden = await app.httpRequest()
    .post('/api/v1/appointments')
    .set(bearer(session.token))
    .send({ leadId: converted.id, scheduledAt: SLOT_A, channel: 'ONSITE' })
    .expect(409);
  assert.equal(forbidden.body.message, 'LEAD_STATE_TRANSITION_INVALID');

  const missing = await app.httpRequest()
    .get(`/api/v1/appointments/${randomUUID()}`)
    .set(bearer(session.token))
    .expect(404);
  assert.equal(missing.body.message, 'LEAD_NOT_FOUND');
  await app.httpRequest()
    .get(`/api/v1/leads/${randomUUID()}/appointments`)
    .set(bearer(session.token))
    .expect(404);
});

test('does not expose no-show or cancel routes', async () => {
  const session = await createCrmSession({ permissions: ['appointment.create', 'appointment.visit', 'appointment.read'] });
  const lead = await seedLead();
  const created = await app.httpRequest()
    .post('/api/v1/appointments')
    .set(bearer(session.token))
    .send({ leadId: lead.id, scheduledAt: SLOT_A, channel: 'ONSITE' })
    .expect(200);
  const appointmentId = created.body.data.id;

  // markNoShow/cancel 服务方法存在，但 brief 未要求路由：一律不可达。
  await app.httpRequest()
    .post(`/api/v1/appointments/${appointmentId}/noshow`)
    .set(bearer(session.token))
    .send({})
    .expect(404);
  await app.httpRequest()
    .post(`/api/v1/appointments/${appointmentId}/no-show`)
    .set(bearer(session.token))
    .send({})
    .expect(404);
  await app.httpRequest()
    .post(`/api/v1/appointments/${appointmentId}/cancel`)
    .set(bearer(session.token))
    .send({})
    .expect(404);

  // 2026-07-29 用户裁定后顶层日历路由已开放（详见下方 range 测试）：缺 from/to → 400。
  await app.httpRequest()
    .get('/api/v1/appointments')
    .set(bearer(session.token))
    .expect(400);
  await app.httpRequest()
    .get('/api/v1/appointments/calendar')
    .set(bearer(session.token))
    .expect(404);

  const after = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
  assert.equal(after.status, 'PENDING');
});

// ---------------------------------------------------------------------------
// 2026-07-29 用户裁定（Task 10 收官后纯追加）：GET /api/v1/appointments 到访日历范围查询。
// 契约：401 未认证 / 403 无 appointment.read / 400 非法 from/to；200 包络
// { code, message, data: { list, page, pageSize, total } }；BRANCH 范围跨所不可见。
// ---------------------------------------------------------------------------

async function seedBranch(code: string) {
  const id = randomUUID();
  return prisma.organization.create({
    data: { id, code: `${code}_${id}`, name: code, type: 'BRANCH', path: `/${id}` },
  });
}

async function seedAppointmentRow(leadId: string, scheduledAt: string) {
  return prisma.appointment.create({
    data: {
      appointmentNo: `AP-API-${randomUUID()}`,
      leadId,
      scheduledAt: new Date(scheduledAt),
      channel: 'ONSITE',
      status: 'PENDING',
      createdBy: 'seed',
    },
  });
}

/** BRANCH 数据范围会话夹具：BUSINESS 角色 + appointment.read + BRANCH 范围（指定组织子树）。 */
async function createBranchScopedSession(organizationId: string): Promise<{ userId: string; token: string }> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: { username: `crm.appt.branch.${suffix}`, password: 'not-used' },
  });
  const role = await prisma.role.create({
    data: {
      name: `CRM APPT BRANCH ${suffix}`,
      code: `CRM_APPT_BR_${suffix.replaceAll('-', '').slice(0, 16).toUpperCase()}`,
      type: 'BUSINESS',
      permissions: { create: [{ permission: { connect: { code: 'appointment.read' } } }] },
    },
  });
  const dataScope = await prisma.dataScope.create({
    data: { name: `Branch scope ${suffix}`, scopeType: 'BRANCH', organizationId },
  });
  await prisma.roleDataScope.create({
    data: { roleId: role.id, resource: 'appointment', dataScopeId: dataScope.id },
  });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const token = (await createApiSession(prisma, user.id)).token;
  return { userId: user.id, token };
}

test('calendar range endpoint requires authentication', async () => {
  await app.httpRequest()
    .get('/api/v1/appointments?from=2026-08-01&to=2026-08-31')
    .expect(401);
});

test('calendar range endpoint rejects users without appointment.read', async () => {
  const ordinary = await createCrmSession({ permissions: ['lead.read'] });
  const denied = await app.httpRequest()
    .get('/api/v1/appointments?from=2026-08-01&to=2026-08-31')
    .set(bearer(ordinary.token))
    .expect(403);
  assert.equal(denied.body.message, 'PERMISSION_DENIED');
});

test('calendar range endpoint returns a paged envelope of in-range appointments', async () => {
  const session = await createCrmSession({ permissions: ['appointment.read'] });
  const lead = await seedLead({ status: 'INVITED' });
  const inRange = await seedAppointmentRow(lead.id, '2026-08-15T02:00:00.000Z');
  await seedAppointmentRow(lead.id, '2026-09-01T02:00:00.000Z');

  const response = await app.httpRequest()
    .get('/api/v1/appointments?from=2026-08-01&to=2026-08-31')
    .set(bearer(session.token))
    .expect(200);

  assert.equal(response.body.code, 200);
  assert.equal(response.body.message, 'success');
  assert.equal(response.body.data.page, 1);
  assert.equal(response.body.data.pageSize, 20);
  assert.equal(response.body.data.total, 1);
  assert.deepEqual(
    response.body.data.list.map((item: { id: string }) => item.id),
    [inRange.id],
  );
  assert.equal(response.body.data.list[0].leadId, lead.id);
  assert.equal(response.body.data.list[0].scheduledAt, '2026-08-15T02:00:00.000Z');

  // 分页参数透传：page=2&pageSize=1 越过唯一行 → 空页但 total 不变。
  const paged = await app.httpRequest()
    .get('/api/v1/appointments?from=2026-08-01&to=2026-08-31&page=2&pageSize=1')
    .set(bearer(session.token))
    .expect(200);
  assert.equal(paged.body.data.page, 2);
  assert.equal(paged.body.data.pageSize, 1);
  assert.equal(paged.body.data.total, 1);
  assert.deepEqual(paged.body.data.list, []);
});

test('calendar range endpoint rejects invalid from/to with 400', async () => {
  const session = await createCrmSession({ permissions: ['appointment.read'] });

  const garbage = await app.httpRequest()
    .get('/api/v1/appointments?from=not-a-date&to=2026-08-31')
    .set(bearer(session.token))
    .expect(400);
  assert.equal(garbage.body.message, 'VALIDATION_FAILED');
  // 缺 to → 400。
  await app.httpRequest()
    .get('/api/v1/appointments?from=2026-08-01')
    .set(bearer(session.token))
    .expect(400);
  // from > to → 400。
  await app.httpRequest()
    .get('/api/v1/appointments?from=2026-09-01&to=2026-08-01')
    .set(bearer(session.token))
    .expect(400);
  // 跨度 > 366 天 → 400（全表扫描护栏）。
  await app.httpRequest()
    .get('/api/v1/appointments?from=2026-01-01&to=2027-01-03')
    .set(bearer(session.token))
    .expect(400);
  // 未知 query 键 → 400。
  await app.httpRequest()
    .get('/api/v1/appointments?from=2026-08-01&to=2026-08-31&status=PENDING')
    .set(bearer(session.token))
    .expect(400);
});

test('calendar range endpoint hides other branches from a BRANCH-scope user', async () => {
  const branchA = await seedBranch('BRANCH_A');
  const branchB = await seedBranch('BRANCH_B');
  const leadA = await seedLead({ name: 'A 所线索', branchId: branchA.id });
  const leadB = await seedLead({ name: 'B 所线索', branchId: branchB.id });
  const visible = await seedAppointmentRow(leadA.id, '2026-08-16T02:00:00.000Z');
  await seedAppointmentRow(leadB.id, '2026-08-16T03:00:00.000Z');
  const branchUser = await createBranchScopedSession(branchA.id);

  const response = await app.httpRequest()
    .get('/api/v1/appointments?from=2026-08-01&to=2026-08-31')
    .set(bearer(branchUser.token))
    .expect(200);

  assert.equal(response.body.data.total, 1);
  assert.deepEqual(
    response.body.data.list.map((item: { id: string }) => item.id),
    [visible.id],
  );
});
