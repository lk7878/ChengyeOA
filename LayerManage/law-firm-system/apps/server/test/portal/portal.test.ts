import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestPrisma } from '../helpers/test-database';
import {
  manageList,
  portalFeed,
  publishPortal,
  readAsset,
  saveDraft,
} from '../../app/application/portal/portal';
import { isAuthenticationPublicPath } from '../../app/domain/security/auth-paths';

test('portal staff directory, published versions, file withdrawal and explicit public release', async () => {
  const db = createTestPrisma();
  try {
    const admin = await db.user.create({ data: { username: 'portal-admin', password: 'unused' } });
    const person = await db.employee.create({
      data: {
        employeeNo: 'L1',
        name: '律师甲',
        type: 'LAWYER',
        phone: 'private-phone',
        entryDate: new Date(),
      },
    });
    const reader = await db.user.create({
      data: { username: 'portal-reader', password: 'unused', employeeId: person.id },
    });
    await db.employee.create({
      data: { employeeNo: 'L2', name: '未绑定员工', type: 'LAWYER', phone: '0', entryDate: new Date() },
    });
    const org = await db.organization.create({
      data: { name: '团队组织', type: 'FIRM', code: 'PORTAL', path: '/portal', sort: 99 },
    });
    const team = await db.professionalTeam.create({
      data: { name: '律师团队', code: 'PORTAL-T', categoryCode: 'TEST', homeOrganizationId: org.id },
    });
    const member = await db.professionalTeamMember.create({
      data: {
        professionalTeamId: team.id,
        employeeId: person.id,
        memberRole: 'MEMBER',
        startedAt: new Date(0),
      },
    });
    const inside = await portalFeed(db, false);
    assert.deepEqual(
      inside.people.map((p) => p.name),
      ['律师甲'],
    );
    assert.deepEqual(inside.people[0].teams, [team.id]);
    assert.ok(!JSON.stringify(inside).includes('private-phone'));
    assert.deepEqual((await portalFeed(db, true)).people, []);
    assert.equal(isAuthenticationPublicPath('/api/v1/portal/admin'), false);
    assert.equal(isAuthenticationPublicPath('/api/v1/portal'), false);
    const create = (kind: string, props: Record<string, unknown> = {}) =>
      saveDraft(db, admin.id, undefined, { kind, title: '测试', ...props });
    const bytes = Buffer.from('first file');
    const doc = await create('DOWNLOAD', { file: { name: '模板.txt', data: bytes.toString('base64') } });
    const draft = (await manageList(db)).entries.find((i) => i.id === doc.id)!.draft;
    assert.deepEqual((await portalFeed(db, false)).entries, []);
    await assert.rejects(readAsset(db, doc.id, draft.fileId!, false));
    await publishPortal(db, doc.id, 1, true, admin.id);
    assert.deepEqual(Buffer.from((await readAsset(db, doc.id, draft.fileId!, false)).bytes), bytes);
    await saveDraft(db, admin.id, doc.id, {
      kind: 'DOWNLOAD',
      title: '新版',
      version: 2,
      file: { name: '模板2.txt', data: Buffer.from('second').toString('base64') },
    });
    assert.equal((await portalFeed(db, false)).entries[0].number, 1);
    await assert.rejects(publishPortal(db, doc.id, 2, true, admin.id));
    await publishPortal(db, doc.id, 3, true, admin.id);
    const published = (await portalFeed(db, false)).entries[0];
    assert.equal(published.number, 2);
    await assert.rejects(readAsset(db, doc.id, draft.fileId!, false));
    await assert.rejects(readAsset(db, doc.id, published.file!.id, true));
    await publishPortal(db, doc.id, 4, false, admin.id);
    await assert.rejects(readAsset(db, doc.id, published.file!.id, false));
    await assert.rejects(create('NOTICE', { external: true }));
    const expiry = await create('NOTICE', { expiresAt: '2000-01-01' });
    await assert.rejects(publishPortal(db, expiry.id, 1, true, admin.id));
    const photo = { name: 'portrait.png', data: Buffer.from('89504e470d0a1a0a', 'hex').toString('base64') };
    const profile = await create('LAWYER', { subject: person.id, image: photo, external: true });
    await publishPortal(db, profile.id, 1, true, admin.id);
    const honor = await create('HONOR', { subject: person.id, period: '本月' });
    await publishPortal(db, honor.id, 1, true, admin.id);
    const out = (await portalFeed(db, true)).entries;
    assert.deepEqual(
      out.map((i) => i.kind),
      ['LAWYER'],
    );
    const photoId = out[0].image!.id;
    assert.equal((await readAsset(db, profile.id, photoId, true)).mime, 'image/png');
    assert.equal((await portalFeed(db, false)).entries.find((i) => i.kind === 'HONOR')?.image?.id, photoId);
    await assert.rejects(readAsset(db, honor.id, photoId, true));
    await db.professionalTeamMember.update({ where: { id: member.id }, data: { endedAt: new Date(0) } });
    assert.deepEqual((await portalFeed(db, false)).people[0].teams, []);
    await db.user.update({ where: { id: reader.id }, data: { status: 'DISABLED' } });
    assert.deepEqual((await portalFeed(db, false)).people, []);
    assert.deepEqual((await portalFeed(db, false)).entries, []);
    await assert.rejects(readAsset(db, honor.id, photoId, false));
    assert.deepEqual((await portalFeed(db, true)).entries, []);
    await assert.rejects(readAsset(db, profile.id, photoId, true));
  } finally {
    await db.$disconnect();
  }
});
