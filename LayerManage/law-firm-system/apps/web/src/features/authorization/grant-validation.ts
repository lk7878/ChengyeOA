export type GrantKind = 'ROLE' | 'SPECIAL';
export type GrantDuration = 'PERMANENT' | 'TEMPORARY';

const DAY_MS = 24 * 60 * 60 * 1000;

export function validateGrantWindow(
  kind: GrantKind,
  duration: GrantDuration,
  validFrom: string,
  validUntil: string | null,
): string | null {
  if (kind === 'ROLE' && duration === 'PERMANENT') return null;
  if (!validUntil) return '临时授权必须填写结束时间';
  const from = Date.parse(validFrom);
  const until = Date.parse(validUntil);
  if (!Number.isFinite(from) || !Number.isFinite(until)) return '授权时间格式无效';
  const window = until - from;
  if (window <= 0) return '结束时间必须晚于开始时间';
  const maximumDays = kind === 'ROLE' ? 90 : 30;
  if (window > maximumDays * DAY_MS) return `授权期限不能超过 ${maximumDays} 天`;
  return null;
}
