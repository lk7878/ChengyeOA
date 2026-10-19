import { expect, test } from 'vitest';
import { formatMoney, formatBusinessDate, refundStatusLabels } from './business-format';
import { displayValue, fieldLabel, fieldHint } from '@/features/workspaces/display-value';
import type { Field } from '@/features/workspaces/types';
test('money preserves decimal precision including large totals, negatives, and zero', () => {
  expect(formatMoney('9999999999999999.99')).toBe('9,999,999,999,999,999.99');
  expect(formatMoney('1234.5')).toBe('1,234.50');
  expect(formatMoney('-3.125')).toBe('-3.13');
  expect(formatMoney(0)).toBe('0.00');
  expect(formatMoney(null)).toBe('—');
  expect(formatMoney('invalid')).toBe('invalid');
});
test('dates use consistent Beijing time and date-only fields keep their calendar day', () => {
  expect(formatBusinessDate('2026-10-19T07:45:00.000Z')).toBe('2026-10-19 15:45:00');
  expect(formatBusinessDate('2026-10-19', true)).toBe('2026-10-19');
  expect(formatBusinessDate('invalid')).toBe('invalid');
});
test('currency units, synchronized readonly hints and approval status remain presentation-only', () => {
  const field = {
    id: 'f',
    name: '合同金额（同步）',
    type: 'CURRENCY',
    writable: false,
    options: { lifecycleKey: 'contractAmount' },
  } as Field;
  const directory = { users: [], employees: [], organizations: [], teams: [] };
  expect(displayValue(field, '1200', directory)).toBe('1,200.00');
  expect(fieldLabel(field)).toBe('合同金额（元，同步）');
  expect(fieldHint(field)).toContain('上游业务实时同步');
  expect(field.name).toBe('合同金额（同步）');
  expect(fieldLabel({ ...field, name: '金额（元）' })).toBe('金额（元）');
  expect(
    displayValue(
      { ...field, type: 'TEXT', options: { businessSource: 'REFUNDS', businessKey: 'status' } },
      'APPROVED',
      directory,
    ),
  ).toBe(refundStatusLabels.APPROVED);
});
