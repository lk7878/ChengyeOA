import { Prisma } from '@prisma/client';
import { check } from '../../domain/workflow/schema';

export const D = Prisma.Decimal;
export function decimal(value: unknown, label: string, places = 2) {
  check(typeof value === 'number' || typeof value === 'string', label + '须为数字');
  const text = String(value);
  check(/^-?\d{1,14}(\.\d+)?$/.test(text), label + '须为有效数字');
  const n = new D(text);
  check(n.decimalPlaces() <= places, label + '小数位数过多');
  return n;
}

export function referencedFields(fields: string[], formulas: string[]) {
  const names = new Set(formulas.flatMap((formula): string[] => formula.match(/[\p{L}_][\p{L}\p{N}_]*/gu) ?? []));
  return fields.filter((field) => names.has(field));
}

// Tokenize the complete formula, then parse only arithmetic. Names map to numeric fields.
export function calculate(expression: string, values: Record<string, Prisma.Decimal>, validateOnly = false) {
  check(typeof expression === 'string' && expression.length <= 250, '公式最长 250 字');
  const tokens = (expression.match(/[\p{L}_][\p{L}\p{N}_]*|\d+(?:\.\d+)?|\S/gu) ?? []) as string[];
  let cursor = 0;
  function factor(): Prisma.Decimal {
    const token = tokens[cursor++];
    if (token === '-') return factor().neg();
    if (token === '(') {
      const n = sum();
      check(tokens[cursor++] === ')', '公式缺少右括号');
      return n;
    }
    if (/^\d+(?:\.\d+)?$/.test(token ?? '')) return new D(token);
    check(token && Object.hasOwn(values, token), '公式中有无效的字段或运算符');
    return values[token];
  }
  function product(): Prisma.Decimal {
    let n = factor();
    while (tokens[cursor] === '*' || tokens[cursor] === '/') {
      const operator = tokens[cursor++],
        right = factor();
      if (operator === '*') n = n.mul(right);
      else {
        check(validateOnly || !right.isZero(), '公式的除数不能为零');
        n = validateOnly ? new D(1) : n.div(right);
      }
    }
    return n;
  }
  function sum(): Prisma.Decimal {
    let n = product();
    while (tokens[cursor] === '+' || tokens[cursor] === '-') {
      const op = tokens[cursor++],
        right = product();
      n = op === '+' ? n.add(right) : n.sub(right);
    }
    return n;
  }
  const result = sum().toDecimalPlaces(2);
  check(cursor === tokens.length, '公式格式不正确');
  check(
    validateOnly || (result.isFinite() && result.gte(0) && result.lt('10000000000000000')),
    '可分配金额超出范围',
  );
  return result;
}

export function policyFields(raw: unknown): string[] {
  check(Array.isArray(raw) && raw.length <= 12, '最多可配置 12 个数值字段');
  const fields = raw.map((value) => {
    check(
      typeof value === 'string' &&
        /^[\p{L}][\p{L}\p{N}_]{0,15}$/u.test(value) &&
        !['基数', '__proto__', 'constructor', 'prototype'].includes(value),
      '自定义字段名称无效',
    );
    return value;
  });
  check(new Set(fields).size === fields.length, '自定义字段名称重复');
  return fields;
}
