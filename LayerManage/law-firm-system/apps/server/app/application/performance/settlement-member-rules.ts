import { check } from '../../domain/workflow/schema';
import { object, text } from '../collaboration/collaboration-policy';
import { calculate, D, decimal } from './settlement-calculation';

export type MemberRule = { employeeId: string; rate: string; formula: string };

export function readMemberRules(raw: unknown, fields: string[]): MemberRule[] {
  check(Array.isArray(raw) && raw.length <= 200, '最多可设置 200 条成员规则');
  const variables = ['可分配金额', '个人提成比例'];
  check(!raw.length || fields.every((name) => !variables.includes(name)), '自定义字段不能与个人公式变量同名');
  const samples = Object.fromEntries(['基数', ...variables, ...fields].map((name) => [name, new D(1)]));
  const seen = new Set<string>();
  return raw.map((value) => {
    const rule = object(value);
    const employeeId = text(rule.employeeId);
    check(!seen.has(employeeId), '同一成员只能设置一条个人规则');
    seen.add(employeeId);
    const rate = decimal(rule.rate, '个人提成比例', 4);
    check(rate.gte(0) && rate.lte(100), '个人提成比例须在 0 至 100 之间');
    const formula = text(rule.formula, 250);
    calculate(formula, samples, true);
    return { employeeId, rate: rate.toString(), formula };
  });
}
