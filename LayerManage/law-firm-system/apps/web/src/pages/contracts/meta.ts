// SPEC-010 Task 11: 谈案/合同/收款展示元数据与合同状态机按钮矩阵（contracts/payments/negotiations
// 各页面共享，先例：customers 页面复用 ../leads/meta）。
// availableContractActions 逐行镜像服务端 domain/contract/contract-policy.ts canTransitionContract
// 流转表（含政策门禁：approve 仅 requiresApproval 类型、effect 仅 generatesReceivable 类型、
// 终态 TERMINATED/VOID 无动作、voidable = DRAFT|PENDING_APPROVAL|PENDING_SIGN）。
import type { ContractAction, ContractStatus, ContractType } from '@/api/contract';
import type { NegotiationStatus } from '@/api/negotiation';
import type { PaymentPlanStatus, PaymentStatus } from '@/api/payment';
import type { PermissionCode } from '@/features/authorization/types';

export const CONTRACT_TYPE_META: Record<ContractType, { text: string; color: string }> = {
  FIRST_SIGN: { text: '首签合同', color: 'blue' },
  FORMAL: { text: '正式委托', color: 'geekblue' },
  SUPPLEMENT: { text: '补充协议', color: 'purple' },
  RISK_NOTICE: { text: '风险告知书', color: 'orange' },
};

export const CONTRACT_STATUS_META: Record<ContractStatus, { text: string; color: string }> = {
  DRAFT: { text: '草稿', color: 'default' },
  PENDING_APPROVAL: { text: '待审批', color: 'gold' },
  PENDING_SIGN: { text: '待签署', color: 'blue' },
  SIGNED: { text: '已签署', color: 'cyan' },
  EFFECTIVE: { text: '已生效', color: 'green' },
  TERMINATED: { text: '已终止', color: 'red' },
  VOID: { text: '已作废', color: 'default' },
};

export const NEGOTIATION_STATUS_META: Record<NegotiationStatus, { text: string; color: string }> = {
  NEGOTIATING: { text: '谈案中', color: 'blue' },
  SIGNED: { text: '已签约', color: 'green' },
  UNSIGNED: { text: '未签约', color: 'default' },
};

export const PAYMENT_STATUS_META: Record<PaymentStatus, { text: string; color: string }> = {
  PENDING: { text: '待确认', color: 'gold' },
  CONFIRMED: { text: '已确认', color: 'green' },
  REFUNDED: { text: '已退款', color: 'red' },
  // SPEC-011 Task 11：冲销（FIN-03）——VOIDED 词汇并入收款状态矩阵。
  VOIDED: { text: '已冲销', color: 'default' },
};

export const PAYMENT_PLAN_STATUS_META: Record<PaymentPlanStatus, { text: string; color: string }> = {
  PENDING: { text: '待收款', color: 'gold' },
  PARTIAL: { text: '部分收款', color: 'blue' },
  RECEIVED: { text: '已收齐', color: 'green' },
  OVERDUE: { text: '已逾期', color: 'red' },
  // SPEC-012 Task 6：终止联动——已取消计划以默认灰标签呈现（词位「已取消」）。
  CANCELLED: { text: '已取消', color: 'default' },
};

export const CONTRACT_ACTION_META: Record<ContractAction, { text: string; permission: PermissionCode; danger?: boolean }> = {
  submit: { text: '提交', permission: 'contract.submit' },
  approve: { text: '审批通过', permission: 'contract.approve' },
  reject: { text: '驳回', permission: 'contract.approve' },
  sign: { text: '签署', permission: 'contract.sign' },
  effect: { text: '生效', permission: 'contract.effect' },
  terminate: { text: '终止', permission: 'contract.terminate', danger: true },
  void: { text: '作废', permission: 'contract.void', danger: true },
};

/** 镜像 contract-policy.ts CONTRACT_TYPE_POLICY。 */
const CONTRACT_TYPE_POLICY: Readonly<Record<ContractType, { requiresApproval: boolean; generatesReceivable: boolean }>> = {
  FIRST_SIGN: { requiresApproval: true, generatesReceivable: true },
  FORMAL: { requiresApproval: true, generatesReceivable: true },
  SUPPLEMENT: { requiresApproval: true, generatesReceivable: true },
  RISK_NOTICE: { requiresApproval: false, generatesReceivable: false },
};

const VOIDABLE_STATUSES: ReadonlySet<ContractStatus> = new Set<ContractStatus>([
  'DRAFT',
  'PENDING_APPROVAL',
  'PENDING_SIGN',
]);

/**
 * 合同状态机按钮可用性矩阵（与后端 canTransitionContract 一致）：
 *   DRAFT→提交/作废；PENDING_APPROVAL→审批/驳回/作废；PENDING_SIGN→签署/作废；
 *   SIGNED→生效（RISK_NOTICE 无生效——签署即终态）；EFFECTIVE→终止；TERMINATED/VOID→无动作。
 */
export function availableContractActions(type: ContractType, status: ContractStatus): ContractAction[] {
  if (status === 'TERMINATED' || status === 'VOID') return [];
  const policy = CONTRACT_TYPE_POLICY[type];
  const actions: ContractAction[] = [];
  switch (status) {
    case 'DRAFT':
      actions.push('submit');
      break;
    case 'PENDING_APPROVAL':
      if (policy.requiresApproval) actions.push('approve', 'reject');
      break;
    case 'PENDING_SIGN':
      actions.push('sign');
      break;
    case 'SIGNED':
      if (policy.generatesReceivable) actions.push('effect');
      break;
    case 'EFFECTIVE':
      actions.push('terminate');
      break;
    default:
      break;
  }
  if (VOIDABLE_STATUSES.has(status)) actions.push('void');
  return actions;
}
