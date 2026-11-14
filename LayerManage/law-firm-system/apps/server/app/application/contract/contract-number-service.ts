// SPEC-010 Task 5: contract-number-service —— 合同编号序列（CON-02）。
// 编号格式（设计 §6.4）：`{类型码}-{分所码}-{团队码}-{yyyy}-{4位流水}`，例 FS-ZS01-YL-2026-0007；
// 类型码 FS/WT/SA/RN 来自 Task 3 contract-policy 的 CONTRACT_TYPE_CODES；分所/团队缺省 HQ/ALL；
// yyyy=UTC 年（now 可注入，便于跨年测试）。
// 序列按 scopeKey=`类型|分所|团队|年份` 独立计数（Task 1 ContractNumberSequence）。
// 取号在调用方事务内以 INSERT ... ON CONFLICT ("scopeKey") DO UPDATE ... RETURNING 原子完成
// （$queryRaw 参数化，唯一索引行级锁保证并发不重号）；调用方事务回滚产生跳号可接受
// （设计 §5.1：编号不重用作废语义），序列取号无需 P2002 重试。
// id 列为 TEXT NOT NULL 且无数据库默认值（20260730120000 迁移实测，Prisma @default(uuid())
// 仅客户端生效），故 INSERT 显式给 randomUUID()（与 Prisma uuid() 同为 v4）。
// 同类业务编号（非序列号）为 makeBusinessNo 薄封装：应收计划 PP / 收款 PY / 谈案 NE /
// 分析委托 AE / 案件 CA。随机码 P2002 碰撞重试纪律在调用方（上限 2，同 lead-service
// BUSINESS_NO_RETRY_LIMIT），本模块纯生成不落库。
// 净化纪律（Task 7 评审 Important 跨任务修复，协调者裁决方案 a）：Organization/
// ProfessionalTeam code 词汇表 STABLE_CODE=/^[A-Z][A-Z0-9_]{1,31}$/ 允许 `_`，而编号格式
// 钉死 `^(FS|WT|SA|RN)-[A-Z0-9]+-[A-Z0-9]+-\d{4}-\d{4}$` 不含 `_`——branchCode/teamCode
// 入参先经 replace(/[^A-Z0-9]/g,'') 净化，scopeKey 与编号输出同源使用净化后值（防分叉）；
// 净化后为空串视为未提供，回落缺省 HQ/ALL。

import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { makeBusinessNo } from '../crm/business-no';
import { CONTRACT_TYPE_CODES, ContractType } from '../../domain/contract/contract-policy';

export interface NextContractNoInput {
  contractType: ContractType;
  branchCode?: string | null;
  teamCode?: string | null;
  now?: Date;
}

/**
 * 编号 scope 段净化：剔除非 [A-Z0-9] 字符（STABLE_CODE 词汇表允许 `_`，编号格式钉死不含）。
 * 输入 null/undefined 或净化后为空串时返回 null，由调用方回落缺省 HQ/ALL。
 * scopeKey 与编号输出必须同源使用本函数结果，禁止分别净化。
 */
function sanitizeScopeCode(code: string | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  const cleaned = code.replace(/[^A-Z0-9]/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * 事务内原子取合同编号（CON-02）。Task 7 合同创建在同一事务中调用本函数，
 * 使序列增量与合同写入同生共死；并发取号经 scopeKey 唯一索引行级锁串行化。
 */
export async function nextContractNo(
  tx: Prisma.TransactionClient,
  input: NextContractNoInput,
): Promise<string> {
  const now = input.now ?? new Date();
  const yyyy = String(now.getUTCFullYear());
  const typeCode = CONTRACT_TYPE_CODES[input.contractType];
  const branchCode = sanitizeScopeCode(input.branchCode) ?? 'HQ';
  const teamCode = sanitizeScopeCode(input.teamCode) ?? 'ALL';
  const scopeKey = `${typeCode}|${branchCode}|${teamCode}|${yyyy}`;

  const rows = await tx.$queryRaw<Array<{ lastSerial: number }>>`
    INSERT INTO "contract_number_sequence" ("id", "scopeKey", "lastSerial")
    VALUES (${randomUUID()}, ${scopeKey}, 1)
    ON CONFLICT ("scopeKey") DO UPDATE
      SET "lastSerial" = "contract_number_sequence"."lastSerial" + 1
    RETURNING "lastSerial"
  `;
  const serial = rows[0]?.lastSerial;
  if (typeof serial !== 'number') {
    throw new Error(`contract number sequence upsert returned no row for scopeKey=${scopeKey}`);
  }
  return `${typeCode}-${branchCode}-${teamCode}-${yyyy}-${String(serial).padStart(4, '0')}`;
}

/** 应收计划编号（前缀 PP）。 */
export function nextPlanNo(now?: Date): string {
  return makeBusinessNo('PP', now);
}

/** 收款编号（前缀 PY）。 */
export function nextPaymentNo(now?: Date): string {
  return makeBusinessNo('PY', now);
}

/** 谈案编号（前缀 NE）。 */
export function nextNegotiationNo(now?: Date): string {
  return makeBusinessNo('NE', now);
}

/** 分析委托编号（前缀 AE）。 */
export function nextEngagementNo(now?: Date): string {
  return makeBusinessNo('AE', now);
}

/** 案件编号（前缀 CA）。 */
export function nextCaseNo(now?: Date): string {
  return makeBusinessNo('CA', now);
}

/** 开票申请编号（前缀 INV）。 */
export function nextInvoiceNo(now?: Date): string {
  return makeBusinessNo('INV', now);
}

/** 退款/减免申请编号（前缀 RF）。 */
export function nextRefundNo(now?: Date): string {
  return makeBusinessNo('RF', now);
}
