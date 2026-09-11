// SPEC-011 Task 3: finance-policy 领域纯函数。不依赖 Prisma、不依赖 Egg、不连数据库。
// 状态机（设计 §6.1）：
//   InvoiceRequest: approve PENDING→APPROVED；reject PENDING→REJECTED；complete APPROVED→COMPLETED
//   RefundRequest:  approve PENDING→APPROVED；reject PENDING→REJECTED；execute APPROVED→EXECUTED
// 终态防线先于流转表。成本锚点矩阵（设计 §5.3）：CHANNEL→channelId 必填、caseId 禁填；
// EVIDENCE/CASE_HANDLING→caseId 必填、channelId 禁填；LABOR/OFFICE→两锚均禁填。

import {
  COST_CATEGORIES,
  CostCategory,
  InvoiceStatus,
  RefundRequestStatus,
} from './finance-types';
import { COST_ANCHOR_FORBIDDEN, COST_ANCHOR_REQUIRED, FinanceError } from './finance-errors';

export type InvoiceAction = 'approve' | 'reject' | 'complete';
export type RefundRequestAction = 'approve' | 'reject' | 'execute';

const INVOICE_TERMINAL: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>(['REJECTED', 'COMPLETED']);
const REFUND_TERMINAL: ReadonlySet<RefundRequestStatus> = new Set<RefundRequestStatus>(['REJECTED', 'EXECUTED']);

export function canTransitionInvoice(from: InvoiceStatus, action: InvoiceAction): InvoiceStatus | null {
  if (INVOICE_TERMINAL.has(from)) return null;
  switch (action) {
    case 'approve': return from === 'PENDING' ? 'APPROVED' : null;
    case 'reject': return from === 'PENDING' ? 'REJECTED' : null;
    case 'complete': return from === 'APPROVED' ? 'COMPLETED' : null;
    default: return null;
  }
}

export function canTransitionRefundRequest(
  from: RefundRequestStatus,
  action: RefundRequestAction,
): RefundRequestStatus | null {
  if (REFUND_TERMINAL.has(from)) return null;
  switch (action) {
    case 'approve': return from === 'PENDING' ? 'APPROVED' : null;
    case 'reject': return from === 'PENDING' ? 'REJECTED' : null;
    case 'execute': return from === 'APPROVED' ? 'EXECUTED' : null;
    default: return null;
  }
}

/** 成本锚点矩阵校验：违反抛 FinanceError（REQUIRED/FORBIDDEN 400）。channelId/caseId 传 null 表未提供。 */
export function assertCostAnchorShape(
  category: CostCategory,
  channelId: string | null,
  caseId: string | null,
): void {
  if (!COST_CATEGORIES.includes(category)) {
    throw new FinanceError(COST_ANCHOR_REQUIRED, 400, `unknown cost category ${String(category)}`);
  }
  if (category === 'CHANNEL') {
    if (channelId === null) throw new FinanceError(COST_ANCHOR_REQUIRED, 400, 'CHANNEL cost requires channelId');
    if (caseId !== null) throw new FinanceError(COST_ANCHOR_FORBIDDEN, 400, 'CHANNEL cost forbids caseId');
    return;
  }
  if (category === 'EVIDENCE' || category === 'CASE_HANDLING') {
    if (caseId === null) throw new FinanceError(COST_ANCHOR_REQUIRED, 400, `${category} cost requires caseId`);
    if (channelId !== null) throw new FinanceError(COST_ANCHOR_FORBIDDEN, 400, `${category} cost forbids channelId`);
    return;
  }
  if (category === 'REIMBURSEMENT') {
    if (channelId !== null) throw new FinanceError(COST_ANCHOR_FORBIDDEN, 400, 'REIMBURSEMENT forbids channelId');
    return;
  }
  // LABOR / OFFICE：两锚均禁填。
  if (channelId !== null) throw new FinanceError(COST_ANCHOR_FORBIDDEN, 400, `${category} cost forbids channelId`);
  if (caseId !== null) throw new FinanceError(COST_ANCHOR_FORBIDDEN, 400, `${category} cost forbids caseId`);
}
