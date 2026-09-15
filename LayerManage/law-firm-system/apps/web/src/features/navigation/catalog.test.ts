import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { canOpen, entries, findEntry, legacyRedirects, visibleEntries } from './catalog';
import type { AuthorizationSummary } from '../authorization/types';

const summary: AuthorizationSummary = {
  userId: 'u',
  employeeId: null,
  isSystemSuperAdmin: false,
  isSystemAdmin: false,
  permissions: [],
  menus: [],
  validUntil: null,
  evaluatedAt: new Date().toISOString(),
  fieldCapabilities: {},
};
test('every live App route is catalogued or an explicit authentication/legacy/fallback route', () => {
  const app = readFileSync(resolve('src/App.tsx'), 'utf8');
  const routes = [...app.matchAll(/path="([^"]+)"/g)].map((match) => match[1]);
  for (const route of routes) {
    if (['/login', '/password-change', '*', '/inventory/*'].includes(route) || legacyRedirects[route])
      continue;
    expect(
      entries.some((entry) => entry.path === route),
      route,
    ).toBe(true);
  }
  for (const entry of entries)
    expect(routes.includes(entry.path) || entry.path.startsWith('/inventory'), entry.path).toBe(true);
  expect(new Set(entries.map((entry) => entry.path)).size).toBe(entries.length);
  const inventory = readFileSync(resolve('src/pages/Inventory/index.tsx'), 'utf8');
  const titleDefinition = inventory.slice(
    inventory.indexOf('const titles:'),
    inventory.indexOf('const kindOptions'),
  );
  for (const route of entries.filter((entry) => entry.path.startsWith('/inventory/')))
    expect(titleDefinition).toContain(route.path.split('/')[2]);
});
test('static pool/calendar/new paths take precedence over record details', () => {
  expect(findEntry('/leads/pool')?.title).toBe('公海池');
  expect(findEntry('/leads/pool/')?.title).toBe('公海池');
  expect(findEntry('/leads/calendar')?.title).toBe('到访日历');
  expect(findEntry('/contracts/new')?.required).toContain('contract.create');
  expect(findEntry('/leads/original-record-id')?.parent).toBe('/leads');
  expect(findEntry('/inventory/unknown')).toBeUndefined();
});
test('menus intersect read permissions; organization management retains its additional boundary', () => {
  const entry = findEntry('/org/tree')!;
  const allowed = {
    ...summary,
    menus: ['menu.organization_personnel', 'menu.organization'] as AuthorizationSummary['menus'],
    permissions: ['organization.read'] as AuthorizationSummary['permissions'],
  };
  expect(canOpen(entry, allowed)).toBe(false);
  expect(canOpen(entry, { ...allowed, isSystemSuperAdmin: true })).toBe(true);
  expect(canOpen(entry, { ...allowed, isSystemSuperAdmin: true, permissions: [] })).toBe(false);
  expect(canOpen(entry, { ...allowed, isSystemSuperAdmin: true, menus: ['menu.organization'] })).toBe(false);
  expect(
    canOpen(findEntry('/security/event-operations')!, { ...summary, menus: ['menu.event_operations'] }),
  ).toBe(false);
});
test('expired authorization and role names never grant destinations', () => {
  expect(visibleEntries(null)).toEqual([]);
  expect(visibleEntries({ ...summary, validUntil: '2000-01-01T00:00:00Z' })).toEqual([]);
  expect(
    canOpen(findEntry('/security/roles')!, { ...summary, permissions: ['SYSTEM_SUPER_ADMIN'] as never[] }),
  ).toBe(false);
});
test('finance compatibility requires a complete authorized pair', () => {
  const finance = findEntry('/finance')!;
  expect(canOpen(finance, { ...summary, menus: ['menu.payment'], permissions: ['refund.read'] })).toBe(false);
  expect(canOpen(finance, { ...summary, menus: ['menu.refund'], permissions: ['refund.read'] })).toBe(true);
});
