import assert from 'node:assert/strict';
import test from 'node:test';

import mm from 'egg-mock';

import { EventWorker } from '../../app/application/events/event-worker';
import { EventWorkerRuntimeStatusStore } from '../../app/application/events/event-worker-runtime-status-store';

process.env.EGG_TYPESCRIPT = 'true';
process.env.EVENT_WORKER_ENABLED = 'false';

const originalStart = EventWorker.prototype.start;
const originalStop = EventWorker.prototype.stop;
const originalMarkDisabled = EventWorkerRuntimeStatusStore.prototype.markDisabled;
const originalMarkStopped = EventWorkerRuntimeStatusStore.prototype.markStopped;
let startCalls = 0;
const stopTimeouts: number[] = [];
let disabledCalls = 0;
let stoppedCalls = 0;
EventWorker.prototype.start = function observedStart(): void { startCalls += 1; };
EventWorker.prototype.stop = async function observedStop(timeoutMs: number): Promise<void> {
  stopTimeouts.push(timeoutMs);
};
EventWorkerRuntimeStatusStore.prototype.markDisabled = async function observedMarkDisabled(): Promise<void> {
  disabledCalls += 1;
};
EventWorkerRuntimeStatusStore.prototype.markStopped = async function observedMarkStopped(): Promise<void> {
  stoppedCalls += 1;
};
const app = mm.app();

test.before(async () => {
  await app.ready();
});
test.after(async () => {
  await app.close().catch(() => undefined);
  EventWorker.prototype.start = originalStart;
  EventWorker.prototype.stop = originalStop;
  EventWorkerRuntimeStatusStore.prototype.markDisabled = originalMarkDisabled;
  EventWorkerRuntimeStatusStore.prototype.markStopped = originalMarkStopped;
  await mm.restore();
});

test('real Egg unittest app.ready does not auto-start a disabled worker', async () => {
  await app.ready();
  assert.equal(startCalls, 0);
  assert.equal(disabledCalls, 1);
  await app.close();
  assert.deepEqual(stopTimeouts, []);
  assert.equal(stoppedCalls, 0);
});
