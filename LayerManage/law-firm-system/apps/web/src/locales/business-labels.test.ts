import { expect, test } from 'vitest';
import { businessLabel, categoryLabel, newPositionCode, positionCodeLabel } from './business-labels';

test('known business values are Chinese and unknown technical codes are preserved', () => {
  expect(businessLabel('ENABLED')).toBe('启用');
  expect(businessLabel('SPECIAL_GRANT')).toBe('临时特权授权');
  expect(businessLabel('MASKED')).toBe('脱敏读取');
  expect(businessLabel('UNKNOWN_CODE')).toBe('UNKNOWN_CODE');
  expect(businessLabel('constructor')).toBe('constructor');
  expect(businessLabel(null)).toBe('—');
});
test('position labels preserve neutral historical meaning and generated IDs satisfy the API contract', () => {
  expect(categoryLabel('LEGAL')).toBe('法律专业');
  expect(categoryLabel('DEPT_001')).toBe('部门岗位 001');
  expect(categoryLabel('UNKNOWN')).toBe('历史自定义分类');
  expect(positionCodeLabel('DEPART001', '主任')).toBe('岗位编号 001');
  expect(positionCodeLabel('LAWYER_01', '律师')).toBe('律师编号 01');
  const codes = new Set(Array.from({ length: 10 }, newPositionCode));
  expect(codes.size).toBe(10);
  for (const code of codes) expect(code).toMatch(/^[A-Z][A-Z0-9_]{1,31}$/);
});
