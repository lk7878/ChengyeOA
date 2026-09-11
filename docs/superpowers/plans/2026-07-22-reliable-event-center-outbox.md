# Reliable Event Center and Governance Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build SPEC-007 as a PostgreSQL Outbox event center with multi-instance-safe delivery, ordered retry/manual recovery, an administrator operations UI, and the first real `admin.operation.reviewed.v1 → Notification` flow.

**Architecture:** Governance review writes its state, audit, and immutable EventLog in one Prisma transaction. An in-process Egg worker dispatches subscriptions and leases EventDelivery rows with PostgreSQL locks; code-owned handlers perform idempotent writes and record immutable attempt evidence. A protected operations API/Web page exposes safe diagnostics and Step-Up-bound manual retry.

**Tech Stack:** Node.js 22.14.0, npm 10.9.2, TypeScript, Egg 3, Prisma 5.22, PostgreSQL 16, React 19, Ant Design 6, Vitest, node:test, c8.

## Global Constraints

- Work in `D:\2_test\16_ChengyeOA`; application root is `LayerManage/law-firm-system`.
- Design authority: `docs/superpowers/specs/2026-07-22-reliable-event-center-outbox-design.md`.
- Preserve the existing dirty working tree and unrelated user changes.
- Do not execute Git/GitHub writes: no stage, commit, branch, merge, push, PR, reset, checkout, clean, or worktree mutation.
- Use PostgreSQL only; integration tests must target a local database whose decoded name ends in `_test`.
- Use the pinned wrapper `npx.cmd -y -p node@22.14.0` and npm `10.9.2` where npm itself is required.
- Follow TDD: add the failing test, observe the intended failure, implement minimally, then rerun focused and regression tests.
- Event delivery is at-least-once; handler business writes must be idempotent.
- No event or error persistence may contain password, secret, token, Authorization, Cookie, CSRF, TOTP, MFA, recovery code, full governance reason, review comment, or raw stack/message.
- Do not introduce Redis, a broker, a dynamic script engine, or a new runtime dependency.
- Production must fail closed when `EVENT_WORKER_ENABLED` is absent or invalid.
- A `MANUAL` ordered delivery continues blocking later deliveries for the same `handlerCode + orderingKey` until it succeeds.

### Verification environment

```powershell
$env:NODE_ENV='test'
$env:EGG_SERVER_ENV='unittest'
$env:DATABASE_URL_TEST='postgresql://chengye_test:chengye_test_local_only@localhost:55432/chengye_oa_test?schema=public'
$env:DATABASE_URL=$env:DATABASE_URL_TEST
$env:JWT_SECRET='01234567890123456789012345678901'
$env:APP_KEYS='first-32-character-application-key,second-32-character-app-key'
$env:MFA_ENCRYPTION_KEY_V1='MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
$env:EVENT_WORKER_ENABLED='false'
$env:ALLOW_TEST_DB_RESET='true'
```

---

### Task 1: Event contracts, payload safety, filters, and retry policy

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/domain/events/event-types.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/domain/events/event-registry.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/domain/events/subscription-filter.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/domain/events/event-errors.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/domain/events/retry-policy.ts`
- Test: `LayerManage/law-firm-system/apps/server/test/events/event-contracts.test.ts`

**Interfaces:**
- Produces `EventEnvelopeInput`, `AdminOperationReviewedV1`, `RegisteredEvent`, `parseEventPayload`, `parseSubscriptionFilter`, `matchesSubscriptionFilter`, `RetryableEventError`, `PermanentEventError`, and `retryDecision`.
- Later tasks must use these parsers; no task may parse arbitrary event JSON independently.

- [x] **Step 1: Write failing contract and security tests**

```ts
test('accepts the exact reviewed-v1 payload and derives a stable ordering key', () => {
  const parsed = parseEventPayload('admin.operation.reviewed', 1, {
    operationId: '11111111-1111-4111-8111-111111111111',
    operationType: 'SYSTEM_ADMIN_GRANT', riskLevel: 'HIGH', decision: 'APPROVE',
    status: 'APPROVED', requesterUserId: '22222222-2222-4222-8222-222222222222',
    routeUrl: '/security/admin-governance?operationId=11111111-1111-4111-8111-111111111111',
  });
  assert.equal(parsed.sourceModule, 'ADMIN_GOVERNANCE');
  assert.match(parsed.orderingKey, /^[a-f0-9]{64}$/);
});

for (const forbidden of ['password', 'token', 'authorization', 'cookie', 'totp', 'mfa', 'reason', 'comment']) {
  test(`rejects recursively forbidden field ${forbidden}`, () => {
    assert.throws(() => parseEventPayload('admin.operation.reviewed', 1, validPayload({ nested: { [forbidden]: 'x' } })));
  });
}

test('uses the fixed retry schedule and sends attempt five to MANUAL', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(attempt => retryDecision(attempt)), [
    { kind: 'RETRY_WAIT', delayMs: 15_000 },
    { kind: 'RETRY_WAIT', delayMs: 300_000 },
    { kind: 'RETRY_WAIT', delayMs: 3_600_000 },
    { kind: 'RETRY_WAIT', delayMs: 21_600_000 },
    { kind: 'MANUAL' },
  ]);
});
```

- [x] **Step 2: Run the focused test and observe missing-module failures**

Run from `apps/server`:

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test --test-force-exit test/events/event-contracts.test.ts
```

Expected: FAIL because the event domain modules do not exist.

- [x] **Step 3: Implement exact event and filter types**

```ts
export interface AdminOperationReviewedV1 {
  operationId: string;
  operationType: GovernedOperationType;
  riskLevel: GovernanceRisk;
  decision: 'APPROVE' | 'REJECT' | 'CONFIRM' | 'FLAG';
  status: GovernanceStatus;
  requesterUserId: string;
  routeUrl: string;
}

export interface SubscriptionFilter {
  all: Array<{ field: string; operator: 'EQ' | 'IN'; values: Array<string | number | boolean> }>;
}

export type RetryDecision =
  | { kind: 'RETRY_WAIT'; delayMs: number }
  | { kind: 'MANUAL' };
```

Implement a registry entry for `admin.operation.reviewed` version `1`, exact-key validation, UUID validation, server-owned route validation, recursive plain-JSON validation, a 16 KiB serialized limit, the forbidden-name set from the Spec, filter limits (10 clauses, 20 values each, 100-character strings), and SHA-256 `orderingKey`.

- [x] **Step 4: Run focused tests and the existing canonical JSON/security tests**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test --test-force-exit test/events/event-contracts.test.ts test/admin-governance/governance-kernel.test.ts test/config/env.test.ts
```

Expected: PASS.

- [x] **Step 5: Record local checkpoint without Git**

Mark Task 1 complete in this plan only after the command passes. Do not stage or commit.

### Task 2: Additive schema, migration, permissions, and Worker configuration

**Files:**
- Modify: `LayerManage/law-firm-system/apps/server/prisma/schema.prisma`
- Create: `LayerManage/law-firm-system/apps/server/prisma/migrations/20260722120000_reliable_event_center/migration.sql`
- Modify: `LayerManage/law-firm-system/apps/server/app/domain/authorization/authorization-types.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/domain/authorization/permission-catalog.ts`
- Modify: `LayerManage/law-firm-system/apps/server/config/env.ts`
- Modify: `LayerManage/law-firm-system/apps/server/config/config.default.ts`
- Test: `LayerManage/law-firm-system/apps/server/test/db/spec-007-event-center-migration-contract.test.ts`
- Test: `LayerManage/law-firm-system/apps/server/test/config/event-worker-config.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/db/schema-contract.test.ts`

**Interfaces:**
- Produces Prisma delegates for `eventLog`, `eventSubscription`, `eventDelivery`, and `eventHandlerLog`.
- Produces `AppEnvironment.eventWorker` with `enabled`, `pollMs`, `batchSize`, `leaseSeconds`, and `shutdownSeconds`.
- Produces permission codes `menu.event_operations`, `event.delivery.read`, and `event.delivery.retry`.

- [x] **Step 1: Write failing migration and config tests**

```ts
test('migration owns the event schema and pilot subscription', () => {
  const sql = readMigration('20260722120000_reliable_event_center');
  for (const table of ['event_log', 'event_subscription', 'event_delivery', 'event_handler_log']) {
    assert.match(sql, new RegExp(`CREATE TABLE "${table}"`, 'i'));
  }
  assert.match(sql, /UNIQUE\s*\("eventId",\s*"handlerCode"\)/i);
  assert.match(sql, /admin-operation-reviewed-notification-v1/i);
  assert.match(sql, /event\.delivery\.retry/i);
});

test('production requires an explicit worker switch', () => {
  assert.throws(() => loadEnvironment(productionEnv({ EVENT_WORKER_ENABLED: undefined })));
  assert.equal(loadEnvironment(productionEnv({ EVENT_WORKER_ENABLED: 'false' })).eventWorker.enabled, false);
});
```

- [x] **Step 2: Run and observe failures before schema changes**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test --test-force-exit test/db/spec-007-event-center-migration-contract.test.ts test/config/event-worker-config.test.ts
```

Expected: FAIL for absent migration/models/config.

- [x] **Step 3: Add Prisma models and Notification compatibility fields**

Add the four models with the exact fields and constraints from Spec sections 7.1–7.4. Add to `Notification`:

```prisma
deduplicationKey String? @unique
routeUrl          String?
```

Use database CHECK constraints in migration SQL for statuses, non-negative counters, lease-field combinations, RETRY_WAIT next-attempt requirements, and SUCCEEDED completion requirements. Use restrictive foreign keys; no cascading deletion for event evidence.

- [x] **Step 4: Seed permissions and the pilot subscription in migration SQL**

Insert stable permission IDs `permission:<code>` idempotently and grant read/menu to reserved `SYSTEM_ADMIN` and `SYSTEM_SUPER_ADMIN`; grant retry only to `SYSTEM_SUPER_ADMIN`. Insert the pilot subscription with `ON CONFLICT ("code") DO NOTHING` and no filter.

- [x] **Step 5: Implement fail-closed Worker config parsing**

```ts
export interface EventWorkerEnvironment {
  enabled: boolean;
  pollMs: number;
  batchSize: number;
  leaseSeconds: number;
  shutdownSeconds: number;
}
```

Parse booleans exactly as `true|false`; parse decimal integers only. Enforce poll 250–60000, batch 1–200, lease 30–600, shutdown 1–120 and shutdown < lease. Default development to enabled and unittest to disabled; production has no switch default.

- [x] **Step 6: Generate Prisma and deploy only to the guarded test database**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/prisma/build/index.js generate
npx.cmd -y -p node@22.14.0 node node_modules/prisma/build/index.js migrate deploy
```

Expected: 10 migrations found; `20260722120000_reliable_event_center` applies once.

- [x] **Step 7: Rerun schema/config tests and baseline contracts**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test --test-force-exit test/db/spec-007-event-center-migration-contract.test.ts test/config/event-worker-config.test.ts test/db/schema-contract.test.ts test/authorization/permission-catalog.test.ts
```

Expected: PASS.

- [x] **Step 8: Record local checkpoint without Git**

Mark Task 2 complete; do not stage or commit.

### Task 3: Transactional Outbox writer and governance review integration

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/events/event-outbox-writer.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/application/admin-governance/governance-review-service.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/application/admin-governance/governance-factory.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/application/admin-governance/governance-event-sink.ts`
- Test: `LayerManage/law-firm-system/apps/server/test/events/event-outbox-writer.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/admin-governance/governance-review-service.test.ts`

**Interfaces:**
- Produces `EventOutboxWriter.append(tx, input): Promise<{ eventId: string }>`.
- Governance review consumes the writer inside its existing transaction.
- Non-contract governance observers remain test-only and cannot persist public events.

- [x] **Step 1: Write failing atomicity and payload tests**

```ts
test('commits review, audit, and reviewed-v1 event atomically', async () => {
  const result = await services().review.review(reviewerContext, operationId, approveInput, requestId, stepUp);
  const event = await prisma.eventLog.findFirstOrThrow({ where: { objectId: operationId } });
  assert.equal(event.eventType, 'admin.operation.reviewed');
  assert.equal(event.eventVersion, 1);
  assert.equal((event.payload as Record<string, unknown>).requesterUserId, requesterId);
  assert.doesNotMatch(JSON.stringify(event), /reason text|review comment|token/i);
});

test('rolls back the governance decision when EventLog creation fails', async () => {
  await assert.rejects(() => reviewWithWriter(async () => { throw new Error('outbox unavailable'); }));
  assert.equal((await operation()).status, 'PENDING_REVIEW');
  assert.equal(await prisma.adminOperationReview.count(), 0);
  assert.equal(await prisma.eventLog.count(), 0);
});
```

- [x] **Step 2: Run and observe missing EventLog behavior**

Run the two focused test files. Expected: FAIL because review does not append a transactional event.

- [x] **Step 3: Implement `PrismaEventOutboxWriter`**

```ts
export interface EventOutboxWriter {
  append(tx: Prisma.TransactionClient, input: EventEnvelopeInput): Promise<{ eventId: string }>;
}

export class PrismaEventOutboxWriter implements EventOutboxWriter {
  async append(tx: Prisma.TransactionClient, input: EventEnvelopeInput) {
    const registered = validateEventEnvelope(input);
    const created = await tx.eventLog.create({ data: registered });
    return { eventId: created.id };
  }
}
```

- [x] **Step 4: Move reviewed event creation into the review transaction**

Pass the outbox writer through `createGovernanceServices`. After audit writing, append exact reviewed-v1 payload using the state-machine decision and server-generated route. Remove transaction-external public reviewed emission. Keep rejected attempts out of EventLog.

- [x] **Step 5: Run governance, Step-Up, and acceptance regressions**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test --test-force-exit test/events/event-outbox-writer.test.ts test/admin-governance/governance-review-service.test.ts test/admin-governance/governance-concurrency.test.ts test/admin-governance/governance-step-up.test.ts test/acceptance/spec-005-acceptance.test.ts test/acceptance/spec-006-acceptance.test.ts
```

Expected: PASS.

- [x] **Step 6: Record local checkpoint without Git**

Mark Task 3 complete; do not stage or commit.

### Task 4: Subscription dispatcher and idempotent delivery creation

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/events/event-handler-registry.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/events/event-dispatcher.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/events/event-health-service.ts`
- Test: `LayerManage/law-firm-system/apps/server/test/events/event-dispatcher.test.ts`
- Test: `LayerManage/law-firm-system/apps/server/test/events/event-dispatcher-concurrency.test.ts`

**Interfaces:**
- Produces `EventHandlerRegistry.register/get/has/validate`.
- Produces `EventDispatcher.dispatchBatch(limit): Promise<DispatchBatchResult>`.
- Produces health mutations for unknown handlers and invalid filters.

- [x] **Step 1: Write failing dispatcher and concurrency tests**

```ts
test('snapshots enabled matching subscriptions once', async () => {
  await Promise.all([dispatcherA.dispatchBatch(25), dispatcherB.dispatchBatch(25)]);
  assert.equal(await prisma.eventDelivery.count({ where: { eventId } }), 1);
  assert.ok((await prisma.eventLog.findUniqueOrThrow({ where: { id: eventId } })).dispatchedAt);
});

test('creates MANUAL evidence for an enabled unknown handler', async () => {
  await enableSubscription({ handlerCode: 'UNKNOWN' });
  await dispatcher.dispatchBatch(25);
  const delivery = await prisma.eventDelivery.findFirstOrThrow({ where: { eventId } });
  assert.equal(delivery.status, 'MANUAL');
  assert.equal(delivery.lastErrorCode, 'HANDLER_NOT_REGISTERED');
});
```

- [x] **Step 2: Run and observe missing dispatcher failures**

Expected: FAIL because registry/dispatcher do not exist.

- [x] **Step 3: Implement registry and short dispatcher transaction**

Use a deterministic code registry. In `dispatchBatch`, select undispatched rows `ORDER BY createdAt,id FOR UPDATE SKIP LOCKED LIMIT <bounded>`, load enabled subscriptions, validate/match, create deliveries with `createManyAndReturn({ skipDuplicates: true })`, and set `dispatchedAt` in the same transaction. Compute delivery/manual counts and post-commit health mutations only from rows actually returned as inserted; map safe error references explicitly to faults so unique-key skips cannot create health state without persistent evidence.

- [x] **Step 4: Implement safe degraded health state**

`EventHealthService` stores only counters, timestamps, safe codes, and random references. Unknown handlers or bad filters create MANUAL delivery evidence and update degraded state; no raw configuration JSON is logged.

- [x] **Step 5: Run dispatcher tests with two Prisma clients**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 --test-force-exit test/events/event-dispatcher.test.ts test/events/event-dispatcher-concurrency.test.ts
```

Expected: PASS with one delivery per `(eventId, handlerCode)`.

The two files share one resettable PostgreSQL test database, so cross-file execution is serialized with `--test-concurrency=1` as a test-data isolation rule. The concurrency behavior itself remains exercised inside `event-dispatcher-concurrency.test.ts` by two explicitly independent Prisma clients. Do not use or report the command without this flag as an approved result.

- [x] **Step 6: Record local checkpoint without Git**

Mark Task 4 complete; do not stage or commit.

### Task 5: Lease worker, ordered execution, retries, and immutable attempt logs

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/events/event-worker.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/events/event-delivery-store.ts`
- Test: `LayerManage/law-firm-system/apps/server/test/events/event-worker.test.ts`
- Test: `LayerManage/law-firm-system/apps/server/test/events/event-worker-concurrency.test.ts`
- Test: `LayerManage/law-firm-system/apps/server/test/events/event-worker-ordering.test.ts`

**Interfaces:**
- Produces `EventHandler.handle(tx, context): Promise<void>`.
- Produces `EventWorker.tick(): Promise<WorkerTickResult>`, `start()`, and `stop(timeoutMs)`.
- Delivery store owns every SQL lock and lease transition; controllers and handlers may not mutate delivery rows directly.

- [x] **Step 1: Write failing lease/retry/order tests**

```ts
test('allows exactly one worker to own a delivery lease', async () => {
  const results = await Promise.all([workerA.tick(), workerB.tick()]);
  assert.equal(results.reduce((sum, value) => sum + value.claimed, 0), 1);
});

test('records a crashed lease as LEASE_LOST before reclaiming', async () => {
  await expireCurrentLease(deliveryId);
  await workerB.tick();
  const logs = await prisma.eventHandlerLog.findMany({ where: { deliveryId }, orderBy: { attemptNumber: 'asc' } });
  assert.equal(logs[0].outcome, 'LEASE_LOST');
});

test('MANUAL continues blocking later ordered deliveries', async () => {
  await makeEarlierManual();
  assert.equal((await worker.tick()).claimed, 0);
  await manuallyRequeueEarlier();
  await worker.tick();
  assert.equal((await earlier()).status, 'SUCCEEDED');
});
```

- [x] **Step 2: Run and observe missing worker failures**

Expected: FAIL because worker/store do not exist.

- [x] **Step 3: Implement SQL claim and lease ownership**

Claim `PENDING`, due `RETRY_WAIT`, and expired `PROCESSING` with `FOR UPDATE SKIP LOCKED`. Before reclaiming, insert `LEASE_LOST` for the old attempt. Exclude a candidate when an earlier same-handler/orderingKey delivery is not SUCCEEDED. Set worker ID, 60-second lease, attempt count, start time, and version atomically.

- [x] **Step 4: Implement outcome transactions**

For success, rerun lease/version ownership validation inside the handler transaction, execute the handler, insert SUCCEEDED log, then clear lease and update delivery SUCCEEDED/completedAt. For failure, map only the error class/code/reference, insert the immutable log, clear the lease, and apply the fixed retry decision. A lost lease must never commit handler business writes.

- [x] **Step 5: Implement lifecycle-safe loop and database backoff**

`start()` schedules `tick()` without overlap using an unref timer. Database failures back off 1/2/5/10/30 seconds and update health. `stop()` prevents new claims and waits only for the configured timeout.

- [x] **Step 6: Run focused concurrency and timing tests**

Run all three worker test files with injected clocks and two Prisma clients. Expected: PASS without sleeps longer than one event-loop turn.

- [x] **Step 7: Record local checkpoint without Git**

Mark Task 5 complete; do not stage or commit.

### Task 6: Governance notification handler and end-to-end idempotency

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/events/handlers/admin-operation-reviewed-notification-handler.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/events/event-services-factory.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/application/events/event-handler-registry.ts`
- Test: `LayerManage/law-firm-system/apps/server/test/events/admin-operation-reviewed-notification-handler.test.ts`
- Test: `LayerManage/law-firm-system/apps/server/test/events/governance-notification-flow.test.ts`

**Interfaces:**
- Produces registered handler code `ADMIN_OPERATION_REVIEWED_NOTIFICATION`.
- Creates Notification using SHA-256 `(eventId + handlerCode + requesterUserId)` deduplication key.

- [x] **Step 1: Write failing handler/idempotency tests**

```ts
test('creates one safe notification for the original requester', async () => {
  await handler.handle(tx, context);
  await handler.handle(tx, context);
  const notifications = await prisma.notification.findMany({ where: { userId: requesterId } });
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].routeUrl, `/security/admin-governance?operationId=${operationId}`);
  assert.doesNotMatch(JSON.stringify(notifications[0]), /request reason|review comment|payload/i);
});
```

- [x] **Step 2: Run and observe missing handler failure**

Expected: FAIL because no registered notification handler exists.

- [x] **Step 3: Implement safe notification projection**

Validate payload again, verify AdminOperation ID/requester/type, construct bounded Chinese title/content from code-owned labels, calculate the deduplication hash, and create Notification with `type='SYSTEM'`, related type/id, and routeUrl. Treat unique collision as success only after loading and comparing userId/type/routeUrl; otherwise throw `PermanentEventError('NOTIFICATION_DEDUPLICATION_CONFLICT')`.

- [x] **Step 4: Register production services**

Factory returns one shared registry, dispatcher, delivery store, worker, health service, and outbox writer for the Prisma client/config. No request controller may construct an independent Worker.

- [x] **Step 5: Run handler, notification API, and governance flow tests**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test --test-force-exit test/events/admin-operation-reviewed-notification-handler.test.ts test/events/governance-notification-flow.test.ts test/app/notification-api.test.ts
```

Expected: PASS; repeated ticks keep Notification count at one.

- [x] **Step 6: Record local checkpoint without Git**

Mark Task 6 complete; do not stage or commit.

### Task 7: Egg lifecycle and safe drain CLI

**Files:**
- Modify: `LayerManage/law-firm-system/apps/server/app.ts`
- Create: `LayerManage/law-firm-system/apps/server/scripts/events/drain-events.ts`
- Modify: `LayerManage/law-firm-system/apps/server/package.json`
- Modify: `LayerManage/law-firm-system/apps/server/pkg` assets only if build tests show the script/service output is omitted
- Test: `LayerManage/law-firm-system/apps/server/test/events/event-lifecycle.test.ts`
- Test: `LayerManage/law-firm-system/apps/server/test/events/event-drain-cli.test.ts`

**Interfaces:**
- Egg boot owns exactly one Worker per application.
- CLI calls the same dispatcher/worker services and exits after two empty rounds.

- [x] **Step 1: Write failing lifecycle and redaction tests**

```ts
test('unit-test app does not auto-start the worker', async () => {
  await app.ready();
  assert.equal(eventWorkerStartCalls, 0);
});

test('drain works while the background switch is false and prints only counts', async () => {
  const result = await drainMain([], env({ EVENT_WORKER_ENABLED: 'false' }), deps);
  assert.equal(result, 0);
  assert.match(output, /dispatched=1.*succeeded=1/);
  assert.doesNotMatch(output, /payload|postgresql:|notification content/i);
});
```

- [x] **Step 2: Run and observe failures**

Expected: FAIL because lifecycle and CLI entry do not exist.

- [x] **Step 3: Wire `didReady` and `beforeClose`**

Store the singleton Worker on a private AppBootHook field. In didReady, start only when config enabled; log only enabled/disabled state. In beforeClose, call `stop(shutdownSeconds * 1000)` and never expose raw errors.

- [x] **Step 4: Implement dependency-injected `drainMain`**

Validate zero arguments, database target and migrations. Ignore only the background enabled switch, not numeric config. Dispatch and tick until two empty rounds; return nonzero when MANUAL was created for unknown type/handler or database state is unavailable. Add package script:

```json
"events:drain": "tsx scripts/events/drain-events.ts"
```

- [x] **Step 5: Run lifecycle, CLI, build-contract, and packaging tests**

Expected: PASS, no leaked connection string or payload.

- [x] **Step 6: Record local checkpoint without Git**

Mark Task 7 complete; do not stage or commit.

### Task 8: Operations query API and Step-Up manual retry

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/events/event-operations-service.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/controller/eventOperations.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/router.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/domain/security/step-up-target.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/controller/auth.ts` only through the existing generic Step-Up endpoint types
- Test: `LayerManage/law-firm-system/apps/server/test/events/event-operations-service.test.ts`
- Test: `LayerManage/law-firm-system/apps/server/test/app/event-operations-api.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/auth/step-up-target.test.ts`

**Interfaces:**
- Produces summary/list/detail/subscriptions/retry methods.
- Adds StepUpPurpose `EVENT_DELIVERY_RETRY` with exact target `{ deliveryId, expectedVersion }`.

- [x] **Step 1: Write failing authorization, redaction, and retry tests**

```ts
test('returns only safe delivery detail fields', async () => {
  const detail = await service.detail(superAdminContext, deliveryId);
  assert.deepEqual(Object.keys(detail.payloadSummary).sort(), ['operationId', 'operationType', 'riskLevel', 'status']);
  assert.equal(JSON.stringify(detail).includes('lockedBy'), false);
  assert.equal(JSON.stringify(detail).includes('raw failure'), false);
});

test('atomically consumes a target-bound Step-Up and requeues MANUAL', async () => {
  await service.retry(superAdminContext, deliveryId, expectedVersion, stepUpToken);
  assert.equal((await delivery()).status, 'PENDING');
  assert.equal(await prisma.operationLog.count({ where: { action: 'EVENT_DELIVERY_MANUAL_RETRY' } }), 1);
});
```

- [x] **Step 2: Run and observe missing service/routes**

Expected: FAIL because APIs and purpose do not exist.

- [x] **Step 3: Implement query parsing and safe views**

Default page 20, max 200; whitelist statuses, event type, handler code, object type/id, UTC time bounds, and sort keys. Detail maps payload through the registry’s `safeSummary` and omits worker/lock/raw config fields.

- [x] **Step 4: Implement transactional manual retry**

Require effective super-admin plus `event.delivery.retry`; lock delivery; require MANUAL, exact version and no live lease; consume Step-Up with target `{ deliveryId, expectedVersion }`; update PENDING/manualRetryCount/version and clear error/lease/timing fields; write audit in the same transaction.

- [x] **Step 5: Add protected routes**

```ts
router.get('/api/v1/event-operations/summary', requirePermission('event.delivery.read'), controller.eventOperations.summary);
router.get('/api/v1/event-operations/deliveries', requirePermission('event.delivery.read'), controller.eventOperations.index);
router.get('/api/v1/event-operations/deliveries/:id', requirePermission('event.delivery.read'), controller.eventOperations.show);
router.get('/api/v1/event-operations/subscriptions', requirePermission('event.delivery.read'), controller.eventOperations.subscriptions);
router.post('/api/v1/event-operations/deliveries/:id/retry', requirePermission('event.delivery.retry'), controller.eventOperations.retry);
```

- [x] **Step 6: Run API, auth, CSRF, and authorization regressions**

Expected: PASS, including wrong-purpose/target/version/expired/reused Step-Up rejection.

- [x] **Step 7: Record local checkpoint without Git**

Mark Task 8 complete; do not stage or commit.

### Task 9: Web event operations page

**Files:**
- Create: `LayerManage/law-firm-system/apps/web/src/features/event-operations/types.ts`
- Create: `LayerManage/law-firm-system/apps/web/src/features/event-operations/api.ts`
- Create: `LayerManage/law-firm-system/apps/web/src/pages/EventOperations/index.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/pages/EventOperations/index.test.tsx`
- Modify: `LayerManage/law-firm-system/apps/web/src/features/auth/types.ts`
- Modify: `LayerManage/law-firm-system/apps/web/src/features/authorization/types.ts`
- Modify: `LayerManage/law-firm-system/apps/web/src/components/Layout/index.tsx`
- Modify: `LayerManage/law-firm-system/apps/web/src/components/Layout/index.test.tsx`
- Modify: `LayerManage/law-firm-system/apps/web/src/App.tsx`

**Interfaces:**
- Adds Web StepUpPurpose `EVENT_DELIVERY_RETRY`.
- `eventOperationsApi.retry(id, expectedVersion, token)` sends `X-Step-Up-Token`.

- [x] **Step 1: Write failing API/menu/page tests**

```tsx
test('shows MANUAL detail and binds retry Step-Up to delivery version', async () => {
  render(<EventOperationsPage />);
  fireEvent.click(await screen.findByRole('button', { name: '人工重试 d1' }));
  await waitFor(() => expect(runStepUp).toHaveBeenCalledWith(expect.objectContaining({
    purpose: 'EVENT_DELIVERY_RETRY', target: { deliveryId: 'd1', expectedVersion: 7 },
  })));
});

test('only includes event operations menu with its menu permission', () => {
  expect(JSON.stringify(buildMenuItems(['menu.event_operations']))).toContain('/security/event-operations');
  expect(JSON.stringify(buildMenuItems([]))).not.toContain('/security/event-operations');
});
```

- [x] **Step 2: Run and observe missing page/API/type failures**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/vitest/vitest.mjs run src/pages/EventOperations/index.test.tsx src/components/Layout/index.test.tsx
```

Expected: FAIL because the feature is absent.

- [x] **Step 3: Implement typed API and safe table/detail views**

Create summary cards, bounded filters, paginated table, detail Drawer, attempt timeline and subscription read-only tab. Render only server-provided payloadSummary and safe error code/reference. Use Chinese labels from the approved Spec.

- [x] **Step 4: Implement Step-Up retry and refresh**

Use `useStepUp().run` with exact delivery/version target and impact text. On success close detail, reload summary/list/detail, and show success. Never store Step-Up token in component state or browser storage.

- [x] **Step 5: Add permission-gated route and menu**

Route requires `event.delivery.read`; menu requires `menu.event_operations`. Add breadcrumb name “事件运维”.

- [x] **Step 6: Run focused and full Web tests/typecheck**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/vitest/vitest.mjs run src/pages/EventOperations/index.test.tsx src/components/Layout/index.test.tsx src/features/auth/useStepUp.test.ts
npx.cmd -y -p node@22.14.0 node node_modules/vitest/vitest.mjs run
npx.cmd -y -p node@22.14.0 node node_modules/typescript/bin/tsc -b --pretty false
```

Expected: all Web tests PASS and typecheck exit 0.

- [x] **Step 7: Record local checkpoint without Git**

Mark Task 9 complete; do not stage or commit.

### Task 10: Acceptance, operations rehearsal, documentation, and final verification

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/test/acceptance/spec-007-acceptance.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/scripts/rehearsal/rehearse-event-center.ts`
- Modify: `LayerManage/law-firm-system/apps/server/package.json`
- Create: `docs/superpowers/runbooks/reliable-event-center-outbox.md`
- Create: `docs/superpowers/reports/spec-007-closeout.md`
- Modify: `docs/superpowers/handoffs/2026-07-21-cross-device-migration-handoff.md`
- Modify: `LayerManage/law-firm-system/apps/server/scripts/ci/check-spec-006-built-leakage.ts` only if its naming/scope must become a shared sensitive-artifact scan; preserve all SPEC-006 signatures.
- Test: `LayerManage/law-firm-system/apps/server/test/security/spec-007-event-leakage.test.ts`

**Interfaces:**
- Produces a guarded test-only rehearsal and complete sanitized closeout evidence.

- [x] **Step 1: Write failing complete acceptance and leakage tests**

Acceptance must create a reviewed governance operation, assert atomic EventLog, run dispatcher/worker, assert one requester Notification, rerun/restart without duplication, inject retryable attempts 1–4, reach MANUAL on 5, execute Step-Up retry, recover, and scan serialized evidence for known fixture secrets.

- [x] **Step 2: Run acceptance and observe the first missing integration or rehearsal failure**

Expected: FAIL until every production factory/lifecycle/API path is connected.

- [x] **Step 3: Implement the guarded rehearsal**

`rehearse-event-center.ts` must require `ALLOW_TEST_DB_RESET=true`, exact local `chengye_oa_test`, and `EVENT_WORKER_ENABLED=false`; create disposable users/roles/factor/session/governance data; use production services and `drainMain`; assert one notification and safe evidence; truncate all application tables in `finally`; print counts only.

Add:

```json
"rehearse:event-center": "tsx scripts/rehearsal/rehearse-event-center.ts"
```

- [x] **Step 4: Run focused acceptance and actual drain/rehearsal**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test --test-force-exit test/acceptance/spec-007-acceptance.test.ts test/security/spec-007-event-leakage.test.ts
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs scripts/rehearsal/rehearse-event-center.ts
```

Expected: PASS, final application tables empty.

- [x] **Step 5: Perform an isolated PostgreSQL restore rehearsal**

Back up a guarded controlled state containing one undispatched/unfinished delivery and one succeeded notification, restore only to `chengye_oa_restore_test`, start with Worker disabled, verify rows and idempotency, run drain, confirm no duplicate Notification, remove the restore database, clean source fixture, and record start/end time, elapsed seconds and dump SHA-256. Never write credentials or MFA keys to the report.

- [x] **Step 6: Write runbook, handoff, and draft closeout**

Document configuration, health checks, drain, retry schedule, ordered blockage, MANUAL Step-Up recovery, unknown handler/version, database outage, rollout/rollback, backup/restore, safe evidence, and explicit prohibition on deleting or rewriting event history.

- [x] **Step 7: Run fresh complete verification**

Server:

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/eslint/bin/eslint.js . --ext .ts
npx.cmd -y -p node@22.14.0 node node_modules/typescript/bin/tsc --noEmit
npx.cmd -y -p node@22.14.0 node node_modules/c8/bin/c8.js --reporter=text-summary --reporter=json-summary --reporter=json --reporter=lcov --reporter=cobertura node_modules/tsx/dist/cli.mjs scripts/ci/run-node-tests-serial.ts
npx.cmd -y -p node@22.14.0 node scripts/clean-build-output.js
npx.cmd -y -p node@22.14.0 node node_modules/typescript/bin/tsc
npx.cmd -y -p node@22.14.0 node node_modules/prisma/build/index.js generate
npx.cmd -y -p node@22.14.0 node scripts/build.js
```

Web:

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/eslint/bin/eslint.js .
npx.cmd -y -p node@22.14.0 node node_modules/typescript/bin/tsc -b --pretty false
npx.cmd -y -p node@22.14.0 node node_modules/vitest/vitest.mjs run
npx.cmd -y -p node@22.14.0 node node_modules/vite/bin/vite.js build
```

Security/database:

```powershell
npx.cmd -y -p node@22.14.0 node scripts/security/cli.mjs policy
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/server audit --omit=dev --audit-level=high
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/web audit --omit=dev --audit-level=high
npx.cmd -y -p node@22.14.0 node apps/server/node_modules/tsx/dist/cli.mjs apps/server/scripts/ci/check-spec-006-built-leakage.ts
npx.cmd -y -p node@22.14.0 node apps/server/node_modules/tsx/dist/cli.mjs apps/server/scripts/db/reset-test-db.ts
npx.cmd -y -p node@22.14.0 node apps/server/node_modules/tsx/dist/cli.mjs apps/server/scripts/db/assert-empty-application-tables.ts
```

Expected: zero test failures, zero lint/type errors, successful builds, zero production high/critical vulnerabilities, leakage scan PASS, and every application table empty.

- [x] **Step 8: Request independent read-only code review**

Reviewer must inspect transaction atomicity, lease correctness, ordered MANUAL blocking, idempotency, error/payload redaction, permission/Step-Up boundaries, lifecycle shutdown, CLI safety, backup/restore evidence, and regressions. Resolve every Critical/Important issue with TDD and rerun affected/full verification.

- [x] **Step 9: Finalize closeout without Git**

Record exact migration count, Server/Web test counts, c8 percentages, lint/build/audit results, rehearsal hash/timing/cleanup, review verdict and known non-blocking warnings. Mark all plan tasks complete only after evidence exists. Do not stage, commit, push, or create a PR.

---

## Plan self-review result

- Spec coverage: Tasks 1–10 map all SPEC-007 sections, including the pilot, lifecycle, API/UI, Step-Up, drain, observability, backup/restore and independent review.
- Placeholder scan: no TBD/TODO/“implement later” steps remain.
- Type consistency: event type/version, handler code, delivery statuses, Step-Up purpose/target, retry schedule and permission codes are consistent across Server, Web and tests.
- Scope: event infrastructure plus one notification pilot only; approval, automation, dynamic subscription editing and other business events remain excluded.
- Git exception: every normal commit checkpoint is replaced with a local plan checkbox because the authoritative handoff forbids Git/GitHub writes.
