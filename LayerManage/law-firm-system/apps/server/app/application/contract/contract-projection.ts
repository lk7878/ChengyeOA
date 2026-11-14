// SPEC-010 Task 7: contract-projection —— Contract → ContractView 全字段投影。
// 独立成文件供 Task 7 服务 A 与 Task 8 生效段共用（Task 6 projectNegotiation 为模块内
// 私有函数；合同投影被两个服务消费故提升）。金额以 toFixed(2) 投影（D3 先例：内存态
// Decimal 丢尾零，schema Decimal(18,2) scale 钉死，create 视图与 get/list 视图一致）。
// esignCallbackPayload（CON-05 预留原始回调 JSON）与 deletedAt 不入视图。

import { Contract, Prisma } from '@prisma/client';

import { ContractStatus, ContractType } from '../../domain/contract/contract-policy';
import { ContractSourceType } from '../../domain/events/event-types';
import { ContractView } from './contract-types';

/** Contract 全字段投影：金额 Decimal→string 不脱敏（设计 §8），无 L3 字段。 */
export function projectContract(contract: Contract): ContractView {
  return {
    id: contract.id,
    contractNo: contract.contractNo,
    contractType: contract.contractType as ContractType,
    title: contract.title,
    customerId: contract.customerId,
    sourceType: contract.sourceType as ContractSourceType,
    sourceId: contract.sourceId,
    negotiationId: contract.negotiationId,
    parentContractId: contract.parentContractId,
    templateCode: contract.templateCode,
    templateVersion: contract.templateVersion,
    branchId: contract.branchId,
    professionalTeamId: contract.professionalTeamId,
    amount: formatAmount(contract.amount),
    receivedAmount: formatAmount(contract.receivedAmount),
    status: contract.status as ContractStatus,
    submittedBy: contract.submittedBy,
    submittedAt: contract.submittedAt,
    approvedBy: contract.approvedBy,
    approvedAt: contract.approvedAt,
    approvalComment: contract.approvalComment,
    signDate: contract.signDate,
    esignLinkId: contract.esignLinkId,
    esignSerialNo: contract.esignSerialNo,
    esignStatus: contract.esignStatus,
    effectiveDate: contract.effectiveDate,
    terminatedAt: contract.terminatedAt,
    terminateReason: contract.terminateReason,
    voidedAt: contract.voidedAt,
    voidReason: contract.voidReason,
    startDate: contract.startDate,
    endDate: contract.endDate,
    paymentTerms: contract.paymentTerms,
    terms: contract.terms,
    createdBy: contract.createdBy,
    updatedBy: contract.updatedBy,
    version: contract.version,
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
  };
}

/**
 * 金额投影：schema 为 Decimal(18,2)，统一钉 scale=2 输出——create 视图（内存 Decimal 可能
 * 丢尾零，如 '12800.5'）与 get/list 视图（DB 回读 scale=2）因此保持一致（D3 先例）。
 * 合同 amount/receivedAmount 非空（schema @default(0)），故签名不收 null。
 */
export function formatAmount(amount: Prisma.Decimal): string {
  return amount.toFixed(2);
}
