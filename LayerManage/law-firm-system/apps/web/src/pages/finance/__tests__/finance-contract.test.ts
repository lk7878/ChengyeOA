import { expect, test } from 'vitest';
import { moneyBalance, currencyKey, moneyMinor } from '@/features/workspaces/money';
import { groupedRows } from '@/features/workspaces/grouping';
import { clipboardValue } from '@/features/workspaces/clipboard';
import { financialViewConfig } from '../context';
import type { Field, RecordRow, ViewConfig } from '@/features/workspaces/types';
const field = {
  id: 'amount',
  name: '金额',
  type: 'CURRENCY',
  writable: true,
  options: {},
  required: false,
  position: 0,
  archived: false,
  defaultValue: null,
} satisfies Field;
test('decimal values retain cents up to the storage boundary', () => {
  expect(moneyBalance('0.30', '0.10')).toBe('0.20');
  expect(moneyBalance('9999999999999999.99', '0.01')).toBe('9999999999999999.98');
  expect(moneyMinor('9999999999999999.99')).toBe(999999999999999999n);
  expect(() => moneyMinor('10000000000000000.00')).toThrow();
  expect(
    clipboardValue(field, '9999999999999999.99', { organizations: [], employees: [], users: [], teams: [] }),
  ).toBe('9999999999999999.99');
  expect(currencyKey('-00.00')).toBe('0');
});
test('neighboring large currency groups remain distinct and scales match SQL totals', () => {
  const records = ['9999999999999999.98', '9999999999999999.99', '1.00', '1.0'].map(
    (value, i) => ({ id: String(i), tableId: 'table', version: 1, createdAt: '2026-09-15', updatedAt: '2026-09-15', createdBy: 'u', ownerId: 'u', values: { amount: value } }) satisfies RecordRow,
  );
  const rows = groupedRows(
    records,
    [field],
    [
      { keys: ['9999999999999999.98'], count: 1 },
      { keys: ['9999999999999999.99'], count: 1 },
      { keys: ['1'], count: 2 },
    ],
    new Set(),
  );
  expect(rows.filter((row) => row.group).map((row) => row.group?.count)).toEqual([1, 1, 2]);
});
test('financial context intersects the active view without mutating its persisted configuration', () => {
  const contract = { ...field, id: 'contract', type: 'TEXT', options: { businessKey: 'contractId' } };
  const config: ViewConfig = { filter: { fieldId: 'status', operator: 'eq', value: 'PENDING' }, sorts: [] };
  const original = JSON.stringify(config);
  expect(financialViewConfig('PAYMENTS', [contract], config, 'contract-1', null).filter).toEqual({
    join: 'and',
    children: [config.filter, { fieldId: 'contract', operator: 'eq', value: 'contract-1' }],
  });
  expect(JSON.stringify(config)).toBe(original);
  expect(() =>
    financialViewConfig('PAYMENTS', [{ ...contract, queryable: false }], config, 'contract-1', null),
  ).toThrow('字段权限');
  expect(financialViewConfig('CUSTOMERS', [], config, 'contract-1', null)).toBe(config);
});
