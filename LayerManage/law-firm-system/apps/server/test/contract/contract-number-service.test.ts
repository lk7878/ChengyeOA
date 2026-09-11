import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

import {
  nextCaseNo,
  nextContractNo,
  NextContractNoInput,
  nextEngagementNo,
  nextInvoiceNo,
  nextNegotiationNo,
  nextPaymentNo,
  nextPlanNo,
  nextRefundNo,
} from '../../app/application/contract/contract-number-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

// SPEC-010 Task 5: contract-number-service 契约测试（CON-02 编号序列）。
// 钉死值（设计 §6.4 + 协调者接口决策）：
//   格式 `{类型码}-{分所码}-{团队码}-{yyyy}-{4位流水}`，例 FS-ZS01-YL-2026-0007；
//   scopeKey=`${CONTRACT_TYPE_CODES[type]}|${branchCode ?? 'HQ'}|${teamCode ?? 'ALL'}|${yyyy}`（yyyy=UTC 年）；
//   事务内 INSERT ... ON CONFLICT (scopeKey) DO UPDATE lastSerial+1 RETURNING 原子取号；
//   跳号可接受（回滚不补号）；薄封装 makeBusinessNo 前缀 PP/PY/NE/AE/CA。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/contract/contract-number-service.test.ts

let prisma: PrismaClient;

const NOW_2026 = new Date('2026-07-30T12:00:00.000Z');

test.before(() => {
  prisma = createTestPrisma();
});

test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

function draw(input: NextContractNoInput): Promise<string> {
  return prisma.$transaction(tx => nextContractNo(tx, input));
}

test('issues serials 0001/0002 incrementally within the same scope', async () => {
  const first = await draw({ contractType: 'FIRST_SIGN', now: NOW_2026 });
  const second = await draw({ contractType: 'FIRST_SIGN', now: NOW_2026 });

  assert.equal(first, 'FS-HQ-ALL-2026-0001');
  assert.equal(second, 'FS-HQ-ALL-2026-0002');
});

test('keeps an independent sequence per contract type', async () => {
  const firstSign = await draw({ contractType: 'FIRST_SIGN', now: NOW_2026 });
  const formal = await draw({ contractType: 'FORMAL', now: NOW_2026 });
  const supplement = await draw({ contractType: 'SUPPLEMENT', now: NOW_2026 });
  const riskNotice = await draw({ contractType: 'RISK_NOTICE', now: NOW_2026 });

  assert.equal(firstSign, 'FS-HQ-ALL-2026-0001');
  assert.equal(formal, 'WT-HQ-ALL-2026-0001');
  assert.equal(supplement, 'SA-HQ-ALL-2026-0001');
  assert.equal(riskNotice, 'RN-HQ-ALL-2026-0001');
});

test('keeps independent sequences per branch and team code', async () => {
  const branchTeam = await draw({
    contractType: 'FIRST_SIGN',
    branchCode: 'ZS01',
    teamCode: 'YL',
    now: NOW_2026,
  });
  const defaulted = await draw({ contractType: 'FIRST_SIGN', now: NOW_2026 });
  const otherBranch = await draw({ contractType: 'FIRST_SIGN', branchCode: 'GZ01', now: NOW_2026 });
  const branchTeamAgain = await draw({
    contractType: 'FIRST_SIGN',
    branchCode: 'ZS01',
    teamCode: 'YL',
    now: NOW_2026,
  });

  assert.equal(branchTeam, 'FS-ZS01-YL-2026-0001');
  assert.equal(defaulted, 'FS-HQ-ALL-2026-0001');
  assert.equal(otherBranch, 'FS-GZ01-ALL-2026-0001');
  assert.equal(branchTeamAgain, 'FS-ZS01-YL-2026-0002');
});

test('maps null branchCode/teamCode to the HQ/ALL defaults', async () => {
  const drawn = await draw({
    contractType: 'FIRST_SIGN',
    branchCode: null,
    teamCode: null,
    now: NOW_2026,
  });

  assert.equal(drawn, 'FS-HQ-ALL-2026-0001');
});

// 跨任务修复（Task 7 评审 Important，协调者裁决方案 a）：STABLE_CODE 允许 `_`，
// 编号格式钉死不含 `_`——入参净化，scopeKey 与编号同源使用净化值。
test('sanitizes underscore-carrying org codes and keeps scopeKey on the sanitized value', async () => {
  const first = await draw({
    contractType: 'FIRST_SIGN',
    branchCode: 'BRANCH_TEAM',
    teamCode: 'TEAM_A',
    now: NOW_2026,
  });
  assert.equal(first, 'FS-BRANCHTEAM-TEAMA-2026-0001');
  assert.match(first, /^(FS|WT|SA|RN)-[A-Z0-9]+-[A-Z0-9]+-\d{4}-\d{4}$/);

  // 同 scope 再取号流水递增：证明 scopeKey 行使用净化值（与编号同源，无 `_` 分叉）。
  const second = await draw({
    contractType: 'FIRST_SIGN',
    branchCode: 'BRANCH_TEAM',
    teamCode: 'TEAM_A',
    now: NOW_2026,
  });
  assert.equal(second, 'FS-BRANCHTEAM-TEAMA-2026-0002');

  // 已净化入参与未净化入参命中同一序列行。
  const third = await draw({
    contractType: 'FIRST_SIGN',
    branchCode: 'BRANCHTEAM',
    teamCode: 'TEAMA',
    now: NOW_2026,
  });
  assert.equal(third, 'FS-BRANCHTEAM-TEAMA-2026-0003');
});

test('falls back to HQ/ALL when sanitization strips the code to empty', async () => {
  const drawn = await draw({
    contractType: 'FIRST_SIGN',
    branchCode: '___',
    teamCode: '___',
    now: NOW_2026,
  });

  assert.equal(drawn, 'FS-HQ-ALL-2026-0001');
});

test('switches sequence by UTC year when now is injected', async () => {
  const endOf2025 = new Date('2025-12-31T23:59:59.000Z');
  const startOf2026 = new Date('2026-01-01T00:00:00.000Z');

  const first2025 = await draw({ contractType: 'FORMAL', now: endOf2025 });
  const second2025 = await draw({ contractType: 'FORMAL', now: endOf2025 });
  const first2026 = await draw({ contractType: 'FORMAL', now: startOf2026 });

  assert.equal(first2025, 'WT-HQ-ALL-2025-0001');
  assert.equal(second2025, 'WT-HQ-ALL-2025-0002');
  assert.equal(first2026, 'WT-HQ-ALL-2026-0001');
});

test('never duplicates numbers across 10 concurrent draws in the same scope', async () => {
  const numbers = await Promise.all(
    Array.from({ length: 10 }, () => draw({ contractType: 'FIRST_SIGN', now: NOW_2026 })),
  );

  assert.equal(new Set(numbers).size, 10);
  const serials = numbers.map(no => Number(no.slice(-4))).sort((a, b) => a - b);
  assert.deepEqual(serials, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const no of numbers) {
    assert.match(no, /^FS-HQ-ALL-2026-\d{4}$/);
  }
});

test('wraps makeBusinessNo with the pinned PP/PY/NE/AE/CA prefixes', () => {
  const now = new Date('2026-07-30T00:00:00.000Z');

  assert.match(nextPlanNo(now), /^PP260730-[A-Z0-9]{6}$/);
  assert.match(nextPaymentNo(now), /^PY260730-[A-Z0-9]{6}$/);
  assert.match(nextNegotiationNo(now), /^NE260730-[A-Z0-9]{6}$/);
  assert.match(nextEngagementNo(now), /^AE260730-[A-Z0-9]{6}$/);
  assert.match(nextCaseNo(now), /^CA260730-[A-Z0-9]{6}$/);
});

test('business-number wrappers default to the current time when now is omitted', () => {
  assert.match(nextPlanNo(), /^PP\d{6}-[A-Z0-9]{6}$/);
  assert.match(nextPaymentNo(), /^PY\d{6}-[A-Z0-9]{6}$/);
  assert.match(nextNegotiationNo(), /^NE\d{6}-[A-Z0-9]{6}$/);
  assert.match(nextEngagementNo(), /^AE\d{6}-[A-Z0-9]{6}$/);
  assert.match(nextCaseNo(), /^CA\d{6}-[A-Z0-9]{6}$/);
});

// SPEC-011 Task 4：开票申请 INV / 退款（减免）申请 RF 编号薄封装，形态与 PP/PY 同构。
test('wraps makeBusinessNo with the pinned INV/RF prefixes', () => {
  const now = new Date('2026-07-30T00:00:00.000Z');

  assert.match(nextInvoiceNo(now), /^INV260730-[A-Z0-9]{6}$/);
  assert.match(nextRefundNo(now), /^RF260730-[A-Z0-9]{6}$/);
});

test('invoice/refund number wrappers default to the current time when now is omitted', () => {
  assert.match(nextInvoiceNo(), /^INV\d{6}-[A-Z0-9]{6}$/);
  assert.match(nextRefundNo(), /^RF\d{6}-[A-Z0-9]{6}$/);
});
