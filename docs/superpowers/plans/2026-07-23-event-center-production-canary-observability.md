# Event Center Production Canary and Built-In Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fail-closed production canary gates, durable Worker heartbeat evidence, safe built-in alert evaluation, a protected operations view, and a portable inspection CLI for the SPEC-007 event center.

**Architecture:** PostgreSQL remains the source of truth for event backlog and lease evidence. A minimal single-row Worker runtime status lets a separate CLI observe the application process, while a pure policy maps a normalized snapshot to stable `READY | DEGRADED | BLOCKED` results. The existing operations API and Web page consume the same reader/policy; no external monitoring dependency or alert-history state machine is introduced.

**Tech Stack:** Node.js 22.14.0, npm 10.9.2, TypeScript 5.4, Egg 3, Prisma 5.22, PostgreSQL 16, React 18, Ant Design 5, Vitest, Node test runner, c8.

## Global Constraints

- Never run any Git or GitHub command, including read-only commands. Replace commit steps with a task report and independent review gate.
- Preserve user changes in the shared workspace; do not reset, overwrite, or clean unrelated files.
- Use only additive PostgreSQL migrations; never destructively roll back or mutate event history.
- Keep `EventLog`, `EventDelivery`, `EventHandlerLog`, notification idempotency keys, and audit evidence immutable.
- Do not add delete, skip, payload edit, attempt edit, subscription edit, bulk replay, runtime Worker toggle, archive, or history-cleanup entry points.
- Do not expose credentials, database URLs, payloads, notification content, raw errors/stacks, `workerId`, `lockedBy`, hostnames, or PIDs through API, Web, CLI, logs, tests, reports, or docs.
- Use `EVENT_WORKER_ENABLED=false` for preflight and `true` for canary; production continues to reject a missing or invalid explicit switch.
- Use inclusive alert boundaries: `value >= threshold` triggers the configured level.
- Shared resettable PostgreSQL tests run with `--test-concurrency=1`; concurrency is created inside one test with independent Prisma clients.
- Run Server tests from an explicit no-Git list and exclude `test/ci/distribution-config-contract.test.ts`, which invokes Git internally.
- Use the protected local test database guards already present in the repository; never broaden destructive database targets.
- Every implementation task follows RED → GREEN → focused regression → independent spec/compliance review → independent code-quality review.

---

## File Structure

### New Server files

- `apps/server/app/domain/events/event-observability.ts`: public snapshot, alert, mode, threshold, and policy types; pure rollout evaluator.
- `apps/server/app/domain/events/event-observability-errors.ts`: stable safe unavailable error type and Prisma database-error classifier.
- `apps/server/app/application/events/event-worker-runtime-status-store.ts`: single-slot lifecycle and throttled heartbeat persistence.
- `apps/server/app/application/events/event-runtime-snapshot-reader.ts`: PostgreSQL aggregate reader with one injected evaluation clock.
- `apps/server/scripts/events/check-events.ts`: strict preflight/canary CLI and stable exit-code adapter.
- `apps/server/scripts/rehearsal/rehearse-event-observability.ts`: guarded 15-minute local canary rehearsal.
- `apps/server/prisma/migrations/20260723090000_event_worker_runtime_status/migration.sql`: additive runtime-status table and constraints.
- `apps/server/test/config/event-observability-config.test.ts`: configuration defaults, bounds, and cross-field constraints.
- `apps/server/test/events/event-rollout-policy.test.ts`: exhaustive pure policy boundaries and stable ordering.
- `apps/server/test/events/event-worker-runtime-status-store.test.ts`: real PostgreSQL lifecycle/store behavior.
- `apps/server/test/events/event-runtime-snapshot-reader.test.ts`: real PostgreSQL aggregate semantics.
- `apps/server/test/events/event-check-cli.test.ts`: CLI parser, output, error mapping, and real reader smoke test.
- `apps/server/test/events/event-observability-load.test.ts`: bounded multi-client load, convergence, and idempotency.
- `apps/server/test/acceptance/spec-008-acceptance.test.ts`: end-to-end preflight/canary/fault/rollback acceptance.
- `apps/server/test/db/spec-008-event-observability-migration-contract.test.ts`: migration and schema safety contract.

### Modified Server files

- `apps/server/config/env.ts`, `config/config.default.ts`, `.env.example`: parse and expose observability configuration.
- `apps/server/prisma/schema.prisma`: add `EventWorkerRuntimeStatus`; model count becomes 45.
- `apps/server/scripts/ci/check-baseline-contract.ts`, `test/ci/baseline-contract.test.ts`, `test/db/schema-contract.test.ts`: update the canonical model contract and verify the new model.
- `apps/server/app/application/events/event-worker.ts`: write only background-started, throttled successful heartbeats.
- `apps/server/app/application/events/event-services-factory.ts`: construct/export status store, snapshot reader, and policy dependencies.
- `apps/server/app/application/events/event-operations-service.ts`: add the observability snapshot to the existing summary.
- `apps/server/app/controller/eventOperations.ts`, `app/middleware/errorHandler.ts`: inject the reader/policy and return safe 503 errors.
- `apps/server/app.ts`: write `DISABLED`, `STARTING`, and `STOPPED` lifecycle state around the existing Worker.
- `apps/server/package.json`, `server-entry.js`, `scripts/lib/portable-command.js`: expose source and packaged `events:check` commands.
- Existing event lifecycle, worker, operations API/service, launcher, portable command, packaging, and leakage tests: preserve prior behavior while covering new boundaries.

### Modified Web files

- `apps/web/src/features/event-operations/types.ts`: add the exact observability response types.
- `apps/web/src/pages/EventOperations/index.tsx`: status banner, metrics, safe alert copy, and refresh behavior.
- `apps/web/src/pages/EventOperations/event-operations.css`: responsive observability cards and alert list.
- `apps/web/src/pages/EventOperations/index.test.tsx`: READY/DEGRADED/BLOCKED, unknown-code fallback, and no-control assertions.

### Documentation and evidence

- `docs/superpowers/runbooks/reliable-event-center-outbox.md`: preflight/canary/check/rollback procedures.
- `LayerManage/law-firm-system/docs/DEPLOY.md`: release sequence and portable command.
- `docs/superpowers/reports/spec-008-closeout.md`: final redacted evidence and remaining risks.
- `docs/superpowers/handoffs/2026-07-21-cross-device-migration-handoff.md`: current continuation point.
- `.superpowers/sdd/progress.md` and `.superpowers/sdd/task-<n>-report.md`: task reports/reviews without Git actions.

---

### Task 1: Observability Configuration and Pure Rollout Policy

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/domain/events/event-observability.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/config/event-observability-config.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/events/event-rollout-policy.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/config/env.ts`
- Modify: `LayerManage/law-firm-system/apps/server/config/config.default.ts`
- Modify: `LayerManage/law-firm-system/apps/server/.env.example`

**Interfaces:**
- Produces `EventObservabilityEnvironment`, `EventRolloutMode`, `EventRuntimeSnapshot`, `EventRolloutAlert`, `EventRolloutEvaluation`, and `evaluateEventRollout(input)`.
- Later tasks must import these types; they must not re-declare thresholds, modes, statuses, or alert codes.

- [x] **Step 1: Write configuration tests that establish defaults, inclusive ranges, and cross-field constraints**

```ts
const loaded = loadEnvironment(baseEnv).eventObservability;
assert.deepEqual(loaded, {
  heartbeatSeconds: 10,
  undispatchedBlockSeconds: 120,
  dueBacklogBlockSeconds: 300,
  leaseLostDegradedCount: 1,
  leaseLostBlockedCount: 3,
  canaryWindowMinutes: 15,
  heartbeatStaleSeconds: 60,
});

assert.throws(() => loadEnvironment({
  ...baseEnv,
  EVENT_OBSERVABILITY_LEASE_LOST_DEGRADED_COUNT: '3',
  EVENT_OBSERVABILITY_LEASE_LOST_BLOCKED_COUNT: '3',
}), /BLOCKED.*greater than.*DEGRADED/i);
```

- [x] **Step 2: Run the new configuration test and verify RED**

Run from `LayerManage/law-firm-system/apps/server`:

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test test/config/event-observability-config.test.ts
```

Expected: FAIL because `eventObservability` is not returned by `loadEnvironment`.

- [x] **Step 3: Add the exact configuration contract**

```ts
export interface EventObservabilityEnvironment {
  readonly heartbeatSeconds: number;
  readonly heartbeatStaleSeconds: number;
  readonly undispatchedBlockSeconds: number;
  readonly dueBacklogBlockSeconds: number;
  readonly leaseLostDegradedCount: number;
  readonly leaseLostBlockedCount: number;
  readonly canaryWindowMinutes: number;
}
```

Parse the six documented variables with the existing decimal-integer helper. Derive `heartbeatStaleSeconds = Math.max(60, heartbeatSeconds * 3)`. Reject `leaseLostBlockedCount <= leaseLostDegradedCount`. Add commented, non-secret examples to `.env.example`; expose `config.eventObservability = env.eventObservability`.

- [x] **Step 4: Write policy tests before implementation**

Use a `healthySnapshot(overrides)` fixture and table-driven assertions for:

```ts
assert.equal(evaluateEventRollout({ mode: 'preflight', snapshot, config }).status, 'READY');
assert.deepEqual(
  evaluateEventRollout({ mode: 'canary', snapshot: { ...snapshot, manualCount: 1 }, config }).alerts,
  [{ code: 'EVENT_OBS_MANUAL_PRESENT', severity: 'BLOCKED', value: 1, threshold: 1 }],
);
```

Cover every exact threshold at `threshold - 1` and `threshold`, mode/config/runtime mismatches, STARTING inside/outside grace, missing runtime row, same-process consecutive database failures, stable severity/code ordering, and the LEASE_LOST degraded interval.

- [x] **Step 5: Run policy tests and verify RED**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test test/events/event-rollout-policy.test.ts
```

Expected: FAIL because `event-observability.ts` does not exist.

- [x] **Step 6: Implement the pure types and evaluator**

The exported core must have these exact shapes:

```ts
export type EventRolloutMode = 'preflight' | 'canary';
export type EventRolloutStatus = 'READY' | 'DEGRADED' | 'BLOCKED';
export type EventRolloutAlertCode =
  | 'EVENT_OBS_MODE_MISMATCH'
  | 'EVENT_OBS_MANUAL_PRESENT'
  | 'EVENT_OBS_DISPATCHER_FAULT'
  | 'EVENT_OBS_DATABASE_FAILURES'
  | 'EVENT_OBS_WORKER_TICK_STALE'
  | 'EVENT_OBS_UNDISPATCHED_STALE'
  | 'EVENT_OBS_DUE_BACKLOG_STALE'
  | 'EVENT_OBS_LEASE_LOST'
  | 'EVENT_OBS_LEASE_LOST_EXCESSIVE'
  | 'EVENT_OBS_PROCESSING_LEASE_STALE';

export interface EventRolloutAlert {
  readonly code: EventRolloutAlertCode;
  readonly severity: 'DEGRADED' | 'BLOCKED';
  readonly value: number | boolean | null;
  readonly threshold: number | boolean | null;
}

export type EventWorkerRuntimeState = 'DISABLED' | 'STARTING' | 'RUNNING' | 'STOPPED';

export interface EventRuntimeSnapshot {
  readonly evaluatedAt: Date;
  readonly undispatchedCount: number;
  readonly oldestUndispatchedSeconds: number;
  readonly dueBacklogCount: number;
  readonly oldestDueBacklogSeconds: number;
  readonly manualCount: number;
  readonly unresolvedDispatcherFaultCount: number;
  readonly processingCount: number;
  readonly expiredProcessingCount: number;
  readonly staleExpiredProcessingCount: number;
  readonly leaseLost15mCount: number;
  readonly workerConfiguredEnabled: boolean | null;
  readonly workerState: EventWorkerRuntimeState | null;
  readonly workerProcessStartedAt: Date | null;
  readonly lastHeartbeatAt: Date | null;
  readonly lastSuccessfulTickAt: Date | null;
  readonly consecutiveDatabaseFailures: number | null;
}

export interface EventObservabilityMetrics {
  readonly undispatchedCount: number;
  readonly oldestUndispatchedSeconds: number;
  readonly dueBacklogCount: number;
  readonly oldestDueBacklogSeconds: number;
  readonly manualCount: number;
  readonly processingCount: number;
  readonly expiredProcessingCount: number;
  readonly staleExpiredProcessingCount: number;
  readonly leaseLost15mCount: number;
  readonly lastSuccessfulTickAt: Date | null;
  readonly lastHeartbeatAt: Date | null;
}

export interface EventRolloutEvaluation {
  readonly status: EventRolloutStatus;
  readonly mode: EventRolloutMode;
  readonly evaluatedAt: Date;
  readonly metrics: EventObservabilityMetrics;
  readonly alerts: readonly EventRolloutAlert[];
}
```

Copy dates on input/output, validate finite non-negative counts/ages, use inclusive comparisons, and sort alerts by BLOCKED before DEGRADED then code. Never accept or return arbitrary error text.

- [x] **Step 7: Run focused and regression tests**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test test/config/event-worker-config.test.ts test/config/event-observability-config.test.ts test/events/event-rollout-policy.test.ts
```

Expected: all tests pass.

- [x] **Step 8: Write `.superpowers/sdd/task-1-report.md`, obtain spec-compliance review, then code-quality review**

Record commands, exact test counts, changed files, no-Git compliance, and unresolved observations. Resolve all Critical/Important findings before Task 2.

---

### Task 2: Additive Worker Runtime Status Migration and Store

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/prisma/migrations/20260723090000_event_worker_runtime_status/migration.sql`
- Create: `LayerManage/law-firm-system/apps/server/test/db/spec-008-event-observability-migration-contract.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/events/event-worker-runtime-status-store.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/events/event-worker-runtime-status-store.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/prisma/schema.prisma`
- Modify: `LayerManage/law-firm-system/apps/server/test/db/schema-contract.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/scripts/ci/check-baseline-contract.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/ci/baseline-contract.test.ts`

**Interfaces:**
- Produces `EventWorkerRuntimeStatusStore` with `markDisabled`, `markStarting`, `recordHeartbeat`, `markStopped`, and `read`.
- The only accepted slot is the constant `EVENT_WORKER_PRIMARY_SLOT = 'primary'`.

- [x] **Step 1: Write migration/schema contract tests and update the expected model-count tests to 45**

Assert that the migration creates exactly the additive table, primary key, slot/state checks, non-negative version check, timestamp consistency checks, and no cascade/delete of event tables:

```ts
assert.match(sql, /CREATE TABLE "event_worker_runtime_status"/i);
assert.match(sql, /CHECK\s*\(\s*"slot"\s*=\s*'primary'\s*\)/i);
assert.match(sql, /CHECK[\s\S]*"state"\s+IN\s*\('DISABLED',\s*'STARTING',\s*'RUNNING',\s*'STOPPED'\)/i);
assert.doesNotMatch(sql, /DROP\s+TABLE|TRUNCATE|DELETE\s+FROM\s+"event_/i);
```

- [x] **Step 2: Run migration/schema tests and verify RED**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test test/db/spec-008-event-observability-migration-contract.test.ts test/db/schema-contract.test.ts test/ci/baseline-contract.test.ts
```

Expected: new contract fails and existing model-count tests report 44 instead of 45 until all contract updates are complete.

- [x] **Step 3: Add the Prisma model and SQL migration**

Add this Prisma model next to the event-center models:

```prisma
model EventWorkerRuntimeStatus {
  slot                 String    @id
  configuredEnabled    Boolean
  state                String
  processStartedAt     DateTime  @db.Timestamptz(3)
  lastHeartbeatAt      DateTime? @db.Timestamptz(3)
  lastSuccessfulTickAt DateTime? @db.Timestamptz(3)
  lastStoppedAt        DateTime? @db.Timestamptz(3)
  version              Int       @default(1)
  updatedAt            DateTime  @updatedAt @db.Timestamptz(3)

  @@map("event_worker_runtime_status")
}
```

The SQL migration must add named checks for primary slot, allowed state, `version >= 1`, RUNNING requiring both heartbeat timestamps, and STOPPED requiring `lastStoppedAt`. Do not add foreign keys or event-history writes.

- [x] **Step 4: Generate Prisma Client and run migration contracts GREEN**

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run db:generate
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test test/db/spec-008-event-observability-migration-contract.test.ts test/db/schema-contract.test.ts test/ci/baseline-contract.test.ts
```

Expected: all pass, canonical model count is 45.

- [x] **Step 5: Write real PostgreSQL store tests before the store**

Cover DISABLED, STARTING, first heartbeat → RUNNING, throttled no-op heartbeat, later heartbeat, STOPPED, repeated lifecycle calls, invalid dates, and exact single-row persistence. Use an injected clock and heartbeat interval; assert no forbidden fields exist in returned objects.

```ts
await store.markStarting(T0);
await store.recordHeartbeat(new Date(T0.getTime() + 10_000));
const status = await store.read();
assert.equal(status?.slot, 'primary');
assert.equal(status?.configuredEnabled, true);
assert.equal(status?.state, 'RUNNING');
assert.deepEqual(status?.processStartedAt, T0);
assert.deepEqual(status?.lastHeartbeatAt, T10);
assert.deepEqual(status?.lastSuccessfulTickAt, T10);
assert.equal(status?.lastStoppedAt, null);
assert.equal(status?.version, 2);
assert.ok(status?.updatedAt instanceof Date);
```

- [x] **Step 6: Run the store test RED**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 test/events/event-worker-runtime-status-store.test.ts
```

Expected: FAIL because the store file does not exist.

- [x] **Step 7: Implement the store with validated dates and database-side optimistic updates**

```ts
export class EventWorkerRuntimeStatusStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: { readonly heartbeatSeconds: number; readonly now?: () => Date },
  ) {}

  markDisabled(at = this.now()): Promise<void>;
  markStarting(at = this.now()): Promise<void>;
  recordHeartbeat(at = this.now()): Promise<void>;
  markStopped(at = this.now()): Promise<void>;
  read(): Promise<EventWorkerRuntimeStatus | null>;
}
```

Lifecycle transitions use `upsert`; heartbeat skips a write when the persisted heartbeat is newer than `at - heartbeatSeconds`. A successful write sets RUNNING and increments version. Returned dates are defensive copies.

- [x] **Step 8: Apply the migration only to the protected test database and run store/schema regressions**

Use the existing validated test environment and canonical deploy command; do not reset any non-test database.

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run db:deploy
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 test/events/event-worker-runtime-status-store.test.ts test/db/spec-008-event-observability-migration-contract.test.ts test/db/schema-contract.test.ts
```

Expected: all pass.

- [x] **Step 9: Report and two-stage review**

Document migration count 12, Prisma model count 45, exact target guard evidence without credentials, tests, and no-Git compliance. Resolve all Critical/Important findings.

---

### Task 3: PostgreSQL Runtime Snapshot Reader

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/events/event-runtime-snapshot-reader.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/events/event-runtime-snapshot-reader.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/application/events/event-services-factory.ts`

**Interfaces:**
- Consumes `EventRuntimeSnapshot`, `EventWorkerRuntimeStatusStore`, `EventWorkerHealthSnapshot`, and `leaseSeconds`.
- Produces `EventRuntimeSnapshotReader.read(workerHealth?: EventWorkerHealthSnapshot): Promise<EventRuntimeSnapshot>`.

- [x] **Step 1: Write real PostgreSQL aggregate tests**

Seed exact UTC timestamps and assert:

- no rows returns zero counts and null runtime status;
- PENDING uses `createdAt` as ready time;
- RETRY_WAIT counts only `nextAttemptAt <= now` and uses `nextAttemptAt` for age;
- future RETRY_WAIT is excluded;
- expired and stale PROCESSING use `lockedUntil <= now` and `lockedUntil <= now - leaseSeconds`;
- MANUAL and the three Dispatcher error codes are counted separately;
- LEASE_LOST uses `completedAt >= now - 15 minutes` exactly;
- oldest ages floor at zero if a future clock anomaly is encountered;
- the reader never selects payload, workerId, lockedBy, raw error, or notification content.

- [x] **Step 2: Run the reader test RED**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 test/events/event-runtime-snapshot-reader.test.ts
```

Expected: FAIL because the reader is missing.

- [x] **Step 3: Implement one-clock, bounded aggregate reads**

```ts
export class EventRuntimeSnapshotReader {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: {
      readonly leaseSeconds: number;
      readonly now?: () => Date;
      readonly runtimeStatus: Pick<EventWorkerRuntimeStatusStore, 'read'>;
    },
  ) {}

  async read(workerHealth?: EventWorkerHealthSnapshot): Promise<EventRuntimeSnapshot>;
}
```

Use one validated `now`, `Promise.all` for bounded count/find-first/group queries, and explicit `select` clauses. Compute the earlier of PENDING.createdAt and due RETRY_WAIT.nextAttemptAt in memory. Do not issue unbounded list queries.

- [x] **Step 4: Export reader/store through the service factory**

Extend `EventServices` with:

```ts
readonly runtimeStatus: EventWorkerRuntimeStatusStore;
readonly snapshotReader: EventRuntimeSnapshotReader;
```

Extend the cache signature with every observability configuration number so a Prisma client cannot silently reuse services built with different thresholds.

- [x] **Step 5: Run focused reader, factory, operations, and concurrency regressions**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 test/events/event-runtime-snapshot-reader.test.ts test/events/event-operations-service.test.ts test/events/event-worker-concurrency.test.ts
```

Expected: all pass.

- [x] **Step 6: Report and two-stage review**

Review query boundedness, exact timestamp semantics, safe field selection, and shared-service cache behavior before Task 4.

---

### Task 4: Worker Heartbeat and Egg Lifecycle Integration

**Files:**
- Modify: `LayerManage/law-firm-system/apps/server/app/application/events/event-worker.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/application/events/event-services-factory.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/events/event-worker.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/events/event-lifecycle.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/events/event-lifecycle-egg-enabled.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/events/event-lifecycle-egg-disabled.test.ts`

**Interfaces:**
- Consumes `EventWorkerRuntimeStatusStore`.
- Background `start()` enables heartbeats; direct `tick()` used by drain must never write RUNNING state.

- [x] **Step 1: Add failing Worker tests for background-only heartbeat behavior**

```ts
await worker.tick();
assert.equal(heartbeatCalls.length, 0, 'manual drain tick must not claim background liveness');
worker.start();
await scheduledTick();
assert.deepEqual(heartbeatCalls, [successfulTickAt]);
```

Also assert database/handler failures do not write a successful heartbeat, repeated in-flight ticks do not double-write, and heartbeat errors follow the existing safe database backoff path.

- [x] **Step 2: Add failing lifecycle tests for persisted state transitions**

Expected sequences:

```text
disabled: markDisabled -> no worker start -> no markStopped
enabled: markStarting -> worker.start -> worker.stop -> markStopped
stop failure: safe log -> best-effort markStopped only after stop resolves; timeout/failure must not claim STOPPED
```

- [x] **Step 3: Run lifecycle/worker tests RED**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 test/events/event-worker.test.ts test/events/event-lifecycle.test.ts test/events/event-lifecycle-egg-enabled.test.ts test/events/event-lifecycle-egg-disabled.test.ts
```

Expected: new assertions fail.

- [x] **Step 4: Inject runtime status into the Worker without changing drain semantics**

Add to `EventWorkerOptions`:

```ts
readonly runtimeStatus?: Pick<EventWorkerRuntimeStatusStore, 'recordHeartbeat'>;
```

After a complete successful tick and `health.recordSuccessfulTick`, call `recordHeartbeat` only when `this.started && !this.stopping`. A direct `tick()` before `start()` must retain current behavior and not update runtime status.

- [x] **Step 5: Make lifecycle status writes explicit and fail closed for readiness**

`AppBootHook.didReady()` always obtains the shared Prisma client and event services. It writes DISABLED when the switch is false; otherwise it writes STARTING before `worker.start()`. `beforeClose()` writes STOPPED only after a successful bounded `worker.stop()`. Status-write errors use constant safe log messages and leave readiness non-READY; no raw error is logged.

- [x] **Step 6: Run focused lifecycle and drain regressions GREEN**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 test/events/event-worker.test.ts test/events/event-lifecycle.test.ts test/events/event-lifecycle-egg-enabled.test.ts test/events/event-lifecycle-egg-disabled.test.ts test/events/event-drain-cli.test.ts
```

Expected: all pass; drain still creates no RUNNING heartbeat.

- [x] **Step 7: Report and two-stage review**

Review crash semantics, stop ordering, timer unref behavior, duplicate start protection, direct drain behavior, and log redaction.

---

### Task 5: Protected API Summary and Safe 503 Mapping

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/domain/events/event-observability-errors.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/application/events/event-operations-service.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/controller/eventOperations.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/middleware/errorHandler.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/events/event-operations-service.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/app/event-operations-api.test.ts`

**Interfaces:**
- Consumes `snapshotReader.read(health.workerSnapshot())` and `evaluateEventRollout`.
- Produces the additive `observability` property without changing existing summary fields.

- [x] **Step 1: Add failing service tests for additive summary evaluation**

```ts
assert.deepEqual(summary.observability, {
  status: 'READY', mode: 'preflight', evaluatedAt: NOW,
  metrics: expectedMetrics,
  alerts: [],
});
```

Assert mode comes from configured Worker enabled state, the same-process health snapshot contributes consecutive DB failures, and existing counts/recent24Hours/worker remain unchanged.

- [x] **Step 2: Add failing API tests for permissions, fields, and safe database failure**

Cover authorized READY and BLOCKED responses, unauthorized access, absence of forbidden fields, and a database failure response exactly equivalent to:

```json
{
  "code": 503,
  "message": "EVENT_OBSERVABILITY_UNAVAILABLE",
  "errors": null
}
```

Ignore the dynamic timestamp in equality. Assert no Prisma message, URL, payload, workerId, or stack appears.

- [x] **Step 3: Run service/API tests RED**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 test/events/event-operations-service.test.ts test/app/event-operations-api.test.ts
```

Expected: observability is absent and safe 503 handling is absent.

- [x] **Step 4: Implement the safe error boundary**

```ts
export class EventObservabilityUnavailableError extends Error {
  readonly code = 'EVENT_OBSERVABILITY_UNAVAILABLE';
  readonly httpStatus = 503;
}
```

Provide `isEventObservabilityDatabaseError(error)` for Prisma initialization/known/unknown/rust-panic/validation failures without serializing the error. The error middleware recognizes only this class and writes its constant code/status.

- [x] **Step 5: Extend `EventOperationsServiceOptions` and `summary()`**

```ts
readonly snapshotReader: Pick<EventRuntimeSnapshotReader, 'read'>;
readonly observability: EventObservabilityEnvironment;
readonly workerEnabled: boolean;
```

Read current summary data and observability snapshot, call the pure policy with mode derived from `workerEnabled`, serialize Date values through Egg JSON behavior, and map database failures to the safe unavailable error. Do not catch authorization errors as availability errors.

- [x] **Step 6: Inject shared services from the controller and run GREEN tests**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 test/events/event-operations-service.test.ts test/app/event-operations-api.test.ts test/app/authorization-middleware.test.ts
```

Expected: all pass.

- [x] **Step 7: Report and two-stage review**

Review add-only API compatibility, status-code handling, error classification, permission boundary, and forbidden-field absence.

---

### Task 6: Source and Portable `events:check` CLI

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/scripts/events/check-events.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/events/event-check-cli.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/package.json`
- Modify: `LayerManage/law-firm-system/apps/server/server-entry.js`
- Modify: `LayerManage/law-firm-system/apps/server/scripts/lib/portable-command.js`
- Modify: `LayerManage/law-firm-system/apps/server/test/build/portable-command.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/config/launcher-contract.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/build/pkg-event-check-smoke.test.ts`

**Interfaces:**
- Produces `checkEventsMain(argv, env, dependencies): Promise<number>`.
- Uses the same `EventRuntimeSnapshotReader` and `evaluateEventRollout` as the API.

- [x] **Step 1: Write strict parser and exit-code tests RED**

Accept only:

```text
--mode=preflight
--mode=canary
```

Reject missing, duplicate, split-form, unknown, and secret-bearing arguments before configuration or database access. Table-test exact codes 0/3/4/5/2/70 and assert every transcript excludes fixture secrets and raw errors.

- [x] **Step 2: Write one real PostgreSQL smoke test RED**

Seed DISABLED plus a clean snapshot and expect preflight exit 0. Seed one MANUAL and expect exit 4 with only `EVENT_OBS_MANUAL_PRESENT`. Clean fixtures through the protected helper.

- [x] **Step 3: Run CLI tests RED**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 test/events/event-check-cli.test.ts
```

Expected: command module is missing.

- [x] **Step 4: Implement the CLI adapter**

```ts
export interface CheckEventsCliDependencies {
  readonly stdout: NodeJS.WritableStream;
  readonly stderr: NodeJS.WritableStream;
  readonly assertMigrationsReady: (databaseUrl: string) => Promise<void>;
  readonly createPrisma: (databaseUrl: string) => PrismaClient;
  readonly createSnapshotReader: (prisma: PrismaClient, env: AppEnvironment) => EventRuntimeSnapshotReader;
}
```

Output one stable line ordered as: mode, status, undispatched, oldestUndispatchedSeconds, dueBacklog, oldestDueBacklogSeconds, manual, processing, expiredProcessing, staleExpiredProcessing, leaseLost15m, alertCodes, evaluatedAt. Alert codes are comma-separated or `none`; no dynamic arbitrary text is accepted.

- [x] **Step 5: Expose source and packaged commands**

Add:

```json
"events:check": "tsx scripts/events/check-events.ts"
```

Package `dist/scripts/events/check-events.js`, add `runCheck` to `server-entry.js`, and route `law-firm-system.exe events:check --mode=...` in `portable-command.js`. Do not weaken production environment validation.

- [x] **Step 6: Run CLI, launcher, portable-router, and package contract tests GREEN**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 test/events/event-check-cli.test.ts test/build/portable-command.test.ts test/config/launcher-contract.test.ts test/build/pkg-drain-smoke.test.ts
```

Expected: all pass; the existing drain command remains unchanged.

- [x] **Step 7: Report and two-stage review**

Review parser strictness, DB target validation, migration gate, disconnect cleanup, output schema, exit codes, packaged assets, and secret redaction.

---

### Task 7: Web Canary Status, Safe Alert Copy, and Responsive Metrics

**Files:**
- Modify: `LayerManage/law-firm-system/apps/web/src/features/event-operations/types.ts`
- Modify: `LayerManage/law-firm-system/apps/web/src/pages/EventOperations/index.tsx`
- Modify: `LayerManage/law-firm-system/apps/web/src/pages/EventOperations/event-operations.css`
- Modify: `LayerManage/law-firm-system/apps/web/src/pages/EventOperations/index.test.tsx`

**Interfaces:**
- Consumes only the additive API contract from Task 5.
- Unknown alert codes map to one code-owned generic sentence; backend text is never rendered.

- [x] **Step 1: Add exact frontend types**

```ts
export type EventRolloutStatus = 'READY' | 'DEGRADED' | 'BLOCKED';
export interface EventObservabilityAlert {
  code: string;
  severity: 'DEGRADED' | 'BLOCKED';
  value: number | boolean | null;
  threshold: number | boolean | null;
}
export interface EventObservabilitySummary {
  status: EventRolloutStatus;
  mode: 'preflight' | 'canary';
  evaluatedAt: string;
  metrics: EventObservabilityMetrics;
  alerts: EventObservabilityAlert[];
}
```

Add `observability` to `EventOperationsSummary`; define every metric explicitly rather than using an open record.

- [x] **Step 2: Write UI tests RED**

Cover:

- READY green banner and preflight/canary label;
- DEGRADED amber banner and LEASE_LOST advice;
- BLOCKED red banner and ordered alert advice;
- all metric cards and evaluated UTC time;
- explicit refresh reuses existing race/abort protection;
- unknown alert code shows generic safe text and does not render injected backend fields;
- no Worker toggle, delete, skip, edit, replay, archive, or cleanup buttons;
- mobile layout class remains accessible.

- [x] **Step 3: Run Web test RED**

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/web test -- --run src/pages/EventOperations/index.test.tsx
```

Expected: new observability assertions fail.

- [x] **Step 4: Implement code-owned status and alert mappings**

Use exhaustive status presentation and a bounded map for approved codes. Example:

```ts
const OBSERVABILITY_COPY: Record<string, string> = {
  EVENT_OBS_MANUAL_PRESENT: '存在需要人工处置的投递，禁止继续灰度。',
  EVENT_OBS_WORKER_TICK_STALE: 'Worker 心跳已过期，请关闭 Worker 并检查进程与数据库。',
};
const alertCopy = (code: string) => OBSERVABILITY_COPY[code] ?? '检测到未识别的事件运行告警，请停止灰度并联系系统维护人员。';
```

Render metrics from typed numeric fields; do not interpolate unknown backend strings into HTML.

- [x] **Step 5: Add responsive CSS and run Web focused tests GREEN**

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/web test -- --run src/pages/EventOperations/index.test.tsx src/features/event-operations/api.test.ts
```

Expected: all pass.

- [x] **Step 6: Run Web lint/typecheck/full tests/build**

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/web run lint
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/web run typecheck
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/web test -- --run
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/web run build
```

Expected: 0 errors; existing documented Hook and chunk warnings may remain but no new warning is accepted without review.

- [x] **Step 7: Report and two-stage review**

Review accessibility, responsive layout, race/abort behavior, unknown-code safety, permission boundary, and absence of mutation controls.

---

### Task 8: Load, Fault, Rollback, and 15-Minute Canary Rehearsal

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/test/events/event-observability-load.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/acceptance/spec-008-acceptance.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/scripts/rehearsal/rehearse-event-observability.ts`
- Modify: `LayerManage/law-firm-system/apps/server/package.json`
- Modify: `docs/superpowers/runbooks/reliable-event-center-outbox.md`
- Modify: `LayerManage/law-firm-system/docs/DEPLOY.md`
- Modify: `LayerManage/law-firm-system/apps/server/test/security/spec-007-event-leakage.test.ts`

**Interfaces:**
- Uses production factories, reader, policy, drain, and check CLI; test-only dependency faults never enter production code.
- Produces a guarded `rehearse:event-observability` command and redacted result summary.

- [x] **Step 1: Write acceptance RED tests before the rehearsal helper**

Acceptance must prove:

1. DISABLED + clean state → preflight READY.
2. One governed event + drain → one notification; second drain is empty.
3. STARTING then successful background tick → RUNNING + canary READY.
4. Controlled database dependency failure → API/CLI safe unavailable; restored dependency → READY.
5. Unknown event version → one internal quarantine MANUAL, EventLog remains undispatched, canary BLOCKED, no handler side effect.
6. STOPPED/DISABLED rollback prevents new claims while preserving event rows.
7. Serialized evidence contains no known fixture secrets.

- [x] **Step 2: Write bounded load/soak tests RED**

Within one test, use independent Prisma clients and four workers to process exactly 200 controlled events. Advance an injected clock through 60 one-second waves without real sleeping. Assert backlog converges, heartbeat writes are throttled, every event ID has one successful delivery, one successful HandlerLog, and one deduplicated notification, and no duplicate idempotency key exists.

- [x] **Step 3: Run acceptance/load tests RED**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 test/acceptance/spec-008-acceptance.test.ts test/events/event-observability-load.test.ts
```

Expected: rehearsal/acceptance helpers are incomplete until the implementation is wired.

- [x] **Step 4: Implement the guarded rehearsal command**

Add:

```json
"rehearse:event-observability": "tsx scripts/rehearsal/rehearse-event-observability.ts"
```

The command must require `ALLOW_TEST_DB_RESET=true`, a new explicit `ALLOW_EVENT_OBSERVABILITY_REHEARSAL=true`, `EVENT_WORKER_ENABLED=false`, exact localhost test target, explicit port 55432, and literal `DATABASE_URL === DATABASE_URL_TEST` before fixture setup. It must refuse remote hosts, aliases, missing ports, query/userinfo differences, or non-test database names and must always execute finally cleanup.

The real-time canary observation defaults to `EVENT_OBSERVABILITY_CANARY_WINDOW_MINUTES=15`. Tests inject a clock/window dependency; the final authority run uses the real 15-minute window. Output contains only phase, status, safe counts, alert codes, UTC start/end, and elapsed seconds.

- [x] **Step 5: Implement controlled database-failure and restart drills without destructive host actions**

Inject a dependency that throws the same classified Prisma availability error for one check, assert exit 5/HTTP 503, restore the real reader, and assert READY. Exercise actual lifecycle STOPPED/STARTING/RUNNING records and real lease recovery in PostgreSQL. Do not stop Docker, alter firewall rules, kill unrelated processes, or print connection details.

- [x] **Step 6: Update runbook/deployment docs and leakage signatures**

Document exact preflight, drain, canary, DEGRADED extension, BLOCKED rollback, and portable/source check commands. Add known SPEC-008 fixture markers and new report paths to the existing leakage scanner contract without weakening any SPEC-006/007 signature.

- [x] **Step 7: Run focused acceptance/load/security tests GREEN**

```powershell
npx.cmd -y -p node@22.14.0 node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 test/acceptance/spec-008-acceptance.test.ts test/events/event-observability-load.test.ts test/security/spec-007-event-leakage.test.ts
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run check:docs-leakage
```

Expected: all pass.

- [x] **Step 8: Run the protected real 15-minute rehearsal**

After independently re-validating the exact target and reset guard, run:

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run rehearse:event-observability
```

Expected: preflight READY, drain idempotent, canary READY for the complete window, controlled failure fail-closed, recovery READY, rollback DISABLED, unique notification evidence, finally cleanup complete.

- [x] **Step 9: Report and two-stage review**

Record only redacted timestamps, elapsed times, counts, statuses, and remaining risks; this rehearsal does not create a dump or other binary artifact. Resolve all Critical/Important findings.

---

### Task 9: Full No-Git Verification, Closeout, and Handoff

**Files:**
- Create: `docs/superpowers/reports/spec-008-closeout.md`
- Modify: `docs/superpowers/handoffs/2026-07-21-cross-device-migration-handoff.md`
- Modify: `.superpowers/sdd/progress.md`
- Create/Modify: `.superpowers/sdd/task-9-report.md`, `.superpowers/sdd/task-9-review.md`
- Modify: `docs/superpowers/plans/2026-07-23-event-center-production-canary-observability.md` checkboxes only after evidence exists.

**Interfaces:**
- Consumes all Task 1–8 outputs.
- Produces the authoritative SPEC-008 evidence set and continuation point.

- [x] **Step 1: Build an explicit no-Git Server test manifest**

Use `rg --files test -g '*.test.ts'` to enumerate tests, explicitly remove only `test/ci/distribution-config-contract.test.ts`, record discovered/excluded/executed counts, and pass the remaining list to the serial Node test runner. Do not invoke a package script that rediscovers and runs the Git-calling test.

- [x] **Step 2: Run fresh Server lint, typecheck, no-Git tests, and c8 coverage**

Use Node 22.14.0 and `--test-concurrency=1`. Capture exact totals and verify zero failures. Coverage must not regress below the SPEC-007 accepted gates unless an independently reviewed, documented reason is approved; target statements/lines ≥85%, branches ≥83%, functions ≥91%.

- [x] **Step 3: Run fresh Server clean build, Prisma generate, post-build, leakage, baseline, and packaged command smoke tests**

Verify the new CLI asset exists in the portable tree and its invalid-argument smoke test leaks no fixture content. Do not run the distribution Git contract.

- [x] **Step 4: Run fresh Web lint, typecheck, full tests, and build**

Record file/test counts and distinguish existing nonblocking warnings from new findings.

- [x] **Step 5: Run security tests and dependency audits**

Run the existing 38+ security test suite, production audit, full audit, and Web audits. Require 0 high/critical vulnerabilities; do not use forced major upgrades or widen exceptions without a separate review.

- [x] **Step 6: Verify database cleanup and migration/model authority**

Assert 12 canonical migrations, 45 Prisma models, every source application table empty, and no isolated restore/rehearsal database remains. Never include credentials in output or docs.

- [x] **Step 7: Run persistent documentation leakage scan after writing reports**

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix LayerManage/law-firm-system/apps/server run check:docs-leakage
```

Expected: `Persisted documentation leakage scan passed.`

- [x] **Step 8: Obtain final independent review and re-review**

The reviewer checks spec compliance, code quality, security/privacy, SQL/migration safety, failure semantics, CLI packaging, Web safety, test evidence, and no-Git compliance. Resolve every Critical/Important issue and repeat affected verification. Minor issues must be either fixed or explicitly accepted with rationale.

- [x] **Step 9: Write closeout and handoff**

Include exact authoritative commands, totals, coverage, 15-minute rehearsal timestamps/results, migration/model counts, audit results, database cleanup, known nonblocking warnings, remaining risks, and the next recommended task. Do not claim completion until every required check has fresh passing evidence.

---

## Plan Self-Review Checklist

- [x] Every requirement in the approved SPEC-008 design maps to Task 1–9.
- [x] No placeholder language remains.
- [x] Types and signatures are consistent across policy, store, reader, factory, API, CLI, and Web.
- [x] The independent CLI uses persistent heartbeat state and never relies on application memory.
- [x] Manual drain ticks cannot claim background Worker liveness.
- [x] Database failure, crash, startup grace, graceful stop, lease loss, unknown event, and rollback all fail closed.
- [x] No event-history mutation, destructive rollback, remote Worker toggle, external monitoring dependency, archive, or cleanup endpoint has entered scope.
- [x] Every task has RED/GREEN evidence and two-stage review.
- [x] No step contains or invokes a Git/GitHub command.
