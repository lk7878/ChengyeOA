import { Prisma } from '@prisma/client';
import { writeAuditLog } from '../system/audit-writer';

const EXPLICIT_KEYS = new Set([
  'state',
  'status',
  'version',
  'validFrom',
  'validUntil',
  'revokedAt',
  'startedAt',
  'endedAt',
  'scopeType',
  'fieldCodes',
  'permissionCodes',
  'targetCount',
  'resultCount',
  'count',
  'reason',
  'purpose',
  'result',
]);
const SENSITIVE_KEY = /(password|hash|token|secret|phone|email|idCard|licenseNo|businessValue)/i;

export interface AuthorizationAuditInput {
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  changes: Record<string, unknown>;
  ip?: string;
}

export function sanitizeAuthorizationChanges(input: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isAllowedKey(key) || SENSITIVE_KEY.test(key)) continue;
    const safeValue = sanitizeValue(value);
    if (safeValue !== undefined) sanitized[key] = safeValue;
  }
  return sanitized;
}

export async function writeAuthorizationAudit(
  tx: Prisma.TransactionClient,
  input: AuthorizationAuditInput,
): Promise<void> {
  await writeAuditLog(tx, {
    userId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    oldValues: null,
    newValues: JSON.stringify(sanitizeAuthorizationChanges(input.changes)),
    ip: input.ip,
  });
}

function isAllowedKey(key: string): boolean {
  return EXPLICIT_KEYS.has(key) || /(?:Id|Ids|Code|Codes)$/.test(key);
}

function sanitizeValue(value: unknown): string | number | boolean | Array<string | number | boolean> | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.slice(0, 500);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value) && value.length <= 100) {
    const values = value.filter((item): item is string | number | boolean => (
      typeof item === 'string'
      || (typeof item === 'number' && Number.isFinite(item))
      || typeof item === 'boolean'
    ));
    if (values.length === value.length) return values.map(item => typeof item === 'string' ? item.slice(0, 500) : item);
  }
  return undefined;
}
