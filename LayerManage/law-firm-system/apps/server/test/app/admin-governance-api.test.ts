import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { SessionService } from '../../app/application/auth/session-service';
import { MfaSecretCrypto } from '../../app/domain/security/mfa-factor-crypto';
import { TotpService } from '../../app/domain/security/totp-service';
import { decodeBase32 } from '../../app/domain/security/base32';
import { hashPayload } from '../../app/domain/admin-governance/canonical-json';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

process.env.EGG_TYPESCRIPT = 'true';
const app = mm.app();
const jwtSecret = '01234567890123456789012345678901';
let prisma: PrismaClient;
let systemId: string;
let systemToken: string;
let superId: string;
let superToken: string;
let branchId: string;
let systemSession: TestSession;
let superSession: TestSession;

interface TestSession {
  id: string;
  token: string;
  csrfToken: string;
  secret: string;
}

function bearer(token: string) { return { Authorization: `Bearer ${token}` }; }

async function createAdministrator(code: 'SYSTEM_ADMIN' | 'SYSTEM_SUPER_ADMIN', bound = true) {
  const user = await prisma.user.create({ data: {
    username: `${code.toLowerCase()}.${randomUUID()}`, password: 'unused',
  } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const secret = new TotpService().generateSecret();
  const encrypted = new MfaSecretCrypto((app.config as typeof app.config & { identitySecurity: { mfaEncryptionKeys: ReadonlyMap<number, Buffer> } }).identitySecurity.mfaEncryptionKeys).encrypt(secret);
  if (bound) await prisma.mfaFactor.create({ data: {
    userId: user.id,
    encryptedSecret: encrypted.ciphertext,
    secretIv: encrypted.iv,
    secretAuthTag: encrypted.authTag,
    keyVersion: encrypted.keyVersion,
    verifiedAt: new Date(),
  } });
  const credentials = await new SessionService(prisma, new JwtTokenService(jwtSecret)).create(user.id, bound ? 'MFA' : 'PASSWORD', {});
  return {
    id: user.id,
    token: credentials.accessToken,
    csrfToken: credentials.csrfToken,
    secret,
  };
}

function totpCode(secret: string): string {
  const counter = BigInt(Math.floor(Date.now() / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

async function issueStepUp(session: TestSession, purpose: string, target: unknown): Promise<string> {
  const response = await app.httpRequest().post('/api/v1/auth/step-up')
    .set(bearer(session.token))
    .set('Origin', 'http://localhost:3000')
    .set('X-CSRF-Token', session.csrfToken)
    .set('Cookie', `chengye_csrf=${session.csrfToken}`)
    .send({ purpose, target, code: totpCode(session.secret) })
    .expect(200);
  return response.body.data.stepUpToken;
}

function createInput() {
  return {
    operationType: 'MASTER_DATA_STATUS_CORRECTION', targetType: 'ORGANIZATION', targetId: branchId,
    reason: 'Disable a verified inactive branch through governance review', expectedTargetVersion: 1,
    payload: { status: 'DISABLED' }, idempotencyKey: randomUUID(),
  };
}

test.before(async () => { prisma = createTestPrisma(); await app.ready(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  await prisma.role.createMany({ data: [
    { id: 'role:system-admin', code: 'SYSTEM_ADMIN', name: 'System Admin', type: 'SYSTEM' },
    { id: 'role:super-admin', code: 'SYSTEM_SUPER_ADMIN', name: 'Super Admin', type: 'SYSTEM' },
  ] });
  const system = await createAdministrator('SYSTEM_ADMIN'); systemSession = system; systemId = system.id; systemToken = system.token;
  const root = await createAdministrator('SYSTEM_SUPER_ADMIN'); superSession = root; superId = root.id; superToken = root.token;
  const rootId = randomUUID(); branchId = randomUUID();
  await prisma.organization.create({ data: { id: rootId, code: 'ROOT', name: 'Root', type: 'FIRM', path: `/${rootId}` } });
  await prisma.organization.create({ data: { id: branchId, code: 'BRANCH', name: 'Branch', type: 'BRANCH', parentId: rootId, path: `/${rootId}/${branchId}`, level: 1 } });
  await prisma.systemInitialization.create({ data: { id: 'PRIMARY', rootOrganizationId: rootId, superAdminUserId: superId, completedAt: new Date() } });
});
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); await app.close(); await mm.restore(); });

test('requires JWT and governance permissions, with role-filtered catalogs', async () => {
  await app.httpRequest().get('/api/v1/admin-governance/catalog').expect(401);
  const ordinary = await prisma.user.create({ data: { username: `ordinary.${randomUUID()}`, password: 'x' } });
  const ordinaryToken = (await new SessionService(prisma, new JwtTokenService(jwtSecret)).create(
    ordinary.id, 'PASSWORD', {},
  )).accessToken;
  await app.httpRequest().get('/api/v1/admin-governance/catalog').set(bearer(ordinaryToken)).expect(403);

  const systemCatalog = await app.httpRequest().get('/api/v1/admin-governance/catalog').set(bearer(systemToken)).expect(200);
  assert.deepEqual(systemCatalog.body.data.map((entry: { operationType: string }) => entry.operationType), [
    'SOP_TEMPLATE_PUBLISH', 'SOP_TEMPLATE_DISABLE',
    'MASTER_DATA_STATUS_CORRECTION', 'MASTER_DATA_METADATA_CORRECTION',
  ]);
  const superCatalog = await app.httpRequest().get('/api/v1/admin-governance/catalog').set(bearer(superToken)).expect(200);
  assert.equal(superCatalog.body.data.length, 11);
});

test('exposes a governance-only user target version without credential fields', async () => {
  const response = await app.httpRequest()
    .get('/api/v1/admin-governance/targets/users')
    .set(bearer(systemToken))
    .expect(200);
  const target = response.body.data.find((item: { id: string }) => item.id === superId);
  assert.equal(typeof target.governanceVersion, 'number');
  assert.equal(typeof target.username, 'string');
  assert.doesNotMatch(JSON.stringify(response.body), /credentialVersion|password|mustChangePassword|lockedUntil/i);
});

test('creates, lists, shows, reviews, and hides scopes through thin APIs', async () => {
  const input = createInput();
  const createTarget = {
    operationType: input.operationType,
    targetType: input.targetType,
    targetId: input.targetId,
    expectedTargetVersion: input.expectedTargetVersion,
    payloadHash: hashPayload(input.payload),
  };
  const createGrant = await issueStepUp(systemSession, 'ADMIN_GOVERNANCE_CREATE', createTarget);
  const created = await app.httpRequest()
    .post('/api/v1/admin-governance/operations').set(bearer(systemToken))
    .set('X-Step-Up-Token', createGrant).send(input).expect(200);
  assert.equal(created.body.data.status, 'PENDING_REVIEW');

  const mine = await app.httpRequest()
    .get('/api/v1/admin-governance/operations?scope=mine').set(bearer(systemToken)).expect(200);
  assert.equal(mine.body.data.list.length, 1);
  assert.equal(mine.body.data.list[0].requesterUserId, systemId);
  await app.httpRequest()
    .get('/api/v1/admin-governance/operations?scope=all').set(bearer(systemToken)).expect(403);

  const reviewable = await app.httpRequest()
    .get('/api/v1/admin-governance/operations?scope=reviewable').set(bearer(superToken)).expect(200);
  assert.equal(reviewable.body.data.list[0].id, created.body.data.id);
  const approveGrant = await issueStepUp(superSession, 'ADMIN_GOVERNANCE_APPROVE', {
    operationId: created.body.data.id,
    expectedOperationVersion: 1,
    decision: 'APPROVE',
  });
  const reviewed = await app.httpRequest()
    .post(`/api/v1/admin-governance/operations/${created.body.data.id}/review`)
    .set(bearer(superToken)).set('X-Step-Up-Token', approveGrant)
    .send({ decision: 'APPROVE', expectedOperationVersion: 1 }).expect(200);
  assert.equal(reviewed.body.data.status, 'SUCCEEDED');

  const shown = await app.httpRequest()
    .get(`/api/v1/admin-governance/operations/${created.body.data.id}`).set(bearer(systemToken)).expect(200);
  assert.equal(shown.body.data.executions.length, 1);
});

test('rejects client-controlled policy fields and returns stable errors without internals', async () => {
  for (const field of ['riskLevel', 'reviewMode', 'reviewerUserId', 'status']) {
    const response = await app.httpRequest()
      .post('/api/v1/admin-governance/operations')
      .set(bearer(systemToken)).send({ ...createInput(), [field]: 'CLIENT_VALUE' }).expect(400);
    assert.equal(response.body.message, 'TARGET_NOT_ELIGIBLE');
    assert.doesNotMatch(JSON.stringify(response.body), /Prisma|SELECT|stack|password|Bearer/i);
  }
});

for (const operationType of ['SUPER_ADMIN_GRANT', 'ADMIN_MFA_RESET'] as const) {
  test(`${operationType} needs no factor on create, approval or retry, but preserves governance safeguards`, async () => {
    const requester = await createAdministrator('SYSTEM_SUPER_ADMIN', false);
    const reviewer = await createAdministrator('SYSTEM_SUPER_ADMIN', false);
    const target = operationType === 'ADMIN_MFA_RESET'
      ? await createAdministrator('SYSTEM_SUPER_ADMIN')
      : await prisma.user.create({ data: { username: `target.${randomUUID()}`, password: 'unused' } });
    const targetUser = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    const ordinary = await prisma.user.create({ data: { username: `ordinary.${randomUUID()}`, password: 'unused' } });
    const ordinarySession = await new SessionService(prisma, new JwtTokenService(jwtSecret)).create(ordinary.id, 'PASSWORD', {});
    const databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL_TEST!).pathname.slice(1));
    const input = {
      operationType, targetType: 'USER', targetId: target.id,
      expectedTargetVersion: targetUser.credentialVersion,
      reason: 'Verify the explicitly exempt action retains independent review and audit',
      payload: operationType === 'SUPER_ADMIN_GRANT' ? { validUntil: null } : {},
      confirmation: `CONFIRM ${databaseName} ${operationType} ${targetUser.username}`,
      idempotencyKey: randomUUID(),
    };
    const create = (token: string, body = input) => app.httpRequest()
      .post('/api/v1/admin-governance/operations').set(bearer(token)).send(body);
    await create(systemToken).expect(403);
    await create(ordinarySession.accessToken).expect(403);
    const badConfirmation = await create(requester.token, { ...input, confirmation: 'wrong' }).expect(422);
    assert.equal(badConfirmation.body.message, 'TARGET_NOT_ELIGIBLE');

    // A genuinely stale target fails execution and retry without demanding a factor.
    const stale = await create(requester.token, { ...input, expectedTargetVersion: targetUser.credentialVersion + 1,
      idempotencyKey: randomUUID() }).expect(200);
    const failure = await app.httpRequest().post(`/api/v1/admin-governance/operations/${stale.body.data.id}/review`)
      .set(bearer(reviewer.token)).send({ decision: 'APPROVE', expectedOperationVersion: stale.body.data.version }).expect(409);
    assert.equal(failure.body.message, 'STALE_TARGET_VERSION');
    const failed = await app.httpRequest().get(`/api/v1/admin-governance/operations/${stale.body.data.id}`).set(bearer(reviewer.token)).expect(200);
    assert.equal(failed.body.data.status, 'FAILED');
    assert.equal(failed.body.data.executions[0].resultCode, 'STALE_TARGET_VERSION');
    const retryFailure = await app.httpRequest().post(`/api/v1/admin-governance/operations/${stale.body.data.id}/retry`)
      .set(bearer(reviewer.token)).send({ expectedOperationVersion: failed.body.data.version }).expect(409);
    assert.equal(retryFailure.body.message, 'STALE_TARGET_VERSION');
    const retried = await app.httpRequest().get(`/api/v1/admin-governance/operations/${stale.body.data.id}`).set(bearer(reviewer.token)).expect(200);
    assert.equal(retried.body.data.status, 'FAILED');
    assert.equal(retried.body.data.executions.length, 2);

    const created = await create(requester.token).expect(200);
    const op = created.body.data;
    assert.equal(op.status, 'PENDING_REVIEW');
    assert.equal(op.riskLevel, 'CRITICAL');
    assert.ok(op.secondConfirmationAt);
    const review = (token: string, version = op.version) => app.httpRequest()
      .post(`/api/v1/admin-governance/operations/${op.id}/review`).set(bearer(token))
      .send({ decision: 'APPROVE', expectedOperationVersion: version });
    await review(systemToken).expect(403);
    const self = await review(requester.token).expect(403);
    assert.equal(self.body.message, 'GOVERNANCE_SELF_REVIEW_FORBIDDEN');
    if ('token' in target) {
      const conflicted = await review(target.token).expect(403);
      assert.equal(conflicted.body.message, 'GOVERNANCE_REVIEW_TARGET_CONFLICT');
    }
    await review(reviewer.token, op.version + 1).expect(409);
    const approved = await review(reviewer.token).expect(200);
    assert.equal(approved.body.data.status, 'SUCCEEDED');
    assert.equal(approved.body.data.reviews.length, 1);
    assert.equal(approved.body.data.executions.length, 1);
    await review(reviewer.token).expect(409);
    const audit = await prisma.operationLog.findMany({ where: { targetId: op.id }, select: { action: true } });
    for (const action of ['ADMIN_GOVERNANCE_CREATED_CONFIRMED', 'ADMIN_GOVERNANCE_APPROVE', 'ADMIN_GOVERNANCE_EXECUTION_SUCCEEDED']) {
      assert.ok(audit.some(item => item.action === action), action);
    }
    assert.equal(await prisma.mfaFactor.count({ where: { userId: { in: [requester.id, reviewer.id] } } }), 0);
    assert.equal(await prisma.stepUpGrant.count({ where: { userId: { in: [requester.id, reviewer.id] } } }), 0);
    if (operationType === 'SUPER_ADMIN_GRANT') {
      assert.equal(await prisma.userRole.count({ where: { userId: target.id, role: { code: 'SYSTEM_SUPER_ADMIN' }, revokedAt: null } }), 1);
    } else {
      const factor = await prisma.mfaFactor.findFirstOrThrow({ where: { userId: target.id } });
      assert.ok(factor.disabledAt);
      assert.equal(await prisma.authSession.count({ where: { userId: target.id, revokedAt: null } }), 0);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).credentialVersion, targetUser.credentialVersion + 1);
      assert.equal(await prisma.operationLog.count({ where: { targetId: target.id, action: 'ADMIN_MFA_RESET_GOVERNANCE' } }), 1);
    }
  });
}

test('other critical and high-risk governance actions still require step-up', async () => {
  const requester = await createAdministrator('SYSTEM_SUPER_ADMIN', false);
  const targetUser = await prisma.user.findUniqueOrThrow({ where: { id: superId } });
  const databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL_TEST!).pathname.slice(1));
  for (const operationType of ['SYSTEM_ADMIN_GRANT', 'SUPER_ADMIN_REVOKE', 'SUPER_ADMIN_ACCOUNT_DISABLE']) {
    const response = await app.httpRequest().post('/api/v1/admin-governance/operations').set(bearer(requester.token)).send({
      operationType, targetType: 'USER', targetId: superId, expectedTargetVersion: 1,
      payload: operationType.endsWith('_GRANT') ? { validUntil: null } : {},
      reason: 'Other actions must retain their original step-up boundary', idempotencyKey: randomUUID(),
      ...(operationType.startsWith('SUPER_ADMIN_') ? { confirmation: `CONFIRM ${databaseName} ${operationType} ${targetUser.username}` } : {}),
    }).expect(403);
    assert.equal(response.body.message, 'STEP_UP_REQUIRED');
  }
});
