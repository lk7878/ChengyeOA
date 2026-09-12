import { SessionPersistence, PersistenceCoordinator } from '../../../third_party/deepseek-harness/packages/session/session-persistence/lib/index.js';

/** Keep the official checkpoint/repair coordinator; durable primitives live in the browser. */
export class BrowserSessionPersistence extends SessionPersistence {
  supportsRawArtifacts = false;
  constructor(ctx, request) {
    super(ctx); this.request = request;
    this.coordinator = new PersistenceCoordinator(ctx, this, { preparedSessionCacheSize: 5, writeBatchMaxDelayMs: 200 });
  }
  locate() { return undefined; }
  create(meta) { return this.coordinator.create(meta); }
  ensureMaterialized(session) { return this.coordinator.ensureMaterialized(session); }
  append(id, events) { return this.coordinator.append(id, events); }
  prepare(id, signal) { return this.coordinator.prepare(id, signal); }
  load(id) { return this.coordinator.load(id); }
  inspect(id, signal) { return this.coordinator.inspect(id, signal); }
  borrowSession(id, signal) { return this.coordinator.borrowSession(id, signal); }
  readFrom(id, fromSeq, signal) { return this.coordinator.readFrom(id, fromSeq, signal); }
  loadStored(id, signal) { return this.request(id, 'load', { id }, signal).then(value => value ?? undefined); }
  readStoredRevision(id, signal) { return this.request(id, 'revision', { id }, signal).then(value => value ?? undefined); }
  materializeHeader(meta) { return this.request(meta.id, 'materialize', { meta }); }
  appendBatch(meta, events, isMaterialized) { return this.request(meta.id, 'append', { meta, events, isMaterialized }); }
  commitRepair(meta, tornMarker, closers) {
    if (tornMarker !== undefined) throw new Error('Unexpected browser transaction torn marker');
    return this.request(meta.id, 'repair', { meta, events: closers });
  }
  list(signal) { return this.request('', 'list', {}, signal); }
  listSnapshots(signal) { return this.request('', 'snapshots', {}, signal); }
}
