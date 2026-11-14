import assert from 'node:assert/strict';
import test from 'node:test';

import mm from 'egg-mock';

import { EventWorker } from '../../app/application/events/event-worker';
import { EventWorkerRuntimeStatusStore } from '../../app/application/events/event-worker-runtime-status-store';

process.env.EGG_TYPESCRIPT = 'true';
process.env.EVENT_WORKER_ENABLED = 'true';

const originalStart = EventWorker.prototype.start;
const originalStop = EventWorker.prototype.stop;
const originalMarkStarting = EventWorkerRuntimeStatusStore.prototype.markStarting;
const originalMarkStopped = EventWorkerRuntimeStatusStore.prototype.markStopped;
let startCalls = 0;
const stopTimeouts: number[] = [];
let startingCalls = 0;
let stoppedCalls = 0;
EventWorker.prototype.start = function observedStart(): void { startCalls += 1; };
EventWorker.prototype.stop = async function observedStop(timeoutMs: number): Promise<void> {
  stopTimeouts.push(timeoutMs);
};
EventWorkerRuntimeStatusStore.prototype.markStarting = async function observedMarkStarting(): Promise<void> {
  startingCalls += 1;
};
EventWorkerRuntimeStatusStore.prototype.markStopped = async function observedMarkStopped(): Promise<void> {
  stoppedCalls += 1;
};
const app = mm.app();

test.before(async () => { await app.ready(); });
test.after(async () => {
  await app.close().catch(() => undefined);
  EventWorker.prototype.start = originalStart;
  EventWorker.prototype.stop = originalStop;
  EventWorkerRuntimeStatusStore.prototype.markStarting = originalMarkStarting;
  EventWorkerRuntimeStatusStore.prototype.markStopped = originalMarkStopped;
  await mm.restore();
});

test('real Egg enabled app.ready starts and closes exactly one worker', async () => {
  await app.ready();
  assert.equal(startCalls, 1);
  assert.equal(startingCalls, 1);
  await app.close();
  assert.deepEqual(stopTimeouts, [ 30_000 ]);
  assert.equal(stoppedCalls, 1);
});
