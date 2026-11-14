import { expect, it } from 'vitest';
import type { Field, ViewConfig } from '@/features/workspaces/types';
import { inventoryViewConfig } from './context';
const fields = ['action', 'itemKind'].map((id) => ({
  id,
  type: 'TEXT',
  options: { businessKey: id },
  queryable: true,
})) as Field[];
it('intersects old inbound/outbound/kind contexts without mutating the personal view', () => {
  const original: ViewConfig = { filter: { fieldId: 'action', operator: 'ne', value: 'ADJUST' } };
  const snapshot = JSON.stringify(original);
  const config = inventoryViewConfig(
    'INVENTORY_MOVEMENTS',
    fields,
    original,
    new URLSearchParams({ action: 'OUTBOUND', kind: 'OFFICE' }),
  );
  expect(config.filter).toMatchObject({
    join: 'and',
    children: [expect.anything(), { fieldId: 'action', operator: 'eq', value: 'OUTBOUND' }],
  });
  expect(JSON.stringify(original)).toBe(snapshot);
  expect(JSON.stringify(config)).toContain('OFFICE');
  expect(() =>
    inventoryViewConfig('INVENTORY_MOVEMENTS', [], original, new URLSearchParams({ action: 'OUTBOUND' })),
  ).toThrow('无法');
});
