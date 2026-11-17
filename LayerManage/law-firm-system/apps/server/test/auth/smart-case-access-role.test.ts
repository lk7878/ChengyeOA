import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createTestPrisma, clearTestApplicationData } from '../helpers/test-database';
import { previewSmartCaseAccess, migrateSmartCaseAccess } from '../../app/application/smart-case/access-migration';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { UserGrantService } from '../../app/application/authorization/user-grant-service';
import { RoleAuthorizationService } from '../../app/application/authorization/role-authorization-service';
import { SmartCaseIdentity } from '../../app/application/smart-case/identity';
import { SMART_CASE_ROLE_CODE } from '../../app/domain/smart-case/access-role';
import { provisionOrganizationRoles } from '../../app/application/authorization/organization-role-presets';
import { hasCode } from '../master-data/test-helpers';

const db = createTestPrisma();
let adminId: string;
const loader = new AuthorizationContextLoader(db);
const codes = async (id: string, at?: Date) => (await loader.load(id, at)).permissionCodes;
async function role(code: string, permissions: string[], status = 'ENABLED') {
  return db.role.create({ data: { code, name: code, type: 'BUSINESS', status, permissions: { create: permissions.map(p => ({ permissionId: 'permission:' + p })) } } });
}
async function user(username: string) { return db.user.create({ data: { username, password: 'unused' } }); }
async function dropTrigger() {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_smart_access_audit_trigger ON operation_log');
  await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_smart_access_audit()');
}
test.beforeEach(async () => {
  await dropTrigger(); await clearTestApplicationData(db);
  adminId = (await user('access-admin')).id;
  const root = await db.role.create({ data: { code: 'SYSTEM_SUPER_ADMIN', name: '超级管理员', type: 'SYSTEM' } });
  await db.userRole.create({ data: { userId: adminId, roleId: root.id } });
});
test.after(async () => { await dropTrigger(); await clearTestApplicationData(db); await db.$disconnect(); });

test('migration preserves effective access, removes every job-role entry and revocation invalidates existing SSO', async () => {
  const a = await role('DSJ', ['menu.smart_case', 'employee.read']);
  const b = await role('MANAGER', ['menu.smart_case', 'case.read']);
  const lawyer = await role('LAWYER', ['menu.smart_case', 'approval.read']);
  const reviewer = await role('XZ1', ['knowledge.review']);
  const current = await user('current-user'), unrelated = await user('unrelated'), otherJob = await user('reception');
  await db.userRole.createMany({ data: [{ userId: current.id, roleId: a.id }, { userId: current.id, roleId: b.id }, { userId: unrelated.id, roleId: reviewer.id }] });
  const before = await codes(current.id), unrelatedBefore = await codes(unrelated.id);
  const preview = await previewSmartCaseAccess(db);
  assert.deepEqual(preview.users.map(u => u.id), [current.id]);
  const migrated = await migrateSmartCaseAccess(db, adminId, preview.fingerprint);
  const managed = await db.role.findUniqueOrThrow({ where: { code: SMART_CASE_ROLE_CODE }, include: { permissions: { include: { permission: true } } } });
  assert.equal(migrated.roleId, managed.id);
  assert.deepEqual(managed.permissions.map(p => p.permission.code), ['menu.smart_case']);
  assert.deepEqual(await codes(current.id), before);
  assert.deepEqual(await codes(unrelated.id), unrelatedBefore);
  assert.equal(await db.rolePermission.count({ where: { roleId: { in: [a.id, b.id, lawyer.id] }, permission: { code: 'menu.smart_case' } } }), 0);
  assert.equal(await db.userRole.count({ where: { userId: current.id, roleId: managed.id } }), 1);
  const grants = new UserGrantService(db, await loader.load(adminId));
  await grants.grantRole(otherJob.id, managed.id, { source: 'PERMANENT', validFrom: new Date().toISOString(), validUntil: null, reason: null });
  assert.deepEqual(await codes(otherJob.id), ['menu.smart_case']);
  const session = await db.authSession.create({ data: { userId: current.id, credentialVersion: 1, assuranceLevel: 'PASSWORD', refreshTokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
  const previous = { url: process.env.SMART_CASE_PUBLIC_URL, secret: process.env.SMART_CASE_CLIENT_SECRET };
  process.env.SMART_CASE_PUBLIC_URL = 'https://smart.example'; process.env.SMART_CASE_CLIENT_SECRET = 's'.repeat(48);
  try {
    const identity = new SmartCaseIdentity(db), verifier = 'v'.repeat(64);
    const issued = await identity.issue({ userId: current.id, sessionId: session.id, credentialVersion: 1, assuranceLevel: 'PASSWORD', tokenType: 'access' }, await loader.load(current.id), createHash('sha256').update(verifier).digest('hex'));
    const { token } = await identity.exchange(new URL(issued.url).searchParams.get('code')!, process.env.SMART_CASE_CLIENT_SECRET, verifier);
    assert.equal((await identity.authenticate(token)).userId, current.id);
    const grant = await db.userRole.findFirstOrThrow({ where: { userId: current.id, roleId: managed.id } });
    await grants.revokeRole(current.id, grant.id, { version: grant.version, reason: '管理员撤销智慧办案的独立使用资格' });
    assert.equal((await codes(current.id)).includes('menu.smart_case'), false);
    assert.ok((await codes(current.id)).includes('employee.read'));
    await assert.rejects(() => identity.authenticate(token), hasCode('PERMISSION_DENIED'));
    const revokedContext = await loader.load(current.id);
    await assert.rejects(() => identity.issue({ userId: current.id, sessionId: session.id, credentialVersion: 1, assuranceLevel: 'PASSWORD', tokenType: 'access' }, revokedContext, '0'.repeat(64)));
  } finally {
    if (previous.url === undefined) delete process.env.SMART_CASE_PUBLIC_URL; else process.env.SMART_CASE_PUBLIC_URL = previous.url;
    if (previous.secret === undefined) delete process.env.SMART_CASE_CLIENT_SECRET; else process.env.SMART_CASE_CLIENT_SECRET = previous.secret;
  }
  const again = await previewSmartCaseAccess(db);
  assert.equal((await migrateSmartCaseAccess(db, adminId, again.fingerprint)).alreadyApplied, true);
  assert.equal((await codes(current.id)).includes('menu.smart_case'), false);
  assert.equal(await db.operationLog.count({ where: { action: 'MIGRATE_SMART_CASE_ACCESS' } }), 1);
});

test('migration preserves temporary and scheduled windows rather than granting permanent access', async () => {
  const old = await role('TEMP_JOB', ['menu.smart_case']);
  const target = await user('temp-user');
  const at = Date.now(), end = new Date(at + 3600000), later = new Date(at + 7200000), laterEnd = new Date(at + 10800000);
  await db.userRole.createMany({ data: [
    { userId: target.id, roleId: old.id, source: 'TEMPORARY', validFrom: new Date(at - 3600000), validUntil: end, reason: 'Approved temporary access for regression test' },
    { userId: target.id, roleId: old.id, source: 'TEMPORARY', validFrom: later, validUntil: laterEnd, reason: 'Approved scheduled access for regression test' },
  ] });
  await migrateSmartCaseAccess(db, adminId, (await previewSmartCaseAccess(db)).fingerprint);
  assert.ok((await codes(target.id)).includes('menu.smart_case'));
  assert.equal((await codes(target.id, new Date(at + 5400000))).includes('menu.smart_case'), false);
  assert.ok((await codes(target.id, new Date(at + 9000000))).includes('menu.smart_case'));
  assert.equal((await codes(target.id, laterEnd)).includes('menu.smart_case'), false);
});

test('stale previews and audit failures leave every original grant and permission intact', async () => {
  const legacy = await role('LEGACY_JOB', ['menu.smart_case']);
  const target = await user('legacy-user');
  await db.userRole.create({ data: { userId: target.id, roleId: legacy.id } });
  const stale = await previewSmartCaseAccess(db);
  await db.role.update({ where: { id: legacy.id }, data: { version: { increment: 1 } } });
  await assert.rejects(() => migrateSmartCaseAccess(db, adminId, stale.fingerprint), /状态已变化/);
  await db.$executeRawUnsafe(`CREATE FUNCTION fail_smart_access_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected'; END; $$ LANGUAGE plpgsql`);
  await db.$executeRawUnsafe(`CREATE TRIGGER fail_smart_access_audit_trigger BEFORE INSERT ON operation_log FOR EACH ROW EXECUTE FUNCTION fail_smart_access_audit()`);
  const current = await previewSmartCaseAccess(db);
  await assert.rejects(() => migrateSmartCaseAccess(db, adminId, current.fingerprint));
  assert.equal(await db.role.count({ where: { code: SMART_CASE_ROLE_CODE } }), 0);
  assert.deepEqual(await codes(target.id), ['menu.smart_case']);
});

test('managed capability cannot be edited, copied, deleted or granted through another job role', async () => {
  await migrateSmartCaseAccess(db, adminId, (await previewSmartCaseAccess(db)).fingerprint);
  const managed = await db.role.findUniqueOrThrow({ where: { code: SMART_CASE_ROLE_CODE } });
  const service = new RoleAuthorizationService(db, { actorUserId: adminId }, await loader.load(adminId));
  const job = await role('NEW_JOB', ['employee.read']);
  await assert.rejects(() => service.replacePermissions(job.id, { version: job.version, permissionCodes: ['menu.smart_case'] }), hasCode('SMART_CASE_ACCESS_ROLE_REQUIRED'));
  await assert.rejects(() => service.create({ name: '复制资格', copyRoleId: managed.id }), hasCode('SMART_CASE_ACCESS_ROLE_REQUIRED'));
  await assert.rejects(() => service.remove(managed.id, { version: managed.version }), hasCode('MANAGED_ROLE_PROTECTED'));
  await assert.rejects(() => service.disable(managed.id, managed.version), hasCode('MANAGED_ROLE_PROTECTED'));
  await assert.rejects(() => service.replacePermissions(managed.id, { version: managed.version, permissionCodes: ['employee.read'] }), hasCode('MANAGED_ROLE_PROTECTED'));
  const id = randomUUID();
  await db.organization.create({ data: { id, code: 'FIRM', name: '测试律所', type: 'FIRM', path: '/' + id } });
  const presets = await db.$transaction(tx => provisionOrganizationRoles(tx, id));
  assert.equal(await db.rolePermission.count({ where: { roleId: presets.LAWYER, permission: { code: 'menu.smart_case' } } }), 0);
});
