import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import mm from 'egg-mock';
import type { PrismaClient } from '@prisma/client';
import { BcryptPasswordHasher } from '../../app/domain/security/password-hasher';
import { MfaSecretCrypto } from '../../app/domain/security/mfa-factor-crypto';
import { decodeBase32 } from '../../app/domain/security/base32';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { highRiskOperation } from '../../app/application/auth/high-risk-operation';

process.env.EGG_TYPESCRIPT = 'true';
const app = mm.app();
const origin = 'http://localhost:3000';
const password = 'Initial-secret-123';
const newPassword = 'Changed-secret-456';
const secret = 'JBSWY3DPEHPK3PXP';
let db: PrismaClient;
const hasher = new BcryptPasswordHasher(4);
type BrowserResponse = { body: { data: { token: string; csrfToken: string } }; headers: Record<string, string | string[] | undefined> };
const cookie = (r: BrowserResponse) => ((r.headers['set-cookie'] ?? []) as string[]).map((s: string) => s.split(';')[0]).join('; ');
function totp() {
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const d = createHmac('sha1', decodeBase32(secret)).update(b).digest(), i = d[d.length - 1] & 15;
  return String((d.readUInt32BE(i) & 0x7fffffff) % 1000000).padStart(6, '0');
}
async function user(admin = false, factor = false) {
  const u = await db.user.create({ data: { username: `risk.${randomUUID()}`, password: await hasher.hash(password) } });
  if (admin) {
    const r = await db.role.upsert({ where: { code: 'SYSTEM_SUPER_ADMIN' }, update: {}, create: { name: '超级管理员', code: 'SYSTEM_SUPER_ADMIN', type: 'SYSTEM' } });
    await db.userRole.create({ data: { userId: u.id, roleId: r.id } });
  }
  if (factor) {
    const keys = (app.config as typeof app.config & { identitySecurity: { mfaEncryptionKeys: ReadonlyMap<number, Buffer> } }).identitySecurity.mfaEncryptionKeys;
    const enc = new MfaSecretCrypto(keys).encrypt(secret);
    await db.mfaFactor.create({ data: { userId: u.id, type: 'TOTP', verifiedAt: new Date(), encryptedSecret: enc.ciphertext, secretIv: enc.iv, secretAuthTag: enc.authTag, keyVersion: enc.keyVersion } });
  }
  return u;
}
async function login(u: { username: string }, pass = password) {
  return app.httpRequest().post('/api/v1/auth/login').send({ username: u.username, password: pass }).expect(200);
}
function req(session: BrowserResponse, method: 'get' | 'post' | 'patch' | 'delete', path: string) {
  return app.httpRequest()[method](path).set('Authorization', `Bearer ${session.body.data.token}`)
    .set('Origin', origin).set('X-CSRF-Token', session.body.data.csrfToken).set('Cookie', cookie(session));
}
test.before(async () => { db = createTestPrisma(); await app.ready(); });
test.beforeEach(async () => clearTestApplicationData(db));
test.after(async () => { await clearTestApplicationData(db); await db.$disconnect(); await app.close(); await mm.restore(); });

test('ordinary and administrator accounts login with password, including existing factors', async () => {
  for (const admin of [false, true]) for (const factor of [false, true]) {
    const u = await user(admin, factor), s = await login(u);
    assert.equal(s.body.data.mode, 'AUTHENTICATED');
    await req(s, 'get', '/api/v1/auth/me').expect(200);
    assert.equal((await db.authSession.findFirstOrThrow({ where: { userId: u.id } })).assuranceLevel, 'PASSWORD');
  }
});
test('self password change validates input, rotates current credentials and revokes all other devices', async () => {
  const u = await user(false, true), first = await login(u), second = await login(u);
  const current = (await req(first, 'get', '/api/v1/auth/sessions')).body.data.find((s: { current: boolean; id: string }) => s.current).id;
  await req(first, 'post', '/api/v1/auth/password/change').send({ currentPassword: 'wrong', password: newPassword, confirmation: newPassword }).expect(403);
  await req(first, 'post', '/api/v1/auth/password/change').send({ currentPassword: password, password: newPassword, confirmation: 'mismatch' }).expect(400);
  await req(first, 'post', '/api/v1/auth/password/change').send({ currentPassword: password, password, confirmation: password }).expect(400);
  const changed = await req(first, 'post', '/api/v1/auth/password/change').send({ currentPassword: password, password: newPassword, confirmation: newPassword }).expect(200);
  await req(changed, 'get', '/api/v1/auth/me').expect(200);
  assert.equal((await req(changed, 'get', '/api/v1/auth/sessions')).body.data[0].id, current);
  await req(first, 'get', '/api/v1/auth/me').expect(401);
  await req(second, 'get', '/api/v1/auth/me').expect(401);
  await req(first, 'post', '/api/v1/auth/refresh').send({}).expect(401);
  await req(changed, 'get', '/api/v1/auth/me').expect(200);
  await app.httpRequest().post('/api/v1/auth/login').send({ username: u.username, password }).expect(401);
  await login(u, newPassword);
  const logs = await db.operationLog.findMany({ where: { userId: u.id, action: 'SELF_PASSWORD_CHANGED' } });
  assert.equal(logs.length, 1); assert.ok(!JSON.stringify(logs).includes(newPassword));
});
test('own device logout works without a factor, cannot revoke someone else, and remains CSRF protected', async () => {
  const u = await user(), a = await login(u), b = await login(u), outsider = await user(), c = await login(outsider);
  const own = (await req(b, 'get', '/api/v1/auth/sessions')).body.data.find((s: { current: boolean; id: string }) => s.current).id;
  const foreign = (await req(c, 'get', '/api/v1/auth/sessions')).body.data.find((s: { current: boolean; id: string }) => s.current).id;
  await req(a, 'delete', `/api/v1/auth/sessions/${foreign}`).expect(404);
  await req(a, 'delete', `/api/v1/auth/sessions/${own}`).expect(200);
  await req(b, 'get', '/api/v1/auth/me').expect(401);
  await req(c, 'get', '/api/v1/auth/me').expect(200);
  await app.httpRequest().post('/api/v1/auth/password/change').set('Authorization', `Bearer ${a.body.data.token}`).send({}).expect(403);
  await req(a, 'post', '/api/v1/auth/logout-all').send({ preserveCurrent: true }).expect(200);
  await req(a, 'get', '/api/v1/auth/me').expect(200);
});
test('initial password change is still mandatory, then completes without MFA', async () => {
  const u = await user(true, true); await db.user.update({ where: { id: u.id }, data: { mustChangePassword: true } });
  const first = await login(u); assert.equal(first.body.data.mode, 'PASSWORD_CHANGE_REQUIRED');
  const changed = await app.httpRequest().post('/api/v1/auth/password/forced-change').send({ challengeToken: first.body.data.challengeToken, password: newPassword, confirmation: newPassword }).expect(200);
  assert.equal(changed.body.data.mode, 'AUTHENTICATED');
});
test('permanent file deletion still requires an administrator and a target-bound one-use proof', async () => {
  const admin = await user(true, true), a = await login(admin), member = await user(false, true), b = await login(member);
  const path = `/api/v1/files/${randomUUID()}`, body = {};
  const denied = await req(b, 'delete', path).send(body).expect(403); assert.equal(denied.body.message, 'ADMIN_HIGH_RISK_ONLY');
  const challenge = await req(a, 'delete', path).send(body).expect(403); assert.equal(challenge.body.message, 'STEP_UP_REQUIRED');
  const target = challenge.body.errors.target;
  await req(b, 'post', '/api/v1/auth/step-up').send({ purpose: 'ADMIN_HIGH_RISK', target, code: totp() }).expect(403);
  const proof = await req(a, 'post', '/api/v1/auth/step-up').send({ purpose: 'ADMIN_HIGH_RISK', target, code: totp() }).expect(200);
  const token = proof.body.data.stepUpToken;
  const mismatch = await req(a, 'delete', path).set('X-Step-Up-Token', token).send({ ...body, name: 'Changed target' }).expect(403);
  assert.equal(mismatch.body.message, 'STEP_UP_TARGET_MISMATCH');
  await req(a, 'delete', path).set('X-Step-Up-Token', token).send(body).expect(404);
  const replay = await req(a, 'delete', path).set('X-Step-Up-Token', token).send(body).expect(403);
  assert.equal(replay.body.message, 'STEP_UP_INVALID');
});
test('unbound administrator can start enrollment inline; ordinary account is not invited to bind', async () => {
  const a = await login(await user(true)), b = await login(await user());
  await req(a, 'post', '/api/v1/auth/mfa/enrollment/start').send({}).expect(200);
  await req(b, 'post', '/api/v1/auth/mfa/enrollment/start').send({}).expect(403);
  assert.equal((await req(b, 'get', '/api/v1/auth/mfa')).body.data.canManageHighRisk, false);
});
test('role creation and aliases need no factor while preserving administrator authorization', async () => {
  const a = await login(await user(true));
  for (const path of ['/api/v1/roles', '/api/v1/roles/']) {
    await req(a, 'post', path).send({ name: `Alias role ${randomUUID()}`, code: `ALIAS_${randomUUID().slice(0, 8)}` }).expect(200);
  }
  // Upper-case is classified identically by the guard but is not a registered route.
  await req(a, 'post', '/api/v1/ROLES').send({ name: 'Unsupported alias', code: 'UNSUPPORTED' }).expect(404);
  const ordinary = await login(await user());
  const denied = await req(ordinary, 'post', '/api/v1/roles').send({ name: 'No authority', code: 'FORBIDDEN' }).expect(403);
  assert.equal(denied.body.message, 'ADMIN_HIGH_RISK_ONLY');
  assert.equal(await db.role.count({ where: { code: { startsWith: 'ALIAS_' } } }), 2);

});
test('risk catalogue distinguishes destructive actions from navigation, reversible edits and ordinary approvals', () => {
  for (const [method, path, body] of [
    ['POST', '/api/v1/refunds/r1/approve', {}], ['POST', '/api/v1/workflows/tasks/t1/approve', {}],
    ['PUT', '/api/v1/navigation-menu', { nodes: [] }], ['PATCH', '/api/v1/tables/t1/records/r1', { archived: true }],
    ['POST', '/api/v1/tables/t1/records/delete-batch', { records: [{ id: 'r1' }] }],
    ['POST', '/api/v1/drive/nodes/n1/lifecycle', { action: 'TRASH' }], ['GET', '/api/v1/roles', {}],
  ] as const) assert.equal(highRiskOperation(method, path, body), null);
  assert.ok(highRiskOperation('PATCH', '/api/v1/tables/t1', { remove: true }));
  assert.equal(highRiskOperation('POST', '/api/v1/tables/t1/records/delete-batch', { records: [{ id: 'r1' }, { id: 'r2' }] }), null);
  assert.equal(highRiskOperation('PATCH', '/api/v1/roles/r1', { name: 'Rename only' }), null);
  assert.ok(highRiskOperation('DELETE', '/api/v1/files/f1'));
  assert.ok(highRiskOperation('PUT', '/api/v1/cases/c1', { removeAttachmentIds: ['f1'] }));
  assert.equal(highRiskOperation('PUT', '/api/v1/cases/c1', { title: 'ordinary edit' }), null);
});
