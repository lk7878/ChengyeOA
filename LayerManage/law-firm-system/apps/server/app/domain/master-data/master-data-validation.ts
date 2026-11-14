import { MasterDataError } from './master-data-errors';

const STABLE_CODE = /^[A-Z][A-Z0-9_]{1,31}$/;
const EMPLOYEE_NO = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function validationFailed(): never {
  throw new MasterDataError('VALIDATION_FAILED', 400);
}

export function assertExactKeys(input: unknown, allowedKeys: readonly string[]): asserts input is Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) validationFailed();
  const allowed = new Set(allowedKeys);
  if (Object.keys(input).some(key => !allowed.has(key))) validationFailed();
}

export function normalizeStableCode(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!STABLE_CODE.test(normalized)) validationFailed();
  return normalized;
}

export function normalizeEmployeeNo(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!EMPLOYEE_NO.test(normalized)) validationFailed();
  return normalized;
}

export function normalizeRequiredText(value: unknown, minLength: number, maxLength: number): string {
  if (typeof value !== 'string') validationFailed();
  const normalized = value.trim();
  if (normalized.length < minLength || normalized.length > maxLength) validationFailed();
  return normalized;
}

export function normalizeName(value: unknown): string {
  return normalizeRequiredText(value, 2, 100);
}

export function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') validationFailed();
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maxLength) validationFailed();
  return normalized;
}

export function parseIsoDate(value: unknown): Date {
  if (typeof value !== 'string' || (!ISO_DATE.test(value) && !ISO_DATE_TIME.test(value))) validationFailed();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) validationFailed();
  if (ISO_DATE.test(value) && parsed.toISOString().slice(0, 10) !== value) validationFailed();
  return parsed;
}

export function normalizeNonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) validationFailed();
  return value;
}

export function normalizeVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) validationFailed();
  return value;
}

export function normalizeStringArray(value: unknown, maxItems: number, maxItemLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) validationFailed();
  const normalized = value.map(item => normalizeRequiredText(item, 1, maxItemLength));
  if (new Set(normalized).size !== normalized.length) validationFailed();
  return normalized;
}

export function normalizeAllowedValue<const T extends string>(value: unknown, allowedValues: readonly T[]): T {
  if (typeof value !== 'string' || !allowedValues.includes(value as T)) validationFailed();
  return value as T;
}
