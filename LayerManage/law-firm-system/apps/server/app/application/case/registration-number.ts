import { Prisma } from '@prisma/client';
import { check } from '../../domain/workflow/schema';

export const REGISTRATION_NUMBER_RULES = [
  { code: 'MS', word: '民', digits: 4 },
  { code: 'FS', word: '专', digits: 3 },
  { code: 'XS', word: '刑', digits: 3 },
  { code: 'XZ', word: '行', digits: 3 },
  { code: 'GW', word: '顾', digits: 3 },
  { code: 'YL', word: '民', digits: 3 },
  { code: 'YF', word: '专', digits: 3 },
  { code: 'FY', word: '援', digits: 3 },
  { code: 'ZX', word: '执', digits: 3 },
] as const;
export const numberingOptions = REGISTRATION_NUMBER_RULES.map(r => ({ value: r.code, label: `渝承${r.word}字 · ${r.code}（${r.digits}位流水）` }));
export function numberPrefix(code: string, year: number) {
  const rule = REGISTRATION_NUMBER_RULES.find(r => r.code === code);
  check(rule && Number.isInteger(year) && year >= 2000 && year <= 9999, '请选择有效的合同编号类别');
  return { rule, prefix: `渝承${rule.word}字（${year}）${code}${String(year).slice(-2)}` };
}
// Both allocation and correction use this lock before checking either numbers table.
export async function lockContractNumbers(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(713427892)`;
}
export async function allocateRegistrationNumber(tx: Prisma.TransactionClient, caseId: string, code: string, now = new Date()) {
  const year = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(now));
  const { rule, prefix } = numberPrefix(code, year);
  await lockContractNumbers(tx);
  const [contracts, reservations] = await Promise.all([
    tx.contract.findMany({ where: { contractNo: { startsWith: prefix } }, select: { contractNo: true } }),
    tx.caseContractNumber.findMany({ where: { number: { startsWith: prefix } }, select: { number: true } }),
  ]);
  const used = new Set([...contracts.map(c => c.contractNo), ...reservations.map(r => r.number)]);
  // Choose the first available serial, including historical holes. Reservation and approval share one transaction.
  for (let serial = 1; serial < 10 ** rule.digits; serial++) {
    const number = prefix + String(serial).padStart(rule.digits, '0');
    if (used.has(number)) continue;
    await tx.caseContractNumber.create({ data: { number, caseId } });
    return number;
  }
  check(false, '本年度该类别合同编号已用完，请联系管理员', 409);
}
export function validateRegistrationNumber(value: unknown): string {
  check(typeof value === 'string', '请输入合同编号');
  const match = /^渝承([民专刑行顾援执])字（(\d{4})）([A-Z]{2})(\d{2})(\d{3,4})$/.exec(value);
  check(match, '合同编号格式不正确，请使用规定的九类编号格式');
  const { rule } = numberPrefix(match[3], Number(match[2]));
  check(rule.word === match[1] && match[4] === match[2].slice(-2) && match[5].length === rule.digits && Number(match[5]) > 0,
    '合同类别、年份或流水号位数不一致');
  return value;
}
