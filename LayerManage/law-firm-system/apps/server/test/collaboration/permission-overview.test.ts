import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PermissionOverview } from '../../app/application/collaboration/permission-overview';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

let db: PrismaClient, actor: AuthorizationContext, overview: PermissionOverview;
let member: string, direct: string, outsider: string, role: string, table: string, directTable: string, workspace: string;
const code = (expected: string) => (e: unknown) => (e as { code?: string }).code === expected;
test.before(() => { db = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  const orgId = randomUUID();
  const org = await db.organization.create({ data: { id: orgId, code: 'OVERVIEW', name: '总所', type: 'FIRM', path: '/' + orgId } });
  const admin = await db.user.create({ data: { username: 'overview-admin', password: 'unused' } });
  actor = { userId: admin.id, employeeId: null, isSystemSuperAdmin: true, isSystemAdmin: false, evaluatedAt: new Date(),
    permissionCodes: PERMISSION_CATALOG.map(p => p.code), fieldRules: [], grants: PERMISSION_CATALOG.map(p => ({
      sourceType: 'SYSTEM_SUPER_ADMIN', sourceId: 'fixture', permissionCode: p.code, resource: p.resource, scopeIds: ['ALL'], validUntil: null })) };
  const svc = new CollaborationService(db, actor);
  workspace = (await svc.createWorkspace({ name: '授权测试', organizationId: org.id }, randomUUID())).id;
  const base = (await svc.createBase(workspace, { name: '授权测试应用' }, randomUUID())).id;
  member = (await db.user.create({ data: { username: 'shen', password: 'unused' } })).id;
  direct = (await db.user.create({ data: { username: 'direct', password: 'unused' } })).id;
  outsider = (await db.user.create({ data: { username: 'outsider', password: 'unused' } })).id;
  role = (await db.role.create({ data: { name: '阅读角色', code: 'OVERVIEW_READER', type: 'BUSINESS' } })).id;
  await db.userRole.create({ data: { userId: member, roleId: role } });
  await db.collabMember.createMany({ data: [
    { workspaceId: workspace, principalType: 'ROLE', principalId: role, role: 'READER', rowScope: 'ALL' },
    { workspaceId: workspace, principalType: 'USER', principalId: direct, role: 'READER', rowScope: 'ALL' },
  ] });
  table = (await svc.createTable(base, { name: '角色授权空表', source: 'CUSTOM' }, randomUUID())).id;
  directTable = (await svc.createTable(base, { name: '直接授权空表', source: 'CUSTOM' }, randomUUID())).id;
  const grant = (principalType: string, principalId: string) => ({ principalType, principalId, role: 'READER', rowScope: 'ALL', canCreate: false, hiddenFields: [], readonlyFields: [] });
  await db.collabTable.update({ where: { id: table }, data: { accessPolicy: { restricted: true, grants: [grant('ROLE', role)] } } });
  await db.collabTable.update({ where: { id: directTable }, data: { accessPolicy: { restricted: true, grants: [grant('USER', direct)] } } });
  overview = new PermissionOverview(db, actor);
});
test.after(async () => { await clearTestApplicationData(db); await db.$disconnect(); });

test('member overview merges effective access and includes authorized tables with zero records', async () => {
  const result = await overview.query({ target: 'MEMBER', id: member });
  assert.deepEqual(result.rows.map(r => r.tableId), [table]);
  assert.equal(result.rows[0].level, 1);
  assert.equal('records' in result.rows[0], false);
  assert.deepEqual((await overview.query({ target: 'MEMBER', id: direct })).rows.map(r => r.tableId), [directTable]);
  assert.equal((await overview.query({ target: 'MEMBER', id: outsider })).rows.length, 0);
});

test('table overview includes effective members and roles and respects subject-kind filters', async () => {
  const result = await overview.query({ tableId: table, target: 'ALL' });
  assert.ok(result.rows.some(r => r.subject.target === 'ROLE' && r.subject.id === role));
  assert.ok(result.rows.some(r => r.subject.target === 'MEMBER' && r.subject.id === member));
  assert.ok(!result.rows.some(r => [direct, outsider].includes(r.subject.id)));
  assert.ok((await overview.query({ tableId: table, target: 'ALL_MEMBERS' })).rows.every(r => r.subject.target === 'MEMBER'));
  assert.deepEqual((await overview.query({ tableId: table, target: 'ALL_ROLES' })).rows.map(r => r.subject.id), [role]);
});

test('revoked, pending and expired memberships do not imply access; disabled subjects and archived tables are excluded', async () => {
  const grant = await db.userRole.findFirstOrThrow({ where: { userId: member, roleId: role } });
  for (const data of [
    { revokedAt: new Date(), revokedByUserId: actor.userId, revokeReason: '测试撤销角色后不再出现在授权汇总' },
    { revokedAt: null, revokedByUserId: null, revokeReason: null, validFrom: new Date(Date.now() + 86400000), validUntil: null },
    { source: 'TEMPORARY', validFrom: new Date('2020-01-01'), validUntil: new Date('2021-01-01'), reason: '测试过期' },
  ]) {
    await db.userRole.update({ where: { id: grant.id }, data });
    assert.equal((await overview.query({ target: 'MEMBER', id: member })).rows.length, 0);
  }
  await db.user.update({ where: { id: member }, data: { status: 'DISABLED' } });
  await db.role.update({ where: { id: role }, data: { status: 'DELETED' } });
  await db.collabTable.update({ where: { id: table }, data: { archived: true } });
  const options = await overview.options();
  assert.ok(!options.subjects.some(s => s.id === member || s.id === role));
  assert.ok(!options.tables.some(t => t.id === table));
  await assert.rejects(overview.query({ target: 'MEMBER', id: member }), code('COLLAB_NOT_FOUND'));
});

test('bounded batches cover the full matrix without duplicates or a 100-member cap', async () => {
  await db.user.createMany({ data: Array.from({ length: 105 }, (_, i) => ({ username: `extra${i}`, password: 'unused' })) });
  assert.ok((await overview.options()).subjects.filter(s => s.target === 'MEMBER').length > 100);
  const all = await overview.query({ target: 'ALL', limit: 80 });
  let offset: number | null = 0;
  const keys: string[] = [];
  let checked = 0;
  while (offset !== null) {
    const result = await overview.query({ target: 'ALL', offset, limit: 80 });
    assert.ok(result.checked - checked <= 80);
    keys.push(...result.rows.map(r => `${r.tableId}:${r.subject.target}:${r.subject.id}`));
    checked = result.checked; offset = result.nextOffset;
  }
  assert.equal(checked, all.totalCandidates);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes(`${table}:MEMBER:${member}`));
  assert.ok(keys.includes(`${directTable}:MEMBER:${direct}`));
});

test('overview is super-admin only and validates selections and batch size', async () => {
  const ordinary = new PermissionOverview(db, { ...actor, isSystemSuperAdmin: false });
  await assert.rejects(ordinary.options(), code('COLLAB_FORBIDDEN'));
  await assert.rejects(ordinary.query({ target: 'ALL' }), code('COLLAB_FORBIDDEN'));
  await assert.rejects(overview.query({ target: 'PRESET', id: 'OWNER' }), code('COLLAB_INVALID_OPTION'));
  await assert.rejects(overview.query({ target: 'ALL', limit: 1000 }), code('COLLAB_INVALID_NUMBER'));
  await assert.rejects(overview.query({ target: 'ALL', tableId: 'missing' }), code('COLLAB_NOT_FOUND'));
  await assert.rejects(overview.query({ target: 'ROLE', id: 'missing' }), code('COLLAB_NOT_FOUND'));
});
