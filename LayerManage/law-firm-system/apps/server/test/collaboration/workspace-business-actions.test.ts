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

function commands(service: CollaborationService) {
  for (const permissionCode of ['lead.create', 'lead.pool.claim', 'lead.recycle'] as const) {
    service.actor.permissionCodes.push(permissionCode);
    service.actor.grants.push({
      sourceType: 'ROLE',
      sourceId: 'u4',
      resource: 'lead',
      permissionCode,
      scopeIds: ['ALL'],
      validUntil: null,
    });
  }
  return service;
}
test('U4 directory reveals only authorized sources and locates canonical records across entries', async () => {
  const follows = await owner.createTable(base, { name: '正式跟进', source: 'FOLLOWS' }, key());
  const directory = await employee.businessTables({ source: 'LEADS', recordId: leadId });
  assert.deepEqual(
    directory.tables.map((t) => t.id),
    [table],
  );
  assert.equal(directory.targets.length, 0);
  assert.deepEqual(
    (await manager.businessTables({ source: 'FOLLOWS' })).tables.map((t) => t.id),
    [follows.id],
  );
  assert.equal((await owner.businessTables()).targets[0].id, base);
  await employee.businessAction(
    table,
    leadId,
    { action: 'FOLLOW', version: 1, type: 'PHONE', content: '关联标签验证' },
    key(),
  );
  const followResult = await employee.query(follows.id, {});
  assert.equal(JSON.stringify(followResult.records).includes('本人录入但由他人负责'), true);
  const linkedField = (await owner.describe(follows.id)).fields.find(
    (f) => (f.options as { businessKey: string }).businessKey === 'leadId',
  )!;
  await owner.saveResourceAccess(
    'TABLE',
    follows.id,
    {
      version: 1,
      policy: {
        restricted: true,
        grants: [
          {
            principalType: 'POSITION',
            principalId: position,
            role: 'EDITOR',
            rowScope: 'SELF',
            hiddenFields: [linkedField.id],
            readonlyFields: [],
          },
        ],
      },
    },
    key(),
  );
  assert.equal(JSON.stringify(await employee.query(follows.id, {})).includes('本人录入但由他人负责'), false);
  await assert.rejects(employee.businessTables({ source: 'CUSTOM' }), code('COLLAB_INVALID_OPTION'));
  await owner.saveResourceAccess(
    'TABLE',
    table,
    { version: 1, policy: { restricted: true, grants: [] } },
    key(),
  );
  assert.equal((await employee.businessTables()).tables.length, 0);
  assert.equal((await owner.businessTables()).tables.length, 1);
});
test('U4 creates canonical CRM rows atomically and retries without duplicate records or leaking duplicate identities', async () => {
  commands(employee);
  const body = { name: '表格中新建', phone: '13900009991', intentionLevel: 3 };
  const idempotency = key();
  const first = await employee.createBusinessRecord(table, body, idempotency);
  assert.deepEqual(await employee.createBusinessRecord(table, body, idempotency), first);
  const lead = await db.lead.findUniqueOrThrow({ where: { id: first.id } });
  assert.equal(lead.branchId, org);
  assert.equal(lead.createdBy, employee.actor.userId);
  assert.equal(lead.poolStatus, 'PUBLIC');
  assert.equal(lead.status, 'NEW');
  assert.equal(await db.collabRecord.count(), 0);
  assert.equal(
    (await employee.query(table, {})).records.some((r) => r.id === lead.id),
    true,
  );
  assert.equal(
    (await new LeadService(db, { actorUserId: employee.actor.userId }, employee.actor).getLead(lead.id)).id,
    lead.id,
  );
  assert.equal(await db.operationLog.count({ where: { action: 'LEAD_CREATE', targetId: lead.id } }), 1);
  assert.equal(await db.collabEvent.count({ where: { kind: 'business.changed', baseId: base } }), 1);
  await assert.rejects(
    employee.createBusinessRecord(table, { ...body, branchId: key() }, key()),
    code('COLLAB_UNKNOWN_PROPERTY'),
  );
  await assert.rejects(manager.createBusinessRecord(table, body, key()), code('COLLAB_FORBIDDEN'));
  const other = await commands(manager).createBusinessRecord(table, { ...body, name: '他人重复' }, key());
  assert.equal(other.duplicates, 1);
  const ownAgain = await employee.createBusinessRecord(table, body, key());
  assert.equal(ownAgain.duplicates, 1); // other creator remains outside SELF
  assert.notEqual(ownAgain.id, first.id);
  const service = employee as unknown as { event: (...args: unknown[]) => Promise<void> };
  const original = service.event;
  service.event = async () => {
    throw new Error('u4 event rollback');
  };
  try {
    await assert.rejects(
      employee.createBusinessRecord(table, { ...body, phone: '13900009992' }, key()),
      /u4 event rollback/,
    );
  } finally {
    service.event = original;
  }
  assert.equal(await db.lead.count({ where: { phone: '13900009992' } }), 0);
});
test('U4 pool commands enforce fields, scopes, optimistic version and atomic rollback', async () => {
  commands(employee);
  commands(manager);
  const row = await employee.createBusinessRecord(table, { name: '领取与回收', phone: '13900009993' }, key());
  assert.equal((await employee.businessDetail(table, row.id)).capabilities.claim, true);
  const claimKey = key();
  const claimed = await employee.businessAction(table, row.id, { action: 'CLAIM', version: 1 }, claimKey);
  assert.deepEqual(
    await employee.businessAction(table, row.id, { action: 'CLAIM', version: 1 }, claimKey),
    claimed,
  );
  assert.equal(claimed.version, 2);
  assert.equal(
    (await db.lead.findUniqueOrThrow({ where: { id: row.id } })).assignedTo,
    employee.actor.employeeId,
  );
  await assert.rejects(
    manager.businessAction(table, row.id, { action: 'RECYCLE', version: 1, reason: '过期版本' }, key()),
    code('COLLAB_RECORD_CONFLICT'),
  );
  const service = manager as unknown as { event: (...args: unknown[]) => Promise<void> };
  const original = service.event;
  service.event = async () => {
    throw new Error('pool rollback');
  };
  try {
    await assert.rejects(
      manager.businessAction(table, row.id, { action: 'RECYCLE', version: 2, reason: '应回滚' }, key()),
      /pool rollback/,
    );
  } finally {
    service.event = original;
  }
  assert.equal((await db.lead.findUniqueOrThrow({ where: { id: row.id } })).poolStatus, 'PRIVATE');
  await manager.businessAction(
    table,
    row.id,
    { action: 'RECYCLE', version: 2, reason: '重新分配前回收' },
    key(),
  );
  const current = await db.lead.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(current.createdBy, employee.actor.userId);
  assert.equal(current.assignedTo, null);
  assert.equal(current.poolStatus, 'RECYCLED');
  assert.equal((await employee.businessDetail(table, row.id)).capabilities.claim, true);
  const racing = await employee.createBusinessRecord(
    table,
    { name: '并发领取', phone: '13900009994' },
    key(),
  );
  const outcomes = await Promise.allSettled([
    employee.businessAction(table, racing.id, { action: 'CLAIM', version: 1 }, key()),
    manager.businessAction(table, racing.id, { action: 'CLAIM', version: 1 }, key()),
  ]);
  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
  assert.equal((await db.lead.findUniqueOrThrow({ where: { id: racing.id } })).version, 2);
  assert.equal(await db.leadPoolRecord.count({ where: { leadId: racing.id, action: 'CLAIM' } }), 1);
  const assignedField = (await owner.describe(table)).fields.find(
    (f) => (f.options as { businessKey: string }).businessKey === 'assignedTo',
  )!;
  await owner.saveResourceAccess(
    'TABLE',
    table,
    {
      version: 1,
      policy: {
        restricted: true,
        grants: [
          {
            principalType: 'POSITION',
            principalId: position,
            role: 'EDITOR',
            rowScope: 'SELF',
            readonlyFields: [assignedField.id],
            hiddenFields: [],
          },
        ],
      },
    },
    key(),
  );
  assert.equal((await employee.businessDetail(table, row.id)).capabilities.claim, false);
  await assert.rejects(
    employee.businessAction(table, row.id, { action: 'CLAIM', version: current.version }, key()),
    code('COLLAB_FORBIDDEN'),
  );
});

test('U4 creation fails closed for hidden required fields, creator-only CRM read scopes and outside create scopes', async () => {
  commands(employee);
  const originalGrants = employee.actor.grants;
  employee.actor.grants = originalGrants.map((g) =>
    g.permissionCode === 'lead.read' ? { ...g, scopeIds: ['SELF'] } : g,
  );
  assert.equal((await employee.describe(table)).canCreateBusiness, false);
  await assert.rejects(
    employee.createBusinessRecord(table, { name: '无范围', phone: '13900007771' }, key()),
    code('COLLAB_FORBIDDEN'),
  );
  employee.actor.grants = originalGrants.map((g) =>
    g.permissionCode === 'lead.create' ? { ...g, scopeIds: [] } : g,
  );
  await assert.rejects(
    employee.createBusinessRecord(table, { name: '无创建范围', phone: '13900007772' }, key()),
    code('COLLAB_FORBIDDEN'),
  );
  employee.actor.grants = originalGrants;
  const phone = (await owner.describe(table)).fields.find(
    (f) => (f.options as { businessKey: string }).businessKey === 'phone',
  )!;
  await owner.saveResourceAccess(
    'TABLE',
    table,
    {
      version: 1,
      policy: {
        restricted: true,
        grants: [
          {
            principalType: 'POSITION',
            principalId: position,
            role: 'EDITOR',
            rowScope: 'SELF',
            hiddenFields: [phone.id],
            readonlyFields: [],
          },
        ],
      },
    },
    key(),
  );
  assert.equal((await employee.describe(table)).canCreateBusiness, false);
  await assert.rejects(
    employee.createBusinessRecord(table, { name: '隐藏必填字段', phone: '13900007773' }, key()),
    code('COLLAB_FORBIDDEN'),
  );
  assert.equal(await db.lead.count(), 1);
});
