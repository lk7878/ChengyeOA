import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { text } from 'node:stream/consumers';
import type { Readable } from 'node:stream';
import PersonalFileController from '../../app/controller/personalFile';
import { PersonalFileTransfer } from '../../app/application/collaboration/personal-file-transfer';
import type { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { createTestPrisma, clearTestApplicationData } from '../helpers/test-database';

test('preview enforces personal version access, sharing, revocation and organization audit', async () => {
  const db = createTestPrisma();
  const root = await mkdtemp(path.join(tmpdir(), 'oa-preview-access-'));
  const previous = process.env.PERSONAL_FILES_STORAGE_ROOT;
  process.env.PERSONAL_FILES_STORAGE_ROOT = root;
  try {
    await clearTestApplicationData(db);
    const [owner, reader, admin] = await Promise.all(['owner', 'reader', 'admin'].map(async (username): Promise<AuthorizationContext> => ({
      userId: (await db.user.create({ data: { username, password: 'unused' } })).id, employeeId: null, isSystemAdmin: false,
      isSystemSuperAdmin: username === 'admin', grants: [], fieldRules: [], permissionCodes: [], evaluatedAt: new Date(),
    })));
    const service = new PersonalFileTransfer(db, owner);
    const file = await service.create({ name: '材料.txt', kind: 'FILE', content: Buffer.from('第一版').toString('base64') });
    await service.replace(file.id, { version: 1, name: '材料.txt', content: Buffer.from('第二版').toString('base64') });
    async function preview(authorization: AuthorizationContext, version: number, global = false) {
      const headers = new Map<string, string>();
      const ctx = { prisma: db, state: { authorization }, params: { id: file.id, version: String(version) }, query: { preview: '1' },
        set: (k: string, v: string) => headers.set(k, v), attachment() {}, body: undefined as Readable | undefined };
      const controller = Object.assign(Object.create(PersonalFileController.prototype), { ctx }) as PersonalFileController;
      await (global ? controller.globalContent() : controller.content());
      assert.equal(headers.get('Cache-Control'), 'private, no-store');
      assert.equal(headers.get('X-OA-Preview'), 'text');
      return text(ctx.body!);
    }
    assert.equal(await preview(owner, 2), '第二版');
    await assert.rejects(preview(reader, 1), /COLLAB_FORBIDDEN/);
    await assert.rejects(preview(reader, 1, true), /COLLAB_FORBIDDEN/);
    const grant = { principalType: 'USER', principalId: reader.userId, role: 'READER', rowScope: 'ALL', canCreate: false, hiddenFields: [], readonlyFields: [] };
    await service.share(file.id, { version: 2, policy: { restricted: true, grants: [grant] } });
    assert.equal(await preview(reader, 1), '第一版');
    assert.equal(await preview(reader, 2), '第二版');
    await service.share(file.id, { version: 3, policy: { restricted: true, grants: [] } });
    await assert.rejects(preview(reader, 2), /COLLAB_FORBIDDEN/);
    assert.equal(await preview(admin, 1, true), '第一版');
    assert.equal(await db.operationLog.count({ where: { userId: admin.userId, targetId: file.id, action: 'ALL_FILES_READ' } }), 1);
  } finally {
    await db.$disconnect();
    await rm(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.PERSONAL_FILES_STORAGE_ROOT;
    else process.env.PERSONAL_FILES_STORAGE_ROOT = previous;
  }
});
