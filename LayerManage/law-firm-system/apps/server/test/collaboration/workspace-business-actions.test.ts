import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { LeadService } from '../../app/application/crm/lead-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

let db: PrismaClient;
let owner: CollaborationService;
let employee: CollaborationService;
let manager: CollaborationService;
let admin: CollaborationService;
let workspace: string;
let base: string;
let table: string;
let org: string;
let position: string;
let managerPosition: string;
let assignment: string;
let leadId: string;
const code = (value: string) => (e: unknown) => (e as { code?: string }).code === value;
const key = () => randomUUID();

function context(userId: string, employeeId: string): AuthorizationContext {
  const permissions: AuthorizationContext['permissionCodes'] = ['lead.read', 'lead.update', 'lead.assign'];
  return {
    userId,
    employeeId,
    isSystemAdmin: false,
    isSystemSuperAdmin: false,
    evaluatedAt: new Date(),
    permissionCodes: permissions,
    fieldRules: [],
    grants: permissions.map((permissionCode) => ({
      sourceType: 'ROLE',
      sourceId: 'fixture',
      sourceRoleId: 'fixture',
      resource: 'lead',
      permissionCode,
      scopeIds: ['ALL'],
      validUntil: null,
    })),
  };
}

test.before(() => {
  db = createTestPrisma();
});
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  org = key();
  await db.organization.create({
    data: { id: org, code: key(), name: '第三批测试组织', type: 'FIRM', path: '/' + org },
  });
  position = (
    await db.position.create({
      data: { organizationId: org, code: key(), name: '业务专员', categoryCode: 'SALES' },
    })
  ).id;
  managerPosition = (
    await db.position.create({
      data: { organizationId: org, code: key(), name: '业务负责人', categoryCode: 'SALES' },
    })
  ).id;
  const make = async (name: string, positionId: string) => {
    const e = await db.employee.create({
      data: {
        name,
        employeeNo: key(),
        phone: '13800001234',
        type: 'SALES',
        status: 'FORMAL',
        entryDate: new Date('2025-01-01'),
      },
    });
    const u = await db.user.create({
      data: { username: name, password: 'unused-fixture', employeeId: e.id },
    });
    const job = await db.employeeAssignment.create({
      data: {
        employeeId: e.id,
        organizationId: org,
        positionId,
        assignmentType: 'PRIMARY',
        startedAt: new Date('2025-01-01'),
      },
    });
    return { service: new CollaborationService(db, context(u.id, e.id)), job: job.id };
  };
  owner = (await make('owner', managerPosition)).service;
  const ordinary = await make('employee', position);
  employee = ordinary.service;
  assignment = ordinary.job;
  manager = (await make('manager', managerPosition)).service;
  admin = (await make('administrator', managerPosition)).service;
  const w = await db.collabWorkspace.create({
    data: {
      organizationId: org,
      name: '岗位业务工作区',
      ownerId: owner.actor.userId,
      members: {
        create: [{ principalId: owner.actor.userId, role: 'OWNER', rowScope: 'ALL', canCreate: true }],
      },
    },
  });
  workspace = w.id;
  await owner.saveMember(
    workspace,
    { principalType: 'POSITION', principalId: position, role: 'EDITOR' },
    key(),
  );
  await owner.saveMember(
    workspace,
    { principalType: 'POSITION', principalId: managerPosition, role: 'MANAGER' },
    key(),
  );
  base = (await owner.createBase(workspace, { name: '线索协作' }, key())).id;
  table = (await owner.createTable(base, { name: '真实业务', source: 'LEADS' }, key())).id;
  leadId = (
    await db.lead.create({
      data: {
        name: '本人录入但由他人负责',
        leadNo: key(),
        phone: '13800001234',
        phoneHash: key(),
        branchId: org,
        assignedTo: manager.actor.employeeId,
        status: 'ASSIGNED',
        poolStatus: 'PRIVATE',
        assignedAt: new Date(),
        createdBy: employee.actor.userId,
      },
    })
  ).id;
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});

test('position grants use effective appointments and default ordinary users to creator-only scope', async () => {
  await db.lead.create({
    data: {
      name: '他人录入但由本人负责',
      leadNo: key(),
      phone: '13800001234',
      phoneHash: key(),
      branchId: org,
      assignedTo: employee.actor.employeeId,
      createdBy: manager.actor.userId,
    },
  });
  assert.equal((await employee.access(workspace)).selfOnly, true);
  assert.equal((await manager.access(workspace)).selfOnly, false);
  assert.deepEqual(
    (await employee.query(table, {})).records.map((r) => r.id),
    [leadId],
  );
  assert.equal((await manager.query(table, {})).total, 2);
  await db.employeeAssignment.update({
    where: { id: assignment },
    data: { endedAt: new Date('2025-02-01') },
  });
  await assert.rejects(employee.query(table, {}), code('COLLAB_FORBIDDEN'));
  await db.employeeAssignment.update({ where: { id: assignment }, data: { endedAt: null } });
  await db.position.update({ where: { id: position }, data: { status: 'DISABLED' } });
  await assert.rejects(employee.access(workspace), code('COLLAB_FORBIDDEN'));
});

test('resource administrators configure other positions but cannot delegate authority or change themselves', async () => {
  await assert.rejects(
    manager.saveMember(
      workspace,
      { principalType: 'POSITION', principalId: position, role: 'MANAGER', version: 1 },
      key(),
    ),
    code('COLLAB_FORBIDDEN'),
  );
  await owner.saveMember(
    workspace,
    { principalType: 'USER', principalId: admin.actor.userId, role: 'MANAGER', canManageAccess: true },
    key(),
  );
  assert.equal((await admin.access(workspace)).canManageAccess, true);
  await admin.saveMember(
    workspace,
    {
      principalType: 'POSITION',
      principalId: position,
      role: 'EDITOR',
      rowScope: 'SELF',
      canCreate: true,
      version: 1,
    },
    key(),
  );
  assert.equal((await employee.access(workspace)).canCreate, true);
  await assert.rejects(
    admin.saveMember(
      workspace,
      { principalType: 'POSITION', principalId: managerPosition, role: 'EDITOR', version: 1 },
      key(),
    ),
    code('COLLAB_CANNOT_GRANT_ACCESS_ADMIN'),
  );
  await assert.rejects(
    admin.saveMember(
      workspace,
      {
        principalType: 'POSITION',
        principalId: position,
        role: 'MANAGER',
        canManageAccess: true,
        version: 2,
      },
      key(),
    ),
    code('COLLAB_CANNOT_GRANT_ACCESS_ADMIN'),
  );
  await admin.saveResourceAccess(
    'TABLE',
    table,
    { version: 1, policy: { restricted: true, grants: [] } },
    key(),
  );
  await assert.rejects(employee.query(table, {}), code('COLLAB_FORBIDDEN'));
});

test('follow, assignment and status commands reuse CRM rules, enforce versions and replay exactly once', async () => {
  const replay = key();
  const follow = {
    action: 'FOLLOW',
    version: 1,
    type: 'PHONE',
    content: '在工作区完成首次跟进',
    nextPlan: '明天回访',
  };
  const result = await employee.businessAction(table, leadId, follow, replay);
  assert.deepEqual(await employee.businessAction(table, leadId, follow, replay), result);
  assert.equal(await db.leadFollow.count({ where: { leadId } }), 1);
  const after = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
  assert.equal(after.status, 'CONTACTED');
  assert.notEqual(after.firstResponseSeconds, null);
  await assert.rejects(
    employee.businessAction(
      table,
      leadId,
      { action: 'STATUS', version: 1, status: 'SCREENED', reason: '已筛选' },
      key(),
    ),
    code('COLLAB_RECORD_CONFLICT'),
  );
  await employee.businessAction(
    table,
    leadId,
    { action: 'STATUS', version: after.version, status: 'SCREENED', reason: '已完成初筛' },
    key(),
  );
  const v = (await db.lead.findUniqueOrThrow({ where: { id: leadId } })).version;
  await manager.businessAction(
    table,
    leadId,
    { action: 'ASSIGN', version: v, employeeId: employee.actor.employeeId, reason: '由录入人负责' },
    key(),
  );
  assert.equal(
    (await db.lead.findUniqueOrThrow({ where: { id: leadId } })).assignedTo,
    employee.actor.employeeId,
  );
  assert.equal(await db.leadPoolRecord.count({ where: { leadId } }), 1);
  const detail = await employee.businessDetail(table, leadId);
  assert.equal(detail.followsTotal, 1);
  assert.equal(detail.historyTotal, 2); // Other user's assignment audit is hidden.
  assert.equal((await manager.businessDetail(table, leadId)).historyTotal, 3);
  assert.equal(await db.collabEvent.count({ where: { baseId: base, kind: 'business.changed' } }), 3);
});

test('business actions reject missing action rights, protected fields, outside assignees and roll back failed events', async () => {
  const noAction = new CollaborationService(db, { ...employee.actor, permissionCodes: ['lead.read'] });
  await assert.rejects(
    noAction.businessAction(
      table,
      leadId,
      { action: 'FOLLOW', version: 1, type: 'PHONE', content: 'denied' },
      key(),
    ),
    code('COLLAB_FORBIDDEN'),
  );
  const state = (await owner.describe(table)).fields.find(
    (f) => (f.options as { businessKey: string }).businessKey === 'status',
  )!;
  await owner.saveResourceAccess(
    'TABLE',
    table,
    {
      version: 1,
      policy: {
        restricted: false,
        grants: [
          {
            principalType: 'POSITION',
            principalId: position,
            role: 'EDITOR',
            rowScope: 'SELF',
            readonlyFields: [state.id],
          },
        ],
      },
    },
    key(),
  );
  await assert.rejects(
    employee.businessAction(
      table,
      leadId,
      { action: 'FOLLOW', version: 1, type: 'PHONE', content: 'would change readonly status' },
      key(),
    ),
    code('COLLAB_FORBIDDEN'),
  );
  assert.deepEqual((await employee.businessDetail(table, leadId)).statuses, []);
  await owner.saveResourceAccess(
    'TABLE',
    table,
    {
      version: 2,
      policy: {
        restricted: false,
        grants: [
          {
            principalType: 'POSITION',
            principalId: position,
            role: 'EDITOR',
            rowScope: 'SELF',
            hiddenFields: [state.id],
          },
        ],
      },
    },
    key(),
  );
  assert.ok(!(await employee.describe(table)).fields.some((f) => f.id === state.id));
  assert.deepEqual(
    (await employee.businessDetail(table, leadId)).statuses,
    [],
    'hidden status must not be inferred from transition options',
  );
  await owner.saveResourceAccess(
    'TABLE',
    table,
    { version: 3, policy: { restricted: false, grants: [] } },
    key(),
  );
  await assert.rejects(
    manager.businessAction(
      table,
      leadId,
      { action: 'ASSIGN', version: 1, employeeId: key(), reason: '无效目标' },
      key(),
    ),
    code('COLLAB_MEMBER_UNAVAILABLE'),
  );
  const service = new CollaborationService(db, owner.actor);
  const prototype = Object.getPrototypeOf(service) as { event: (...args: unknown[]) => Promise<void> };
  const event = prototype.event;
  prototype.event = async () => {
    throw new Error('fixture event failure');
  };
  try {
    await assert.rejects(
      service.businessAction(
        table,
        leadId,
        { action: 'FOLLOW', version: 1, type: 'PHONE', content: 'must roll back' },
        key(),
      ),
      /fixture event failure/,
    );
  } finally {
    prototype.event = event;
  }
  assert.equal(await db.leadFollow.count(), 0);
  assert.equal((await db.lead.findUniqueOrThrow({ where: { id: leadId } })).version, 1);
  assert.equal(await db.operationLog.count({ where: { action: 'LEAD_FOLLOW_CREATE' } }), 0);
  // Original business entry remains usable after the composable-transaction refactor.
  await new LeadService(db, { actorUserId: owner.actor.userId }, owner.actor).transitionStatus(
    leadId,
    'CONTACTED',
    '原入口仍可办理',
  );
  assert.equal((await db.lead.findUniqueOrThrow({ where: { id: leadId } })).status, 'CONTACTED');
});
