import { describe, expect, test } from 'vitest';
import { validateGrantWindow } from './grant-validation';

describe('validateGrantWindow', () => {
  test('accepts permanent role grants and bounded temporary grants', () => {
    expect(validateGrantWindow('ROLE', 'PERMANENT', '2026-07-19T00:00:00.000Z', null)).toBeNull();
    expect(validateGrantWindow('ROLE', 'TEMPORARY', '2026-07-19T00:00:00.000Z', '2026-10-17T00:00:00.000Z')).toBeNull();
    expect(validateGrantWindow('SPECIAL', 'TEMPORARY', '2026-07-19T00:00:00.000Z', '2026-08-18T00:00:00.000Z')).toBeNull();
  });

  test('rejects missing, inverted, and overlong temporary windows', () => {
    expect(validateGrantWindow('ROLE', 'TEMPORARY', '2026-07-19T00:00:00.000Z', null)).toMatch(/结束时间/);
    expect(validateGrantWindow('ROLE', 'TEMPORARY', '2026-07-19T00:00:00.000Z', '2026-07-18T00:00:00.000Z')).toMatch(/晚于/);
    expect(validateGrantWindow('ROLE', 'TEMPORARY', '2026-07-19T00:00:00.000Z', '2026-10-18T00:00:00.000Z')).toMatch(/90/);
    expect(validateGrantWindow('SPECIAL', 'TEMPORARY', '2026-07-19T00:00:00.000Z', '2026-08-19T00:00:00.000Z')).toMatch(/30/);
  });
});
