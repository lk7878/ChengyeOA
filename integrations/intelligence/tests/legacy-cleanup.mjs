import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import { removeLegacyWorkspace } from '../case-view/legacy-cleanup.mjs';

const origin = 'http://localhost:3000';
const directory = user => 'chengye-workspace-' + createHash('sha256').update(origin + '\0' + user).digest('hex');
function fixture({ locked = false, failure } = {}) {
  const deleted = []; const locks = [];
  const entries = new Set([directory('admin'), directory('lmj'), 'chengye-wiki-' + 'a'.repeat(64), 'oa-attachments']);
  const environment = { crypto: webcrypto, location: { origin }, navigator: {
    locks: { request: async (name, options, action) => { locks.push({ name, options }); return action(locked ? null : {}); } },
    storage: { getDirectory: async () => ({ removeEntry: async (name, options) => {
      if (failure) throw failure;
      if (!entries.has(name)) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
      assert.deepEqual(options, { recursive: true }); deleted.push(name); entries.delete(name);
    } }) },
  } };
  return { environment, deleted, locks, entries };
}
test('deletes only the signed-in account legacy partition, preserving other accounts and OA/wiki storage', async () => {
  const f = fixture(); assert.equal(await removeLegacyWorkspace('admin', f.environment), 'removed');
  assert.deepEqual(f.deleted, [directory('admin')]);
  assert.equal(f.entries.size, 3); assert(f.entries.has(directory('lmj'))); assert(f.entries.has('oa-attachments'));
  assert.deepEqual(f.locks, [{ name: directory('admin'), options: { ifAvailable: true } }]);
});
test('repeated cleanup is idempotent without recreating the database', async () => {
  const f = fixture(); await removeLegacyWorkspace('admin', f.environment);
  assert.equal(await removeLegacyWorkspace('admin', f.environment), 'absent'); assert.equal(f.deleted.length, 1);
});
test('active legacy tab prevents removal', async () => {
  const f = fixture({ locked: true }); await assert.rejects(removeLegacyWorkspace('admin', f.environment), /关闭其他页面/);
  assert.equal(f.deleted.length, 0);
});
test('real storage failure is reported rather than marked complete', async () => {
  const f = fixture({ failure: new Error('locked storage') }); await assert.rejects(removeLegacyWorkspace('admin', f.environment), /locked storage/);
});
test('missing identity cannot trigger deletion', async () => {
  const f = fixture(); await assert.rejects(removeLegacyWorkspace('', f.environment), /账号/); assert.equal(f.locks.length, 0);
});
test('unsupported browser does not block server workspace', async () => {
  assert.equal(await removeLegacyWorkspace('admin', { navigator: {} }), 'unavailable');
});
