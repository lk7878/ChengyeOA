import { expect, test } from 'vitest';
import { organizationNamePaths } from './organization-utils';
import type { OrganizationNode } from './types';

function node(id: string, name: string, children: OrganizationNode[] = []): OrganizationNode {
  return { id, name, code: id, type: 'DEPARTMENT', parentId: null, path: `/${id}`, level: 0, sort: 0, status: 'ENABLED', version: 1, children };
}
test('paths distinguish same-named departments and stop at each assigned node', () => {
  const paths = organizationNamePaths([node('root', '重庆承业律师事务所', [
    node('hq', '总所', [node('legal1', '律师部', [node('group', '民商事组')])]),
    node('branch', '分所', [node('legal2', '律师部')]),
  ])]);
  expect(paths.get('legal1')).toBe('重庆承业律师事务所/总所/律师部');
  expect(paths.get('legal2')).toBe('重庆承业律师事务所/分所/律师部');
  expect(paths.get('group')).toBe('重庆承业律师事务所/总所/律师部/民商事组');
  expect(paths.get('root')).toBe('重庆承业律师事务所');
});
test('restricted trees use visible names only and empty catalogs remain empty', () => {
  const restricted = { ...node('branch', '分所', [node('legal', '律师部')]), parentId: 'hidden-root', path: '/hidden-root/branch' };
  expect(organizationNamePaths([restricted]).get('legal')).toBe('分所/律师部');
  expect([...organizationNamePaths([restricted]).values()].join()).not.toContain('hidden-root');
  expect(organizationNamePaths([]).size).toBe(0);
});
