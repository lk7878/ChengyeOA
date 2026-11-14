import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { AdministratorAccountAdapter } from '../../app/application/admin-governance/adapters/administrator-account-adapter';
import {
  GovernedOperationAdapter,
  GovernanceExecutionOutcome,
  GovernanceExecutionRequest,
} from '../../app/application/admin-governance/adapters/governance-adapter';
import { SessionService } from '../../app/application/auth/session-service';
import { GovernanceError } from '../../app/domain/admin-governance/governance-errors';
import { GovernedOperationType } from '../../app/domain/admin-governance/governance-types';
import { SecurityError } from '../../app/domain/security/security-errors';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const NOW = new Date('2026-07-21T12:00:00.000Z');
const JWT_SECRET = '01234567890123456789012345678901';
const ADMINISTRATOR_OPERATIONS: GovernedOperationType[] = [
  'SYSTEM_ADMIN_GRANT',
  'SYSTEM_ADMIN_REVOKE',
  'SYSTEM_ADMIN_ACCOUNT_DISABLE',
  'SUPER_ADMIN_GRANT',
  'SUPER_ADMIN_REVOKE',
  'SUPER_ADMIN_ACCOUNT_DISABLE',
  'ADMIN_MFA_RESET' as GovernedOperationType,
];

let prisma: PrismaClient;
let requesterUserId: string;
let reviewerUserId: string;

function createAdapter(): AdministratorAccountAdapter {
  return new AdministratorAccountAdapter(() => new Date(NOW));
}

async function createUser(label: string, status = 'ENABLED') {
  return prisma.user.create({
    data: {
      username: `${label}.${randomUUID()}`,
      password: 'unused',
      status,
      credentialVersion: 1,
    },
  });
}

async function createSystemRoles(): Promise<void> {
  await prisma.role.createMany({ data: [
    { id: 'role:system-admin', name: 'System Administrator', code: 'SYSTEM_ADMIN', type: 'SYSTEM' },
    { id: 'role:super-admin', name: 'System Super Administrator', code: 'SYSTEM_SUPER_ADMIN', type: 'SYSTEM' },
  ] });
}

async function grantRole(
  userId: string,
  roleCode: 'SYSTEM_ADMIN' | 'SYSTEM_SUPER_ADMIN',
  input: { validUntil?: Date | null; grantedByUserId?: string } = {},
) {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  return prisma.userRole.create({ data: {
    userId,
    roleId: role.id,
    source: input.validUntil ? 'TEMPORARY' : 'PERMANENT',
    validFrom: new Date(NOW.getTime() - 60_000),
    validUntil: input.validUntil ?? null,
    grantedByUserId: input.grantedByUserId ?? requesterUserId,
  } });
}

function request(
  operationType: GovernedOperationType,
  targetId: string,
  input: Partial<GovernanceExecutionRequest> = {},
): GovernanceExecutionRequest {
  return {
    operationId: `operation-${randomUUID()}`,
    operationType,
    targetType: 'USER',
    targetId,
    expectedTargetVersion: 1,
    payload: operationType.endsWith('_GRANT') ? { validUntil: null } : {},
    requesterUserId,
    reviewerUserId,
    ...input,
  };
}

async function execute(
  adapter: GovernedOperationAdapter,
  input: GovernanceExecutionRequest,
): Promise<GovernanceExecutionOutcome> {
  return prisma.$transaction(tx => adapter.execute(tx, input));
}

function assertGovernanceError(code: string, status: number) {
  return (error: unknown) => error instanceof GovernanceError && error.code === code && error.status === status;
}

test.before(async () => {
  prisma = createTestPrisma();
});

test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  await createSystemRoles();
  requesterUserId = (await createUser('requester')).id;
  reviewerUserId = (await createUser('reviewer')).id;
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

test('supports exactly the seven administrator-account operations and validates strict payloads', async () => {
  const adapter = createAdapter();
  assert.equal(adapter.key, 'administrator-account');
  assert.deepEqual(ADMINISTRATOR_OPERATIONS.map(type => adapter.supports(type)), Array(7).fill(true));
  assert.equal(adapter.supports('MASTER_DATA_STATUS_CORRECTION'), false);
  assert.deepEqual(adapter.validatePayload('SYSTEM_ADMIN_GRANT', { validUntil: null }), { validUntil: null });
  assert.deepEqual(
    adapter.validatePayload('SUPER_ADMIN_GRANT', { validUntil: '2026-07-22T12:00:00.000Z' }),
    { validUntil: '2026-07-22T12:00:00.000Z' },
  );
  assert.deepEqual(adapter.validatePayload('SYSTEM_ADMIN_REVOKE', {}), {});
  assert.deepEqual(adapter.validatePayload('SUPER_ADMIN_ACCOUNT_DISABLE', {}), {});

  for (const invalid of [
    ['SYSTEM_ADMIN_GRANT', {}],
    ['SYSTEM_ADMIN_GRANT', { validUntil: null as string | null, source: 'PERMANENT' }],
    ['SYSTEM_ADMIN_GRANT', { validUntil: '2026-07-20T12:00:00.000Z' }],
    ['SYSTEM_ADMIN_REVOKE', { reason: 'client-controlled' }],
    ['SYSTEM_ADMIN_ACCOUNT_DISABLE', { credentialVersion: 1 }],
  ] as const) {
    assert.throws(
      () => adapter.validatePayload(invalid[0], invalid[1]),
      assertGovernanceError('TARGET_NOT_ELIGIBLE', 422),
    );
  }
  assert.throws(
    () => adapter.validatePayload('MASTER_DATA_STATUS_CORRECTION', {}),
    assertGovernanceError('GOVERNANCE_OPERATION_NOT_ALLOWED', 403),
  );
});

test('resets administrator MFA, recovery codes, credentials, and sessions in one governed transaction', async () => {
  const adapter = createAdapter();
  const target = await createUser('mfa-reset-target');
  await grantRole(target.id, 'SYSTEM_ADMIN');
  const factor = await prisma.mfaFactor.create({ data: {
    userId: target.id,
    encryptedSecret: 'encrypted-value',
    secretIv: 'iv-value',
    secretAuthTag: 'tag-value',
    verifiedAt: NOW,
  } });
  await prisma.mfaRecoveryCode.create({ data: { factorId: factor.id, codeHash: `hash-${randomUUID()}` } });
  const credentials = await new SessionService(
    prisma, new JwtTokenService(JWT_SECRET), undefined, () => new Date(NOW),
  ).create(target.id, 'MFA', {});

  const outcome = await execute(adapter, request('ADMIN_MFA_RESET' as GovernedOperationType, target.id));

  assert.equal(outcome.resultCode, 'ADMIN_MFA_RESET');
  assert.ok((await prisma.mfaFactor.findUniqueOrThrow({ where: { id: factor.id } })).disabledAt);
  assert.equal(await prisma.mfaRecoveryCode.count({ where: { factorId: factor.id, usedAt: { not: null } } }), 1);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).credentialVersion, 2);
  assert.ok((await prisma.authSession.findUniqueOrThrow({ where: { id: credentials.sessionId } })).revokedAt);
  assert.equal(await prisma.operationLog.count({ where: {
    userId: reviewerUserId, action: 'ADMIN_MFA_RESET_GOVERNANCE', targetId: target.id,
  } }), 1);
  assert.doesNotMatch(JSON.stringify(outcome), /encrypted-value|hash-/);
});

test('grants permanent system and super-admin roles once with sanitized snapshots', async () => {
  const adapter = createAdapter();
  const systemTarget = await createUser('system-target');
  const superTarget = await createUser('super-target');

  const systemOutcome = await execute(adapter, request('SYSTEM_ADMIN_GRANT', systemTarget.id));
  const superOutcome = await execute(adapter, request('SUPER_ADMIN_GRANT', superTarget.id));

  assert.equal(systemOutcome.resultCode, 'SYSTEM_ADMIN_GRANTED');
  assert.equal(superOutcome.resultCode, 'SUPER_ADMIN_GRANTED');
  const grants = await prisma.userRole.findMany({ orderBy: { createdAt: 'asc' }, include: { role: true } });
  assert.deepEqual(grants.map(grant => grant.role.code), ['SYSTEM_ADMIN', 'SYSTEM_SUPER_ADMIN']);
  assert.ok(grants.every(grant => grant.source === 'PERMANENT' && grant.validUntil === null));
  assert.ok(grants.every(grant => grant.grantedByUserId === reviewerUserId));
  assert.ok(grants.every(grant => /^Governance operation operation-/.test(grant.reason ?? '')));
  const snapshots = JSON.stringify([systemOutcome, superOutcome]);
  assert.equal(/password|credentialVersion|token|secret/i.test(snapshots), false);
  assert.equal(snapshots.includes('ACTIVE'), true);

  await assert.rejects(
    () => execute(adapter, request('SYSTEM_ADMIN_GRANT', systemTarget.id)),
    assertGovernanceError('TARGET_NOT_ELIGIBLE', 422),
  );
  assert.equal(await prisma.userRole.count({ where: { userId: systemTarget.id } }), 1);
});

test('creates a bounded temporary grant and rejects disabled users or roles', async () => {
  const adapter = createAdapter();
  const temporaryTarget = await createUser('temporary-target');
  const validUntil = '2026-07-22T12:00:00.000Z';
  await execute(adapter, request('SYSTEM_ADMIN_GRANT', temporaryTarget.id, { payload: { validUntil } }));
  const temporary = await prisma.userRole.findFirstOrThrow({ where: { userId: temporaryTarget.id } });
  assert.equal(temporary.source, 'TEMPORARY');
  assert.equal(temporary.validFrom.toISOString(), NOW.toISOString());
  assert.equal(temporary.validUntil?.toISOString(), validUntil);

  const disabledTarget = await createUser('disabled-target', 'DISABLED');
  await assert.rejects(
    () => execute(adapter, request('SYSTEM_ADMIN_GRANT', disabledTarget.id)),
    assertGovernanceError('TARGET_NOT_ELIGIBLE', 422),
  );
  await prisma.role.update({ where: { code: 'SYSTEM_ADMIN' }, data: { status: 'DISABLED' } });
  const enabledTarget = await createUser('enabled-target');
  await assert.rejects(
    () => execute(adapter, request('SYSTEM_ADMIN_GRANT', enabledTarget.id)),
    assertGovernanceError('TARGET_NOT_ELIGIBLE', 422),
  );
});

test('revokes system-admin history without deletion and increments the grant version', async () => {
  const adapter = createAdapter();
  const target = await createUser('revoke-system-target');
  const original = await grantRole(target.id, 'SYSTEM_ADMIN');
  const outcome = await execute(adapter, request('SYSTEM_ADMIN_REVOKE', target.id));

  assert.equal(outcome.resultCode, 'SYSTEM_ADMIN_REVOKED');
  const revoked = await prisma.userRole.findUniqueOrThrow({ where: { id: original.id } });
  assert.ok(revoked.revokedAt);
  assert.equal(revoked.revokedByUserId, reviewerUserId);
  assert.match(revoked.revokeReason ?? '', /^Governance operation /);
  assert.equal(revoked.version, 2);
  assert.equal(await prisma.userRole.count({ where: { userId: target.id } }), 1);
  assert.equal(JSON.stringify(outcome.beforeSnapshot).includes('ACTIVE'), true);
  assert.equal(JSON.stringify(outcome.afterSnapshot).includes('REVOKED'), true);
});

test('disables a system administrator and invalidates existing access and refresh tokens', async () => {
  const adapter = createAdapter();
  const target = await createUser('disable-system-target');
  await grantRole(target.id, 'SYSTEM_ADMIN');
  const tokens = new JwtTokenService(JWT_SECRET);
  const sessions = new SessionService(prisma, tokens, undefined, () => new Date(NOW));
  const credentials = await sessions.create(target.id, 'PASSWORD', {});
  await prisma.user.update({
    where: { id: target.id },
    data: { failedLoginCount: 4, lockedUntil: new Date('2026-07-21T13:00:00.000Z') },
  });

  const outcome = await execute(adapter, request('SYSTEM_ADMIN_ACCOUNT_DISABLE', target.id));
  assert.equal(outcome.resultCode, 'SYSTEM_ADMIN_ACCOUNT_DISABLED');
  const disabled = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
  assert.equal(disabled.status, 'DISABLED');
  assert.equal(disabled.credentialVersion, 2);
  assert.equal(disabled.failedLoginCount, 0);
  assert.equal(disabled.lockedUntil, null);
  await assert.rejects(
    () => sessions.authenticateAccess(credentials.accessToken),
    (error: unknown) => error instanceof SecurityError && error.code === 'SESSION_REVOKED',
  );
  await assert.rejects(
    () => sessions.rotateRefresh(credentials.refreshToken, {}),
    (error: unknown) => error instanceof SecurityError && error.code === 'SESSION_REVOKED',
  );
  assert.deepEqual(outcome.beforeSnapshot, {
    userId: target.id, username: target.username, status: 'ENABLED', roleCode: 'SYSTEM_ADMIN', roleGrantState: 'ACTIVE',
  });
  assert.deepEqual(outcome.afterSnapshot, {
    userId: target.id, username: target.username, status: 'DISABLED', roleCode: 'SYSTEM_ADMIN', roleGrantState: 'INACTIVE',
  });
});

test('rejects stale target versions and reviewer-target conflicts before mutation', async () => {
  const adapter = createAdapter();
  const target = await createUser('conflict-target');
  await grantRole(target.id, 'SYSTEM_ADMIN');

  await assert.rejects(
    () => execute(adapter, request('SYSTEM_ADMIN_ACCOUNT_DISABLE', target.id, { expectedTargetVersion: 2 })),
    assertGovernanceError('STALE_TARGET_VERSION', 409),
  );
  await assert.rejects(
    () => execute(adapter, request('SYSTEM_ADMIN_REVOKE', reviewerUserId)),
    assertGovernanceError('GOVERNANCE_REVIEW_TARGET_CONFLICT', 403),
  );
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).status, 'ENABLED');
});

test('protects the last effective super administrator from revoke and disable', async () => {
  const adapter = createAdapter();
  const target = await createUser('last-super');
  const grant = await grantRole(target.id, 'SYSTEM_SUPER_ADMIN');

  await assert.rejects(
    () => execute(adapter, request('SUPER_ADMIN_REVOKE', target.id)),
    assertGovernanceError('LAST_SUPER_ADMIN_PROTECTED', 409),
  );
  await assert.rejects(
    () => execute(adapter, request('SUPER_ADMIN_ACCOUNT_DISABLE', target.id)),
    assertGovernanceError('LAST_SUPER_ADMIN_PROTECTED', 409),
  );
  assert.equal((await prisma.userRole.findUniqueOrThrow({ where: { id: grant.id } })).revokedAt, null);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).status, 'ENABLED');
});

test('does not count a currently locked account as a surviving super administrator', async () => {
  const adapter = createAdapter();
  const target = await createUser('effective-super-target');
  const lockedSurvivor = await createUser('locked-super-survivor');
  const targetGrant = await grantRole(target.id, 'SYSTEM_SUPER_ADMIN');
  await grantRole(lockedSurvivor.id, 'SYSTEM_SUPER_ADMIN');
  await prisma.user.update({
    where: { id: lockedSurvivor.id },
    data: { lockedUntil: new Date('2026-07-21T13:00:00.000Z') },
  });

  await assert.rejects(
    () => execute(adapter, request('SUPER_ADMIN_REVOKE', target.id)),
    assertGovernanceError('LAST_SUPER_ADMIN_PROTECTED', 409),
  );
  assert.equal((await prisma.userRole.findUniqueOrThrow({ where: { id: targetGrant.id } })).revokedAt, null);
});

test('allows super-admin revoke and disable while one effective super administrator remains', async () => {
  const adapter = createAdapter();
  const revokeTarget = await createUser('super-revoke-target');
  const disableTarget = await createUser('super-disable-target');
  const survivor = await createUser('super-survivor');
  await grantRole(revokeTarget.id, 'SYSTEM_SUPER_ADMIN');
  await grantRole(disableTarget.id, 'SYSTEM_SUPER_ADMIN');
  await grantRole(survivor.id, 'SYSTEM_SUPER_ADMIN');

  const revoked = await execute(adapter, request('SUPER_ADMIN_REVOKE', revokeTarget.id));
  const disabled = await execute(adapter, request('SUPER_ADMIN_ACCOUNT_DISABLE', disableTarget.id));
  assert.equal(revoked.resultCode, 'SUPER_ADMIN_REVOKED');
  assert.equal(disabled.resultCode, 'SUPER_ADMIN_ACCOUNT_DISABLED');
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: disableTarget.id } })).status, 'DISABLED');
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: survivor.id } })).status, 'ENABLED');
});

test('outer transaction failure rolls back grants, revocations, and account changes', async () => {
  const adapter = createAdapter();
  const grantTarget = await createUser('rollback-grant');
  const revokeTarget = await createUser('rollback-revoke');
  const disableTarget = await createUser('rollback-disable');
  const revokeGrant = await grantRole(revokeTarget.id, 'SYSTEM_ADMIN');
  await grantRole(disableTarget.id, 'SYSTEM_ADMIN');

  for (const input of [
    request('SYSTEM_ADMIN_GRANT', grantTarget.id),
    request('SYSTEM_ADMIN_REVOKE', revokeTarget.id),
    request('SYSTEM_ADMIN_ACCOUNT_DISABLE', disableTarget.id),
  ]) {
    await assert.rejects(() => prisma.$transaction(async tx => {
      await adapter.execute(tx, input);
      throw new Error('injected transaction failure');
    }), /injected transaction failure/);
  }

  assert.equal(await prisma.userRole.count({ where: { userId: grantTarget.id } }), 0);
  assert.equal((await prisma.userRole.findUniqueOrThrow({ where: { id: revokeGrant.id } })).revokedAt, null);
  const disableAfter = await prisma.user.findUniqueOrThrow({ where: { id: disableTarget.id } });
  assert.equal(disableAfter.status, 'ENABLED');
  assert.equal(disableAfter.credentialVersion, 1);
});
