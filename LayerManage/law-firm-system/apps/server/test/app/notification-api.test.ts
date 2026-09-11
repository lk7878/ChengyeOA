import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';

import { SessionService } from '../../app/application/auth/session-service';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

process.env.EGG_TYPESCRIPT = 'true';
const app = mm.app();
const jwtSecret = '01234567890123456789012345678901';
let prisma: PrismaClient;
let firstUserId: string;
let secondUserId: string;
let firstToken: string;
let secondToken: string;

function bearer(token: string) { return { Authorization: `Bearer ${token}` }; }

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function createUserAndToken(label: string): Promise<{ userId: string; token: string }> {
  const user = await prisma.user.create({
    data: { username: `${label}.${randomUUID()}`, password: 'unused' },
  });
  const credentials = await new SessionService(prisma, new JwtTokenService(jwtSecret)).create(
    user.id,
    'PASSWORD',
    {},
  );
  return { userId: user.id, token: credentials.accessToken };
}

async function createNotification(userId: string, label: string, isRead = false) {
  const relatedId = randomUUID();
  return prisma.notification.create({
    data: {
      userId,
      type: 'SYSTEM',
      title: `${label} title`,
      content: `${label} content`,
      isRead,
      relatedType: 'ADMIN_OPERATION',
      relatedId,
      routeUrl: `/security/admin-governance?operationId=${relatedId}`,
      deduplicationKey: randomUUID().replaceAll('-', '').padEnd(64, 'a'),
    },
  });
}

test.before(async () => { prisma = createTestPrisma(); await app.ready(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  const first = await createUserAndToken('notification.first');
  const second = await createUserAndToken('notification.second');
  firstUserId = first.userId;
  firstToken = first.token;
  secondUserId = second.userId;
  secondToken = second.token;
});
test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
  await app.close();
  await mm.restore();
});

test('lists only the caller notifications with safe routing fields and no deduplication key', async () => {
  const own = await createNotification(firstUserId, 'own');
  const other = await createNotification(secondUserId, 'other');

  const response = await app.httpRequest()
    .get('/api/v1/notifications')
    .set(bearer(firstToken))
    .expect(200);

  assert.equal(response.body.data.list.length, 1);
  assert.equal(response.body.data.list[0].id, own.id);
  assert.equal(response.body.data.list[0].relatedType, 'ADMIN_OPERATION');
  assert.equal(response.body.data.list[0].relatedId, own.relatedId);
  assert.equal(response.body.data.list[0].routeUrl, own.routeUrl);
  assert.equal('deduplicationKey' in response.body.data.list[0], false);
  assert.equal('userId' in response.body.data.list[0], false);
  assert.doesNotMatch(JSON.stringify(response.body), new RegExp(other.id));
  assert.doesNotMatch(JSON.stringify(response.body), new RegExp(other.deduplicationKey ?? 'never'));
});

test('marks only an owned notification read and keeps the safe response projection', async () => {
  const own = await createNotification(firstUserId, 'own');
  const other = await createNotification(secondUserId, 'other');

  const response = await app.httpRequest()
    .patch(`/api/v1/notifications/${own.id}/read`)
    .set(bearer(firstToken))
    .expect(200);
  assert.equal(response.body.data.id, own.id);
  assert.equal(response.body.data.isRead, true);
  assert.equal(response.body.data.routeUrl, own.routeUrl);
  assert.equal('deduplicationKey' in response.body.data, false);
  assert.equal('userId' in response.body.data, false);

  await app.httpRequest()
    .patch(`/api/v1/notifications/${other.id}/read`)
    .set(bearer(firstToken))
    .expect(404);
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: other.id } })).isRead, false);
});

test('read atomically rechecks ownership after a concurrent owner change', async () => {
  const mutatingPrisma = createTestPrisma();
  const ownerChanged = deferred();
  const releaseOwnerChange = deferred();
  let mutation: Promise<void> | undefined;
  let requestOutcome: Promise<{ status: number }> | undefined;
  try {
    const notification = await createNotification(firstUserId, 'ownership-race');
    mutation = mutatingPrisma.$transaction(async tx => {
      await tx.notification.update({
        where: { id: notification.id },
        data: { userId: secondUserId },
      });
      ownerChanged.resolve();
      await releaseOwnerChange.promise;
    });
    await ownerChanged.promise;

    requestOutcome = app.httpRequest()
      .patch(`/api/v1/notifications/${notification.id}/read`)
      .set(bearer(firstToken))
      .then(response => ({ status: response.status }));

    let observedLockWait = false;
    for (let turn = 0; turn < 100 && !observedLockWait; turn += 1) {
      await new Promise<void>(resolve => setImmediate(resolve));
      const [activity] = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query ILIKE '%notification%'
        ) AS waiting
      `;
      observedLockWait = activity.waiting;
    }

    releaseOwnerChange.resolve();
    await mutation;
    const response = await requestOutcome;
    assert.equal(observedLockWait, true);
    assert.equal(response.status, 404);
    const stored = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    assert.equal(stored.userId, secondUserId);
    assert.equal(stored.isRead, false);
  } finally {
    releaseOwnerChange.resolve();
    await mutation?.catch(() => undefined);
    await requestOutcome?.catch(() => undefined);
    await mutatingPrisma.$disconnect();
  }
});

test('unread count and read-all remain scoped to the authenticated user', async () => {
  await createNotification(firstUserId, 'first-unread');
  await createNotification(firstUserId, 'first-read', true);
  const other = await createNotification(secondUserId, 'other-unread');

  const before = await app.httpRequest()
    .get('/api/v1/notifications/unread-count')
    .set(bearer(firstToken))
    .expect(200);
  assert.equal(before.body.data.count, 1);

  await app.httpRequest()
    .post('/api/v1/notifications/read-all')
    .set(bearer(firstToken))
    .expect(200);
  const after = await app.httpRequest()
    .get('/api/v1/notifications/unread-count')
    .set(bearer(firstToken))
    .expect(200);
  assert.equal(after.body.data.count, 0);
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: other.id } })).isRead, false);

  const second = await app.httpRequest()
    .get('/api/v1/notifications/unread-count')
    .set(bearer(secondToken))
    .expect(200);
  assert.equal(second.body.data.count, 1);
});
