import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';

import { AppointmentService, CreateAppointmentInput } from '../../app/application/crm/appointment-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import {
  APPOINTMENT_CONFLICT,
  CrmError,
  LEAD_NOT_FOUND,
  LEAD_STATE_TRANSITION_INVALID,
} from '../../app/domain/crm/lead-errors';
import { hashPhone } from '../../app/domain/crm/lead-policy';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

// SPEC-009 Task 8: appointment-service 契约测试。
// 绑定决策（2026-07-29 dispatch coordinator decisions）：
//   4. createAppointment/reschedule=appointment.create；confirmVisit/markNoShow/cancel=appointment.visit；
//      list/get=appointment.read。
//   5. Appointment 无组织列：范围锚定 LEAD 关系列（SELF→lead.assignedTo / TEAM→lead.professionalTeamId /
//      BRANCH·ORG→lead.branchId 子树 / OR 并集 / 零谓词 fail-closed）；不可见 → LEAD_NOT_FOUND(404)。
//   6. lead 可见 + 未删除 + status NOT IN (CONVERTED, LOST, NURTURE)；同 leadId 同时段
//      (PENDING|CONFIRMED) 冲突：同创建人幂等回放返回既有行，他人 APPOINTMENT_CONFLICT(409)。
//      创建置 PENDING；canTransition(current,'INVITED') 时推进 lead=INVITED 并同事务发
//      lead.status_changed v1；恒发 appointment.created v1。appointmentNo=makeBusinessNo('AP')。
//   7. confirmVisit：仅 PENDING|CONFIRMED→VISITED；lead 仅 canTransition(current,'VISITED') 时推进；
//      恒发 appointment.visited v1，推进时再发 lead.status_changed v1。
//   8. markNoShow/cancel：PENDING|CONFIRMED→NOSHOW/CANCELLED；无事件；lead 不动。
//   9. reschedule：仅 PENDING|CONFIRMED；旧行→RESCHEDULED + 新行 PENDING rescheduledFromId=旧 id；
//      新槽位套用决策 6 冲突规则（同创建人回放不适用——恒为新行）；无事件。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/crm/appointment-service.test.ts

let prisma: PrismaClient;

const APPOINTMENT_PERMISSIONS: PermissionCode[] = [
  'appointment.read',
  'appointment.create',
  'appointment.visit',
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

function crmContext(userId: string, overrides: ContextOverrides = {}): AuthorizationContext {
  const permissionCodes = overrides.permissionCodes ?? APPOINTMENT_PERMISSIONS;
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
    data: { username: `appt.actor.${randomUUID()}`, password: 'x' },
  });
  return {
    userId: user.id,
    actor: { actorUserId: user.id, requestId: `req-${randomUUID()}` },
  };
}

function serviceFor(userId: string, actor: AuditActor, overrides: ContextOverrides = {}): AppointmentService {
  return new AppointmentService(prisma, actor, crmContext(userId, overrides));
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

const SLOT_1 = new Date('2026-08-01T10:00:00.000Z');
const SLOT_2 = new Date('2026-08-02T10:00:00.000Z');
const SLOT_3 = new Date('2026-08-03T10:00:00.000Z');

function appointmentInput(overrides: Partial<CreateAppointmentInput> = {}): CreateAppointmentInput {
  return {
    scheduledAt: SLOT_1,
    channel: 'ONSITE',
    ...overrides,
  };
}

test('createAppointment persists PENDING and writes appointment.created in one transaction', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const lead = await seedLead({ status: 'NEW' });

  const view = await service.createAppointment(lead.id, appointmentInput({ remark: '首次到访约见' }));

  assert.ok(view.id);
  // appointmentNo（决策 6）：AP + yyMMdd + '-' + 6 位随机字母数字。
  assert.match(view.appointmentNo, /^AP\d{6}-[0-9A-Z]{6}$/);
  assert.equal(view.status, 'PENDING');
  assert.equal(view.leadId, lead.id);
  assert.deepEqual(view.scheduledAt, SLOT_1);
  assert.equal(view.channel, 'ONSITE');

  const stored = await prisma.appointment.findUniqueOrThrow({ where: { id: view.id } });
  assert.equal(stored.createdBy, userId);
  assert.equal(stored.status, 'PENDING');
  assert.equal(stored.rescheduledFromId, null);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { eventType: 'appointment.created', objectType: 'APPOINTMENT', objectId: view.id },
  });
  assert.equal(event.eventVersion, 1);
  assert.equal(event.sourceModule, 'CRM');
  assert.equal(event.operatorUserId, userId);
  assert.deepEqual(event.payload, {
    appointmentId: view.id,
    leadId: lead.id,
    channel: 'ONSITE',
    status: 'PENDING',
  });

  // NEW 不可推进 INVITED（canTransition(NEW,'INVITED')=false）：lead 状态不动、无状态事件。
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status, 'NEW');
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'lead.status_changed' } }), 0);
});

test('createAppointment promotes a SCREENED lead to INVITED with lead.status_changed in the same transaction', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const lead = await seedLead({ status: 'SCREENED' });

  const view = await service.createAppointment(lead.id, appointmentInput());

  assert.equal(view.status, 'PENDING');
  const storedLead = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(storedLead.status, 'INVITED');
  const statusEvent = await prisma.eventLog.findFirstOrThrow({
    where: { eventType: 'lead.status_changed', objectType: 'LEAD', objectId: lead.id },
  });
  assert.deepEqual(statusEvent.payload, {
    leadId: lead.id,
    fromStatus: 'SCREENED',
    toStatus: 'INVITED',
  });
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'appointment.created', objectId: view.id } }),
    1,
  );
});

test('createAppointment rejects leads in CONVERTED, LOST or NURTURE with LEAD_STATE_TRANSITION_INVALID', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const converted = await seedLead({ status: 'CONVERTED' });
  const lost = await seedLead({ status: 'LOST' });
  const nurture = await seedLead({ status: 'NURTURE', name: '沉淀线索' });

  for (const lead of [converted, lost, nurture]) {
    await assert.rejects(
      () => service.createAppointment(lead.id, appointmentInput()),
      error => error instanceof CrmError
        && error.code === LEAD_STATE_TRANSITION_INVALID
        && error.httpStatus === 409,
    );
  }
  assert.equal(await prisma.appointment.count(), 0);
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'appointment.created' } }), 0);
});

test('createAppointment replays the same-actor identical active slot instead of duplicating', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const lead = await seedLead({ status: 'SCREENED' });

  const first = await service.createAppointment(lead.id, appointmentInput());
  const replay = await service.createAppointment(lead.id, appointmentInput());

  assert.equal(replay.id, first.id);
  assert.equal(replay.appointmentNo, first.appointmentNo);
  assert.equal(await prisma.appointment.count(), 1);
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'appointment.created' } }), 1);
});

test('createAppointment conflicts with another actor\'s active slot but ignores terminal slots', async () => {
  const first = await createActor();
  const second = await createActor();
  const lead = await seedLead({ status: 'INVITED' });
  const mine = await serviceFor(first.userId, first.actor).createAppointment(lead.id, appointmentInput());

  // 他人同线索同时段（PENDING）→ APPOINTMENT_CONFLICT(409)。
  await assert.rejects(
    () => serviceFor(second.userId, second.actor).createAppointment(lead.id, appointmentInput()),
    error => error instanceof CrmError
      && error.code === APPOINTMENT_CONFLICT
      && error.httpStatus === 409,
  );

  // 同时段但既有邀约已进入终态（CANCELLED）→ 不冲突。
  await prisma.appointment.update({ where: { id: mine.id }, data: { status: 'CANCELLED' } });
  const afterCancel = await serviceFor(second.userId, second.actor)
    .createAppointment(lead.id, appointmentInput());
  assert.notEqual(afterCancel.id, mine.id);

  // 同时段不同线索 → 不冲突。
  const otherLead = await seedLead({ status: 'INVITED', name: '另一线索' });
  const onOtherLead = await serviceFor(second.userId, second.actor)
    .createAppointment(otherLead.id, appointmentInput());
  assert.ok(onOtherLead.id);
});

test('createAppointment requires appointment.create and hides out-of-scope leads', async () => {
  const { userId, actor } = await createActor();
  const lead = await seedLead({ status: 'SCREENED' });

  await assert.rejects(
    () => serviceFor(userId, actor, { permissionCodes: ['appointment.read'] })
      .createAppointment(lead.id, appointmentInput()),
    hasCode('PERMISSION_DENIED'),
  );

  const branch = await createOrganizationFixture('BRANCH_MAIN');
  const other = await createOrganizationFixture('BRANCH_OTHER');
  const clerk = await createEmployeeInOrg(branch.id, '分所客服');
  const branchScope = await prisma.dataScope.create({
    data: { name: `branch-${randomUUID()}`, scopeType: 'BRANCH', organizationId: branch.id },
  });
  const outOfBranchLead = await seedLead({ status: 'SCREENED', branchId: other.id });

  const scoped = serviceFor(userId, actor, { employeeId: clerk.id, scopeIds: [branchScope.id] });
  await assert.rejects(
    () => scoped.createAppointment(outOfBranchLead.id, appointmentInput()),
    error => error instanceof CrmError && error.code === LEAD_NOT_FOUND && error.httpStatus === 404,
  );
  assert.equal(await prisma.appointment.count(), 0);
});

test('confirmVisit marks VISITED, promotes an INVITED lead and writes appointment.visited', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const lead = await seedLead({ status: 'INVITED' });
  const appointment = await service.createAppointment(lead.id, appointmentInput());

  const visited = await service.confirmVisit(appointment.id);

  assert.equal(visited.status, 'VISITED');
  assert.equal((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status, 'VISITED');
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status, 'VISITED');

  const visitEvent = await prisma.eventLog.findFirstOrThrow({
    where: { eventType: 'appointment.visited', objectType: 'APPOINTMENT', objectId: appointment.id },
  });
  assert.equal(visitEvent.eventVersion, 1);
  assert.deepEqual(visitEvent.payload, {
    appointmentId: appointment.id,
    leadId: lead.id,
    status: 'VISITED',
  });
  const statusEvent = await prisma.eventLog.findFirstOrThrow({
    where: { eventType: 'lead.status_changed', objectType: 'LEAD', objectId: lead.id },
  });
  assert.deepEqual(statusEvent.payload, {
    leadId: lead.id,
    fromStatus: 'INVITED',
    toStatus: 'VISITED',
  });
});

test('confirmVisit keeps a non-INVITED lead untouched but still writes appointment.visited', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const lead = await seedLead({ status: 'NEW' });
  const appointment = await service.createAppointment(lead.id, appointmentInput());
  // CONFIRMED 也可确认到访（决策 7：PENDING|CONFIRMED→VISITED）。
  await prisma.appointment.update({ where: { id: appointment.id }, data: { status: 'CONFIRMED' } });

  const visited = await service.confirmVisit(appointment.id);

  assert.equal(visited.status, 'VISITED');
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status, 'NEW');
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'appointment.visited', objectId: appointment.id } }),
    1,
  );
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'lead.status_changed' } }), 0);
});

test('confirmVisit rejects terminal appointments with LEAD_STATE_TRANSITION_INVALID', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const lead = await seedLead({ status: 'INVITED' });
  const appointment = await service.createAppointment(lead.id, appointmentInput());
  await service.confirmVisit(appointment.id);

  await assert.rejects(
    () => service.confirmVisit(appointment.id),
    error => error instanceof CrmError
      && error.code === LEAD_STATE_TRANSITION_INVALID
      && error.httpStatus === 409,
  );
});

test('markNoShow and cancel move active appointments to terminal without touching lead or events', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const lead = await seedLead({ status: 'SCREENED' });
  const noShowTarget = await service.createAppointment(lead.id, appointmentInput());
  const cancelTarget = await service.createAppointment(lead.id, appointmentInput({ scheduledAt: SLOT_2 }));

  const noShown = await service.markNoShow(noShowTarget.id);
  assert.equal(noShown.status, 'NOSHOW');
  const cancelled = await service.cancel(cancelTarget.id);
  assert.equal(cancelled.status, 'CANCELLED');

  // lead 只被创建动作推进到 INVITED；爽约/取消不动 lead、不发任何事件。
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status, 'INVITED');
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'appointment.created' } }), 2);
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'appointment.visited' } }), 0);
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'lead.status_changed' } }), 1);

  await assert.rejects(() => service.markNoShow(noShowTarget.id), hasCode(LEAD_STATE_TRANSITION_INVALID));
  await assert.rejects(() => service.cancel(cancelTarget.id), hasCode(LEAD_STATE_TRANSITION_INVALID));
});

test('reschedule archives the old row and chains the new one via rescheduledFromId', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const lead = await seedLead({ status: 'INVITED' });
  const original = await service.createAppointment(lead.id, appointmentInput());

  const moved = await service.reschedule(original.id, SLOT_3);

  assert.notEqual(moved.id, original.id);
  assert.equal(moved.status, 'PENDING');
  assert.equal(moved.leadId, lead.id);
  assert.deepEqual(moved.scheduledAt, SLOT_3);
  assert.equal(moved.rescheduledFromId, original.id);
  assert.match(moved.appointmentNo, /^AP\d{6}-[0-9A-Z]{6}$/);

  const oldRow = await prisma.appointment.findUniqueOrThrow({ where: { id: original.id } });
  assert.equal(oldRow.status, 'RESCHEDULED');

  // reschedule 无事件（决策 9）：创建事件仅 1 条（首建行），新行不发 appointment.created。
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'appointment.created' } }), 1);
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'lead.status_changed' } }), 0);
});

test('reschedule applies the active-slot conflict rule to the new slot for any actor', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const lead = await seedLead({ status: 'INVITED' });
  const first = await service.createAppointment(lead.id, appointmentInput());
  // 同一 actor 在 SLOT_2 已有 PENDING 邀约：改期到 SLOT_2 仍冲突（同创建人回放不适用）。
  await service.createAppointment(lead.id, appointmentInput({ scheduledAt: SLOT_2 }));

  await assert.rejects(
    () => service.reschedule(first.id, SLOT_2),
    error => error instanceof CrmError
      && error.code === APPOINTMENT_CONFLICT
      && error.httpStatus === 409,
  );
  assert.equal((await prisma.appointment.findUniqueOrThrow({ where: { id: first.id } })).status, 'PENDING');

  // 改期到空槽成功；旧行 RESCHEDULED 后不再占用原槽位，可再次新建。
  const moved = await service.reschedule(first.id, SLOT_3);
  assert.equal(moved.status, 'PENDING');
  const reused = await service.createAppointment(lead.id, appointmentInput());
  assert.ok(reused.id);

  // 终态邀约不可改期。
  await assert.rejects(() => service.reschedule(first.id, SLOT_1), hasCode(LEAD_STATE_TRANSITION_INVALID));
});

test('reschedule requires appointment.create and hides out-of-scope appointments', async () => {
  const { userId, actor } = await createActor();
  const lead = await seedLead({ status: 'INVITED' });
  const appointment = await serviceFor(userId, actor).createAppointment(lead.id, appointmentInput());

  await assert.rejects(
    () => serviceFor(userId, actor, { permissionCodes: ['appointment.read', 'appointment.visit'] })
      .reschedule(appointment.id, SLOT_2),
    hasCode('PERMISSION_DENIED'),
  );

  const branch = await createOrganizationFixture('BRANCH_MAIN');
  const clerk = await createEmployeeInOrg(branch.id, '分所客服');
  const branchScope = await prisma.dataScope.create({
    data: { name: `branch-${randomUUID()}`, scopeType: 'BRANCH', organizationId: branch.id },
  });
  const scoped = serviceFor(userId, actor, { employeeId: clerk.id, scopeIds: [branchScope.id] });
  await assert.rejects(
    () => scoped.reschedule(appointment.id, SLOT_2),
    hasCode(LEAD_NOT_FOUND),
  );
  assert.equal(
    (await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status,
    'PENDING',
  );
});

test('BRANCH scope anchors on the lead relation: in-branch appointments visible, others 404', async () => {
  const { userId, actor } = await createActor();
  const branch = await createOrganizationFixture('BRANCH_MAIN');
  const branchChild = await createOrganizationFixture('BRANCH_CHILD', branch);
  const other = await createOrganizationFixture('BRANCH_OTHER');
  const clerk = await createEmployeeInOrg(branch.id, '分所客服');
  const branchScope = await prisma.dataScope.create({
    data: { name: `branch-${randomUUID()}`, scopeType: 'BRANCH', organizationId: branch.id },
  });

  const inBranchLead = await seedLead({ status: 'INVITED', branchId: branch.id });
  const inChildLead = await seedLead({ status: 'INVITED', branchId: branchChild.id, name: '子机构线索' });
  const outLead = await seedLead({ status: 'INVITED', branchId: other.id, name: '外所线索' });

  const writer = serviceFor(userId, actor);
  const inBranch = await writer.createAppointment(inBranchLead.id, appointmentInput());
  await writer.createAppointment(inBranchLead.id, appointmentInput({ scheduledAt: SLOT_2 }));
  const inChild = await writer.createAppointment(inChildLead.id, appointmentInput());
  const outOfBranch = await writer.createAppointment(outLead.id, appointmentInput());

  const scoped = serviceFor(userId, actor, { employeeId: clerk.id, scopeIds: [branchScope.id] });

  const page = await scoped.listAppointments(inBranchLead.id);
  assert.deepEqual(page.map(item => item.id), [inBranch.id, (await prisma.appointment.findFirstOrThrow({
    where: { leadId: inBranchLead.id, scheduledAt: SLOT_2 },
  })).id]);

  const childView = await scoped.getAppointment(inChild.id);
  assert.equal(childView.id, inChild.id);

  await assert.rejects(() => scoped.getAppointment(outOfBranch.id), hasCode(LEAD_NOT_FOUND));
  await assert.rejects(() => scoped.listAppointments(outLead.id), hasCode(LEAD_NOT_FOUND));
});

test('getAppointment and listAppointments require appointment.read', async () => {
  const { userId, actor } = await createActor();
  const lead = await seedLead({ status: 'INVITED' });
  const appointment = await serviceFor(userId, actor).createAppointment(lead.id, appointmentInput());

  const readerLess = serviceFor(userId, actor, { permissionCodes: ['appointment.create'] });
  await assert.rejects(() => readerLess.getAppointment(appointment.id), hasCode('PERMISSION_DENIED'));
  await assert.rejects(() => readerLess.listAppointments(lead.id), hasCode('PERMISSION_DENIED'));

  const list = await serviceFor(userId, actor).listAppointments(lead.id);
  assert.deepEqual(list.map(item => item.id), [appointment.id]);
  const fetched = await serviceFor(userId, actor).getAppointment(appointment.id);
  assert.equal(fetched.id, appointment.id);
});

test('appointment mutations write OperationLog audit without remark free text', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const lead = await seedLead({ status: 'INVITED' });
  const appointment = await service.createAppointment(
    lead.id,
    appointmentInput({ remark: '绝密约见备注' }),
  );

  const createAudit = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPOINTMENT', targetId: appointment.id, action: 'APPOINTMENT_CREATE' },
  });
  assert.equal(createAudit.userId, userId);
  assert.equal((createAudit.newValues ?? '').includes('绝密约见备注'), false);

  await service.reschedule(appointment.id, SLOT_2);
  const rescheduleAudit = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPOINTMENT', action: 'APPOINTMENT_RESCHEDULE' },
  });
  assert.equal((rescheduleAudit.newValues ?? '').includes('绝密约见备注'), false);

  await service.confirmVisit(
    (await prisma.appointment.findFirstOrThrow({ where: { rescheduledFromId: appointment.id } })).id,
  );
  const visitAudit = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPOINTMENT', action: 'APPOINTMENT_VISIT' },
  });
  assert.equal(visitAudit.userId, userId);
});

// ---------------------------------------------------------------------------
// 2026-07-29 用户裁定（Task 10 收官后纯追加）：listAppointmentsByRange 到访日历范围查询。
// 契约：appointment.read 首语句；scheduledAt ∈ [from, to] 双端含；from>to / 跨度>366d /
// 非 Date → VALIDATION_FAILED(400)；范围锚定 lead 关系（SELF/TEAM/BRANCH 子树/ALL）；
// 软删 lead 排除；scheduledAt ASC（id ASC 决胜）分页。
// ---------------------------------------------------------------------------

async function seedAppointment(
  leadId: string,
  scheduledAt: Date,
  overrides: Partial<Prisma.AppointmentUncheckedCreateInput> = {},
) {
  return prisma.appointment.create({
    data: {
      appointmentNo: `AP-SEED-${randomUUID()}`,
      leadId,
      scheduledAt,
      channel: 'ONSITE',
      status: 'PENDING',
      createdBy: 'seed',
      ...overrides,
    },
  });
}

const RANGE_FROM = new Date('2026-08-01T00:00:00.000Z');
const RANGE_TO = new Date('2026-08-31T23:59:59.999Z');
const RANGE_SPAN_CAP = 366 * 24 * 60 * 60 * 1000;

test('listAppointmentsByRange includes both boundary instants and orders by scheduledAt then id', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const lead = await seedLead({ status: 'INVITED' });
  const atFrom = await seedAppointment(lead.id, RANGE_FROM);
  const mid = await seedAppointment(lead.id, new Date('2026-08-15T12:00:00.000Z'));
  const atTo = await seedAppointment(lead.id, RANGE_TO);
  // 区间外两侧各一行：毫秒级贴边排除。
  await seedAppointment(lead.id, new Date(RANGE_FROM.getTime() - 1));
  await seedAppointment(lead.id, new Date(RANGE_TO.getTime() + 1));

  const result = await service.listAppointmentsByRange({ from: RANGE_FROM, to: RANGE_TO });

  assert.deepEqual(result.list.map(item => item.id), [atFrom.id, mid.id, atTo.id]);
  assert.equal(result.total, 3);
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 20);
  assert.equal(result.list[0].appointmentNo, atFrom.appointmentNo);
});

test('listAppointmentsByRange rejects inverted, over-span and non-Date ranges with 400', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);

  // from > to → 400。
  await assert.rejects(
    () => service.listAppointmentsByRange({ from: RANGE_TO, to: RANGE_FROM }),
    error => hasCode('VALIDATION_FAILED')(error)
      && (error as { status?: number }).status === 400,
  );
  // 跨度 > 366 天 → 400；恰好 366 天放行（全表扫描护栏边界）。
  await assert.rejects(
    () => service.listAppointmentsByRange({
      from: RANGE_FROM,
      to: new Date(RANGE_FROM.getTime() + RANGE_SPAN_CAP + 1),
    }),
    hasCode('VALIDATION_FAILED'),
  );
  const atCap = await service.listAppointmentsByRange({
    from: RANGE_FROM,
    to: new Date(RANGE_FROM.getTime() + RANGE_SPAN_CAP),
  });
  assert.equal(atCap.total, 0);
  // NaN Date 与非 Date 形态 → 400。
  await assert.rejects(
    () => service.listAppointmentsByRange({ from: new Date('not-a-date'), to: RANGE_TO }),
    hasCode('VALIDATION_FAILED'),
  );
  await assert.rejects(
    () => service.listAppointmentsByRange({ from: '2026-08-01' as unknown as Date, to: RANGE_TO }),
    hasCode('VALIDATION_FAILED'),
  );
  // 未知键 → 400。
  await assert.rejects(
    () => service.listAppointmentsByRange({ from: RANGE_FROM, to: RANGE_TO, status: 'PENDING' } as never),
    hasCode('VALIDATION_FAILED'),
  );
});

test('listAppointmentsByRange requires appointment.read as its first statement', async () => {
  const { userId, actor } = await createActor();
  const readerLess = serviceFor(userId, actor, { permissionCodes: ['appointment.create'] });
  await assert.rejects(
    () => readerLess.listAppointmentsByRange({ from: RANGE_FROM, to: RANGE_TO }),
    hasCode('PERMISSION_DENIED'),
  );
});

test('listAppointmentsByRange SELF scope sees only own-assigned-lead appointments', async () => {
  const { userId, actor } = await createActor();
  const branch = await createOrganizationFixture('BRANCH_MAIN');
  const employeeA = await createEmployeeInOrg(branch.id, '客服A');
  const employeeB = await createEmployeeInOrg(branch.id, '客服B');
  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  const mineLead = await seedLead({ name: '我的线索', assignedTo: employeeA.id, poolStatus: 'PRIVATE' });
  const othersLead = await seedLead({ name: '他人线索', assignedTo: employeeB.id, poolStatus: 'PRIVATE' });
  const mine = await seedAppointment(mineLead.id, new Date('2026-08-10T10:00:00.000Z'));
  await seedAppointment(othersLead.id, new Date('2026-08-10T11:00:00.000Z'));

  const scoped = serviceFor(userId, actor, { employeeId: employeeA.id, scopeIds: [selfScope.id] });
  const result = await scoped.listAppointmentsByRange({ from: RANGE_FROM, to: RANGE_TO });

  assert.deepEqual(result.list.map(item => item.id), [mine.id]);
  assert.equal(result.total, 1);
});

test('listAppointmentsByRange TEAM scope anchors on lead.professionalTeamId', async () => {
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
  const inTeamLead = await seedLead({ name: '团队线索', professionalTeamId: team.id });
  const otherTeamLead = await seedLead({ name: '他团队线索', professionalTeamId: otherTeam.id });
  const visible = await seedAppointment(inTeamLead.id, new Date('2026-08-11T10:00:00.000Z'));
  await seedAppointment(otherTeamLead.id, new Date('2026-08-11T11:00:00.000Z'));

  const scoped = serviceFor(userId, actor, { scopeIds: [teamScope.id] });
  const result = await scoped.listAppointmentsByRange({ from: RANGE_FROM, to: RANGE_TO });

  assert.deepEqual(result.list.map(item => item.id), [visible.id]);
  assert.equal(result.total, 1);
});

test('listAppointmentsByRange BRANCH scope covers the subtree; ALL scope sees everything', async () => {
  const { userId, actor } = await createActor();
  const branch = await createOrganizationFixture('BRANCH_MAIN');
  const child = await createOrganizationFixture('BRANCH_CHILD', branch);
  const other = await createOrganizationFixture('BRANCH_OTHER');
  const clerk = await createEmployeeInOrg(branch.id, '分所客服');
  const branchScope = await prisma.dataScope.create({
    data: { name: `branch-${randomUUID()}`, scopeType: 'BRANCH', organizationId: branch.id },
  });
  const inBranchLead = await seedLead({ branchId: branch.id });
  const inChildLead = await seedLead({ name: '子机构线索', branchId: child.id });
  const outLead = await seedLead({ name: '外所线索', branchId: other.id });
  const inBranch = await seedAppointment(inBranchLead.id, new Date('2026-08-12T10:00:00.000Z'));
  const inChild = await seedAppointment(inChildLead.id, new Date('2026-08-12T11:00:00.000Z'));
  const outside = await seedAppointment(outLead.id, new Date('2026-08-12T12:00:00.000Z'));

  const scoped = serviceFor(userId, actor, { employeeId: clerk.id, scopeIds: [branchScope.id] });
  const branchResult = await scoped.listAppointmentsByRange({ from: RANGE_FROM, to: RANGE_TO });
  assert.deepEqual(branchResult.list.map(item => item.id), [inBranch.id, inChild.id]);
  assert.equal(branchResult.total, 2);

  const all = await serviceFor(userId, actor).listAppointmentsByRange({ from: RANGE_FROM, to: RANGE_TO });
  assert.deepEqual(all.list.map(item => item.id), [inBranch.id, inChild.id, outside.id]);
  assert.equal(all.total, 3);
});

test('listAppointmentsByRange excludes appointments whose lead is soft-deleted', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const liveLead = await seedLead();
  const deletedLead = await seedLead({ name: '已删线索', deletedAt: new Date() });
  const live = await seedAppointment(liveLead.id, new Date('2026-08-13T10:00:00.000Z'));
  await seedAppointment(deletedLead.id, new Date('2026-08-13T11:00:00.000Z'));

  const result = await service.listAppointmentsByRange({ from: RANGE_FROM, to: RANGE_TO });

  assert.deepEqual(result.list.map(item => item.id), [live.id]);
  assert.equal(result.total, 1);
});

test('listAppointmentsByRange paginates with page/pageSize math in scheduledAt order', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const lead = await seedLead();
  const seeded: string[] = [];
  for (let day = 1; day <= 5; day += 1) {
    const row = await seedAppointment(lead.id, new Date(`2026-08-0${day}T09:00:00.000Z`));
    seeded.push(row.id);
  }

  const page1 = await service.listAppointmentsByRange({ from: RANGE_FROM, to: RANGE_TO, page: 1, pageSize: 2 });
  assert.deepEqual(page1.list.map(item => item.id), [seeded[0], seeded[1]]);
  assert.equal(page1.page, 1);
  assert.equal(page1.pageSize, 2);
  assert.equal(page1.total, 5);

  const page2 = await service.listAppointmentsByRange({ from: RANGE_FROM, to: RANGE_TO, page: 2, pageSize: 2 });
  assert.deepEqual(page2.list.map(item => item.id), [seeded[2], seeded[3]]);

  const page3 = await service.listAppointmentsByRange({ from: RANGE_FROM, to: RANGE_TO, page: 3, pageSize: 2 });
  assert.deepEqual(page3.list.map(item => item.id), [seeded[4]]);

  // 非法分页参数 → 400。
  await assert.rejects(
    () => service.listAppointmentsByRange({ from: RANGE_FROM, to: RANGE_TO, page: 0 }),
    hasCode('VALIDATION_FAILED'),
  );
  await assert.rejects(
    () => service.listAppointmentsByRange({ from: RANGE_FROM, to: RANGE_TO, pageSize: 101 }),
    hasCode('VALIDATION_FAILED'),
  );
});

test('listAppointmentsByRange returns an empty page when the range has no appointments', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const lead = await seedLead();
  await seedAppointment(lead.id, new Date('2026-09-10T10:00:00.000Z'));

  const result = await service.listAppointmentsByRange({ from: RANGE_FROM, to: RANGE_TO });

  assert.deepEqual(result.list, []);
  assert.equal(result.total, 0);
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 20);
});
