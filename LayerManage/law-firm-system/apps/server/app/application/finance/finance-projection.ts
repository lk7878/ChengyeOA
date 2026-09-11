// SPEC-011 Task 5: finance-projection —— InvoiceRequest/RefundRequest/CostEntry → 输出视图投影。
// 形态逐段镜像 contract/payment-projection.ts：金额 Decimal→string toFixed(2)（formatAmount
// 共享 contract-projection 纪律）；日期保持 Date 对象（JSON 序列化即 ISO 串）。三视图均为
// 全字段投影：金额非 L3 不脱敏（设计 §8 决策，以数据范围+动作权限控制）。InvoiceRequest/
// RefundRequest 模型本无 deletedAt 列，CostEntryView 按 brief 钉死不含 deletedAt。

import { CostEntry, InvoiceRequest, RefundRequest } from '@prisma/client';

import {
  CostCategory,
  InvoiceStatus,
  RefundRequestStatus,
  RefundRequestType,
} from '../../domain/finance/finance-types';
import { formatAmount } from '../contract/contract-projection';

/** InvoiceRequest 输出视图：全字段投影（无 deletedAt——模型本无该列），amount toFixed(2)。 */
export interface InvoiceRequestView {
  linkedCase?: { id: string; caseNo: string; title: string } | null;
  id: string;
  requestNo: string;
  contractId: string;
  customerId: string;
  amount: string;
  reason: string | null;
  status: InvoiceStatus;
  approvedBy: string | null;
  approvedAt: Date | null;
  approvalComment: string | null;
  invoiceNo: string | null;
  completedBy: string | null;
  completedAt: Date | null;
  createdBy: string;
  updatedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** RefundRequest 输出视图：全字段投影（无 deletedAt——模型本无该列），amount toFixed(2)。 */
export interface RefundRequestView {
  linkedCase?: { id: string; caseNo: string; title: string } | null;
  id: string;
  requestNo: string;
  type: RefundRequestType;
  contractId: string;
  customerId: string;
  paymentId: string | null;
  planId: string | null;
  amount: string;
  reason: string;
  status: RefundRequestStatus;
  approvedBy: string | null;
  approvedAt: Date | null;
  approvalComment: string | null;
  executedBy: string | null;
  executedAt: Date | null;
  createdBy: string;
  updatedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** CostEntry 输出视图：amount toFixed(2)；deletedAt 不入视图（软删列不外泄，同 PaymentView 纪律）。 */
export interface CostEntryView {
  sourceApprovalId?: string | null;
  id: string;
  category: CostCategory;
  amount: string;
  occurredAt: Date;
  note: string | null;
  channelId: string | null;
  caseId: string | null;
  createdBy: string;
  updatedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** InvoiceRequest 全字段投影：amount 以 toFixed(2) 输出。 */
export function projectInvoiceRequest(invoice: InvoiceRequest & { contract?: { case: { id: string; caseNo: string; title: string } | null } }): InvoiceRequestView {
  return {
    ...( invoice.contract ? { linkedCase: invoice.contract.case } : {}),
    id: invoice.id,
    requestNo: invoice.requestNo,
    contractId: invoice.contractId,
    customerId: invoice.customerId,
    amount: formatAmount(invoice.amount),
    reason: invoice.reason,
    status: invoice.status as InvoiceStatus,
    approvedBy: invoice.approvedBy,
    approvedAt: invoice.approvedAt,
    approvalComment: invoice.approvalComment,
    invoiceNo: invoice.invoiceNo,
    completedBy: invoice.completedBy,
    completedAt: invoice.completedAt,
    createdBy: invoice.createdBy,
    updatedBy: invoice.updatedBy,
    version: invoice.version,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  };
}

/** RefundRequest 全字段投影：amount 以 toFixed(2) 输出。 */
export function projectRefundRequest(refund: RefundRequest & { contract?: { case: { id: string; caseNo: string; title: string } | null } }): RefundRequestView {
  return {
    ...( refund.contract ? { linkedCase: refund.contract.case } : {}),
    id: refund.id,
    requestNo: refund.requestNo,
    type: refund.type as RefundRequestType,
    contractId: refund.contractId,
    customerId: refund.customerId,
    paymentId: refund.paymentId,
    planId: refund.planId,
    amount: formatAmount(refund.amount),
    reason: refund.reason,
    status: refund.status as RefundRequestStatus,
    approvedBy: refund.approvedBy,
    approvedAt: refund.approvedAt,
    approvalComment: refund.approvalComment,
    executedBy: refund.executedBy,
    executedAt: refund.executedAt,
    createdBy: refund.createdBy,
    updatedBy: refund.updatedBy,
    version: refund.version,
    createdAt: refund.createdAt,
    updatedAt: refund.updatedAt,
  };
}

/** CostEntry 全字段投影：amount 以 toFixed(2) 输出；deletedAt 不入视图。 */
export function projectCostEntry(entry: CostEntry): CostEntryView {
  return {
    sourceApprovalId: entry.sourceApprovalId,
    id: entry.id,
    category: entry.category as CostCategory,
    amount: formatAmount(entry.amount),
    occurredAt: entry.occurredAt,
    note: entry.note,
    channelId: entry.channelId,
    caseId: entry.caseId,
    createdBy: entry.createdBy,
    updatedBy: entry.updatedBy,
    version: entry.version,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}
