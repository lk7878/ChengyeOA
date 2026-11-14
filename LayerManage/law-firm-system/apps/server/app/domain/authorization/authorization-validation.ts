import { PERMISSION_CATALOG } from './permission-catalog';
import { PermissionCode } from './authorization-types';
import { accessPurposeError, authorizationInputError } from './authorization-errors';

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const DIRECT_GRANT_BLOCKLIST = new Set<PermissionCode>([
  'role.permission.manage',
  'user.role.manage',
  'temporary_grant.manage',
]);

export interface ParsedRoleGrantInput {
  source: 'PERMANENT' | 'TEMPORARY';
  validFrom: Date;
  validUntil: Date | null;
  reason: string | null;
}

export interface ParsedSpecialGrantInput {
  permissionCode: PermissionCode;
  dataScopeId: string;
  validFrom: Date;
  validUntil: Date;
  reason: string;
}

export function assertAuthorizationExactKeys(
  input: unknown,
  allowedKeys: readonly string[],
): asserts input is Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) authorizationInputError();
  const allowed = new Set(allowedKeys);
  if (Object.keys(input).some(key => !allowed.has(key))) authorizationInputError();
}

export function parseGrantReason(value: unknown): string {
  return parseBoundedText(value, 10, 500, authorizationInputError);
}

export function parseAccessPurpose(value: unknown): string {
  return parseBoundedText(value, 10, 200, accessPurposeError);
}

export function parseRoleGrantInput(input: unknown): ParsedRoleGrantInput {
  assertAuthorizationExactKeys(input, ['source', 'validFrom', 'validUntil', 'reason']);
  const source = input.source;
  if (source !== 'PERMANENT' && source !== 'TEMPORARY') authorizationInputError();
  const validFrom = parseDateTime(input.validFrom);

  if (source === 'PERMANENT') {
    if (input.validUntil !== undefined && input.validUntil !== null) authorizationInputError();
    if (input.reason !== undefined && input.reason !== null) authorizationInputError();
    return { source, validFrom, validUntil: null, reason: null };
  }

  const validUntil = parseDateTime(input.validUntil);
  validateWindow(validFrom, validUntil, 90);
  return { source, validFrom, validUntil, reason: parseGrantReason(input.reason) };
}

export function parseSpecialGrantInput(input: unknown): ParsedSpecialGrantInput {
  assertAuthorizationExactKeys(input, [
    'permissionCode',
    'dataScopeId',
    'validFrom',
    'validUntil',
    'reason',
  ]);
  if (typeof input.permissionCode !== 'string') authorizationInputError();
  const permission = PERMISSION_CATALOG.find(item => item.code === input.permissionCode);
  if (!permission || permission.type !== 'SPECIAL' || DIRECT_GRANT_BLOCKLIST.has(permission.code)) {
    authorizationInputError();
  }

  const validFrom = parseDateTime(input.validFrom);
  const validUntil = parseDateTime(input.validUntil);
  validateWindow(validFrom, validUntil, 30);

  return {
    permissionCode: permission.code,
    dataScopeId: parseIdentifier(input.dataScopeId),
    validFrom,
    validUntil,
    reason: parseGrantReason(input.reason),
  };
}

function parseBoundedText(
  value: unknown,
  minimum: number,
  maximum: number,
  fail: () => never,
): string {
  if (typeof value !== 'string') fail();
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) fail();
  return normalized;
}

function parseDateTime(value: unknown): Date {
  if (typeof value !== 'string' || !ISO_DATE_TIME.test(value)) authorizationInputError();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) authorizationInputError();
  return parsed;
}

function validateWindow(validFrom: Date, validUntil: Date, maximumDays: number): void {
  const duration = validUntil.getTime() - validFrom.getTime();
  if (duration <= 0 || duration > maximumDays * DAY_MS) authorizationInputError();
}

function parseIdentifier(value: unknown): string {
  if (typeof value !== 'string') authorizationInputError();
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 200) authorizationInputError();
  return normalized;
}
