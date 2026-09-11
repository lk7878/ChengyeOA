import { expect, test } from 'vitest';
import { requestErrorMessage } from './errors';

test('explains actual organization deletion blockers without suggesting status changes remove references', () => {
  const failure = (blockers: unknown) => ({ response: { status: 409, data: { message: 'ORGANIZATION_DELETE_IN_USE', errors: { organizationDeleteBlockers: blockers } } } });
  expect(requestErrorMessage(failure({ children: 2 }))).toBe('无法删除：存在下级组织 2 条。请先移动或删除下级组织，再删除当前组织');
  expect(requestErrorMessage(failure({ positions: 1, assignments: 3, children: 0 }))).toContain('岗位 1 条、任职历史 3 条');
  expect(requestErrorMessage(failure({ children: -1, positions: '2', unexpected: 8 }))).toBe(requestErrorMessage(new Error('ORGANIZATION_DELETE_IN_USE')));
});

test('preserves useful Chinese validation messages from other modules and hides internal failures', () => {
  expect(requestErrorMessage(new Error('网络错误'))).toBe('网络错误');
  expect(requestErrorMessage({ response: { status: 400, data: { message: '名称和类型不能为空' } } })).toBe('名称和类型不能为空');
  expect(requestErrorMessage({ response: { status: 500, data: { message: 'INTERNAL_DATABASE_ERROR' } } })).toBe('操作失败，请稍后重试');
  expect(requestErrorMessage({ response: { status: 409, data: { message: 'MASTER_DATA_CODE_CONFLICT' } } })).toBe('编码已存在，请使用其他编码');
  expect(requestErrorMessage({ response: { status: 409, data: { message: 'ORGANIZATION_HIERARCHY_INVALID' } } })).toContain('组织层级');
});
