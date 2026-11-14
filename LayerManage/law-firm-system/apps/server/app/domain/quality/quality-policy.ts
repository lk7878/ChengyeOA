import { createHash } from 'node:crypto';
import { assertExactKeys, normalizeRequiredText } from '../master-data/master-data-validation';
import { sopFail } from '../sop/template-content';
export type QualityCheck = {
  code: string;
  name: string;
  result: 'PENDING' | 'PASS' | 'FAIL' | 'NA';
  reason: string;
};
export function checklist(raw: unknown, results = false): QualityCheck[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 50) sopFail('VALIDATION_FAILED');
  const rows = (raw as unknown[]).map((value) => {
    assertExactKeys(value, ['code', 'name', ...(results ? ['result', 'reason'] : [])]);
    const code = normalizeRequiredText(value.code, 1, 50),
      name = normalizeRequiredText(value.name, 1, 200);
    const result = results ? String(value.result) : 'PENDING';
    if (!(results ? ['PASS', 'FAIL', 'NA'] : ['PENDING']).includes(result)) sopFail('VALIDATION_FAILED');
    const reason = results && value.reason ? normalizeRequiredText(value.reason, 1, 4000) : '';
    if (['FAIL', 'NA'].includes(result) && !reason) sopFail('QUALITY_REASON_REQUIRED');
    return { code, name, result: result as QualityCheck['result'], reason };
  });
  if (new Set(rows.map((r) => r.code)).size !== rows.length) sopFail('VALIDATION_FAILED');
  return rows;
}
export function qualityMonth(value: unknown, now = new Date()) {
  const local = new Date(now.getTime() + 8 * 3600000);
  const previous = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 1, 1));
  const month = value === undefined ? previous.toISOString().slice(0, 7) : String(value);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 2000)
    sopFail('VALIDATION_FAILED');
  const [year, m] = month.split('-').map(Number);
  return {
    month,
    start: new Date(Date.UTC(year, m - 1, 1) - 8 * 3600000),
    end: new Date(Date.UTC(year, m, 1) - 8 * 3600000),
  };
}
export function sampleIds(
  rows: { id: string; stratum: string }[],
  seed: string,
  mode: string,
  amount: number,
  stratified: boolean,
) {
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = stratified ? row.stratum : 'ALL';
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const selected: string[] = [];
  for (const [, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const count = mode === 'COUNT' ? amount : Math.ceil((group.length * amount) / 100);
    group.sort((a, b) => {
      const rank = (id: string) =>
        createHash('sha256')
          .update(seed + ':' + id)
          .digest('hex');
      return rank(a.id).localeCompare(rank(b.id)) || a.id.localeCompare(b.id);
    });
    selected.push(...group.slice(0, count).map((r) => r.id));
  }
  return selected;
}
