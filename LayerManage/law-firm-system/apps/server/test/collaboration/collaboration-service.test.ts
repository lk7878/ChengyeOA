import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { createTestPrisma, clearTestApplicationData } from '../helpers/test-database';

let db: PrismaClient;
let admin: CollaborationService;
let editor: CollaborationService;
let reader: CollaborationService;
let workspaceId: string;
let baseId: string;
let tableId: string;
let titleId: string;
const context = (userId: string, superAdmin = false): AuthorizationContext => ({
  userId,
  employeeId: null,
  isSystemSuperAdmin: superAdmin,
  isSystemAdmin: false,
  grants: [],
  fieldRules: [],
  permissionCodes: [],
  evaluatedAt: new Date(),
});
const hasCode = (code: string) => (e: unknown) => e instanceof Error && e.message === code;

const resourceGrant = (principalId: string, role = 'READER', extra = {}) => ({
  principalType: 'USER',
  principalId,
  role,
  rowScope: 'ALL',
  canCreate: false,
  hiddenFields: [],
  readonlyFields: [],
  ...extra,
});

test('resource ACL filters directories, intersects parent roles, and protects snapshot updates', async () => {
  const policy = { restricted: true, grants: [resourceGrant(editor.actor.userId)] };
  const key = randomUUID();
  const payload = { version: 1, policy };
  const first = await admin.saveResourceAccess('TABLE', tableId, payload, key);
  assert.deepEqual(await admin.saveResourceAccess('TABLE', tableId, payload, key), first);
  assert.equal((await reader.listTables(baseId)).tables.length, 0);
  await assert.rejects(reader.record(tableId, randomUUID()), hasCode('COLLAB_FORBIDDEN'));
  assert.equal((await editor.describe(tableId)).access.level, 1);
  await assert.rejects(
    editor.saveResourceAccess('TABLE', tableId, { version: 2, policy }, randomUUID()),
    hasCode('COLLAB_FORBIDDEN'),
  );
  await assert.rejects(
    admin.saveResourceAccess('TABLE', tableId, payload, randomUUID()),
    hasCode('COLLAB_ACCESS_CONFLICT'),
  );
  await admin.saveResourceAccess(
    'BASE',
    baseId,
    { version: 1, policy: { restricted: false, grants: [resourceGrant(editor.actor.userId, 'DENY')] } },
    randomUUID(),
  );
  assert.equal((await editor.listWorkspaces()).workspaces[0].bases.length, 0);
  await assert.rejects(editor.describe(tableId), hasCode('COLLAB_FORBIDDEN'));
  assert.equal((await admin.describe(tableId)).access.level, 4);
  assert.equal(await db.operationLog.count({ where: { action: 'access.updated' } }), 2);
});

test('table ACL restrictions apply to rows, fields, files and shared relation targets', async () => {
  const other = (await admin.createTable(baseId, { name: 'other' }, randomUUID())).id;
  const fileField = await admin.saveField(
    tableId,
    undefined,
    { name: '附件', type: 'FILE', version: 1 },
    randomUUID(),
  );
  const file = await db.collabAttachment.create({
    data: {
      tableId,
      ownerId: editor.actor.userId,
      name: 'fixture.pdf',
      mimeType: 'application/pdf',
      size: 3,
      storageKey: randomUUID(),
    },
  });
  await editor.saveRecord(
    tableId,
    undefined,
    { values: { [titleId]: 'mine', [fileField.id]: [file.id] }, schemaVersion: 2 },
    randomUUID(),
  );
  await admin.saveRecord(
    tableId,
    undefined,
    { values: { [titleId]: 'other' }, schemaVersion: 2 },
    randomUUID(),
  );
  await admin.saveResourceAccess(
    'TABLE',
    tableId,
    {
      version: 1,
      policy: {
        restricted: true,
        grants: [
          resourceGrant(editor.actor.userId, 'EDITOR', {
            rowScope: 'SELF',
            hiddenFields: [fileField.id],
            readonlyFields: [titleId],
          }),
        ],
      },
    },
    randomUUID(),
  );
  const rows = await editor.query(tableId, {});
  assert.equal(rows.total, 1);
  assert.equal(rows.records[0].values[fileField.id], undefined);
  await assert.rejects(editor.attachment(tableId, file.id), hasCode('COLLAB_FORBIDDEN'));
  await assert.rejects(
    editor.saveRecord(
      tableId,
      rows.records[0].id,
      { values: { [titleId]: 'changed' }, schemaVersion: 2, version: 1 },
      randomUUID(),
    ),
    hasCode('COLLAB_READONLY_FIELD'),
  );
  // Other tables remain reachable after one table is restricted.
  assert.equal((await reader.listTables(baseId)).tables[0].id, other);
});

test('live CRM tables intersect business scope, organization and resource permissions before paging/counting', async () => {
  const org = await db.collabWorkspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const employee = await db.employee.create({
    data: {
      employeeNo: 'collab-crm',
      name: '负责人',
      status: 'FORMAL',
      phone: '13800009999',
      type: 'SALES',
      entryDate: new Date(),
    },
  });
  const crm = (userId: string, scopeIds = ['ALL']): AuthorizationContext => ({
    ...context(userId),
    employeeId: employee.id,
    permissionCodes: ['lead.read'],
    grants: [
      {
        sourceType: 'ROLE',
        sourceId: 'test',
        sourceRoleId: 'crm',
        permissionCode: 'lead.read',
        resource: 'lead',
        scopeIds,
        validUntil: null,
      },
    ],
  });
  const ownerCrm = new CollaborationService(db, crm(admin.actor.userId));
  const selfScope = await db.dataScope.create({ data: { name: '本人', scopeType: 'SELF' } });
  const editorCrm = new CollaborationService(db, crm(editor.actor.userId, [selfScope.id]));
  const leads = (await ownerCrm.createTable(baseId, { name: '业务线索', source: 'LEADS' }, randomUUID())).id;
  const follows = (await ownerCrm.createTable(baseId, { name: '业务跟进', source: 'FOLLOWS' }, randomUUID()))
    .id;
  const seed = async (name: string, branchId: string | null, assignedTo: string | null) =>
    db.lead.create({
      data: {
        leadNo: randomUUID(),
        name,
        phone: '13800001234',
        phoneHash: randomUUID(),
        wechat: 'private-wechat',
        branchId,
        assignedTo,
        createdBy: admin.actor.userId,
      },
    });
  const mine = await seed('我的线索', org.organizationId, employee.id);
  const other = await seed('他人线索', org.organizationId, null);
  const outside = await seed('外部组织线索', randomUUID(), employee.id);
  await db.leadFollow.createMany({
    data: [mine, other, outside].map((l) => ({
      leadId: l.id,
      type: 'PHONE',
      content: l.name + '跟进',
      createdBy: editor.actor.userId,
    })),
  });
  await assert.rejects(editor.query(leads, {}), hasCode('COLLAB_FORBIDDEN'));
  assert.equal(
    (await editor.listTables(baseId)).tables.some((t) => t.id === leads),
    false,
  );
  const detail = await editorCrm.describe(leads);
  const field = (key: string) =>
    detail.fields.find((f) => (f.options as { businessKey: string }).businessKey === key)!;
  assert.equal(field('phone').queryable, false);
  assert.equal(field('name').queryable, true);
  const q = await editorCrm.query(leads, {
    pageSize: 1,
    config: {
      groupBy: [field('status').id],
      sorts: [{ fieldId: field('intentionLevel').id, direction: 'desc' }],
    },
  });
  assert.equal(q.total, 1);
  assert.equal(q.records[0].id, mine.id);
  assert.equal(q.groups[0].count, 1);
  assert.equal(q.records[0].values[field('phone').id], '138****1234');
  assert.equal((await ownerCrm.query(leads, {})).total, 2);
  assert.equal((await editorCrm.query(follows, {})).total, 1);
  const filtered = await ownerCrm.query(leads, {
    config: {
      filter: {
        join: 'and',
        children: [
          { fieldId: field('name').id, operator: 'contains', value: '我的' },
          { fieldId: field('intentionLevel').id, operator: 'gte', value: 3 },
        ],
      },
    },
  });
  assert.equal(filtered.total, 1);
  assert.equal(
    (
      await editorCrm.query(leads, {
        config: { filter: { fieldId: field('assignedTo').id, operator: 'eq', value: '$currentUser' } },
      })
    ).total,
    1,
  );
  const followDetail = await editorCrm.describe(follows);
  const followType = followDetail.fields.find(
    (f) => (f.options as { businessKey: string }).businessKey === 'type',
  )!;
  assert.equal((await editorCrm.query(follows, { config: { groupBy: [followType.id] } })).groups[0].count, 1);
  await assert.rejects(
    editorCrm.createTable(baseId, { name: '尝试绕过表限制', source: 'LEADS' }, randomUUID()),
    hasCode('COLLAB_FORBIDDEN'),
  );

  await assert.rejects(editorCrm.record(leads, other.id), hasCode('COLLAB_NOT_FOUND'));
  await assert.rejects(
    editorCrm.query(leads, {
      config: { filter: { fieldId: field('phone').id, operator: 'eq', value: '13800001234' } },
    }),
    hasCode('COLLAB_SENSITIVE_QUERY_UNSUPPORTED'),
  );
  await assert.rejects(
    ownerCrm.saveField(leads, undefined, { name: 'fake', type: 'TEXT', version: 1 }, randomUUID()),
    hasCode('COLLAB_USE_BUSINESS_ACTION'),
  );
  await assert.rejects(
    editorCrm.saveRecord(
      leads,
      mine.id,
      { values: { [field('status').id]: 'CONVERTED' }, schemaVersion: 1, version: 1 },
      randomUUID(),
    ),
    hasCode('COLLAB_USE_BUSINESS_ACTION'),
  );
  await assert.rejects(
    ownerCrm.mutateTable(leads, { duplicate: true, name: 'copy', version: 1 }, randomUUID()),
    hasCode('COLLAB_USE_BUSINESS_ACTION'),
  );
  // Writes from the original business entry are visible without any synchronization copy.
  await db.lead.update({ where: { id: mine.id }, data: { name: '业务入口更新', version: { increment: 1 } } });
  assert.equal((await editorCrm.record(leads, mine.id)).record.values[field('name').id], '业务入口更新');
  assert.equal(await db.collabRecord.count({ where: { tableId: { in: [leads, follows] } } }), 0);
});
test.before(() => {
  db = createTestPrisma();
});
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  const orgId = randomUUID();
  const org = await db.organization.create({
    data: { id: orgId, code: 'COLLAB_TEST', name: '协作测试组织', type: 'FIRM', path: '/' + orgId, sort: 1 },
  });
  const users = await Promise.all(
    ['owner', 'editor', 'reader'].map((username) =>
      db.user.create({ data: { username, password: 'test-hash-not-used-for-login' } }),
    ),
  );
  admin = new CollaborationService(db, context(users[0].id, true));
  editor = new CollaborationService(db, context(users[1].id));
  reader = new CollaborationService(db, context(users[2].id));
  workspaceId = (await admin.createWorkspace({ name: '经营协作', organizationId: org.id }, randomUUID())).id;
  await db.collabMember.createMany({
    data: [
      { workspaceId, principalId: users[1].id, role: 'EDITOR', canCreate: true },
      { workspaceId, principalId: users[2].id, role: 'READER' },
    ],
  });
  baseId = (await admin.createBase(workspaceId, { name: '团队台账' }, randomUUID())).id;
  tableId = (await admin.createTable(baseId, { name: '自建表' }, randomUUID())).id;
  titleId = (await admin.describe(tableId)).fields[0].id;
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});

test('blank table is persistent and creates one default view; replay is idempotent', async () => {
  const key = randomUUID();
  const input = { name: '自主表', template: 'TASKS' };
  const first = await editor.createTable(baseId, input, key);
  const second = await editor.createTable(baseId, input, key);
  assert.deepEqual(first, second);
  const detail = await editor.describe(first.id);
  assert.equal(detail.fields.length, 4);
  assert.equal(detail.views.filter((v) => v.isDefault).length, 1);
  assert.equal(detail.access.level, 3); // Explicit table creator can configure their new table.
  await assert.rejects(
    editor.createTable(baseId, { name: 'different' }, key),
    hasCode('COLLAB_IDEMPOTENCY_CONFLICT'),
  );
  await assert.rejects(
    reader.createTable(baseId, { name: 'denied' }, randomUUID()),
    hasCode('COLLAB_FORBIDDEN'),
  );
});
test('record editing and personal view share stable records, with independent layout', async () => {
  const r = await editor.saveRecord(
    tableId,
    undefined,
    { values: { [titleId]: '第一条' }, schemaVersion: 1 },
    randomUUID(),
  );
  const v = await reader.saveView(
    tableId,
    undefined,
    { name: '我的布局', config: { visibleFields: [titleId], rowHeight: 40 } },
    randomUUID(),
  );
  assert.equal((await admin.describe(tableId)).views.length, 1);
  assert.equal((await reader.query(tableId, { viewId: v.id })).records[0].id, r.id);
  await editor.saveRecord(
    tableId,
    r.id,
    { values: { [titleId]: '更新后的记录' }, version: 1, schemaVersion: 1 },
    randomUUID(),
  );
  assert.equal((await reader.query(tableId, { viewId: v.id })).records[0].values[titleId], '更新后的记录');
  await assert.rejects(
    reader.saveRecord(tableId, r.id, { values: {}, version: 2, schemaVersion: 1 }, randomUUID()),
    hasCode('COLLAB_FORBIDDEN'),
  );
});
test('concurrent writes prevent silent lost updates, and transaction failure emits no event', async () => {
  const r = await editor.saveRecord(
    tableId,
    undefined,
    { values: { [titleId]: 'before' }, schemaVersion: 1 },
    randomUUID(),
  );
  const before = await db.collabEvent.count();
  const results = await Promise.allSettled(
    ['a', 'b'].map((value) =>
      editor.saveRecord(
        tableId,
        r.id,
        { values: { [titleId]: value }, version: 1, schemaVersion: 1 },
        randomUUID(),
      ),
    ),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    results.filter((r) => r.status === 'rejected' && hasCode('COLLAB_RECORD_CONFLICT')(r.reason)).length,
    1,
  );
  assert.equal(await db.collabEvent.count(), before + 1);
  assert.equal((await db.collabRecord.findUnique({ where: { id: r.id } })).version, 2);
  assert.equal(await db.collabRevision.count({ where: { recordId: r.id } }), 2);
  assert.ok((await db.eventLog.count({ where: { eventType: 'collaboration.changed' } })) > 0);
});
test('field rename preserves values; old schema and unsafe type changes fail', async () => {
  const r = await editor.saveRecord(
    tableId,
    undefined,
    { values: { [titleId]: '保留值' }, schemaVersion: 1 },
    randomUUID(),
  );
  await admin.saveField(tableId, titleId, { name: '新字段名', version: 1 }, randomUUID());
  assert.equal((await admin.record(tableId, r.id)).record.values[titleId], '保留值');
  await assert.rejects(
    editor.saveRecord(
      tableId,
      r.id,
      { values: { [titleId]: 'x' }, version: 1, schemaVersion: 1 },
      randomUUID(),
    ),
    hasCode('COLLAB_SCHEMA_CONFLICT'),
  );
  await assert.rejects(
    admin.saveField(tableId, titleId, { type: 'NUMBER', version: 2 }, randomUUID()),
    hasCode('COLLAB_FIELD_MIGRATION_REQUIRED'),
  );
});
test('server filters, numeric ordering, grouping and pagination are evaluated on authorized rows', async () => {
  const f = await admin.saveField(
    tableId,
    undefined,
    { name: '数量', type: 'NUMBER', version: 1 },
    randomUUID(),
  );
  for (const n of [20, 3, 10])
    await editor.saveRecord(
      tableId,
      undefined,
      { values: { [titleId]: '项目' + n, [f.id]: n }, schemaVersion: 2 },
      randomUUID(),
    );
  const result = await reader.query(tableId, {
    pageSize: 1,
    config: {
      filter: { fieldId: f.id, operator: 'gt', value: 5 },
      sorts: [{ fieldId: f.id, direction: 'asc' }],
      groupBy: [f.id],
    },
  });
  assert.equal(result.total, 2);
  assert.equal(result.records[0].values[f.id], 10);
  assert.equal(result.groups.length, 2);
  await assert.rejects(
    reader.query(tableId, { config: { filter: { fieldId: 'injected sql', operator: 'eq', value: 'x' } } }),
    hasCode('COLLAB_FIELD_UNAVAILABLE'),
  );
});
test('row and field restrictions cover detail, query, history, and forbidden filter metadata', async () => {
  const r = await editor.saveRecord(
    tableId,
    undefined,
    { values: { [titleId]: 'secret' }, schemaVersion: 1 },
    randomUUID(),
  );
  await db.collabMember.updateMany({
    where: { workspaceId, principalId: reader.actor.userId },
    data: { hiddenFields: [titleId] },
  });
  assert.equal((await reader.describe(tableId)).fields.length, 0);
  assert.deepEqual((await reader.record(tableId, r.id)).record.values, {});
  assert.deepEqual((await reader.record(tableId, r.id)).revisions[0].changes, {});
  await assert.rejects(
    reader.query(tableId, { config: { sorts: [{ fieldId: titleId, direction: 'asc' }] } }),
    hasCode('COLLAB_FIELD_UNAVAILABLE'),
  );
  await db.collabMember.updateMany({
    where: { workspaceId, principalId: reader.actor.userId },
    data: { rowScope: 'SELF' },
  });
  assert.equal((await reader.query(tableId, {})).total, 0);
  await assert.rejects(reader.record(tableId, r.id), hasCode('COLLAB_NOT_FOUND'));
});
test('member removal prevents both reading and mutation replay', async () => {
  const key = randomUUID();
  const body = { values: { [titleId]: 'a' }, schemaVersion: 1 };
  await editor.saveRecord(tableId, undefined, body, key);
  await db.collabMember.deleteMany({ where: { principalId: editor.actor.userId } });
  await assert.rejects(editor.query(tableId, {}), hasCode('COLLAB_FORBIDDEN'));
  await assert.rejects(editor.saveRecord(tableId, undefined, body, key), hasCode('COLLAB_FORBIDDEN'));
  assert.equal((await editor.listWorkspaces()).workspaces.length, 0);
});
test('views cannot be overwritten with stale versions or deleted when default', async () => {
  const v = (await admin.describe(tableId)).views[0];
  await assert.rejects(
    reader.saveView(tableId, v.id, { name: 'not mine', version: 1 }, randomUUID()),
    hasCode('COLLAB_FORBIDDEN'),
  );
  await admin.saveView(tableId, v.id, { name: '共享总表', version: 1 }, randomUUID());
  await assert.rejects(
    admin.saveView(tableId, v.id, { name: 'stale', version: 1 }, randomUUID()),
    hasCode('COLLAB_VIEW_CONFLICT'),
  );
  await assert.rejects(
    admin.saveView(tableId, v.id, { remove: true, version: 2 }, randomUUID()),
    hasCode('COLLAB_DEFAULT_VIEW_REQUIRED'),
  );
});
test('copy is structure only and archive does not delete source data', async () => {
  await editor.saveRecord(
    tableId,
    undefined,
    { values: { [titleId]: 'keep' }, schemaVersion: 1 },
    randomUUID(),
  );
  const copied = await admin.mutateTable(
    tableId,
    { duplicate: true, name: '复制结构', version: 1 },
    randomUUID(),
  );
  assert.equal((await admin.query(copied.id, {})).total, 0);
  await admin.mutateTable(tableId, { archived: true, version: 1 }, randomUUID());
  await assert.rejects(editor.query(tableId, {}), hasCode('COLLAB_NOT_FOUND'));
  await admin.mutateTable(tableId, { archived: false, version: 2 }, randomUUID());
  assert.equal((await editor.query(tableId, {})).records[0].values[titleId], 'keep');
});

test('a downgraded table creator cannot recover editing authority through ownership', async () => {
  const table = await editor.createTable(baseId, { name: '编辑者创建的表' }, randomUUID());
  await db.collabMember.updateMany({
    where: { workspaceId, principalId: editor.actor.userId },
    data: { role: 'READER', canCreate: false },
  });
  assert.equal((await editor.describe(table.id)).access.level, 1);
  await assert.rejects(
    editor.saveField(table.id, undefined, { name: '越权字段', type: 'TEXT', version: 1 }, randomUUID()),
    hasCode('COLLAB_FORBIDDEN'),
  );
});

test('used choices cannot be removed and required fields can be enabled only after backfill', async () => {
  const field = await admin.saveField(
    tableId,
    undefined,
    { name: '状态', type: 'SINGLE_SELECT', options: { choices: [{ id: 'a', name: '待处理' }] }, version: 1 },
    randomUUID(),
  );
  const record = await editor.saveRecord(
    tableId,
    undefined,
    { values: { [titleId]: '测试' }, schemaVersion: 2 },
    randomUUID(),
  );
  await assert.rejects(
    admin.saveField(tableId, field.id, { required: true, version: 2 }, randomUUID()),
    hasCode('COLLAB_REQUIRED_BACKFILL_REQUIRED'),
  );
  await editor.saveRecord(
    tableId,
    record.id,
    { values: { [field.id]: 'a' }, version: 1, schemaVersion: 2 },
    randomUUID(),
  );
  await admin.saveField(tableId, field.id, { required: true, version: 2 }, randomUUID());
  await assert.rejects(
    admin.saveField(tableId, field.id, { options: { choices: [] }, version: 3 }, randomUUID()),
    hasCode('COLLAB_OPTION_IN_USE'),
  );
});

test('attachments inherit row and field access even for their original uploader', async () => {
  const field = await admin.saveField(
    tableId,
    undefined,
    { name: '附件', type: 'FILE', version: 1 },
    randomUUID(),
  );
  const file = await db.collabAttachment.create({
    data: {
      tableId,
      ownerId: editor.actor.userId,
      name: 'test.pdf',
      mimeType: 'application/pdf',
      size: 5,
      storageKey: randomUUID(),
    },
  });
  await assert.rejects(
    admin.saveRecord(
      tableId,
      undefined,
      { values: { [titleId]: '不可窃取上传', [field.id]: [file.id] }, schemaVersion: 2 },
      randomUUID(),
    ),
    hasCode('COLLAB_FORBIDDEN'),
  );
  await editor.saveRecord(
    tableId,
    undefined,
    { values: { [titleId]: '正常绑定', [field.id]: [file.id] }, schemaVersion: 2 },
    randomUUID(),
  );
  assert.equal((await reader.attachment(tableId, file.id)).id, file.id);
  await db.collabMember.updateMany({
    where: { workspaceId, principalId: editor.actor.userId },
    data: { hiddenFields: [field.id] },
  });
  await assert.rejects(editor.attachment(tableId, file.id), hasCode('COLLAB_FORBIDDEN'));
  await db.collabMember.updateMany({
    where: { workspaceId, principalId: reader.actor.userId },
    data: { rowScope: 'SELF' },
  });
  await assert.rejects(reader.attachment(tableId, file.id), hasCode('COLLAB_FORBIDDEN'));
});

test('relation targets and revision payloads do not reveal records outside the current row scope', async () => {
  const targetTable = await admin.createTable(baseId, { name: '关联目标' }, randomUUID());
  const targetTitle = (await admin.describe(targetTable.id)).fields[0].id;
  const target = await admin.saveRecord(
    targetTable.id,
    undefined,
    { values: { [targetTitle]: 'private' }, schemaVersion: 1 },
    randomUUID(),
  );
  const relation = await admin.saveField(
    tableId,
    undefined,
    { name: '关联', type: 'RELATION', options: { targetTableId: targetTable.id }, version: 1 },
    randomUUID(),
  );
  const source = await editor.saveRecord(
    tableId,
    undefined,
    { values: { [titleId]: '可访问来源', [relation.id]: [target.id] }, schemaVersion: 2 },
    randomUUID(),
  );
  await db.collabMember.updateMany({
    where: { workspaceId, principalId: editor.actor.userId },
    data: { rowScope: 'SELF' },
  });
  const detail = await editor.record(tableId, source.id);
  assert.deepEqual(detail.record.values[relation.id], []);
  assert.ok(!JSON.stringify(detail).includes(target.id));
  await assert.rejects(
    editor.query(tableId, { config: { groupBy: [relation.id] } }),
    hasCode('COLLAB_REFERENCE_FILTER_UNSUPPORTED'),
  );
});
