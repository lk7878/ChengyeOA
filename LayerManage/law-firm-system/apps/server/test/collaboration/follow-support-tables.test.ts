import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as key } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import {
  followSupportFields,
  followSupportKinds,
} from '../../app/application/collaboration/follow-support-templates';
import { standardizeFollowSupportTables } from '../../scripts/maintenance/standardize-follow-support-tables';
let db: PrismaClient, svc: CollaborationService, base: string, org: string, user: string, employee: string;
test.before(() => {
  db = createTestPrisma();
});
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  org = key();
  await db.organization.create({
    data: { id: org, code: org, name: '表格测试', type: 'FIRM', path: '/' + org },
  });
  employee = (
    await db.employee.create({
      data: {
        employeeNo: key(),
        name: '测试员工',
        phone: '13800000000',
        type: 'LAWYER',
        status: 'FORMAL',
        entryDate: new Date('2020-01-01'),
      },
    })
  ).id;
  const position = await db.position.create({
    data: { code: key(), name: '律师', organizationId: org, categoryCode: 'LAWYER' },
  });
  await db.employeeAssignment.create({
    data: {
      employeeId: employee,
      organizationId: org,
      positionId: position.id,
      assignmentType: 'PRIMARY',
      startedAt: new Date('2020-01-01'),
    },
  });
  user = (await db.user.create({ data: { username: key(), password: 'unused', employeeId: employee } })).id;
  const ctx: AuthorizationContext = {
    userId: user,
    employeeId: employee,
    isSystemSuperAdmin: true,
    isSystemAdmin: false,
    evaluatedAt: new Date(),
    permissionCodes: PERMISSION_CATALOG.map((p) => p.code),
    grants: PERMISSION_CATALOG.map((p) => ({
      sourceType: 'ROLE',
      sourceId: 'fixture',
      permissionCode: p.code,
      resource: p.resource,
      scopeIds: ['ALL'],
      validUntil: null,
    })),
    fieldRules: [],
  };
  svc = new CollaborationService(db, ctx);
  const workspace = await svc.createWorkspace({ name: '工作区', organizationId: org }, key());
  base = (await svc.createBase(workspace.id, { name: '业务表格' }, key())).id;
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});

test('support templates persist every field and keep editing, batch deletion, restore, history and ACLs', async () => {
  for (const kind of followSupportKinds) {
    const table = await svc.createTable(base, { name: kind, template: kind }, key());
    const detail = await svc.describe(table.id);
    assert.equal(detail.fields.length, kind === 'MEDICAL_ASSESSMENT' ? 22 : 36);
    assert.deepEqual(
      detail.fields.map((f) => f.name),
      followSupportFields(kind).map((f) => f.name),
    );
    const file = await db.collabAttachment.create({
      data: {
        tableId: table.id,
        ownerId: user,
        name: '录音.mp3',
        mimeType: 'audio/mpeg',
        size: 4,
        storageKey: key(),
      },
    });
    const values: Record<string, unknown> = {};
    for (const f of detail.fields.filter((f) => f.writable)) {
      values[f.id] =
        f.options.medicalRelation ? null : f.type === 'USER'
          ? employee
          : f.type === 'BOOLEAN'
            ? true
            : f.type === 'DATETIME'
              ? '2026-10-22T04:00:00.000Z'
              : f.type === 'CURRENCY'
                ? '123456.78'
                : f.type === 'FILE'
                  ? [file.id]
                  : f.type === 'RELATION'
                    ? []
                    : f.type === 'MULTI_SELECT'
                      ? [f.options.choices![0].id]
                      : f.type === 'SINGLE_SELECT'
                        ? (f.options.choices?.[0]?.id ?? null)
                        : '测试内容';
    }
    const created = await svc.saveRecord(table.id, undefined, { schemaVersion: 1, values }, key());
    const row = (await svc.record(table.id, created.id)).record;
    for (const [id, value] of Object.entries(values)) assert.deepEqual(row.values[id], value);
    if (kind === 'SIGNING_CONVERSION') {
      const operator = detail.fields.find((f) => f.name === '最后操作人')!;
      assert.equal(operator.writable, false);
      assert.equal(row.values[operator.id], user);
      await assert.rejects(
        svc.saveRecord(
          table.id,
          created.id,
          { schemaVersion: 1, version: row.version, values: { [operator.id]: employee } },
          key(),
        ),
        /COLLAB_READONLY_FIELD/,
      );
    }
    const note = detail.fields.find((f) => f.name === '备注')!;
    const edited = await svc.saveRecord(
      table.id,
      created.id,
      { schemaVersion: 1, version: row.version, values: { [note.id]: '修改后的备注' } },
      key(),
    );
    await svc.reverseRecordOperation(table.id, edited.operationId, { direction: 'undo' }, key());
    assert.equal((await svc.record(table.id, created.id)).record.values[note.id], '测试内容');
    await svc.reverseRecordOperation(table.id, edited.operationId, { direction: 'redo' }, key());
    const second = await svc.saveRecord(table.id, undefined, { schemaVersion: 1, values }, key());
    const before = await svc.query(table.id, {});
    await svc.deleteRecords(
      table.id,
      { schemaVersion: 1, records: before.records.map((r) => ({ id: r.id, version: r.version })) },
      key(),
    );
    assert.equal((await svc.query(table.id, {})).total, 0);
    const operations = await svc.recordOperations(table.id, { trash: 'true' });
    assert.ok(!Array.isArray(operations));
    for (const op of operations.rows)
      await svc.reverseRecordOperation(table.id, op.id, { direction: 'undo' }, key());
    assert.equal((await svc.query(table.id, {})).total, 2);
    assert.equal((await svc.attachment(table.id, file.id)).id, file.id);
    assert.ok((await db.collabRevision.count({ where: { recordId: created.id } })) > 2);
    const other = await db.user.create({ data: { username: key(), password: 'unused' } });
    const workspaceId = (await db.collabBase.findUniqueOrThrow({ where: { id: base } })).workspaceId;
    const member = await db.collabMember.create({
      data: { workspaceId, principalId: other.id, role: 'READER', rowScope: 'ALL' },
    });
    const reader = new CollaborationService(db, {
      ...svc.actor,
      userId: other.id,
      employeeId: null,
      isSystemSuperAdmin: false,
    });
    const current = (await reader.record(table.id, second.id)).record;
    await assert.rejects(
      reader.saveRecord(
        table.id,
        second.id,
        { schemaVersion: 1, version: current.version, values: { [note.id]: '拒绝' } },
        key(),
      ),
      /COLLAB_FORBIDDEN/,
    );
    await db.collabMember.update({
      where: { id: member.id },
      data: { role: 'EDITOR', readonlyFields: [note.id] },
    });
    await assert.rejects(
      reader.saveRecord(
        table.id,
        second.id,
        { schemaVersion: 1, version: current.version, values: { [note.id]: '拒绝' } },
        key(),
      ),
      /COLLAB_READONLY_FIELD/,
    );
    await db.collabMember.update({ where: { id: member.id }, data: { readonlyFields: [] } });
    await reader.saveRecord(
      table.id,
      second.id,
      { schemaVersion: 1, version: current.version, values: { [note.id]: '协作修改' } },
      key(),
    );
    assert.equal((await svc.record(table.id, second.id)).record.values[note.id], '协作修改');
  }
});

test('conversion links validate canonical lead/channel read scopes and project safe labels', async () => {
  const table = await svc.createTable(base, { name: '转化', template: 'SIGNING_CONVERSION' }, key());
  const detail = await svc.describe(table.id),
    field = (name: string) => detail.fields.find((f) => f.name === name)!;
  const lead = await db.lead.create({
    data: {
      leadNo: 'LEAD-LINK',
      name: '关联客户',
      phone: '13800000001',
      phoneHash: key(),
      branchId: org,
      createdBy: user,
    },
  });
  const channel = await db.channel.create({
    data: { code: 'CHANNEL-LINK', name: '关联渠道', type: 'OTHER', branchId: org, createdBy: user },
  });
  const source = field('线索ID'),
    target = field('来源渠道ID');
  assert.equal(
    (await svc.businessRelationOptions(table.id, source.id, { keyword: '关联' })).options[0].id,
    lead.id,
  );
  assert.equal(
    (await svc.businessRelationOptions(table.id, target.id, { selectedIds: [channel.id] })).options[0].id,
    channel.id,
  );
  const values = { [field('签约ID').id]: 'S-001', [source.id]: [lead.id], [target.id]: [channel.id] };
  const row = await svc.saveRecord(table.id, undefined, { schemaVersion: 1, values }, key());
  const shown = (await svc.query(table.id, {})).records[0];
  assert.equal(
    (shown as { displayValues?: Record<string, string> }).displayValues?.[source.id],
    'LEAD-LINK · 关联客户',
  );
  assert.equal(
    await db.collabRelation.count({ where: { sourceRecordId: row.id } }),
    0,
    'canonical IDs are not custom-record foreign keys',
  );
  await assert.rejects(
    svc.saveRecord(
      table.id,
      row.id,
      { schemaVersion: 1, version: 1, values: { [source.id]: [key()] } },
      key(),
    ),
    /COLLAB_RELATION_UNAVAILABLE/,
  );
  const restricted = new CollaborationService(db, {
    ...svc.actor,
    permissionCodes: svc.actor.permissionCodes.filter((p) => !['lead.read', 'channel.read'].includes(p)),
  });
  await assert.rejects(restricted.businessRelationOptions(table.id, source.id, {}), /COLLAB_FORBIDDEN/);
  const hidden = (await restricted.query(table.id, {})).records[0];
  assert.deepEqual(hidden.values[source.id], []);
  assert.deepEqual(hidden.values[target.id], []);
  await db.lead.update({ where: { id: lead.id }, data: { deletedAt: new Date() } });
  assert.equal(
    (await svc.businessRelationOptions(table.id, source.id, { selectedIds: [lead.id] })).options.length,
    0,
  );
  assert.deepEqual((await svc.record(table.id, row.id)).record.values[source.id], []);
});

test('standardization reuses existing records and IDs, retires obsolete fields and preserves configurable choices', async () => {
  await db.collabBase.update({ where: { id: base }, data: { moduleSource: 'FOLLOWS' } });
  const original = await db.collabBase.findUniqueOrThrow({ where: { id: base } });
  const empty = await db.collabBase.create({
    data: { name: '空的旧目录', workspaceId: original.workspaceId, moduleSource: 'FOLLOWS' },
  });
  const table = await svc.createTable(base, { name: '病历评估表' }, key());
  const first = (await svc.describe(table.id)).fields[0];
  const row = await svc.saveRecord(
    table.id,
    undefined,
    { schemaVersion: 1, values: { [first.id]: '旧ID' } },
    key(),
  );
  const old = await svc.saveField(table.id, undefined, { name: '废弃', type: 'TEXT', version: 1 }, key());
  await standardizeFollowSupportTables(db, user, true);
  assert.equal(
    await db.collabTable.count({ where: { baseId: empty.id } }),
    0,
    'empty old directories are not repopulated',
  );
  const detail = await svc.describe(table.id);
  assert.equal(detail.table.name, '病例评估表');
  assert.equal(detail.fields.length, 22);
  assert.equal(detail.table.followSupportKind, 'MEDICAL_ASSESSMENT');
  assert.equal(detail.fields[0].id, first.id);
  assert.equal((await svc.record(table.id, row.id)).record.values[first.id], '旧ID');
  assert.equal((await db.collabField.findUniqueOrThrow({ where: { id: old.id } })).archived, true);
  const conversion = await db.collabTable.findFirstOrThrow({ where: { baseId: base, name: '签约转化表' } });
  const status = await db.collabField.findFirstOrThrow({
    where: { tableId: conversion.id, name: '财务收款状态' },
  });
  assert.deepEqual((status.options as { choices: unknown[] }).choices, []);
  await svc.saveField(
    conversion.id,
    status.id,
    { options: { choices: [{ id: 'paid', name: '已收款' }] }, version: conversion.schemaVersion },
    key(),
  );
  const version = (await svc.describe(conversion.id)).table.schemaVersion;
  await standardizeFollowSupportTables(db, user, true);
  assert.equal((await svc.describe(conversion.id)).table.schemaVersion, version);
  assert.equal((await svc.describe(table.id)).table.schemaVersion, detail.table.schemaVersion);
});
