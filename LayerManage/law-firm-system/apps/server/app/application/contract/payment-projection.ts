// SPEC-010 Task 9: payment-projection —— Payment/PaymentPlan → 输出视图投影（FIN-01）。
// 结构逐段镜像 contract-projection.ts：金额 Decimal→string toFixed(2)（D3 先例——内存态
// Decimal 丢尾零，schema Decimal(18,2) scale 钉死，create 视图与 get/list 视图一致）；
// 日期保持 Date 对象（JSON 序列化即 ISO 串，同 ContractView/NegotiationView 形态）。
// PaymentView 为全字段投影：金额非 L3 不脱敏（设计 §8 决策，以数据范围+动作权限控制）；
// deletedAt 不入视图。视图类型与投影函数同文件（协调者裁决 7）。
// PaymentPlan.status 词汇 PENDING|PARTIAL|RECEIVED|OVERDUE（schema 注释）——OVERDUE
// 永不落库（逾期=查询时推导，协调者裁决），视图类型保留词位供查询层推导复用。

import { Payment, PaymentPlan } from '@prisma/client';

import { PaymentStatus } from '../../domain/events/event-types';
import { formatAmount } from './contract-projection';

/** PaymentPlan.status 存储词汇；OVERDUE 仅为查询推导位，任何写入路径不得落库。 */
export type PaymentPlanStatus = 'PENDING' | 'PARTIAL' | 'RECEIVED' | 'OVERDUE';

/** Payment 输出视图：全字段投影（无 L3 字段，金额不脱敏），不含 deletedAt。 */
export interface PaymentView {
  linkedCase?: { id: string; caseNo: string; title: string } | null;
  id: string;
  paymentNo: string;
  contractId: string;
  paymentPlanId: string | null;
  customerId: string;
  amount: string;
  method: string | null;
  account: string | null;
  paidAt: Date | null;
  status: PaymentStatus;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  /** SPEC-011 Task 7：冲销三字段投影（voidedBy/voidedAt Date 保持、voidReason 文本直投）。 */
  voidedBy: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  remark: string | null;
  createdBy: string;
  updatedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** PaymentPlan 输出视图：金额 toFixed(2)；PaymentPlan 无 deletedAt/updatedBy 列。 */
export interface PaymentPlanView {
  id: string;
  planNo: string;
  contractId: string;
  period: number;
  dueDate: Date;
  amount: string;
  receivedAmount: string;
  status: PaymentPlanStatus;
  version: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Payment 全字段投影：amount 以 toFixed(2) 输出（formatAmount 共享 contract-projection 纪律）。 */
export function projectPayment(payment: Payment & { contract?: { case: { id: string; caseNo: string; title: string } | null } }): PaymentView {
  return {
    ...( payment.contract ? { linkedCase: payment.contract.case } : {}),
    id: payment.id,
    paymentNo: payment.paymentNo,
    contractId: payment.contractId,
    paymentPlanId: payment.paymentPlanId,
    customerId: payment.customerId,
    amount: formatAmount(payment.amount),
    method: payment.method,
    account: payment.account,
    paidAt: payment.paidAt,
    status: payment.status as PaymentStatus,
    confirmedBy: payment.confirmedBy,
    confirmedAt: payment.confirmedAt,
    voidedBy: payment.voidedBy,
    voidedAt: payment.voidedAt,
    voidReason: payment.voidReason,
    remark: payment.remark,
    createdBy: payment.createdBy,
    updatedBy: payment.updatedBy,
    version: payment.version,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

/** PaymentPlan 全字段投影：amount/receivedAmount 以 toFixed(2) 输出。 */
export function projectPaymentPlan(plan: PaymentPlan): PaymentPlanView {
  return {
    id: plan.id,
    planNo: plan.planNo,
    contractId: plan.contractId,
    period: plan.period,
    dueDate: plan.dueDate,
    amount: formatAmount(plan.amount),
    receivedAmount: formatAmount(plan.receivedAmount),
    status: plan.status as PaymentPlanStatus,
    version: plan.version,
    createdBy: plan.createdBy,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}
