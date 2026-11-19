export type Source = {
  id: string;
  caseNo: string;
  title: string;
  contractId: string | null;
  contractNo: string;
  amount: string;
  received: string;
  lawyer: { id: string; name: string } | null;
};
export type Line = {
  employeeId: string;
  name: string;
  employeeNo: string;
  rate: string;
  adjustment: string;
  reason: string;
  amount: string;
};
export type Settlement = {
  id: string;
  teamId: string;
  caseId: string;
  period: string;
  version: number;
  status: string;
  remark: string;
  basisAmount: string;
  pool: string;
  payrollId: string | null;
  lines: Line[];
  snapshot: {
    source: Source;
    formula: string;
    inputs: Record<string, string>;
    basis: string;
    policyVersion: number;
    customMemberIds?: string[];
  };
};
export type Policy = {
  teamInputFields: string[];
  memberRules: { inputFields: string[]; employeeId: string; rate: string; formula?: string }[];
  teamId: string;
  version: number;
  basis: string;
  formula: string;
  fields: string[];
  financeIds: string[];
  directorId: string;
};
export type PayView = {
  rows: Settlement[];
  teams: { id: string; name: string }[];
  editable: string[];
  finance: string[];
  admin: boolean;
  members: { professionalTeamId: string; memberRole: string; employee: { id: string; name: string; employeeNo: string } }[];
  accounts: { id: string; username: string; employee: { name: string } | null }[];
  policies: Policy[];
  drafts: { id: string; title: string; version: number }[];
  batches: { id: string; title: string; status: string; owner: boolean; version: number }[];
};
export const statusName: Record<string, string> = {
  DRAFT: '草稿',
  SUBMITTED: '待财务确认',
  CONFIRMED: '已确认',
  IN_PAYROLL: '已入工资表',
  PAID: '已登记发放',
};
export function payError(error: unknown) {
  const e = error as { response?: { data?: { message?: string } }; message?: string };
  return e.response?.data?.message || e.message || '操作失败，请重试';
}
export const payUrl = '/case-performance';

// Settlement amounts returned by the API have at most two decimal places.
export function amountInCents(amount: string) {
  const negative = amount.startsWith('-');
  const [whole, fraction = ''] = (negative ? amount.slice(1) : amount).split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -cents : cents;
}
export function displayCents(value: bigint) {
  const abs = value < 0n ? -value : value;
  return (value < 0n ? '-' : '') + String(abs / 100n) + '.' + String(abs % 100n).padStart(2, '0');
}
