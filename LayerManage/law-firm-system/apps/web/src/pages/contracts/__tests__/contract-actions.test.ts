import { test, expect } from 'vitest';
import { availableContractActions } from '../meta';
import type { ContractType, ContractStatus } from '@/api/contract';
const MATRIX: Array<[ContractType, ContractStatus, string[]]> = [
  ['FORMAL', 'DRAFT', ['submit', 'void']],
  ['FORMAL', 'PENDING_APPROVAL', ['approve', 'reject', 'void']],
  ['FORMAL', 'PENDING_SIGN', ['sign', 'void']],
  ['FORMAL', 'SIGNED', ['effect']],
  ['FORMAL', 'EFFECTIVE', ['terminate']],
  ['FORMAL', 'TERMINATED', []],
  ['FORMAL', 'VOID', []],
  ['FIRST_SIGN', 'DRAFT', ['submit', 'void']],
  ['FIRST_SIGN', 'SIGNED', ['effect']],
  ['SUPPLEMENT', 'PENDING_APPROVAL', ['approve', 'reject', 'void']],
  ['RISK_NOTICE', 'DRAFT', ['submit', 'void']],
  ['RISK_NOTICE', 'PENDING_SIGN', ['sign', 'void']],
  // RISK_NOTICE 无生效——签署即终态（政策门禁先于流转表）。
  ['RISK_NOTICE', 'SIGNED', []],
  ['RISK_NOTICE', 'EFFECTIVE', ['terminate']],
];

test('availableContractActions matches the backend state machine matrix', () => {
  for (const [type, status, expected] of MATRIX) {
    expect(availableContractActions(type, status), `${type}/${status}`).toEqual(expected);
  }
});
