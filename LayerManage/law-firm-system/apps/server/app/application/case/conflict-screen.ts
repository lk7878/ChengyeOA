import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import { normalizeRequiredText } from '../../domain/master-data/master-data-validation';
import type { CaseIntake } from './intake-contract';

export interface ConflictReview { fingerprint: string; reason: string }

export async function screenParties(tx: Prisma.TransactionClient, caseId: string | undefined,
  customerId: string, intake: CaseIntake, linked: boolean) {
  const customer = await tx.customer.findUniqueOrThrow({ where: { id: customerId },
    select: { name: true, address: true, phone: true } });
  const normalize = (s: string) => s.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
  const party = normalize(customer.name);
  const opponents = [...new Set((intake.opposingParty || '').split(/[、,，;；\n]/u).map(normalize).filter(Boolean))].sort();
  const region = normalize((linked ? customer.address : intake.region || customer.address) || '');
  const phone = ((linked ? customer.phone : intake.customerPhone || customer.phone) || '').replace(/\D/g, '');
  // Match only opposing sides. A client's contact details corroborate the client side only.
  const rows = await tx.$queryRaw<Array<{ id: string; swapped: boolean; sameClient: boolean; sameRegion: boolean }>>(
    Prisma.sql`WITH parties AS (
      SELECT k.id, lower(regexp_replace(normalize(c.name, NFKC), '[[:space:]]', '', 'g')) AS client,
        regexp_split_to_array(lower(regexp_replace(normalize(coalesce(k."intakeData"->>'opposingParty',''), NFKC), '[[:blank:]]', '', 'g')), '[、,;\n]+') AS opponents,
        lower(regexp_replace(normalize(coalesce(CASE WHEN k."contractId" IS NULL THEN k."intakeData"->>'region' END,c.address,''), NFKC), '[[:space:]]', '', 'g')) AS region,
        regexp_replace(coalesce(CASE WHEN k."contractId" IS NULL THEN k."intakeData"->>'customerPhone' END,c.phone,''), '[^0-9]', '', 'g') AS phone
      FROM "case" k JOIN customer c ON c.id=k."customerId"
      WHERE k."deletedAt" IS NULL AND k.id <> ${caseId || ''})
      SELECT id, (client = ANY(${opponents}::text[]) AND ${party} = ANY(opponents)) AS swapped,
        (client = ${party} AND phone = ${phone} AND ${phone} <> '') AS "sameClient",
        (region = ${region} AND ${region} <> '') AS "sameRegion"
      FROM parties WHERE client = ANY(${opponents}::text[]) OR ${party} = ANY(opponents) ORDER BY id`);
  const red = rows.filter(r => r.swapped || r.sameClient).length;
  const level = red ? 'RED' : rows.length ? 'YELLOW' : 'GREEN';
  const fingerprint = createHash('sha256').update(JSON.stringify([customerId, party, opponents, region, phone, rows])).digest('hex');
  return { level, count: rows.length, sameRegion: rows.filter(r => r.sameRegion).length, fingerprint };
}

export async function verifyConflictReview(tx: Prisma.TransactionClient, userId: string, caseId: string,
  result: Awaited<ReturnType<typeof screenParties>>, review?: unknown) {
  if (!result.count) return;
  const previous = await tx.operationLog.findFirst({ where: { targetId: caseId, targetType: 'CASE', action: 'CASE_CONFLICT_REVIEW' },
    orderBy: { createdAt: 'desc' }, select: { newValues: true } });
  if (previous?.newValues && JSON.parse(previous.newValues).fingerprint === result.fingerprint) return;
  if (!review || typeof review !== 'object' || !('fingerprint' in review) || review.fingerprint !== result.fingerprint ||
      !('reason' in review) || typeof review.reason !== 'string' || !review.reason.trim())
    throw new MasterDataError('CASE_CONFLICT_REVIEW_REQUIRED', 409);
  const reason = normalizeRequiredText(review.reason, 1, 500);
  await tx.operationLog.create({ data: { userId, targetId: caseId, targetType: 'CASE',
    action: 'CASE_CONFLICT_REVIEW', newValues: JSON.stringify({ ...result, reason }) } });
}
