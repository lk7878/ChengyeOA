import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as key } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { WorkflowService } from '../../app/application/workflow/workflow-service';
import { tickWorkflows } from '../../app/application/workflow/workflow-worker';
import {
  calculate,
  fieldMode,
  matches,
  matchesEdge,
  moneyUpper,
  validateSchema,
  validateValues,
  WorkflowSchema,
} from '../../app/domain/workflow/schema';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { DriveService } from '../../app/application/collaboration/drive-service';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
let db: PrismaClient,
  admin: WorkflowService,
  applicant: WorkflowService,
  reviewer: WorkflowService,
  other: WorkflowService,
  reader: WorkflowService,
  drive: DriveService,
  table: string,
  base: string,
  workspace: string,
  titleField: string;
async function person(name: string, permissions: string[], superAdmin = false) {
  const u = await db.user.create({ data: { username: name, password: 'unused' } });
  const r = await db.role.create({
    data: {
      code: superAdmin ? 'SYSTEM_SUPER_ADMIN' : name,
      name,
      type: superAdmin ? 'SYSTEM' : 'BUSINESS',
      permissions: {
        create: PERMISSION_CATALOG.filter((p) => permissions.includes(p.code)).map((p) => ({
          permissionId: p.id,
        })),
      },
    },
  });
  await db.userRole.create({ data: { userId: u.id, roleId: r.id, validFrom: new Date('2000-01-01') } });
  return new WorkflowService(db, await new AuthorizationContextLoader(db).load(u.id));
}
const permissions = ['approval.read', 'approval.apply', 'approval.process'];
test.before(() => {
  db = createTestPrisma();
});
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  admin = await person(
    'admin',
    PERMISSION_CATALOG.map((p) => p.code),
    true,
  );
  applicant = await person('applicant', permissions);
  reviewer = await person('reviewer', permissions);
  other = await person('other', permissions);
  reader = await person('reader', ['approval.read']);
  drive = new DriveService(db, admin.actor);
  const orgId = key();
  const org = await db.organization.create({
    data: { id: orgId, code: key(), name: '可视化审批回归', type: 'FIRM', path: '/' + orgId },
  });
  workspace = (await drive.createWorkspace({ name: '审批测试空间', organizationId: org.id }, key())).id;
  base = (await drive.createDriveBase(workspace, { name: '业务表' }, key())).id;
  table = (await db.collabTable.findFirstOrThrow({ where: { baseId: base } })).id;
  titleField = (await drive.describe(table)).fields[0].id;
  await drive.saveMember(
    workspace,
    {
      baseId: base,
      principalType: 'ROLE',
      principalId: (await db.userRole.findFirstOrThrow({ where: { userId: applicant.actor.userId } })).roleId,
      role: 'EDITOR',
      rowScope: 'ALL',
      canCreate: true,
    },
    key(),
  );
});
test.afterEach(async () => {
  delete process.env.WORKFLOW_WEBHOOKS;
  for (const f of await db.collabAttachment.findMany()) {
    if (/^[0-9a-f-]{36}$/.test(f.storageKey))
      await fs
        .unlink(path.join(process.cwd(), 'var', 'storage', 'collaboration', f.storageKey))
        .catch((): void => {});
  }
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});
function schema(): WorkflowSchema {
  return {
    fields: [
      { key: 'title', label: '标题', type: 'text', required: true },
      { key: 'amount', label: '金额', type: 'number' },
    ],
    nodes: [
      { id: 'start', name: '发起', type: 'START', x: 0, y: 0 },
      {
        id: 'review',
        name: '复核',
        type: 'APPROVAL',
        x: 200,
        y: 0,
        rule: { type: 'USER', ids: [reviewer.actor.userId] },
        mode: 'ALL',
      },
      { id: 'end', name: '结束', type: 'END', x: 400, y: 0 },
    ],
    edges: [
      { id: 'a', from: 'start', to: 'review' },
      { id: 'b', from: 'review', to: 'end' },
    ],
  };
}
async function publish(s = schema()) {
  return admin.saveDefinition(undefined, { name: '测试流程', schema: s, publish: true });
}
async function start(
  d: { id: string },
  content: Record<string, unknown> = { title: '审批回归', amount: 20 },
  extra = {},
) {
  return applicant.start({ definitionId: d.id, title: '测试申请', content, ...extra }, key());
}
async function action(svc: WorkflowService, id: string, action = 'APPROVE', extra = {}) {
  const i = await svc.detail(id);
  return svc.act(id, { action, version: i.version, ...extra }, key());
}

test('submission audience filters the catalog and rejects direct starts, including newly assigned roles', async () => {
  const s = schema();
  const role = await db.userRole.findFirstOrThrow({ where: { userId: applicant.actor.userId } });
  s.settings = { audience: { mode: 'SELECTED', roles: [role.roleId] } };
  const d = await publish(s);
  assert.equal((await applicant.definitions()).length, 1);
  assert.equal((await other.definitions()).length, 0);
  await assert.rejects(
    other.start({ definitionId: d.id, title: '越权', content: { title: '不能提交' } }, key()),
    /提交范围/,
  );
  await start(d);
  await db.userRole.update({
    where: { id: role.id },
    data: {
      revokedAt: new Date(),
      revokedByUserId: admin.actor.userId,
      revokeReason: '验证审批提交范围撤销之后立即生效',
    },
  });
  await assert.rejects(start(d), /提交范围/);
  assert.equal((await admin.definitions(true)).length, 1);
  s.settings.audience = { mode: 'NONE' };
  const closed = await publish(s);
  await assert.rejects(
    admin.start({ definitionId: closed.id, title: '关闭', content: { title: '关闭' } }, key()),
    /提交范围/,
  );
});

test('node actions, mandatory approval comments and withdrawal policy are enforced in the service', async () => {
  const s = schema();
  s.nodes[1].actions = { forward: false, add: false, return: false, remarkRequired: true };
  s.settings = { allowWithdraw: false };
  const i = await start(await publish(s));
  for (const op of ['FORWARD', 'ADD', 'RETURN'])
    await assert.rejects(
      action(reviewer, i.id, op, { userIds: [other.actor.userId], returnNode: 'start', remark: '测试' }),
      /未开放/,
    );
  await assert.rejects(action(reviewer, i.id), /审批意见/);
  await assert.rejects(action(applicant, i.id, 'WITHDRAW'), /不允许撤回/);
  assert.equal((await action(reviewer, i.id, 'APPROVE', { remark: '审核无误' })).status, 'APPROVED');
  s.nodes[1].timeoutHours = 1;
  s.nodes[1].timeoutAction = 'APPROVE';
  assert.throws(() => validateSchema(s), /必填审批意见/);
});

test('condition groups support AND, OR, detail totals and explicit priority before the default path', async () => {
  const s = schema();
  s.fields.push({
    key: 'items',
    label: '费用明细',
    type: 'detail',
    children: [{ key: 'amount', label: '费用', type: 'number' }],
  });
  s.nodes.splice(1, 0, { id: 'branch', name: '金额分支', type: 'BRANCH', x: 100, y: 0 });
  s.edges = [
    { id: 'a', from: 'start', to: 'branch' },
    {
      id: 'low',
      from: 'branch',
      to: 'end',
      priority: 2,
      groups: [[{ field: 'amount', op: 'gte', value: 0 }]],
    },
    {
      id: 'high',
      from: 'branch',
      to: 'review',
      priority: 1,
      groups: [
        [
          { field: 'items.amount', aggregate: 'sum', op: 'gte', value: 5000 },
          { field: 'title', op: 'eq', value: '报销' },
        ],
        [{ field: 'amount', op: 'gt', value: 10000 }],
      ],
    },
    { id: 'default', from: 'branch', to: 'end' },
    { id: 'end', from: 'review', to: 'end' },
  ];
  validateSchema(s);
  const d = await publish(s);
  const i = await start(d, { title: '报销', amount: 20, items: [{ amount: 3000 }, { amount: 2500 }] });
  assert.equal(i.currentNode, 'review');
  assert.equal((await start(d, { title: '其他', amount: 20, items: [{ amount: 6000 }] })).status, 'APPROVED');
  assert.equal(matchesEdge(s.edges[2], { title: '其他', amount: 20000 }), true);
  s.edges[2].groups = [[]];
  assert.throws(() => validateSchema(s), /条件组/);
});

test('explicit automatic approval/rejection and applicant-self nodes are audited', async () => {
  for (const approvalType of ['APPROVE', 'REJECT'] as const) {
    const s = schema();
    s.nodes[1].approvalType = approvalType;
    delete s.nodes[1].rule;
    const i = await start(await publish(s));
    assert.equal(i.status, approvalType === 'APPROVE' ? 'APPROVED' : 'REJECTED');
    assert.ok(i.logs.some((l) => l.action === `RULE_${approvalType}`));
    assert.equal(i.tasks.length, 0);
  }
  const s = schema();
  s.nodes[1].rule = { type: 'SELF' };
  const i = await start(await publish(s));
  assert.equal(i.tasks[0].assigneeId, applicant.actor.userId);
  assert.equal((await action(applicant, i.id)).status, 'APPROVED');
});

test('corrections reapprove, preserve originals and update the same record without duplicate creates', async () => {
  const s = schema();
  s.binding = { tableId: table, mode: 'CREATE', mappings: [{ field: 'title', target: titleField }] };
  const d = await publish(s),
    i = await start(d, { title: '原始内容', amount: 20 });
  await action(reviewer, i.id);
  const original = await applicant.detail(i.id);
  assert.equal(original.canCorrect, true);
  await assert.rejects(
    other.start({ definitionId: d.id, title: '篡改', content: { title: '恶意' }, correctionOf: i.id }, key()),
    /本人已通过/,
  );
  const request = {
    definitionId: d.id,
    title: '更正申请',
    content: { title: '批准更正' },
    correctionOf: i.id,
  };
  const requestKey = key();
  const corrected = await applicant.start(request, requestKey);
  assert.equal((await applicant.start(request, requestKey)).id, corrected.id);
  assert.equal(corrected.status, 'PENDING');
  assert.equal(corrected.correctionOf, i.id);
  assert.equal((await drive.record(table, original.targetRecordId!)).record.values[titleField], '原始内容');
  await assert.rejects(applicant.start(request, key()), /已有处理中/);
  const approved = await action(reviewer, corrected.id);
  assert.equal(approved.syncStatus, 'SYNCED');
  assert.equal(approved.targetRecordId, original.targetRecordId);
  assert.equal(await db.collabRecord.count({ where: { tableId: table } }), 1);
  assert.equal((await drive.record(table, original.targetRecordId!)).record.values[titleField], '批准更正');
  assert.equal((await applicant.detail(i.id)).content.title, '原始内容');
  assert.equal((await applicant.detail(i.id)).canCorrect, false);
  assert.equal((await applicant.detail(corrected.id)).canCorrect, true);
});

test('correction chains enforce concurrency, reject completed source reuse and keep writeback conflict protection', async () => {
  const s = schema();
  s.binding = { tableId: table, mode: 'CREATE', mappings: [{ field: 'title', target: titleField }] };
  const d = await publish(s),
    original = await start(d);
  await action(reviewer, original.id);
  const starts = await Promise.allSettled([
    start(d, { title: '更正一' }, { correctionOf: original.id }),
    start(d, { title: '更正二' }, { correctionOf: original.id }),
  ]);
  assert.equal(starts.filter((x) => x.status === 'fulfilled').length, 1);
  const corrected = starts.find((x) => x.status === 'fulfilled')! as PromiseFulfilledResult<
    Awaited<ReturnType<typeof start>>
  >;
  const row = await drive.record(table, corrected.value.targetRecordId!);
  await drive.saveRecord(
    table,
    row.record.id,
    { schemaVersion: 1, version: row.record.version, values: { [titleField]: '人工修改' } },
    key(),
  );
  assert.equal((await action(reviewer, corrected.value.id)).syncStatus, 'FAILED');
  assert.equal((await drive.record(table, row.record.id)).record.values[titleField], '人工修改');
  await assert.rejects(start(d, { title: '又更正' }, { correctionOf: corrected.value.id }), /回写异常/);
});

test('returning or editing an approval invalidates repeat-review skipping', async () => {
  const s = schema();
  s.nodes.splice(2, 0, { ...s.nodes[1], id: 'second', name: '二次复核', skipRepeated: true });
  s.edges[1].to = 'second';
  s.edges.push({ id: 'c', from: 'second', to: 'end' });
  const i = await start(await publish(s));
  await action(reviewer, i.id, 'RETURN', { returnNode: 'start', remark: '补充材料' });
  await action(applicant, i.id, 'RESUBMIT', { values: { title: '补充后' } });
  const r = await action(reviewer, i.id);
  assert.equal(r.currentNode, 'second');
  assert.equal(r.status, 'PENDING');
  assert.equal((await action(reviewer, i.id)).status, 'APPROVED');
});

test('forms validate conditions, lengths, safe regex, detail totals and uppercase currency without executing code', () => {
  const s = schema();
  s.fields.push(
    {
      key: 'detail',
      label: '明细',
      type: 'detail',
      children: [{ key: 'cost', label: '费用', type: 'number', required: true }],
    },
    { key: 'total', label: '合计', type: 'formula', formula: { op: 'sum', fields: ['detail.cost'] } },
    { key: 'upper', label: '大写', type: 'moneyUpper', sourceField: 'amount' },
    { key: 'reason', label: '原因', type: 'text', requiredWhen: { field: 'amount', op: 'gt', value: 100 } },
  );
  validateSchema(s);
  assert.equal(calculate(s.fields, { amount: 1001.02, detail: [{ cost: 2 }, { cost: 3 }] }).total, 5);
  assert.equal(moneyUpper(1001.02), '壹仟零壹元零贰分');
  assert.throws(() => validateValues(s.fields, { title: 'a', amount: 200 }), /原因/);
  assert.throws(() => validateValues(s.fields, { title: 'a', detail: [{}] }), /费用/);
  assert.equal(matches({ field: 'amount', op: 'gt', value: 10 }, { amount: 11 }), true);
  s.fields[0].pattern = '^(a+)+$';
  assert.throws(() => validateSchema(s), /正则/);
  const malformed = schema();
  const raw = JSON.parse(JSON.stringify(malformed));
  raw.fields.push({ key: 'rows', label: '明细', type: 'detail', children: [null] });
  assert.throws(() => validateSchema(raw), /明细字段格式/);
  raw.fields.pop();
  raw.nodes[1].roleFields = { role: null };
  assert.throws(() => validateSchema(raw), /字段权限格式/);
  assert.equal(
    fieldMode({ ...s.nodes[1], fields: { title: 'EDIT' }, roleFields: { r: { title: 'HIDDEN' } } }, 'title', [
      'r',
    ]),
    'HIDDEN',
  );
});
test('drafts are not applyable, publication rejects cycles/orphans and uses optimistic versioning', async () => {
  const s = schema(),
    d = await admin.saveDefinition(undefined, { name: '草稿', schema: s });
  await assert.rejects(start(d), /流程不存在/);
  assert.equal((await applicant.definitions()).length, 0);
  const loop = structuredClone(s);
  loop.edges[1].to = 'start';
  await assert.rejects(
    admin.saveDefinition(d.id, { name: d.name, schema: loop, revision: d.revision, publish: true }),
    /循环/,
  );
  const p = await admin.saveDefinition(d.id, {
    name: d.name,
    schema: s,
    revision: d.revision,
    publish: true,
  });
  assert.equal(p.version, 1);
  await assert.rejects(
    admin.saveDefinition(d.id, { name: '旧版本', schema: s, revision: d.revision, publish: true }),
    /修改/,
  );
  await assert.rejects(
    reviewer.saveDefinition(undefined, { name: '无权发布', schema: s, publish: true }),
    /PERMISSION_DENIED/,
  );
});
test('conditional routing, ALL signoff, CC inbox, immutable published snapshots and task statistics', async () => {
  const s = schema();
  s.nodes.push(
    { id: 'branch', name: '金额判断', type: 'BRANCH', x: 100, y: 0 },
    {
      id: 'boss',
      name: '大额会签',
      type: 'APPROVAL',
      x: 300,
      y: 100,
      rule: { type: 'USER', ids: [reviewer.actor.userId, other.actor.userId] },
      mode: 'ALL',
    },
    {
      id: 'cc',
      name: '结果抄送',
      type: 'CC',
      x: 400,
      y: 200,
      rule: { type: 'USER', ids: [reader.actor.userId] },
    },
  );
  s.edges = [
    { id: 'a', from: 'start', to: 'branch' },
    { id: 'big', from: 'branch', to: 'boss', condition: { field: 'amount', op: 'gt', value: 10000 } },
    { id: 'default', from: 'branch', to: 'review' },
    { id: 'b', from: 'review', to: 'cc' },
    { id: 'c', from: 'boss', to: 'cc' },
    { id: 'd', from: 'cc', to: 'end' },
  ];
  const d = await publish(s),
    i = await start(d, { title: '大额', amount: 10001 });
  assert.equal(i.currentNode, 'boss');
  const changed = schema();
  await admin.saveDefinition(d.id, { name: '第二版', schema: changed, revision: d.revision, publish: true });
  assert.equal((await reviewer.detail(i.id)).definitionVersion, 1);
  assert.equal((await action(reviewer, i.id)).status, 'PENDING');
  assert.equal((await action(other, i.id)).status, 'APPROVED');
  assert.equal((await reader.list('CC')).total, 1);
  assert.equal((await reader.detail(i.id)).content.title, '大额');
  assert.ok((await admin.stats()).nodes.some((n) => n.nodeName === '大额会签'));
  const small = await start(d);
  assert.equal(small.currentNode, 'review');
  assert.equal(small.definitionVersion, 2);
});
test('ANY concurrent decisions and duplicate submissions never create duplicate tasks or transitions', async () => {
  const s = schema();
  s.nodes[1].mode = 'ANY';
  s.nodes[1].rule!.ids = [reviewer.actor.userId, other.actor.userId];
  const d = await publish(s);
  const request = { definitionId: d.id, title: '并发', content: { title: 'a' } },
    k = key();
  const [a, b] = await Promise.all([applicant.start(request, k), applicant.start(request, k)]);
  assert.equal(a.id, b.id);
  await assert.rejects(applicant.start({ ...request, title: 'changed' }, k), /不同内容/);
  const decisions = await Promise.allSettled([
    reviewer.act(a.id, { action: 'APPROVE', version: a.version }, key()),
    other.act(a.id, { action: 'APPROVE', version: a.version }, key()),
  ]);
  assert.equal(decisions.filter((r) => r.status === 'fulfilled').length, 1);
  const end = await admin.detail(a.id);
  assert.equal(end.status, 'APPROVED');
  assert.equal(end.tasks.filter((t) => t.status === 'APPROVED').length, 1);
  assert.equal(end.logs.filter((l) => l.action === 'COMPLETED').length, 1);
});
test('sequential tasks, transfer, add signer, return to applicant and resubmit keep an auditable path', async () => {
  const extra = await person('extra', permissions);
  const s = schema();
  s.nodes[1].mode = 'SEQUENTIAL';
  s.nodes[1].rule!.ids = [reviewer.actor.userId, other.actor.userId];
  const d = await publish(s),
    i = await start(d);
  assert.equal((await other.list('TODO')).total, 0);
  await action(reviewer, i.id, 'ADD', { userIds: [extra.actor.userId] });
  await action(reviewer, i.id);
  assert.equal((await other.list('TODO')).total, 1);
  await action(other, i.id, 'RETURN', { returnNode: 'start', remark: '补充说明' });
  await assert.rejects(action(applicant, i.id, 'APPROVE'), /不可审批/);
  await action(applicant, i.id, 'RESUBMIT', { values: { title: '补充后' } });
  const target = await person('forward', permissions);
  await action(reviewer, i.id, 'FORWARD', { userIds: [target.actor.userId] });
  await action(target, i.id);
  const final = await action(other, i.id);
  assert.equal(final.status, 'APPROVED');
  assert.equal(final.content.title, '补充后');
  assert.ok(final.logs.some((l) => l.action === 'RETURN'));
});
test('field/role permissions, file references and nonparticipant reads are enforced server-side', async () => {
  const s = schema();
  s.fields.push(
    { key: 'secret', label: '保密', type: 'text' },
    { key: 'receipt', label: '凭证', type: 'file' },
    { key: 'comment', label: '复核说明', type: 'text' },
  );
  s.nodes[1].fields = { secret: 'HIDDEN', receipt: 'READ', comment: 'EDIT' };
  const d = await publish(s),
    f = await applicant.upload('凭证.pdf', Buffer.from('%PDF-example'));
  const i = await start(d, { title: '共享', secret: 'private-value', receipt: [f.id] });
  const r = await reviewer.detail(i.id);
  assert.equal('secret' in r.content, false);
  assert.equal(r.editable.includes('comment'), true);
  await assert.rejects(reader.detail(i.id), /不可访问/);
  await assert.rejects(reader.download(f.id, i.id), /不可访问/);
  assert.equal((await reviewer.download(f.id, i.id)).id, f.id);
  await assert.rejects(action(reviewer, i.id, 'APPROVE', { values: { secret: 'changed' } }), /隐藏/);
  await assert.rejects(action(reviewer, i.id, 'APPROVE', { values: { title: 'changed' } }), /只读/);
  await action(reviewer, i.id, 'APPROVE', { values: { comment: '检查完成' } });
  assert.equal((await applicant.detail(i.id)).content.comment, '检查完成');
  assert.equal(
    JSON.stringify(await db.workflowLog.findMany({ where: { instanceId: i.id } })).includes('private-value'),
    false,
  );
});
test('binding updates shared table through existing ACLs and detects later edits rather than overwriting them', async () => {
  const row = await drive.saveRecord(
    table,
    undefined,
    { schemaVersion: 1, values: { [titleField]: '原值' } },
    key(),
  );
  const s = schema();
  s.binding = { tableId: table, mode: 'UPDATE', mappings: [{ field: 'title', target: titleField }] };
  const d = await publish(s),
    i = await start(d, { title: '批准内容' }, { targetRecordId: row.id });
  await drive.saveRecord(
    table,
    row.id,
    { schemaVersion: 1, version: 1, values: { [titleField]: '他人更新' } },
    key(),
  );
  const approved = await action(reviewer, i.id);
  assert.equal(approved.status, 'APPROVED');
  assert.equal(approved.syncStatus, 'FAILED');
  assert.equal((await drive.record(table, row.id)).record.values[titleField], '他人更新');
  const retried = await action(applicant, i.id, 'RETRY_SYNC', { targetVersion: 2 });
  assert.equal(retried.syncStatus, 'SYNCED');
  assert.equal((await drive.record(table, row.id)).record.values[titleField], '批准内容');
  assert.equal(
    (await new DriveService(db, applicant.actor).record(table, row.id)).record.values[titleField],
    '批准内容',
  );
});
test('permission revoked after submission causes visible sync failure and preserves business data', async () => {
  const s = schema();
  s.binding = { tableId: table, mode: 'CREATE', mappings: [{ field: 'title', target: titleField }] };
  const d = await publish(s),
    i = await start(d);
  await drive.saveMember(
    workspace,
    {
      baseId: base,
      principalType: 'ROLE',
      principalId: (await db.userRole.findFirstOrThrow({ where: { userId: applicant.actor.userId } })).roleId,
      role: 'READER',
      version: 1,
      rowScope: 'ALL',
      canCreate: false,
    },
    key(),
  );
  const approved = await action(reviewer, i.id);
  assert.equal(approved.syncStatus, 'FAILED');
  assert.equal(await db.collabRecord.count({ where: { tableId: table } }), 0);
});
test('new records with file mappings are written once and retain downloadable attachments', async () => {
  const fileField = await drive.saveField(
    table,
    undefined,
    { name: '材料', type: 'FILE', version: 1 },
    key(),
  );
  const detail = await drive.describe(table);
  const s = schema();
  s.fields.push({ key: 'receipt', label: '材料', type: 'file' });
  s.binding = {
    tableId: table,
    mode: 'CREATE',
    mappings: [
      { field: 'title', target: titleField },
      { field: 'receipt', target: fileField.id },
    ],
  };
  const d = await publish(s),
    f = await applicant.upload('审批材料.pdf', Buffer.from('%PDF-test'));
  const i = await start(d, { title: '归档', receipt: [f.id] });
  const r = await reviewer.act(i.id, { action: 'APPROVE', version: i.version }, 'same-action');
  assert.equal(r.syncStatus, 'SYNCED');
  await reviewer.act(i.id, { action: 'APPROVE', version: i.version }, 'same-action');
  assert.equal(await db.collabRecord.count({ where: { tableId: table } }), 1);
  const saved = (await drive.query(table, {})).records[0];
  assert.equal(saved.values[titleField], '归档');
  const ids = saved.values[fileField.id] as string[];
  assert.equal((await drive.attachment(table, ids[0])).name, '审批材料.pdf');
  assert.equal(detail.table.schemaVersion, 2);
});
test('timeout reminders deduplicate; configured auto-approval and durable webhook retries work', async () => {
  const s = schema();
  s.nodes[1].timeoutHours = 1;
  s.nodes[1].timeoutAction = 'REMIND';
  const d = await publish(s),
    i = await start(d);
  await db.workflowTask.updateMany({ where: { instanceId: i.id }, data: { dueAt: new Date(0) } });
  const now = new Date();
  await tickWorkflows(db, now);
  await tickWorkflows(db, now);
  assert.equal(
    await db.notification.count({ where: { deduplicationKey: { startsWith: 'workflow:timeout:' } } }),
    1,
  );
  assert.equal((await admin.detail(i.id)).status, 'PENDING');
  process.env.WORKFLOW_WEBHOOKS = JSON.stringify({
    test: { url: 'https://example.invalid/hook', secret: 'x'.repeat(32) },
  });
  s.nodes[1].timeoutAction = 'APPROVE';
  s.webhook = 'test';
  const d2 = await publish(s),
    i2 = await start(d2);
  await db.workflowTask.updateMany({ where: { instanceId: i2.id }, data: { dueAt: new Date(0) } });
  let sent = 0;
  await tickWorkflows(db, now, async () => {
    sent++;
    throw new Error('offline');
  });
  assert.equal((await admin.detail(i2.id)).status, 'APPROVED');
  await tickWorkflows(db, new Date(now.getTime() + 10000), async () => {
    sent++;
    throw new Error('offline');
  });
  let delivery = await db.workflowDelivery.findFirstOrThrow({ where: { instanceId: i2.id } });
  assert.equal(delivery.attempts, 1);
  await tickWorkflows(db, new Date(now.getTime() + 120000), async (_hook, _id, payload) => {
    sent++;
    assert.equal('content' in (payload as object), false);
  });
  delivery = await db.workflowDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
  assert.equal(delivery.status, 'SENT');
  assert.equal(sent, 2);
  await db.workflowDelivery.update({
    where: { id: delivery.id },
    data: { status: 'SENDING', attempts: 8, nextAt: new Date(0) },
  });
  await tickWorkflows(db, now, async () => {
    throw new Error('exhausted delivery must not be sent');
  });
  assert.equal(
    (await db.workflowDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status,
    'FAILED',
  );
  delete process.env.WORKFLOW_WEBHOOKS;
});
test('same-person skip is bounded by prior approvals, reject/withdraw cancel pending tasks', async () => {
  const s = schema();
  process.env.WORKFLOW_WEBHOOKS = JSON.stringify({
    completed: { url: 'https://example.invalid/workflow', secret: 'x'.repeat(32) },
  });
  s.webhook = 'completed';
  s.nodes.push({
    id: 'again',
    name: '再次复核',
    type: 'APPROVAL',
    x: 300,
    y: 100,
    rule: { type: 'USER', ids: [reviewer.actor.userId] },
    skipRepeated: true,
  });
  s.edges[1].to = 'again';
  s.edges.push({ id: 'last', from: 'again', to: 'end' });
  const d = await publish(s),
    i = await start(d);
  const approved = await action(reviewer, i.id);
  assert.equal(approved.status, 'APPROVED');
  assert.ok(approved.tasks.some((t) => t.status === 'SKIPPED'));
  const b = await start(d);
  await action(reviewer, b.id, 'REJECT', { remark: '不符合要求' });
  assert.equal((await admin.detail(b.id)).status, 'REJECTED');
  const c = await start(d);
  await action(applicant, c.id, 'WITHDRAW');
  await assert.rejects(action(reviewer, c.id), /已经结束/);
  assert.equal(await db.workflowDelivery.count({ where: { instanceId: { in: [i.id, b.id, c.id] } } }), 3);
});
test('role, form contact, applicant selection and manager rules resolve enabled accountable users', async () => {
  const r = await db.userRole.findFirstOrThrow({ where: { userId: reviewer.actor.userId } });
  const s = schema();
  s.nodes[1].rule = { type: 'ROLE', ids: [r.roleId] };
  let d = await publish(s);
  assert.equal((await start(d)).tasks[0].assigneeId, reviewer.actor.userId);
  s.fields.push({ key: 'contact', type: 'user', label: '联系人' });
  s.nodes[1].rule = { type: 'FIELD', field: 'contact' };
  d = await publish(s);
  assert.equal(
    (await start(d, { title: '联系人', contact: other.actor.userId })).tasks[0].assigneeId,
    other.actor.userId,
  );
  s.nodes[1].rule = { type: 'SELECT' };
  d = await publish(s);
  await assert.rejects(start(d), /没有可用/);
  assert.equal(
    (await start(d, { title: '自选' }, { selections: { review: [reviewer.actor.userId] } })).tasks[0]
      .assigneeId,
    reviewer.actor.userId,
  );
  await db.user.update({ where: { id: reviewer.actor.userId }, data: { status: 'DISABLED' } });
  await assert.rejects(
    start(d, { title: '停用' }, { selections: { review: [reviewer.actor.userId] } }),
    /停用/,
  );
  s.nodes[1].rule = { type: 'MANAGER' };
  d = await publish(s);
  await assert.rejects(start(d), /未绑定员工/);
  await db.user.update({ where: { id: reviewer.actor.userId }, data: { status: 'ENABLED' } });
  const employees = [];
  for (const svc of [applicant, reviewer, other]) {
    const employee = await db.employee.create({
      data: {
        employeeNo: key(),
        name: '审批角色',
        phone: '13800003333',
        type: 'PARTNER',
        status: 'FORMAL',
        entryDate: new Date('2020-01-01'),
      },
    });
    await db.user.update({ where: { id: svc.actor.userId }, data: { employeeId: employee.id } });
    employees.push(employee.id);
  }
  const ws = await db.collabWorkspace.findUniqueOrThrow({ where: { id: workspace } });
  await db.organization.update({
    where: { id: ws.organizationId },
    data: { managerEmployeeId: employees[1] },
  });
  const pos = await db.position.create({
    data: { organizationId: ws.organizationId, code: 'WF', name: '测试岗位', categoryCode: 'LEGAL' },
  });
  await db.employeeAssignment.create({
    data: {
      employeeId: employees[0],
      organizationId: ws.organizationId,
      positionId: pos.id,
      assignmentType: 'PRIMARY',
      startedAt: new Date('2020-01-01'),
    },
  });
  assert.equal((await start(d)).tasks[0].assigneeId, reviewer.actor.userId);
  for (let j = 0; j < 2; j++)
    await db.employeeReportingLine.create({
      data: {
        employeeId: employees[j],
        managerEmployeeId: employees[j + 1],
        startedAt: new Date('2020-01-01'),
      },
    });
  s.nodes[1].rule = { type: 'SUPERVISOR', levels: 2 };
  s.nodes[1].mode = 'SEQUENTIAL';
  d = await publish(s);
  const sequential = await start(d);
  assert.deepEqual(
    sequential.tasks.map((t) => [t.assigneeId, t.status]),
    [
      [reviewer.actor.userId, 'PENDING'],
      [other.actor.userId, 'WAITING'],
    ],
  );
  await action(reviewer, sequential.id);
  assert.equal((await action(other, sequential.id)).status, 'APPROVED');
  await db.rolePermission.deleteMany({ where: { roleId: r.roleId, permission: { code: 'approval.read' } } });
  await assert.rejects(start(d), /PERMISSION_DENIED/);
});
