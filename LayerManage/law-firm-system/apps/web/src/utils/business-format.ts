/** Display only: keep exact stored decimal strings and record values unchanged. */
export function formatMoney(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const raw = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return raw;
  const fraction = match[3] || '';
  let cents = BigInt(match[2]) * 100n + BigInt((fraction + '00').slice(0, 2));
  if (Number(fraction[2] || '0') >= 5) cents++;
  const integer = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (match[1] && cents !== 0n ? '-' : '') + integer + '.' + (cents % 100n).toString().padStart(2, '0');
}
const dateTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
export function formatBusinessDate(value: unknown, dateOnly = false): string {
  if (value === null || value === undefined || value === '') return '—';
  const raw = String(value);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  if (dateOnly && /^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return dateTime.format(date);
}
export const refundStatusLabels: Record<string, string> = {
  PENDING: '待审批',
  APPROVED: '审批通过（待执行）',
  REJECTED: '已驳回',
  EXECUTED: '已执行',
};
