import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';

import { Prisma, PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import supertest from 'supertest';

import { SessionService } from '../../app/application/auth/session-service';
import { EventRuntimeSnapshotReader } from '../../app/application/events/event-runtime-snapshot-reader';
import { createEventServices } from '../../app/application/events/event-services-factory';
import { decodeBase32 } from '../../app/domain/security/base32';
import { MfaSecretCrypto } from '../../app/domain/security/mfa-factor-crypto';
import { hashOpaqueToken } from '../../app/domain/security/opaque-token';
import { BcryptPasswordHasher } from '../../app/domain/security/password-hasher';
import { digestStepUpTarget, StepUpPurpose } from '../../app/domain/security/step-up-target';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { TotpService } from '../../app/domain/security/totp-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

process.env.EGG_TYPESCRIPT = 'true';
const app = mm.app();
const jwtSecret = '01234567890123456789012345678901';
const mfaKey = Buffer.from('0123456789abcdef0123456789abcdef');
const browserPassword = 'Correct-Horse-92!';
const EVENT_CONFIG = Object.freeze({
  enabled: false,
  pollMs: 1_000,
  batchSize: 25,
  leaseSeconds: 60,
  shutdownSeconds: 30,
});

interface TestSession {
  id: string;
  userId: string;
  token: string;
  csrfToken: string;
  secret: string;
}

let prisma: PrismaClient;
let superSession: TestSession;
let systemSession: TestSession;
let ordinaryToken: string;

function bearer(token: string) { return { Authorization: `Bearer ${token}` }; }

async function createAdministrator(code: 'SYSTEM_ADMIN' | 'SYSTEM_SUPER_ADMIN'): Promise<TestSession> {
  const user = await prisma.user.create({ data: {
    username: `${code.toLowerCase()}.${randomUUID()}`, password: 'unused',
  } });
  const role = await prisma.role.create({ data: {
    code,
    name: code,
    type: 'SYSTEM',
  } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const secret = new TotpService().generateSecret();
  const encrypted = new MfaSecretCrypto(new Map([[1, mfaKey]])).encrypt(secret);
  await prisma.mfaFactor.create({ data: {
    userId: user.id,
    encryptedSecret: encrypted.ciphertext,
    secretIv: encrypted.iv,
    secretAuthTag: encrypted.authTag,
    keyVersion: encrypted.keyVersion,
    verifiedAt: new Date(),
  } });
  const credentials = await new SessionService(prisma, new JwtTokenService(jwtSecret)).create(user.id, 'MFA', {});
  return {
    id: credentials.sessionId,
    userId: user.id,
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

async function issueThroughGenericEndpoint(
  session: TestSession,
  deliveryId: string,
  expectedVersion: number,
): Promise<string> {
  const response = await app.httpRequest().post('/api/v1/auth/step-up')
    .set(bearer(session.token))
    .set('Origin', 'http://localhost:3000')
    .set('X-CSRF-Token', session.csrfToken)
    .set('Cookie', `chengye_csrf=${session.csrfToken}`)
    .send({
      purpose: 'EVENT_DELIVERY_RETRY',
      target: { deliveryId, expectedVersion },
      code: totpCode(session.secret),
    })
    .expect(200);
  return response.body.data.stepUpToken;
}

async function createGrant(input: {
  purpose?: StepUpPurpose;
  deliveryId: string;
  expectedVersion: number;
  expiresAt?: Date;
}): Promise<string> {
  const purpose = input.purpose ?? 'EVENT_DELIVERY_RETRY';
  const target = purpose === 'EVENT_DELIVERY_RETRY'
    ? { deliveryId: input.deliveryId, expectedVersion: input.expectedVersion }
    : { sessionId: input.deliveryId };
  const token = `step-up-${randomUUID()}`;
  await prisma.stepUpGrant.create({ data: {
    sessionId: superSession.id,
    userId: superSession.userId,
    purpose,
    targetDigest: digestStepUpTarget(purpose, target),
    tokenHash: hashOpaqueToken(token),
    expiresAt: input.expiresAt ?? new Date(Date.now() + 300_000),
  } });
  return token;
}

async function createManualDelivery() {
  const operationId = randomUUID();
  const requesterUserId = randomUUID();
  const event = await prisma.eventLog.create({ data: {
    eventType: 'admin.operation.reviewed',
    eventVersion: 1,
    sourceModule: 'ADMIN_GOVERNANCE',
    objectType: 'ADMIN_OPERATION',
    objectId: operationId,
    orderingKey: 'b'.repeat(64),
    payload: {
      operationId,
      operationType: 'MASTER_DATA_STATUS_CORRECTION',
      riskLevel: 'HIGH',
      decision: 'APPROVE',
      status: 'APPROVED',
      requesterUserId,
      routeUrl: `/security/admin-governance?operationId=${operationId}`,
    },
    traceId: `trace-${randomUUID()}`,
    occurredAt: new Date(),
  } });
  const delivery = await prisma.eventDelivery.create({ data: {
    eventId: event.id,
    subscriptionId: 'subscription:admin-operation-reviewed-notification-v1',
    handlerCode: 'ADMIN_OPERATION_REVIEWED_NOTIFICATION',
    orderingKey: event.orderingKey,
    status: 'MANUAL',
    attemptCount: 5,
    version: 7,
    lastErrorCode: 'EVENT_HANDLER_UNKNOWN',
    lastErrorReference: 'safe-reference',
    startedAt: new Date(),
  } });
  await prisma.eventHandlerLog.create({ data: {
    deliveryId: delivery.id,
    attemptNumber: 1,
    workerId: 'private-worker-id',
    outcome: 'MANUAL_REQUIRED',
    errorCode: 'EVENT_HANDLER_UNKNOWN',
    errorReference: 'safe-handler-reference',
    durationMs: 1,
    startedAt: new Date(),
    completedAt: new Date(),
  } });
  return delivery;
}

function csrf(session: TestSession) {
  return {
    Origin: 'http://localhost:3000',
    'X-CSRF-Token': session.csrfToken,
    Cookie: `chengye_csrf=${session.csrfToken}`,
  };
}

function captureDiagnosticChannels(): { readonly output: string[]; restore(): void } {
  const output: string[] = [];
  const capture = (...values: unknown[]) => {
    output.push(values.map(diagnosticText).join(' '));
  };
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  console.error = (...values: unknown[]) => { capture(...values); };
  console.warn = (...values: unknown[]) => { capture(...values); };
  process.stdout.write = ((chunk: unknown) => {
    capture(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    capture(chunk);
    return true;
  }) as typeof process.stderr.write;

  const loggerRestores: Array<() => void> = [];
  const seenLoggers = new Set<object>();
  for (const logger of [app.logger, app.coreLogger, ...app.loggers.values()]) {
    if (seenLoggers.has(logger)) continue;
    seenLoggers.add(logger);
    const originalError = logger.error;
    logger.error = ((...values: unknown[]) => { capture(...values); }) as typeof logger.error;
    loggerRestores.push(() => { logger.error = originalError; });
  }

  return {
    output,
    restore() {
      for (const restoreLogger of loggerRestores.reverse()) restoreLogger();
      process.stderr.write = originalStderrWrite;
      process.stdout.write = originalStdoutWrite;
      console.warn = originalConsoleWarn;
      console.error = originalConsoleError;
    },
  };
}

function diagnosticText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8');
  if (value instanceof Error) return `${value.name} ${value.message} ${value.stack ?? ''}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

test.before(async () => { prisma = createTestPrisma(); await app.ready(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  const disabledAt = new Date();
  await prisma.eventWorkerRuntimeStatus.upsert({
    where: { slot: 'primary' },
    create: {
      slot: 'primary',
      configuredEnabled: false,
      state: 'DISABLED',
      processStartedAt: disabledAt,
    },
    update: {
      configuredEnabled: false,
      state: 'DISABLED',
      processStartedAt: disabledAt,
      lastHeartbeatAt: null,
      lastSuccessfulTickAt: null,
      lastStoppedAt: null,
      version: 1,
    },
  });
  systemSession = await createAdministrator('SYSTEM_ADMIN');
  superSession = await createAdministrator('SYSTEM_SUPER_ADMIN');
  const ordinary = await prisma.user.create({ data: {
    username: `ordinary.${randomUUID()}`, password: 'unused',
  } });
  ordinaryToken = (await new SessionService(prisma, new JwtTokenService(jwtSecret)).create(
    ordinary.id, 'PASSWORD', {},
  )).accessToken;
});
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); await app.close(); await mm.restore(); });

test('protects all query routes and exposes only safe operations views', async () => {
  const delivery = await createManualDelivery();
  await app.httpRequest().get('/api/v1/event-operations/summary').expect(401);
  await app.httpRequest().get('/api/v1/event-operations/summary').set(bearer(ordinaryToken)).expect(403);

  const summary = await app.httpRequest().get('/api/v1/event-operations/summary')
    .set(bearer(systemSession.token));
  assert.equal(summary.status, 200, JSON.stringify(summary.body));
  assert.equal(summary.body.data.observability.status, 'BLOCKED');
  assert.equal(summary.body.data.observability.mode, 'preflight');
  const list = await app.httpRequest().get('/api/v1/event-operations/deliveries?page=1&pageSize=200')
    .set(bearer(systemSession.token)).expect(200);
  assert.equal(list.body.data.list[0].id, delivery.id);
  const detail = await app.httpRequest().get(`/api/v1/event-operations/deliveries/${delivery.id}`)
    .set(bearer(systemSession.token)).expect(200);
  assert.deepEqual(Object.keys(detail.body.data.payloadSummary).sort(), [
    'operationId', 'operationType', 'riskLevel', 'status',
  ]);
  const subscriptions = await app.httpRequest().get('/api/v1/event-operations/subscriptions')
    .set(bearer(systemSession.token)).expect(200);
  const serialized = JSON.stringify({
    summary: summary.body,
    list: list.body,
    detail: detail.body,
    subscriptions: subscriptions.body,
  });
  assert.doesNotMatch(serialized, /lockedBy|lockedUntil|workerId|private-worker-id|filterJson/i);

  await app.httpRequest().get('/api/v1/event-operations/deliveries?pageSize=201')
    .set(bearer(systemSession.token)).expect(400);
  await app.httpRequest().get('/api/v1/event-operations/deliveries?sortBy=lockedBy')
    .set(bearer(systemSession.token)).expect(400);
  await app.httpRequest().get('/api/v1/event-operations/deliveries?unknown=value')
    .set(bearer(systemSession.token)).expect(400);
  await app.httpRequest().get('/api/v1/event-operations/deliveries?from=2026-02-30T12:00:00Z')
    .set(bearer(systemSession.token)).expect(400);
  await app.httpRequest().get('/api/v1/event-operations/deliveries?from=2026-01-01T24:00:00Z')
    .set(bearer(systemSession.token)).expect(400);
  await app.httpRequest().get('/api/v1/event-operations/deliveries?from=2028-02-29T12:00:00.123Z&to=2028-02-29T12:00:00.123Z')
    .set(bearer(systemSession.token)).expect(200);
});

test('returns an authorized READY observability summary as an additive safe field', async () => {
  const response = await app.httpRequest().get('/api/v1/event-operations/summary')
    .set(bearer(systemSession.token)).expect(200);

  assert.equal(response.body.data.observability.status, 'READY');
  assert.equal(response.body.data.observability.mode, 'preflight');
  assert.deepEqual(response.body.data.observability.alerts, []);
  assert.equal(typeof response.body.data.observability.evaluatedAt, 'string');
  assert.deepEqual(Object.keys(response.body.data.observability.metrics).sort(), [
    'dueBacklogCount',
    'expiredProcessingCount',
    'lastHeartbeatAt',
    'lastSuccessfulTickAt',
    'leaseLost15mCount',
    'manualCount',
    'oldestDueBacklogSeconds',
    'oldestUndispatchedSeconds',
    'processingCount',
    'staleExpiredProcessingCount',
    'undispatchedCount',
  ]);
  assert.ok(response.body.data.counts);
  assert.ok(response.body.data.recent24Hours);
  assert.ok(response.body.data.worker);
  assert.doesNotMatch(JSON.stringify(response.body.data.observability), /payload|workerId|lockedBy|lockedUntil|stack|database.*url/i);
});

test('maps every Prisma observability failure to the exact safe 503 response without diagnostic output', async () => {
  const unsafeMarkers = [
    `unsafe-initialization-${randomUUID()}-url-stack-payload-workerId`,
    `unsafe-known-${randomUUID()}-url-stack-payload-workerId`,
    `unsafe-unknown-${randomUUID()}-url-stack-payload-workerId`,
    `unsafe-rust-panic-${randomUUID()}-url-stack-payload-workerId`,
    `unsafe-validation-${randomUUID()}-url-stack-payload-workerId`,
  ];
  const failures = [
    new Prisma.PrismaClientInitializationError(unsafeMarkers[0], 'test-client'),
    new Prisma.PrismaClientKnownRequestError(unsafeMarkers[1], { code: 'P2002', clientVersion: 'test-client' }),
    new Prisma.PrismaClientUnknownRequestError(unsafeMarkers[2], { clientVersion: 'test-client' }),
    new Prisma.PrismaClientRustPanicError(unsafeMarkers[3], 'test-client'),
    new Prisma.PrismaClientValidationError(unsafeMarkers[4], { clientVersion: 'test-client' }),
  ];
  const originalRead = EventRuntimeSnapshotReader.prototype.read;
  const diagnostics = captureDiagnosticChannels();
  const responseBodies: unknown[] = [];
  try {
    for (const failure of failures) {
      EventRuntimeSnapshotReader.prototype.read = async () => { throw failure; };
      const response = await app.httpRequest().get('/api/v1/event-operations/summary')
        .set(bearer(systemSession.token)).expect(503);
      responseBodies.push(response.body);
      const { timestamp, ...stableBody } = response.body;
      assert.equal(typeof timestamp, 'number');
      assert.deepEqual(stableBody, {
        code: 503,
        message: 'EVENT_OBSERVABILITY_UNAVAILABLE',
        errors: null,
      });
    }
  } finally {
    diagnostics.restore();
    EventRuntimeSnapshotReader.prototype.read = originalRead;
  }

  const serializedResponses = JSON.stringify(responseBodies);
  const serializedDiagnostics = diagnostics.output.join('\n');
  for (const unsafeMarker of unsafeMarkers) {
    assert.equal(serializedResponses.includes(unsafeMarker), false);
    assert.equal(serializedDiagnostics.includes(unsafeMarker), false);
  }
  assert.doesNotMatch(serializedResponses, /Prisma|PostgreSQL|payload|workerId|lockedBy|database-url|stack/i);
  assert.doesNotMatch(serializedDiagnostics, /unsafe-[^\s]*-(?:url|stack|payload|workerId)/i);
});

test('keeps anonymous and unauthorized summary denials ahead of a failing observability reader', async () => {
  const originalRead = EventRuntimeSnapshotReader.prototype.read;
  let readerCalls = 0;
  EventRuntimeSnapshotReader.prototype.read = async () => {
    readerCalls += 1;
    throw new Prisma.PrismaClientInitializationError('unreachable-reader-marker', 'test-client');
  };
  try {
    await app.httpRequest().get('/api/v1/event-operations/summary').expect(401);
    await app.httpRequest().get('/api/v1/event-operations/summary')
      .set(bearer(ordinaryToken)).expect(403);
  } finally {
    EventRuntimeSnapshotReader.prototype.read = originalRead;
  }
  assert.equal(readerCalls, 0);
});

test('reports persistent dispatcher faults through the summary API without exposing event payloads', async () => {
  const events = createEventServices(prisma, EVENT_CONFIG);
  await prisma.eventSubscription.update({
    where: { code: 'admin-operation-reviewed-notification-v1' },
    data: { handlerCode: 'UNKNOWN_FOR_API_HEALTH' },
  });
  const operationId = randomUUID();
  await prisma.$transaction(tx => events.outboxWriter.append(tx, {
    eventType: 'admin.operation.reviewed',
    eventVersion: 1,
    objectType: 'ADMIN_OPERATION',
    objectId: operationId,
    operatorUserId: null,
    organizationId: null,
    branchId: null,
    teamId: null,
    payload: {
      operationId,
      operationType: 'SYSTEM_ADMIN_GRANT',
      riskLevel: 'HIGH',
      decision: 'REJECT',
      status: 'REJECTED',
      requesterUserId: systemSession.userId,
      routeUrl: `/security/admin-governance?operationId=${operationId}`,
    },
    traceId: randomUUID(),
    occurredAt: new Date(),
  }));
  await events.dispatcher.dispatchBatch(25);
  const manual = await prisma.eventDelivery.findFirstOrThrow({ where: { status: 'MANUAL' } });

  const response = await app.httpRequest().get('/api/v1/event-operations/summary')
    .set(bearer(systemSession.token)).expect(200);
  assert.equal(response.body.data.worker.status, 'degraded');
  assert.equal(response.body.data.worker.unresolvedDispatcherFaultCount, 1);
  assert.equal(response.body.data.worker.unknownHandlerCount, 1);
  assert.equal(response.body.data.worker.invalidFilterCount, 0);
  assert.equal(response.body.data.worker.invalidEnvelopeCount, 0);
  assert.equal(response.body.data.worker.lastErrorCode, 'HANDLER_NOT_REGISTERED');
  assert.equal(response.body.data.worker.lastErrorReference, manual.lastErrorReference);
  assert.doesNotMatch(JSON.stringify(response.body.data.worker), /UNKNOWN_FOR_API_HEALTH|operationType|routeUrl|payload/i);

  await prisma.eventLog.update({
    where: { id: manual.eventId },
    data: { eventType: 'unknown.event.for.api.quarantine', dispatchedAt: null },
  });
  await prisma.eventDelivery.delete({ where: { id: manual.id } });
  const quarantineDispatch = await events.dispatcher.dispatchBatch(25);
  assert.equal(quarantineDispatch.manualCount, 1);
  const quarantine = await prisma.eventDelivery.findFirstOrThrow({
    where: { handlerCode: 'EVENT_DISPATCH_QUARANTINE', status: 'MANUAL' },
  });
  const retryToken = await createGrant({ deliveryId: quarantine.id, expectedVersion: quarantine.version });
  const quarantinedRetry = await app.httpRequest().post(`/api/v1/event-operations/deliveries/${quarantine.id}/retry`)
    .set(bearer(superSession.token))
    .set('X-Step-Up-Token', retryToken)
    .send({ expectedVersion: quarantine.version })
    .expect(409);
  assert.equal(quarantinedRetry.body.message, 'EVENT_DELIVERY_QUARANTINED');
  assert.equal((await prisma.eventDelivery.findUniqueOrThrow({ where: { id: quarantine.id } })).status, 'MANUAL');
  assert.equal((await prisma.eventLog.findUniqueOrThrow({ where: { id: quarantine.eventId } })).dispatchedAt, null);
  assert.equal((await prisma.stepUpGrant.findUniqueOrThrow({ where: { tokenHash: hashOpaqueToken(retryToken) } })).consumedAt, null);
  const stillDegraded = await app.httpRequest().get('/api/v1/event-operations/summary')
    .set(bearer(systemSession.token)).expect(200);
  assert.equal(stillDegraded.body.data.worker.status, 'degraded');
  assert.equal(stillDegraded.body.data.worker.invalidEnvelopeCount, 1);
});

test('requires effective super-admin and bearer authority without a Step-Up grant', async () => {
  const delivery = await createManualDelivery();

  await app.httpRequest().post(`/api/v1/event-operations/deliveries/${delivery.id}/retry`)
    .set(bearer(superSession.token))
    .send({ expectedVersion: delivery.version })
    .expect(200);

  const browserUser = await prisma.user.create({ data: {
    username: `browser.${randomUUID()}`,
    password: await new BcryptPasswordHasher(4).hash(browserPassword),
  } });
  const browser = supertest.agent(app.callback());
  const login = await browser.post('/api/v1/auth/login')
    .send({ username: browserUser.username, password: browserPassword })
    .expect(200);
  await browser.post('/api/v1/auth/refresh').expect(403);
  await browser.post('/api/v1/auth/refresh')
    .set('Origin', 'http://localhost:3000')
    .set('X-CSRF-Token', login.body.data.csrfToken)
    .expect(200);
  await browser.post(`/api/v1/event-operations/deliveries/${delivery.id}/retry`)
    .send({ expectedVersion: delivery.version })
    .expect(401);

  const concurrentDelivery = await createManualDelivery();
  await app.httpRequest().post(`/api/v1/event-operations/deliveries/${delivery.id}/retry`)
    .set(bearer(systemSession.token)).set(csrf(systemSession))
    .send({ expectedVersion: delivery.version })
    .expect(403);

  const endpointGrant = await issueThroughGenericEndpoint(
    superSession, concurrentDelivery.id, concurrentDelivery.version,
  );
  const results = await Promise.all([
    app.httpRequest().post(`/api/v1/event-operations/deliveries/${concurrentDelivery.id}/retry`)
      .set(bearer(superSession.token))
      .send({ expectedVersion: concurrentDelivery.version }),
    app.httpRequest().post(`/api/v1/event-operations/deliveries/${concurrentDelivery.id}/retry`)
      .set(bearer(superSession.token))
      .send({ expectedVersion: concurrentDelivery.version }),
  ]);
  assert.deepEqual(results.map(response => response.status).sort(), [200, 409]);
  assert.equal(await prisma.operationLog.count({
    where: { action: 'EVENT_DELIVERY_MANUAL_RETRY', targetId: concurrentDelivery.id },
  }), 1);
  assert.equal((await prisma.stepUpGrant.findUniqueOrThrow({
    where: { tokenHash: hashOpaqueToken(endpointGrant) },
  })).consumedAt, null);
});

test('retry ignores legacy proof headers but still rejects stale versions and duplicate requests', async () => {
  const delivery = await createManualDelivery();
  const url = `/api/v1/event-operations/deliveries/${delivery.id}/retry`;
  await app.httpRequest().post(url).set(bearer(superSession.token))
    .send({ expectedVersion: delivery.version + 1 }).expect(409);
  assert.equal((await prisma.eventDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status, 'MANUAL');
  await app.httpRequest().post(url).set(bearer(superSession.token))
    .set('X-Step-Up-Token', 'obsolete-proof-not-required')
    .send({ expectedVersion: delivery.version }).expect(200);
  await app.httpRequest().post(url).set(bearer(superSession.token))
    .send({ expectedVersion: delivery.version }).expect(409);
  assert.equal(await prisma.operationLog.count({ where: { action: 'EVENT_DELIVERY_MANUAL_RETRY', targetId: delivery.id } }), 1);
});

test('generic Step-Up rejects unknown purposes and malformed targets as stable 400 before TOTP use', async () => {
  const rawMarker = `raw-client-marker-${randomUUID()}`;
  const auditsBefore = await prisma.operationLog.count({ where: { userId: superSession.userId } });
  const malformed = [
    { purpose: rawMarker, target: { deliveryId: randomUUID(), expectedVersion: 7 } },
    { purpose: 'EVENT_DELIVERY_RETRY', target: { expectedVersion: 7 } },
    { purpose: 'EVENT_DELIVERY_RETRY', target: { deliveryId: randomUUID(), expectedVersion: 7, extra: rawMarker } },
    { purpose: 'EVENT_DELIVERY_RETRY', target: { deliveryId: randomUUID(), expectedVersion: 0 } },
    { purpose: 'EVENT_DELIVERY_RETRY', target: { deliveryId: randomUUID(), expectedVersion: 1.5 } },
    { purpose: 'EVENT_DELIVERY_RETRY', target: { deliveryId: '', expectedVersion: 7 } },
    { purpose: 'EVENT_DELIVERY_RETRY', target: { deliveryId: 'd'.repeat(201), expectedVersion: 7 } },
  ];

  for (const input of malformed) {
    const response = await app.httpRequest().post('/api/v1/auth/step-up')
      .set(bearer(superSession.token)).set(csrf(superSession))
      .send({ ...input, code: totpCode(superSession.secret) })
      .expect(400);
    assert.equal(response.body.message, 'AUTHORIZATION_INPUT_INVALID');
    assert.equal(JSON.stringify(response.body).includes(rawMarker), false);
  }
  assert.equal(await prisma.stepUpGrant.count({ where: { userId: superSession.userId } }), 0);
  assert.equal(await prisma.operationLog.count({ where: { userId: superSession.userId } }), auditsBefore);
  assert.equal((await prisma.mfaFactor.findFirstOrThrow({
    where: { userId: superSession.userId },
  })).lastAcceptedCounter, null);

  const deliveryId = randomUUID();
  const valid = await app.httpRequest().post('/api/v1/auth/step-up')
    .set(bearer(superSession.token)).set(csrf(superSession))
    .send({
      purpose: 'EVENT_DELIVERY_RETRY',
      target: { deliveryId, expectedVersion: 7 },
      code: totpCode(superSession.secret),
    })
    .expect(200);
  assert.equal(valid.body.data.expiresIn, 300);
  assert.equal(await prisma.stepUpGrant.count({
    where: { userId: superSession.userId, purpose: 'EVENT_DELIVERY_RETRY' },
  }), 1);
});
