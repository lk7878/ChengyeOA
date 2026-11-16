import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

let db: PrismaClient;
let owner: CollaborationService;
let employee: CollaborationService;
let manager: CollaborationService;
let workspace: string;
let base: string;
let table: string;
let org: string;
let position: string;
let managerPosition: string;
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
    data: { id: org, code: key(), name: '扩展字段测试组织', type: 'FIRM', path: '/' + org },
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
  manager = (await make('manager', managerPosition)).service;
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

async function field(name: string, type = 'TEXT', extra: Record<string, unknown> = {}, target = table) {
  const version = (await owner.describe(target)).table.schemaVersion;
  return (await owner.saveField(target, undefined, { name, type, version, ...extra }, key())).id;
}
async function save(
  values: Record<string, unknown>,
  service = employee,
  target = table,
  id = leadId,
  mutation = key(),
) {
  const row = (await service.record(target, id)).record;
  const schemaVersion = (await service.describe(target)).table.schemaVersion;
  return service.saveRecord(target, id, { values, version: row.version, schemaVersion }, mutation);
}

test('core extensions share business IDs, persist on both sources and never alter original business fields', async () => {
  const note = await field('补充说明');
  const before = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
  await save({ [note]: '同一线索的扩展信息' });
  const row = (await employee.record(table, leadId)).record;
  assert.equal(row.values[note], '同一线索的扩展信息');
  assert.equal(row.id, leadId);
  assert.equal(row.version, 2);
  assert.deepEqual(await db.lead.findUniqueOrThrow({ where: { id: leadId } }), before);
  assert.equal(await db.collabRecord.count(), 0);
  const other = (await owner.createTable(base, { name: '另一个表定义', source: 'LEADS' }, key())).id;
  assert.ok(!Object.values((await owner.record(other, leadId)).record.values).includes('同一线索的扩展信息'));
  const follows = (await owner.createTable(base, { name: '跟进扩展', source: 'FOLLOWS' }, key())).id;
  const f = await db.leadFollow.create({
    data: {
      leadId,
      type: 'PHONE',
      content: '原始跟进',
      createdBy: employee.actor.userId,
      nextTime: new Date('2026-09-15T04:00:00Z'),
    },
  });
  const score = await field('质量评分', 'NUMBER', {}, follows);
  await save({ [score]: 4.5 }, employee, follows, f.id);
  assert.equal((await employee.record(follows, f.id)).record.values[score], 4.5);
  const nextTime = (await owner.describe(follows)).fields.find(
    (f) => (f.options as { businessKey?: string }).businessKey === 'nextTime',
  )!.id;
  const value = String((await employee.record(follows, f.id)).record.values[nextTime]);
  assert.match(value, /(Z|[+-]\d{2}:\d{2})$/);
  assert.equal(new Date(value).toISOString(), '2026-09-15T04:00:00.000Z');
  assert.equal((await db.leadFollow.findUniqueOrThrow({ where: { id: f.id } })).content, '原始跟进');
  const core = (await owner.describe(table)).fields.find(
    (f) => (f.options as { businessKey?: string }).businessKey === 'status',
  )!;
  await assert.rejects(save({ [core.id]: 'LOST' }), code('COLLAB_USE_BUSINESS_ACTION'));
  await assert.rejects(
    owner.saveField(table, core.id, { name: '不可改业务字段', version: 2 }, key()),
    code('COLLAB_USE_BUSINESS_ACTION'),
  );
  await assert.rejects(
    field('伪造业务来源', 'TEXT', { options: { businessKey: 'status' } }),
    code('COLLAB_UNKNOWN_PROPERTY'),
  );
});

test('mixed core and extension filters sort, page and group authorized rows in the database', async () => {
  const score = await field('金额', 'CURRENCY');
  const date = await field('复核时间', 'DATETIME');
  await save({ [score]: '10.20', [date]: '2026-09-15T12:00:00+08:00' });
  const second = await db.lead.create({
    data: {
      name: '第二个本人线索',
      leadNo: key(),
      phone: '13800001234',
      phoneHash: key(),
      branchId: org,
      createdBy: employee.actor.userId,
    },
  });
  await save({ [score]: '2.50' }, employee, table, second.id);
  await db.lead.create({
    data: {
      name: '他人线索',
      leadNo: key(),
      phone: '13800001234',
      phoneHash: key(),
      branchId: org,
      createdBy: manager.actor.userId,
    },
  });
  const name = (await owner.describe(table)).fields.find(
    (f) => (f.options as { businessKey?: string }).businessKey === 'name',
  )!.id;
  const query = await employee.query(table, {
    config: {
      filter: {
        join: 'or',
        children: [
          { fieldId: score, operator: 'gt', value: '5' },
          { fieldId: name, operator: 'contains', value: '第二个' },
        ],
      },
      sorts: [{ fieldId: score, direction: 'asc' }],
      groupBy: [score],
    },
    pageSize: 1,
    page: 2,
  });
  assert.equal(query.total, 2);
  assert.equal(query.records[0].id, leadId);
  assert.deepEqual(
    query.groups.map((g) => Number(g.keys[0])).sort((a, b) => a - b),
    [2.5, 10.2],
  );
  assert.equal(
    (
      await employee.query(table, {
        config: { filter: { fieldId: date, operator: 'eq', value: '2026-09-15T04:00:00Z' } },
      })
    ).total,
    1,
  );
  assert.equal(
    (await employee.query(table, { config: { filter: { fieldId: score, operator: 'empty' } } })).total,
    0,
  );
  assert.equal(
    (await manager.query(table, { config: { filter: { fieldId: score, operator: 'empty' } } })).total,
    1,
  );
});

test('position, creator, action and hidden field constraints also guard extension history and linked files', async () => {
  const note = await field('权限字段');
  const fileField = await field('附件', 'FILE');
  const file = await db.collabAttachment.create({
    data: {
      tableId: table,
      ownerId: employee.actor.userId,
      name: '测试.pdf',
      mimeType: 'application/pdf',
      size: 10,
      storageKey: key(),
    },
  });
  await save({ [note]: '只供本人', [fileField]: [file.id] });
  const other = await db.lead.create({
    data: {
      name: '他人记录',
      leadNo: key(),
      phone: '13800001234',
      phoneHash: key(),
      branchId: org,
      createdBy: manager.actor.userId,
    },
  });
  await assert.rejects(save({ [note]: '越权' }, employee, table, other.id), code('COLLAB_NOT_FOUND'));
  const noUpdate = new CollaborationService(db, { ...employee.actor, permissionCodes: ['lead.read'] });
  assert.equal((await noUpdate.describe(table)).fields.find((f) => f.id === note)!.writable, false);
  await assert.rejects(save({ [note]: '越权' }, noUpdate), code('COLLAB_FORBIDDEN'));
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
            hiddenFields: [fileField],
            readonlyFields: [note],
          },
        ],
      },
    },
    key(),
  );
  await assert.rejects(save({ [note]: '只读不可改' }), code('COLLAB_FIELD_UNAVAILABLE'));
  await assert.rejects(employee.attachment(table, file.id), code('COLLAB_FORBIDDEN'));
  const detail = await employee.record(table, leadId);
  assert.ok(!(fileField in detail.record.values));
  assert.ok(!(fileField in detail.revisions[0].changes));
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
            hiddenFields: [note, fileField],
          },
        ],
      },
    },
    key(),
  );
  assert.deepEqual((await employee.record(table, leadId)).revisions[0].changes, {});
  await assert.rejects(
    employee.query(table, { config: { filter: { fieldId: note, operator: 'eq', value: '只供本人' } } }),
    code('COLLAB_FIELD_UNAVAILABLE'),
  );
});

test('extension versions, replay, core revisions and transactional events prevent lost or partial saves', async () => {
  const note = await field('并发说明');
  const input = { values: { [note]: '第一份' }, version: 1, schemaVersion: 2 };
  const mutation = key();
  const first = await employee.saveRecord(table, leadId, input, mutation);
  assert.deepEqual(await employee.saveRecord(table, leadId, input, mutation), first);
  await assert.rejects(
    employee.saveRecord(table, leadId, { ...input, values: { [note]: '覆盖' } }, key()),
    code('COLLAB_RECORD_CONFLICT'),
  );
  assert.equal(await db.collabExtensionRevision.count(), 1);
  await db.lead.update({ where: { id: leadId }, data: { version: { increment: 1 } } });
  await assert.rejects(
    employee.saveRecord(table, leadId, { ...input, version: 2 }, key()),
    code('COLLAB_RECORD_CONFLICT'),
  );
  const prototype = Object.getPrototypeOf(employee) as { event: (...args: unknown[]) => Promise<void> };
  const event = prototype.event;
  prototype.event = async () => {
    throw new Error('extension event failure');
  };
  try {
    await assert.rejects(save({ [note]: '不能部分提交' }), /extension event failure/);
  } finally {
    prototype.event = event;
  }
  assert.equal((await employee.record(table, leadId)).record.values[note], '第一份');
  assert.equal(await db.collabExtensionRevision.count(), 1);
  await assert.rejects(
    employee.saveRecord(table, leadId, { ...input, version: 3, schemaVersion: 1 }, key()),
    code('COLLAB_SCHEMA_CONFLICT'),
  );
});

test('required/default values, used types/options and view references are enforced for extension fields', async () => {
  const choiceField = await field('审核', 'SINGLE_SELECT', {
    required: true,
    defaultValue: 'todo',
    options: {
      choices: [
        { id: 'todo', name: '待审核' },
        { id: 'done', name: '完成' },
      ],
    },
  });
  const note = await field('说明');
  assert.equal((await employee.record(table, leadId)).record.values[choiceField], null);
  await save({ [note]: '首次填写' });
  assert.equal((await employee.record(table, leadId)).record.values[choiceField], 'todo');
  await assert.rejects(save({ [choiceField]: null }), code('COLLAB_REQUIRED_FIELD'));
  await assert.rejects(
    owner.saveField(table, choiceField, { version: 3, type: 'NUMBER' }, key()),
    code('COLLAB_FIELD_MIGRATION_REQUIRED'),
  );
  await assert.rejects(
    owner.saveField(
      table,
      choiceField,
      { version: 3, options: { choices: [{ id: 'done', name: '完成' }] } },
      key(),
    ),
    code('COLLAB_OPTION_IN_USE'),
  );
  await owner.saveView(
    table,
    undefined,
    { name: '引用视图', shared: true, config: { sorts: [{ fieldId: note, direction: 'asc' }] } },
    key(),
  );
  await assert.rejects(
    owner.saveField(table, note, { version: 3, archived: true }, key()),
    code('COLLAB_REFERENCED_FIELD'),
  );
  const free = await field('可归档');
  await save({ [free]: '归档保留' });
  await owner.saveField(table, free, { version: 4, archived: true }, key());
  assert.ok(!(free in (await employee.record(table, leadId)).record.values));
  assert.equal(
    (
      await db.collabExtension.findUniqueOrThrow({
        where: { tableId_recordId: { tableId: table, recordId: leadId } },
      })
    ).values[free],
    '归档保留',
  );
});

test('extension relation values follow target record permissions without leaking old target IDs', async () => {
  const target = (await owner.createTable(base, { name: '关联目标' }, key())).id;
  const title = (await owner.describe(target)).fields[0].id;
  const own = (
    await employee.saveRecord(target, undefined, { values: { [title]: '本人目标' }, schemaVersion: 1 }, key())
  ).id;
  const other = (
    await manager.saveRecord(target, undefined, { values: { [title]: '他人目标' }, schemaVersion: 1 }, key())
  ).id;
  const relation = await field('关联资料', 'RELATION', { options: { targetTableId: target } });
  await save({ [relation]: [own] });
  await assert.rejects(save({ [relation]: [other] }), code('COLLAB_RELATION_UNAVAILABLE'));
  assert.deepEqual((await employee.record(table, leadId)).record.values[relation], [own]);
  assert.ok(!(relation in (await employee.record(table, leadId)).revisions[0].changes));
  await owner.saveResourceAccess(
    'TABLE',
    target,
    { version: 1, policy: { restricted: true, grants: [] } },
    key(),
  );
  assert.deepEqual((await employee.record(table, leadId)).record.values[relation], []);
});

test('different read and update scopes and default attachments cannot expand record access', async () => {
  const note = await field('可读但不可写');
  const narrow = new CollaborationService(db, {
    ...employee.actor,
    grants: employee.actor.grants.map((g) => ({
      ...g,
      scopeIds: g.permissionCode === 'lead.update' ? ['SELF'] : g.scopeIds,
    })),
  });
  assert.equal((await narrow.record(table, leadId)).record.writable, false);
  await assert.rejects(save({ [note]: '不能扩大动作范围' }, narrow), code('COLLAB_NOT_FOUND'));
  const confidential = await field('受限附件', 'FILE');
  const file = await db.collabAttachment.create({
    data: {
      tableId: table,
      ownerId: manager.actor.userId,
      name: '测试.pdf',
      mimeType: 'application/pdf',
      size: 10,
      storageKey: key(),
    },
  });
  await save({ [confidential]: [file.id] }, manager);
  await owner.saveResourceAccess(
    'TABLE',
    table,
    {
      version: 1,
      policy: {
        restricted: false,
        grants: [
          { principalType: 'POSITION', principalId: position, role: 'EDITOR', hiddenFields: [confidential] },
        ],
      },
    },
    key(),
  );
  await field('默认附件', 'FILE', { defaultValue: [file.id] });
  const next = await db.lead.create({
    data: {
      name: '新的本人记录',
      leadNo: key(),
      phone: '13800001234',
      phoneHash: key(),
      branchId: org,
      createdBy: employee.actor.userId,
    },
  });
  await assert.rejects(
    save({ [note]: '默认值不能绕过附件权限' }, employee, table, next.id),
    code('COLLAB_FORBIDDEN'),
  );
  assert.equal(await db.collabExtension.count({ where: { recordId: next.id } }), 0);
});

test('simultaneous first writes have one winner, including a wide extension schema', async () => {
  await db.collabField.createMany({
    data: Array.from({ length: 60 }, (_, i) => ({
      tableId: table,
      name: '扩展' + i,
      type: 'TEXT',
      position: 20 + i,
    })),
  });
  const fields = (await owner.describe(table)).fields.filter(
    (f) => !(f.options as { businessKey?: string }).businessKey,
  );
  const results = await Promise.allSettled([
    employee.saveRecord(
      table,
      leadId,
      { values: { [fields[0].id]: '甲' }, version: 1, schemaVersion: 1 },
      key(),
    ),
    manager.saveRecord(
      table,
      leadId,
      { values: { [fields[1].id]: '乙' }, version: 1, schemaVersion: 1 },
      key(),
    ),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.code,
    'COLLAB_RECORD_CONFLICT',
  );
  assert.equal(Object.keys((await employee.record(table, leadId)).record.values).length, 71);
  assert.equal(await db.collabExtensionRevision.count(), 1);
});

test('batch extensions share one transaction and preserve business action boundaries', async () => {
  const field = await owner.saveField(
    table,
    undefined,
    { name: '批量扩展', type: 'TEXT', version: 1 },
    key(),
  );
  const second = await db.lead.create({
    data: {
      name: '第二条',
      leadNo: key(),
      phone: '13800001234',
      phoneHash: key(),
      branchId: org,
      createdBy: employee.actor.userId,
    },
  });
  const payload = {
    schemaVersion: 2,
    records: [
      { id: leadId, version: 1, values: { [field.id]: 'first' } },
      { id: second.id, version: 99, values: { [field.id]: 'second' } },
    ],
  };
  await assert.rejects(employee.saveRecords(table, payload, key()), code('COLLAB_RECORD_CONFLICT'));
  assert.equal(await db.collabExtension.count(), 0);
  assert.equal(await db.collabExtensionRevision.count(), 0);
  payload.records[1].version = 1;
  const mutationKey = key();
  const result = await employee.saveRecords(table, payload, mutationKey);
  assert.deepEqual(await employee.saveRecords(table, payload, mutationKey), result);
  assert.equal(await db.collabExtension.count(), 2);
  const core = (await owner.describe(table)).fields.find(
    (f) => f.options && (f.options as { businessKey?: string }).businessKey === 'name',
  )!;
  await employee.saveRecords(table,
    { schemaVersion: 2, records: [{ id: leadId, version: 2, values: { [core.id]: '授权更新姓名' } }] }, key());
  await assert.rejects(
    employee.saveRecords(
      table,
      { schemaVersion: 2, records: [{ values: { [field.id]: 'no core creation' } }] },
      key(),
    ),
    code('COLLAB_USE_BUSINESS_ACTION'),
  );
  assert.equal((await db.lead.findUniqueOrThrow({ where: { id: leadId } })).name, '授权更新姓名');
});
