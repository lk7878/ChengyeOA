// SPEC-042 Task 2: case-file 服务契约测试（上传落盘/列表/下载/删除 + 校验/权限/审计）。
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { CaseFileService } from '../../app/application/case/case-file-service';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { CASE_ERROR_CODES, CaseError } from '../../app/domain/case/case-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const FILE_PERMISSIONS: PermissionCode[] = ['case.file.read', 'case.file.manage'];

const prisma = createTestPrisma();

test.before(async () => {
  await prisma.$connect();
});

test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

function fileContext(userId: string, permissionCodes: PermissionCode[] = FILE_PERMISSIONS): AuthorizationContext {
  return {
    userId,
    employeeId: null,
    isSystemAdmin: false,
    isSystemSuperAdmin: false,
    permissionCodes,
    grants: permissionCodes.map(permissionCode => ({
      sourceType: 'ROLE' as const,
      sourceId: `${userId}-grant-${permissionCode}`,
      sourceRoleId: 'test-role',
      permissionCode,
      resource: permissionCode.split('.')[0],
      scopeIds: ['ALL'],
      validUntil: null,
    })),
    dataScope: { clause: '1=1', params: [], forcePersonLevel: false },
    delegatedScopes: [],
    isDelegated: false,
  };
}

async function serviceFor(permissionCodes: PermissionCode[] = FILE_PERMISSIONS): Promise<{ service: CaseFileService; userId: string }> {
  const user = await prisma.user.create({
    data: { username: `casefile.actor.${randomUUID()}`, password: 'x' },
  });
  const actor: AuditActor = { actorUserId: user.id, requestId: `req-${randomUUID()}` };
  return { service: new CaseFileService(prisma, actor, fileContext(user.id, permissionCodes)), userId: user.id };
}

async function seedCase(status = 'PENDING'): Promise<string> {
  const customer = await prisma.customer.create({
    data: {
      customerNo: `CU-${randomUUID()}`,
      name: '案件文件客户',
      phone: '13800001111',
      phoneHash: 'seed',
      status: 'SIGNED',
      createdBy: 'seed',
    },
  });
  const created = await prisma.case.create({
    data: { caseNo: `CA-${randomUUID()}`, title: '文件案', customerId: customer.id, caseType: '民事', status },
  });
  return created.id;
}

const SAMPLE_BASE64 = Buffer.from('hello case file').toString('base64');

test('upload persists a file to disk and DB with audit, and validates inputs', async () => {
  const { service } = await serviceFor();
  const caseId = await seedCase();

  const view = await service.upload(caseId, {
    fileName: '证据材料.txt',
    fileType: 'text/plain',
    base64: SAMPLE_BASE64,
  });
  assert.equal(view.caseId, caseId);
  assert.equal(view.fileName, '证据材料.txt');
  assert.equal(view.fileType, 'text/plain');
  assert.equal(view.fileSize, Buffer.byteLength('hello case file'));

  // 磁盘落盘 + DB 记录。
  const record = await prisma.caseFile.findUnique({ where: { id: view.id } });
  assert.ok(record, 'case file record persisted');
  assert.ok(fs.existsSync(path.join(process.cwd(), 'var', 'storage', 'case-files', record.filePath)), 'file written to disk');

  const audit = await prisma.operationLog.findFirst({ where: { action: 'CASE_FILE_UPLOAD', targetType: 'CASE_FILE' } });
  assert.ok(audit, 'a CASE_FILE_UPLOAD audit is written');

  // 案件不存在 → 404。
  await assert.rejects(
    () => service.upload(randomUUID(), { fileName: 'x.txt', fileType: 'text/plain', base64: SAMPLE_BASE64 }),
    (error: unknown) => error instanceof CaseError && error.code === CASE_ERROR_CODES.CASE_NOT_FOUND && error.httpStatus === 404,
  );

  // 终态案件 → 409。
  const closedCaseId = await seedCase('CLOSED');
  await assert.rejects(
    () => service.upload(closedCaseId, { fileName: 'x.txt', fileType: 'text/plain', base64: SAMPLE_BASE64 }),
    (error: unknown) => error instanceof CaseError && error.code === CASE_ERROR_CODES.CASE_STATE_INVALID && error.httpStatus === 409,
  );

  // 非法 base64 → 400 CASE_FILE_INVALID。
  await assert.rejects(
    () => service.upload(caseId, { fileName: 'x.txt', fileType: 'text/plain', base64: '!!!not-base64!!!' }),
    (error: unknown) => error instanceof CaseError && error.code === CASE_ERROR_CODES.CASE_FILE_INVALID && error.httpStatus === 400,
  );

  // 无 case.file.manage → 403。
  await assert.rejects(
    async () => (await serviceFor(['case.file.read'])).service.upload(caseId, { fileName: 'x.txt', fileType: 'text/plain', base64: SAMPLE_BASE64 }),
    { name: 'AuthorizationError' },
  );
});

test('list returns only the case files; download returns base64; remove deletes file and record', async () => {
  const { service } = await serviceFor();
  const caseId = await seedCase();
  const otherCaseId = await seedCase();

  const f1 = await service.upload(caseId, { fileName: 'a.txt', fileType: 'text/plain', base64: SAMPLE_BASE64 });
  const f2 = await service.upload(caseId, { fileName: 'b.txt', fileType: 'text/plain', base64: SAMPLE_BASE64 });
  await service.upload(otherCaseId, { fileName: 'c.txt', fileType: 'text/plain', base64: SAMPLE_BASE64 });

  const list = await service.list(caseId, { page: 1, pageSize: 10 });
  assert.equal(list.total, 2, 'only the case files for this case');
  assert.ok(list.list.some(file => file.id === f1.id));
  assert.ok(list.list.some(file => file.id === f2.id));

  // 下载 → base64 信封。
  const download = await service.download(f1.id);
  assert.equal(download.base64, SAMPLE_BASE64);
  assert.equal(download.fileName, 'a.txt');

  // 删除 → 磁盘文件移除 + DB 记录移除。
  const removed = await service.remove(f1.id);
  assert.equal(removed.id, f1.id);
  const record = await prisma.caseFile.findUnique({ where: { id: f1.id } });
  assert.equal(record, null, 'record removed');

  // 案件不存在 → 404。
  await assert.rejects(
    () => service.list(randomUUID(), {}),
    (error: unknown) => error instanceof CaseError && error.code === CASE_ERROR_CODES.CASE_NOT_FOUND && error.httpStatus === 404,
  );

  // 文件不存在 → 404 CASE_FILE_NOT_FOUND。
  await assert.rejects(
    () => service.download(randomUUID()),
    (error: unknown) => error instanceof CaseError && error.code === CASE_ERROR_CODES.CASE_FILE_NOT_FOUND && error.httpStatus === 404,
  );
  await assert.rejects(
    () => service.remove(randomUUID()),
    (error: unknown) => error instanceof CaseError && error.code === CASE_ERROR_CODES.CASE_FILE_NOT_FOUND && error.httpStatus === 404,
  );

  // 无 case.file.read → 403。
  await assert.rejects(
    async () => (await serviceFor(['case.file.manage'])).service.list(caseId, {}),
    { name: 'AuthorizationError' },
  );
});
