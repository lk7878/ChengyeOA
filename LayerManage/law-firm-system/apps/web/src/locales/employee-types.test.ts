import { expect, test } from 'vitest';
import { employeeTypeLabel, employeeTypeOptions } from './employee-types';

test('current and historical types have Chinese labels without changing stored values', () => {
  expect(employeeTypeLabel('LAWYER')).toBe('律师');
  expect(employeeTypeLabel('SENIOR_LAWYER')).toBe('资深律师');
  expect(employeeTypeLabel('JUNIOR_LAWYER')).toBe('初级律师');
  expect(employeeTypeOptions.find(option => option.label === '资深律师')?.value).toBe('SENIOR_LAWYER');
  expect(employeeTypeLabel('CUSTOM_TYPE')).toBe('CUSTOM_TYPE');
  expect(employeeTypeLabel('constructor')).toBe('constructor');
});
