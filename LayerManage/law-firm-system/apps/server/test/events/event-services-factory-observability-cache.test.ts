import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { createEventServices } from '../../app/application/events/event-services-factory';
import type { EventObservabilityEnvironment, EventWorkerEnvironment } from '../../config/env';

const WORKER_CONFIG: EventWorkerEnvironment = Object.freeze({
  enabled: false,
  pollMs: 1_000,
  batchSize: 25,
  leaseSeconds: 60,
  shutdownSeconds: 30,
});
const OBSERVABILITY_CONFIG: EventObservabilityEnvironment = Object.freeze({
  heartbeatSeconds: 10,
  heartbeatStaleSeconds: 60,
  undispatchedBlockSeconds: 120,
  dueBacklogBlockSeconds: 300,
  leaseLostDegradedCount: 1,
  leaseLostBlockedCount: 3,
  canaryWindowMinutes: 15,
});

test('factory rejects explicit generated-worker-id after an omitted auto worker id', async () => {
  const client = new PrismaClient();
  try {
    createEventServices(client, WORKER_CONFIG, { observability: OBSERVABILITY_CONFIG });

    assert.throws(
      () => createEventServices(client, WORKER_CONFIG, {
        workerId: 'generated-worker-id',
        observability: OBSERVABILITY_CONFIG,
      }),
      /already initialized with different configuration/,
    );
  } finally {
    await client.$disconnect();
  }
});

test('factory rejects an omitted auto worker id after explicit generated-worker-id', async () => {
  const client = new PrismaClient();
  try {
    createEventServices(client, WORKER_CONFIG, {
      workerId: 'generated-worker-id',
      observability: OBSERVABILITY_CONFIG,
    });

    assert.throws(
      () => createEventServices(client, WORKER_CONFIG, { observability: OBSERVABILITY_CONFIG }),
      /already initialized with different configuration/,
    );
  } finally {
    await client.$disconnect();
  }
});

// SPEC-009 终审条目 18 根治（常驻契约）：三处生产调用点（app.ts 启动钩子 /
// controller/eventOperations.ts / admin-governance/governance-factory.ts）的
// createEventServices 必须同源传 observability 与 leadRecycle——非默认
// EVENT_OBSERVABILITY_*/LEAD_RECYCLE_* 环境下任一调用点缺省都会与启动钩子签名不一致
// fail-fast（条目 17/18 同类回退已发生两次）。纯静态 grep（不起库），防第三次回退。
test('every production createEventServices call site passes observability and leadRecycle from app config', () => {
  const callSites = [
    'app.ts',
    'app/controller/eventOperations.ts',
    'app/application/admin-governance/governance-factory.ts',
  ];
  for (const relativePath of callSites) {
    const source = fs.readFileSync(path.resolve(relativePath), 'utf8');
    const callIndex = source.indexOf('createEventServices(');
    assert.ok(callIndex >= 0, `${relativePath} must call createEventServices`);
    const callSource = source.slice(callIndex);
    assert.match(
      callSource,
      /observability:\s*(?:this\.)?(?:ctx\.app|app)\.config\.eventObservability/,
      `${relativePath} must pass observability from app config`,
    );
    assert.match(
      callSource,
      /leadRecycle:\s*(?:this\.)?(?:ctx\.app|app)\.config\.leadRecycle/,
      `${relativePath} must pass leadRecycle from app config`,
    );
  }
});
