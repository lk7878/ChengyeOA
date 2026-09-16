import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { assertExactKeys, normalizeRequiredText } from '../../domain/master-data/master-data-validation';
import { sopFail } from '../../domain/sop/template-content';
/** Quality additions preserve the original closed Case version and never replace existing bytes. */
export async function addRemediationMaterial(
  tx: Prisma.TransactionClient,
  caseId: string,
  revisionId: string,
  userId: string,
  raw: unknown,
  createdPaths: string[],
) {
  assertExactKeys(raw, ['fileName', 'fileType', 'base64']);
  const fileName = normalizeRequiredText(raw.fileName, 1, 255),
    fileType = normalizeRequiredText(raw.fileType, 1, 100);
  if (typeof raw.base64 !== 'string' || raw.base64.length > 14 * 1024 * 1024) sopFail('VALIDATION_FAILED');
  const bytes = Buffer.from(raw.base64 as string, 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024 || bytes.toString('base64') !== raw.base64)
    sopFail('VALIDATION_FAILED');
  const root = path.resolve(process.cwd(), 'var/storage/case-files');
  fs.mkdirSync(root, { recursive: true });
  const filePath = randomUUID(),
    stored = path.join(root, filePath);
  fs.writeFileSync(stored, bytes, { flag: 'wx' });
  createdPaths.push(stored);
  const file = await tx.caseFile.create({
    data: {
      caseId,
      fileName,
      fileType,
      filePath,
      fileSize: bytes.length,
      uploadedBy: userId,
      category: '质检整改',
    },
  });
  await tx.issueAttachment.create({
    data: {
      revisionId,
      fileId: file.id,
      fileSize: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  });
}
export function discardRemediationMaterials(paths: string[]) {
  for (const file of paths) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* Original transaction error remains authoritative. */
    }
  }
}
