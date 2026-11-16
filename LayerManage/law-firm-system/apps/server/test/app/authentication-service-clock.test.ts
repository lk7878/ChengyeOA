import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import type { AuthChallengeService } from '../../app/application/auth/auth-challenge-service';
import { AuthenticationService } from '../../app/application/auth/authentication-service';
import type { MfaService } from '../../app/application/auth/mfa-service';
import type { SessionCompletion, SessionService } from '../../app/application/auth/session-service';
import { PasswordHasher } from '../../app/domain/security/password-hasher';
import { SecurityError } from '../../app/domain/security/security-errors';

const decisionTime = new Date('2099-01-02T03:04:05.000Z');

interface HarnessOptions {
  passwordMatches: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
  administrator?: boolean;
  localPasswordLogin?: boolean;
  verifiedFactor?: boolean;
  mustChangePassword?: boolean;
}

function createHarness(options: HarnessOptions) {
  let rowLocked = false;
  let clockCalls = 0;
  const updates: Array<{ data: Record<string, unknown> }> = [];
  const logs: Array<{ data: Record<string, unknown> }> = [];
  const user = {
    id: 'user-1',
    username: 'root.admin',
    password: 'stored-password-hash',
    status: 'ENABLED',
    lockedUntil: options.lockedUntil,
    failedLoginCount: options.failedLoginCount,
    credentialVersion: 1,
    mustChangePassword: options.mustChangePassword ?? false,
    userRoles: options.administrator ? [{
      role: { code: 'SYSTEM_SUPER_ADMIN', name: 'Super Admin', status: 'ENABLED', permissions: [] },
      revokedAt: null, validFrom: new Date(0), validUntil: null,
    }] : [],
  };
  const hasher: PasswordHasher = {
    async hash(): Promise<string> {
      throw new Error('hash is not used by login clock tests');
    },
    async compare(): Promise<boolean> {
      return options.passwordMatches;
    },
  };
  const tx = {
    async $queryRaw(): Promise<typeof user[]> {
      rowLocked = true;
      return [user];
    },
    user: {
      async update(input: { data: Record<string, unknown> }) {
        updates.push(input);
        return user;
      },
    },
    loginLog: {
      async create(input: { data: Record<string, unknown> }) {
        logs.push(input);
        return input;
      },
    },
  };
  const prisma = {
    user: {
      async findUnique() {
        return user;
      },
    },
    mfaFactor: {
      async findFirst() {
        return options.verifiedFactor ? { id: 'factor-1' } : null;
      },
    },
    async $transaction<T>(callback: (transaction: typeof tx) => Promise<T>): Promise<T> {
      return callback(tx);
    },
  } as unknown as PrismaClient;
  const clock = () => {
    assert.equal(rowLocked, true, 'clock must be read only after FOR UPDATE returns');
    clockCalls += 1;
    return new Date(decisionTime);
  };
  const sessions = {
    async create(
      userId: string,
      _assuranceLevel: string,
      _metadata: Record<string, unknown>,
      completion?: SessionCompletion,
    ) {
      if (completion) {
        await completion(tx as unknown as Parameters<SessionCompletion>[0], {
          id: 'session-1',
          userId,
        });
      }
      return {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        csrfToken: 'csrf-token',
        expiresIn: 900 as const,
        sessionId: 'session-1',
      };
    },
  } as unknown as SessionService;
  const service = new AuthenticationService(
    prisma,
    hasher,
    { async issue() { return { token: 'challenge-token' }; } } as unknown as AuthChallengeService,
    {} as MfaService,
    sessions,
    undefined,
    clock,
    options.localPasswordLogin,
  );

  return { service, updates, logs, clockCalls: () => clockCalls };
}

async function expectAuthenticationFailure(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof SecurityError && error.code === 'AUTHENTICATION_FAILED',
  );
}

test('fifth failure locks for a full fifteen minutes from the post-lock decision time', async () => {
  const harness = createHarness({ passwordMatches: false, failedLoginCount: 4, lockedUntil: null });

  await expectAuthenticationFailure(harness.service.login('root.admin', 'Wrong-Horse-95!', {}));

  assert.equal(harness.clockCalls(), 1);
  assert.equal(harness.updates.length, 1);
  assert.equal(harness.updates[0].data.failedLoginCount, 5);
  assert.deepEqual(
    harness.updates[0].data.lockedUntil,
    new Date(decisionTime.getTime() + 15 * 60 * 1000),
  );
  assert.equal(harness.logs[0].data.outcome, 'LOCKED');
  assert.equal(harness.logs[0].data.reasonCode, 'INVALID_PASSWORD');
});

test('an active lock is logged without changing its deadline', async () => {
  const lockedUntil = new Date(decisionTime.getTime() + 1);
  const harness = createHarness({ passwordMatches: false, failedLoginCount: 5, lockedUntil });

  await expectAuthenticationFailure(harness.service.login('root.admin', 'Wrong-Horse-95!', {}));

  assert.equal(harness.clockCalls(), 1);
  assert.equal(harness.updates.length, 0);
  assert.equal(harness.logs[0].data.outcome, 'LOCKED');
  assert.equal(harness.logs[0].data.reasonCode, 'ACCOUNT_LOCKED');
  assert.equal(lockedUntil.getTime(), decisionTime.getTime() + 1);
});

test('a lock deadline equal to decision time is expired', async () => {
  const harness = createHarness({
    passwordMatches: false,
    failedLoginCount: 5,
    lockedUntil: new Date(decisionTime),
  });

  await expectAuthenticationFailure(harness.service.login('root.admin', 'Wrong-Horse-95!', {}));

  assert.equal(harness.clockCalls(), 1);
  assert.equal(harness.updates[0].data.failedLoginCount, 6);
  assert.deepEqual(
    harness.updates[0].data.lockedUntil,
    new Date(decisionTime.getTime() + 15 * 60 * 1000),
  );
  assert.equal(harness.logs[0].data.reasonCode, 'INVALID_PASSWORD');
});

test('successful login checks expiry and timestamps the reset after row lock acquisition', async () => {
  const harness = createHarness({
    passwordMatches: true,
    failedLoginCount: 4,
    lockedUntil: new Date(decisionTime),
  });

  const result = await harness.service.login('root.admin', 'Correct-Horse-92', {});

  assert.equal(result.mode, 'AUTHENTICATED');
  assert.equal(harness.clockCalls(), 2);
  assert.equal(harness.updates[0].data.failedLoginCount, 0);
  assert.equal(harness.updates[0].data.lockedUntil, null);
  assert.deepEqual(harness.updates[1].data.lastLoginAt, decisionTime);
  assert.equal(harness.logs[0].data.outcome, 'SUCCESS');
});

test('administrator login is password-only regardless of an existing factor', async () => {
  for (const verifiedFactor of [false, true]) {
    const harness = createHarness({
      passwordMatches: true, failedLoginCount: 0, lockedUntil: null, administrator: true, verifiedFactor,
    });
    const result = await harness.service.login('root.admin', 'Correct-Horse-92', {});
    assert.equal(result.mode, 'AUTHENTICATED');
  }
});

test('legacy local setting has no effect on the password-only login policy', async () => {
  for (const verifiedFactor of [false, true]) {
    const harness = createHarness({
      passwordMatches: true, failedLoginCount: 0, lockedUntil: null,
      administrator: true, verifiedFactor, localPasswordLogin: true,
    });
    assert.equal((await harness.service.login('root.admin', 'Correct-Horse-92', {})).mode, 'AUTHENTICATED');
    if (!verifiedFactor) assert.equal(harness.logs[0].data.outcome, 'SUCCESS');
  }
});

test('local password login still enforces passwords, account locks and forced password changes', async () => {
  const base = { failedLoginCount: 0, administrator: true, localPasswordLogin: true };
  await expectAuthenticationFailure(createHarness({
    ...base, passwordMatches: false, lockedUntil: null,
  }).service.login('root.admin', 'wrong', {}));
  await expectAuthenticationFailure(createHarness({
    ...base, passwordMatches: true, lockedUntil: new Date(decisionTime.getTime() + 1),
  }).service.login('root.admin', 'Correct-Horse-92', {}));
  const result = await createHarness({
    ...base, passwordMatches: true, lockedUntil: null, mustChangePassword: true,
  }).service.login('root.admin', 'Correct-Horse-92', {});
  assert.equal(result.mode, 'PASSWORD_CHANGE_REQUIRED');
});
